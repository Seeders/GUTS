class ComponentGenerator {
    constructor(components, collections = null) {
        this.components = components;
        this.collections = collections;
        // Build enum lookup maps for components that define enums
        this._enumMaps = {};
        // Global lookup: string value -> enum map (for auto-detection)
        this._valueToEnumMap = {};
        // Collection-based enum maps (dynamically generated from collections)
        this._collectionEnumMaps = {};
        // Singular field name -> collection name map (e.g., "level" -> "levels")
        this._singularToCollection = {};

        this._buildEnumMaps();
        if (collections) {
            this._buildCollectionEnumMaps();
        }

        // Expanded component schemas (with $fixedArray and $bitmask resolved)
        this._expandedSchemas = {};
        this._expandSchemas();
    }

    /**
     * Build string->index lookup maps for components with enum definitions
     */
    _buildEnumMaps() {
        for (const componentId in this.components) {
            const model = this.components[componentId];
            if (model.enum && Array.isArray(model.enum)) {
                // Create lookup map: string -> index
                const enumMap = {};
                for (let i = 0; i < model.enum.length; i++) {
                    enumMap[model.enum[i]] = i;
                    // Also add to global value->enumMap lookup for auto-detection
                    // If multiple enums have same value, first one wins
                    if (!this._valueToEnumMap[model.enum[i]]) {
                        this._valueToEnumMap[model.enum[i]] = {
                            toIndex: null, // Will be set after loop
                            toValue: model.enum,
                            sourceComponent: componentId
                        };
                    }
                }
                this._enumMaps[componentId] = {
                    toIndex: enumMap,
                    toValue: model.enum
                };
            }
        }
        // Fix up the global lookup references
        for (const value in this._valueToEnumMap) {
            const ref = this._valueToEnumMap[value];
            ref.toIndex = this._enumMaps[ref.sourceComponent].toIndex;
        }
    }

    /**
     * Build enum maps for all collection types dynamically
     * Keys are sorted alphabetically to ensure deterministic indices
     */
    _buildCollectionEnumMaps() {
        if (!this.collections) return;

        // First, process the dedicated enums collection if it exists
        const enumsCollection = this.collections.enums;
        if (enumsCollection && typeof enumsCollection === 'object') {
            for (const enumName in enumsCollection) {
                const enumDef = enumsCollection[enumName];
                if (enumDef && Array.isArray(enumDef.enum)) {
                    const enumValues = enumDef.enum;
                    const enumMap = {};

                    for (let i = 0; i < enumValues.length; i++) {
                        enumMap[enumValues[i]] = i;
                    }

                    this._collectionEnumMaps[enumName] = {
                        toIndex: enumMap,
                        toValue: enumValues
                    };
                }
            }
        }

        // Build singular -> collection name map from objectTypeDefinitions
        const objectTypeDefs = this.collections.objectTypeDefinitions;
        if (objectTypeDefs && typeof objectTypeDefs === 'object') {
            for (const defKey in objectTypeDefs) {
                const def = objectTypeDefs[defKey];
                if (def && def.singular && def.id) {
                    // Map singular (lowercase) to collection id
                    // e.g., "level" -> "levels", "world" -> "worlds"
                    this._singularToCollection[def.singular.toLowerCase()] = def.id;
                }
            }
        }

        // Generate enum maps for every other collection (using keys)
        for (const collectionName in this.collections) {
            if (collectionName === 'enums') continue; // Already processed
            const collection = this.collections[collectionName];
            // Skip non-object collections and special keys
            if (!collection || typeof collection !== 'object' || Array.isArray(collection)) continue;

            // Get keys and sort alphabetically for deterministic ordering
            const sortedKeys = Object.keys(collection).sort();
            const enumMap = {};

            for (let i = 0; i < sortedKeys.length; i++) {
                enumMap[sortedKeys[i]] = i;
            }

            this._collectionEnumMaps[collectionName] = {
                toIndex: enumMap,
                toValue: sortedKeys
            };
        }
    }

    /**
     * Expand all component schemas, resolving $fixedArray and $bitmask directives
     */
    _expandSchemas() {
        for (const componentId in this.components) {
            const model = this.components[componentId];
            const schema = model.schema || model;
            this._expandedSchemas[componentId] = this._expandSchema(schema);
        }
    }

    /**
     * Recursively expand a schema object
     */
    _expandSchema(schema) {
        const result = {};

        for (const key in schema) {
            const value = schema[key];

            if (value && typeof value === 'object' && !Array.isArray(value)) {
                if (value.$fixedArray) {
                    // Expand fixed array into individual fields
                    Object.assign(result, this._expandFixedArray(key, value.$fixedArray));
                } else if (value.$bitmask) {
                    // Expand bitmask into individual numeric fields
                    Object.assign(result, this._expandBitmask(key, value.$bitmask));
                } else if (value.$enum) {
                    // Expand enum to numeric default (0)
                    result[key] = 0;
                } else {
                    // Recursively expand nested objects
                    result[key] = this._expandSchema(value);
                }
            } else {
                result[key] = value;
            }
        }

        return result;
    }

    /**
     * Expand a $fixedArray directive into individual fields
     * { "$fixedArray": { "size": 5, "default": -1 } }
     * { "$fixedArray": { "size": 5, "default": 0, "fields": ["vx", "vz", "frame"] } }
     */
    _expandFixedArray(baseName, config) {
        const result = {};
        const size = config.size || 0;
        const defaultValue = config.default !== undefined ? config.default : 0;
        const fields = config.fields;

        if (fields && Array.isArray(fields)) {
            // Multi-field array: baseName_vx0, baseName_vz0, baseName_frame0, etc.
            for (let i = 0; i < size; i++) {
                for (const field of fields) {
                    result[`${baseName}_${field}${i}`] = defaultValue;
                }
            }
        } else {
            // Simple array: baseName0, baseName1, etc.
            for (let i = 0; i < size; i++) {
                result[`${baseName}${i}`] = defaultValue;
            }
        }

        return result;
    }

    /**
     * Expand a $bitmask directive into individual numeric fields
     * { "$bitmask": { "size": 64 } } -> 2 fields (32 bits each)
     * { "$bitmask": { "sizeFrom": "units" } } -> fields based on collection size
     */
    _expandBitmask(baseName, config) {
        const result = {};
        let bitCount;

        if (config.sizeFrom) {
            // Get size from collection/enum
            const enumMap = this._collectionEnumMaps[config.sizeFrom];
            bitCount = enumMap ? enumMap.toValue.length : 32;
        } else {
            bitCount = config.size || 32;
        }

        // Calculate number of 32-bit fields needed
        const fieldCount = Math.ceil(bitCount / 32);

        for (let i = 0; i < fieldCount; i++) {
            result[`${baseName}${i}`] = 0;
        }

        return result;
    }

    /**
     * Find an enum map that contains the given value (auto-detection)
     */
    findEnumMapForValue(value) {
        const ref = this._valueToEnumMap[value];
        return ref ? { toIndex: ref.toIndex, toValue: ref.toValue } : null;
    }

    /**
     * Get enum maps for external use (e.g., for comparisons)
     */
    getEnumMap(enumName) {
        // Check collection-based enums first, then component-based
        return this._collectionEnumMaps[enumName] || this._enumMaps[enumName];
    }

    /**
     * Get all enum maps as a convenient lookup object (key → index)
     * Returns: { team: { neutral: 0, hostile: 1, left: 2, right: 3 }, element: { ... }, ... }
     */
    getEnums() {
        const enums = {};
        // Add component-based enums
        for (const enumName in this._enumMaps) {
            enums[enumName] = this._enumMaps[enumName].toIndex;
        }
        // Add collection-based enums (may override component-based)
        for (const enumName in this._collectionEnumMaps) {
            enums[enumName] = this._collectionEnumMaps[enumName].toIndex;
        }
        return enums;
    }

    /**
     * Get reverse enum lookups (index → key)
     * Returns: { team: { 0: 'neutral', 1: 'hostile', 2: 'left', 3: 'right' }, ... }
     */
    getReverseEnums() {
        const reverseEnums = {};
        // Add component-based enums
        for (const enumName in this._enumMaps) {
            reverseEnums[enumName] = this._enumMaps[enumName].toValue;
        }
        // Add collection-based enums (may override component-based)
        for (const enumName in this._collectionEnumMaps) {
            reverseEnums[enumName] = this._collectionEnumMaps[enumName].toValue;
        }
        return reverseEnums;
    }

    /**
     * Get the expanded schema for a component (used for TypedArray field enumeration)
     */
    getSchema(componentId) {
        return this._expandedSchemas[componentId] || null;
    }

    /**
     * Get the original schema for a component (preserves $fixedArray, $bitmask directives)
     */
    getOriginalSchema(componentId) {
        const model = this.components[componentId];
        return model?.schema || model || null;
    }

    /**
     * Convert an array of enum strings to a bitmask
     * e.g., ["left", "right"] with enum ["neutral", "hostile", "left", "right"]
     * becomes: (1 << 2) | (1 << 3) = 0b1100 = 12
     * Special value "all" sets all bits
     */
    _arrayToBitmask(arr, enumMap) {
        if (!enumMap || !Array.isArray(arr)) return arr;

        let bitmask = 0;
        for (const item of arr) {
            if (item === 'all') {
                // Set all bits for all enum values
                bitmask = (1 << enumMap.toValue.length) - 1;
                break;
            }
            if (enumMap.toIndex.hasOwnProperty(item)) {
                bitmask |= (1 << enumMap.toIndex[item]);
            }
        }
        return bitmask;
    }

    /**
     * Find enum map for a field based on its name matching a collection
     * Uses endsWith matching like the editor does:
     * - "level" or "selectedLevel" -> matches "levels" collection via singular "level"
     * - "levels" or "allowedLevels" -> matches "levels" collection directly
     */
    findEnumMapForField(fieldName) {
        const lowerName = fieldName.toLowerCase();

        // Check exact match first for plural (collection name)
        if (this._collectionEnumMaps[lowerName]) {
            return this._collectionEnumMaps[lowerName];
        }

        // Check exact match for singular
        if (this._singularToCollection[lowerName]) {
            return this._collectionEnumMaps[this._singularToCollection[lowerName]];
        }

        // Check endsWith for plural (e.g., "allowedLevels" ends with "levels")
        for (const collectionName in this._collectionEnumMaps) {
            if (lowerName.endsWith(collectionName.toLowerCase())) {
                return this._collectionEnumMaps[collectionName];
            }
        }

        // Check endsWith for singular (e.g., "selectedLevel" ends with "level")
        for (const singular in this._singularToCollection) {
            if (lowerName.endsWith(singular)) {
                return this._collectionEnumMaps[this._singularToCollection[singular]];
            }
        }

        return null;
    }

    deepMerge(target, source, enumMap = null) {
        const result = { ...target };

        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(result[key] || {}, source[key], enumMap);
            } else {
                let value = source[key] == 'null' ? null : source[key];
                // Convert enum strings to indices
                // Priority: 1) component's enumMap, 2) field name -> collection mapping, 3) auto-detect by value
                if (typeof value === 'string') {
                    let map = enumMap && enumMap.toIndex.hasOwnProperty(value) ? enumMap : null;
                    if (!map) {
                        // Try field name -> collection mapping (e.g., "level" -> "levels" collection)
                        map = this.findEnumMapForField(key);
                        if (map && !map.toIndex.hasOwnProperty(value)) {
                            map = null; // Value not in collection, try auto-detect
                        }
                    }
                    if (!map) {
                        map = this.findEnumMapForValue(value);
                    }
                    if (map) {
                        value = map.toIndex[value];
                    }
                }
                // Convert arrays of enum strings to bitmask
                if (Array.isArray(value) && value.length > 0) {
                    const firstItem = value[0];
                    let map = enumMap && (firstItem === 'all' || enumMap.toIndex.hasOwnProperty(firstItem)) ? enumMap : null;
                    if (!map) {
                        map = this.findEnumMapForField(key);
                        if (map && firstItem !== 'all' && !map.toIndex.hasOwnProperty(firstItem)) {
                            map = null;
                        }
                    }
                    if (!map) {
                        map = this.findEnumMapForValue(firstItem);
                    }
                    if (map) {
                        value = this._arrayToBitmask(value, map);
                    }
                }
                result[key] = value;
            }
        }

        // Also convert default values from target if they're enum strings or arrays
        for (const key in result) {
            const value = result[key];
            if (typeof value === 'string') {
                let map = enumMap && enumMap.toIndex.hasOwnProperty(value) ? enumMap : null;
                if (!map) {
                    map = this.findEnumMapForField(key);
                    if (map && !map.toIndex.hasOwnProperty(value)) {
                        map = null;
                    }
                }
                if (!map) {
                    map = this.findEnumMapForValue(value);
                }
                if (map) {
                    result[key] = map.toIndex[value];
                }
            } else if (Array.isArray(value) && value.length > 0) {
                const firstItem = value[0];
                let map = enumMap && (firstItem === 'all' || enumMap.toIndex.hasOwnProperty(firstItem)) ? enumMap : null;
                if (!map) {
                    map = this.findEnumMapForField(key);
                    if (map && firstItem !== 'all' && !map.toIndex.hasOwnProperty(firstItem)) {
                        map = null;
                    }
                }
                if (!map) {
                    map = this.findEnumMapForValue(firstItem);
                }
                if (map) {
                    result[key] = this._arrayToBitmask(value, map);
                }
            }
        }

        return result;
    }

    getComponents() {
        let components = {};
        Object.keys(this.components).forEach((componentId) => {
            // Use pre-expanded schema
            const data = this._expandedSchemas[componentId];
            const enumMap = this._enumMaps[componentId] || null;
            components[componentId] = (params = {}) => {
                return this.deepMerge(data, params, enumMap);
            };
        });
        return components;
    }

}
