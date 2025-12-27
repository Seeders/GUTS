class BaseECSGame {
    constructor(app) {
        this.app = app;
        this.state = {};

        this.entitiesToAdd = [];
        this.classes = [];
        this.systems = [];

        // Scene management
        this.sceneManager = null;

        // Service registry
        this._services = new GUTS.GameServices();


        // ============================================
        // HIGH-PERFORMANCE ECS STORAGE (10k+ entities)
        // ============================================

        // Maximum entities - pre-allocate for performance
        this.MAX_ENTITIES = 65536; // Power of 2 for fast modulo

        // Entity management with TypedArrays
        // entityAlive[i] = 1 if entity i exists, 0 if free slot
        this.entityAlive = new Uint8Array(this.MAX_ENTITIES);
        // Component bitmask per entity (up to 32 component types with single Uint32)
        // For more components, we use multiple Uint32s
        this.entityComponentMask = new Uint32Array(this.MAX_ENTITIES * 2); // 64 component types max

        // Free entity ID pool for recycling
        this.freeEntityIds = new Uint32Array(this.MAX_ENTITIES);
        this.freeEntityCount = 0;
        this.nextEntityId = 1; // Start at 1, reserve 0 as "no entity"
        this.entityCount = 0;

        // Component type registry - maps component name to numeric ID (0-63)
        this._componentTypeId = new Map(); // componentName -> typeId
        this._componentTypeNames = []; // typeId -> componentName
        this._nextComponentTypeId = 0;

        // SoA (Structure of Arrays) storage for numeric components
        // Each numeric field gets its own Float32Array for cache-friendly iteration
        this._numericArrays = new Map(); // "componentType.field.path" -> Float32Array

        // Track which components are numeric-only (use TypedArrays)
        // Maps componentId -> { fields: ['field1', 'nested.field2'], isNumeric: true }
        this._numericComponentInfo = new Map();

        // Object storage for non-numeric/complex component data
        // Pre-allocated array of objects, indexed by entity ID
        this._objectComponents = new Map(); // componentType -> Array[MAX_ENTITIES]

        // Query cache for getEntitiesWith - stores reusable arrays to avoid allocations
        this._queryCache = new Map();

        // Delta sync tracking - stores last synced state for computing deltas
        this._lastSyncedState = null;

        // Client-only components - excluded from server sync to preserve client state
        // These components are managed locally and should not be overwritten by server
        this._clientOnlyComponents = new Set([
            'renderable',
            'animationState'
        ]);

        // Proxy cache for getComponent - avoids creating new proxies every call
        // Map: componentType -> Map(entityId -> proxy)
        this._proxyCache = new Map();

        // Pre-allocated result array for queries (avoids allocation in hot path)
        this._queryResultBuffer = new Uint32Array(this.MAX_ENTITIES);

        this.lastTime = 0;
        this.currentTime = 0;
        this.deltaTime = 0;
        this.tickCount = 0;

        // Fixed timestep for deterministic simulation (20 TPS = 0.05s per tick)
        this.FIXED_DELTA_TIME = 1/20;

        this.isServer = false;
        // Performance monitoring
        if (typeof GUTS !== 'undefined' && typeof GUTS.PerformanceMonitor !== 'undefined') {
            this.performanceMonitor = new GUTS.PerformanceMonitor();
        }

        // Call logging for debugging
        if (typeof GUTS !== 'undefined' && typeof GUTS.CallLogger !== 'undefined') {
            this.callLogger = new GUTS.CallLogger();
        }

        // Global seeded random instance - can be reseeded for deterministic simulation
        if (typeof GUTS !== 'undefined' && typeof GUTS.SeededRandom !== 'undefined') {
            this.rng = new GUTS.SeededRandom(Date.now());
        }

        // Initialize component type registry with common components
        this._initComponentTypes();
    }

    /**
     * Pre-register common component types and allocate their storage
     */
    _initComponentTypes() {

        const collections = this.getCollections();
        this.componentGenerator = new GUTS.ComponentGenerator(collections.components, collections);
        this.register("getComponents", this.getComponents.bind(this));
        this.register("getComponentSchema", this.getComponentSchema.bind(this));
        this.register("getEnumMap", this.getEnumMap.bind(this));
        this.register("getEnums", this.getEnums.bind(this));
        this.register("getReverseEnums", this.getReverseEnums.bind(this));
        this.register("getUnitTypeDef", this.getUnitTypeDef.bind(this));

        // Pre-register all component types in alphabetical order for deterministic type IDs
        // This ensures server and client have identical type ID mappings
        const componentNames = Object.keys(collections.components).sort();
        for (const componentName of componentNames) {
            this._getComponentTypeId(componentName);
        }
    }

    /**
     * Get or create a numeric component type ID
     */
    _getComponentTypeId(componentType) {
        let typeId = this._componentTypeId.get(componentType);
        if (typeId === undefined) {

            typeId = this._nextComponentTypeId++;
            this._componentTypeId.set(componentType, typeId);
            this._componentTypeNames[typeId] = componentType;
        }
        return typeId;
    }

    /**
     * Set component bit in entity's bitmask
     */
    _setComponentBit(entityId, componentTypeId) {
        const maskIndex = entityId * 2 + (componentTypeId >= 32 ? 1 : 0);
        const bit = componentTypeId % 32;
        this.entityComponentMask[maskIndex] |= (1 << bit);
    }

    /**
     * Clear component bit in entity's bitmask
     */
    _clearComponentBit(entityId, componentTypeId) {
        const maskIndex = entityId * 2 + (componentTypeId >= 32 ? 1 : 0);
        const bit = componentTypeId % 32;
        this.entityComponentMask[maskIndex] &= ~(1 << bit);
    }

    /**
     * Check if entity has component via bitmask
     */
    _hasComponentBit(entityId, componentTypeId) {
        const maskIndex = entityId * 2 + (componentTypeId >= 32 ? 1 : 0);
        const bit = componentTypeId % 32;
        return (this.entityComponentMask[maskIndex] & (1 << bit)) !== 0;
    }

    /**
     * Get or create Float32Array for a numeric field
     */
    _getNumericArray(key) {
        let arr = this._numericArrays.get(key);
        if (!arr) {
            arr = new Float32Array(this.MAX_ENTITIES);
            this._numericArrays.set(key, arr);
        }
        return arr;
    }

    /**
     * Get or create object storage array for a component type
     */
    _getObjectStorage(componentType) {
        let storage = this._objectComponents.get(componentType);
        if (!storage) {
            storage = new Array(this.MAX_ENTITIES);
            this._objectComponents.set(componentType, storage);
        }
        return storage;
    }

    /**
     * Analyze a component schema to determine if it's all-numeric
     * Returns { isNumeric: true, fields: ['field1', 'nested.field2'] } or { isNumeric: false }
     * Numbers, booleans (stored as 0/1), enum strings, and arrays of enum values (bitmasks) are all considered numeric.
     * @param {Object} schema - The component schema
     * @param {Object|null} enumMap - The enum map if this component has enums
     * @param {string} prefix - Path prefix for nested fields
     */
    _analyzeComponentSchema(schema, enumMap = null, prefix = '') {
        const fields = [];
        let isNumeric = true;

        for (const key in schema) {
            const value = schema[key];
            const fieldPath = prefix ? `${prefix}.${key}` : key;

            if (typeof value === 'number') {
                fields.push(fieldPath);
            } else if (typeof value === 'boolean') {
                // Booleans stored as 0/1 in TypedArrays
                fields.push(fieldPath);
            } else if (value === null) {
                // null fields stored as -Infinity in TypedArrays
                fields.push(fieldPath);
            } else if (typeof value === 'string' && enumMap && enumMap.toIndex.hasOwnProperty(value)) {
                // String that will be converted to enum index - treat as numeric
                fields.push(fieldPath);
            } else if (Array.isArray(value) && enumMap) {
                // Arrays of enum values will be converted to bitmask - treat as numeric
                // Check if array contains enum values or "all"
                const isEnumArray = value.every(item =>
                    item === 'all' || enumMap.toIndex.hasOwnProperty(item)
                );
                if (isEnumArray) {
                    fields.push(fieldPath);
                } else {
                    isNumeric = false;
                    break;
                }
            } else if (value && typeof value === 'object' && !Array.isArray(value)) {
                // Recursively check nested objects
                const nested = this._analyzeComponentSchema(value, enumMap, fieldPath);
                if (nested.isNumeric) {
                    fields.push(...nested.fields);
                } else {
                    isNumeric = false;
                    break;
                }
            } else {
                // String (non-enum), non-enum array, null, etc. - not purely numeric
                isNumeric = false;
                break;
            }
        }

        return { isNumeric, fields };
    }

    /**
     * Register a component type and set up storage (TypedArrays for numeric, object array otherwise)
     * Called when a component is first added
     */
    _setupComponentStorage(componentId, schema, enumMap = null) {
        if (this._numericComponentInfo.has(componentId)) {
            return; // Already set up
        }

        const analysis = this._analyzeComponentSchema(schema, enumMap);
        // Cache both schemas for getComponent:
        // - schema: expanded schema (used for TypedArray field enumeration)
        // - originalSchema: preserves $fixedArray directives for array proxy creation
        analysis.schema = schema;
        analysis.originalSchema = this.componentGenerator.getOriginalSchema(componentId);
        this._numericComponentInfo.set(componentId, analysis);

        if (analysis.isNumeric) {
            // Create TypedArrays for each field
            for (const fieldPath of analysis.fields) {
                const key = `${componentId}.${fieldPath}`;
                this._getNumericArray(key);
            }
        }
    }

    /**
     * Set a value in a numeric component's TypedArray storage
     * Note: Caller should use _toStorageValue() if passing user-provided values
     */
    _setNumericField(componentId, entityId, fieldPath, value) {
        const key = `${componentId}.${fieldPath}`;
        const arr = this._numericArrays.get(key);
        if (arr) {
            arr[entityId] = value;
        }
    }

    /**
     * Get a value from a numeric component's TypedArray storage (internal)
     * Converts -Infinity (null sentinel) back to null for API consumers
     */
    _getNumericField(componentId, entityId, fieldPath) {
        const key = `${componentId}.${fieldPath}`;
        const arr = this._numericArrays.get(key);
        if (!arr) return undefined;
        return this._fromStorageValue(arr[entityId]);
    }

    /**
     * Get raw value from TypedArray storage without null conversion (for internal use)
     */
    _getRawNumericField(componentId, entityId, fieldPath) {
        const key = `${componentId}.${fieldPath}`;
        const arr = this._numericArrays.get(key);
        return arr ? arr[entityId] : undefined;
    }

    /**
     * Direct field read - bypasses proxy for maximum performance in hot paths
     * Use for tight loops where proxy overhead matters (collision, pathfinding)
     * @param {number} entityId - Entity ID
     * @param {string} componentType - Component name (e.g., 'transform')
     * @param {string} fieldPath - Dot-separated path (e.g., 'position.x')
     * @returns {number|null} - Raw value, or null if field was null
     * @example
     * // Instead of: game.getComponent(id, 'transform').position.x
     * const x = game.getField(id, 'transform', 'position.x');
     */
    getField(entityId, componentType, fieldPath) {
        return this._getNumericField(componentType, entityId, fieldPath);
    }

    /**
     * Direct field write - bypasses proxy for maximum performance in hot paths
     * @param {number} entityId - Entity ID
     * @param {string} componentType - Component name (e.g., 'transform')
     * @param {string} fieldPath - Dot-separated path (e.g., 'position.x')
     * @param {number|null} value - Value to set
     * @example
     * // Instead of: game.getComponent(id, 'transform').position.x = 100
     * game.setField(id, 'transform', 'position.x', 100);
     */
    setField(entityId, componentType, fieldPath, value) {
        this._setNumericField(componentType, entityId, fieldPath, this._toStorageValue(value));
    }

    /**
     * Check if a field value represents null/unset
     * @param {number} value - Value from getField or direct TypedArray read
     * @returns {boolean} - True if value represents null
     */
    isNull(value) {
        return value === -Infinity || value === null;
    }

    // ============================================
    // NULL SENTINEL CONVERSION UTILITIES
    // ============================================
    // TypedArrays can't store null, so we use -Infinity as a sentinel value.
    // These methods provide consistent conversion at all boundaries:
    //   - _toStorageValue / _fromStorageValue: for TypedArray read/write
    //   - _toSyncValue / _fromSyncValue: for JSON serialization (sync)
    // ============================================

    /**
     * Convert API value to TypedArray storage format
     * null -> -Infinity (null sentinel), other values pass through
     */
    _toStorageValue(value) {
        return value === null ? -Infinity : value;
    }

    /**
     * Convert TypedArray storage value to API format
     * -Infinity (null sentinel) -> null, other values pass through
     */
    _fromStorageValue(value) {
        return value === -Infinity ? null : value;
    }

    /**
     * Convert TypedArray storage value to JSON-safe format for sync
     * -Infinity (null sentinel) -> null (JSON null), other values pass through
     * Note: This is the same as _fromStorageValue since JSON uses null
     */
    _toSyncValue(value) {
        return value === -Infinity ? null : value;
    }

    /**
     * Convert JSON sync value back to TypedArray storage format
     * null (JSON null) -> -Infinity (null sentinel), other values pass through
     * Note: This is the same as _toStorageValue since JSON uses null
     */
    _fromSyncValue(value) {
        return value === null ? -Infinity : value;
    }

    /**
     * Write component data to TypedArrays (for numeric components)
     * Handles numbers, booleans (as 0/1), and enum values (already converted to indices)
     */
    _writeNumericComponent(componentId, entityId, data, schema, prefix = '') {
        for (const key in schema) {
            const fieldPath = prefix ? `${prefix}.${key}` : key;
            const schemaValue = schema[key];
            let dataValue = prefix
                ? this._getNestedValue(data, fieldPath)
                : data[key];

            if (typeof schemaValue === 'number' || typeof schemaValue === 'boolean' || typeof schemaValue === 'string') {
                // Convert booleans to 0/1 for storage
                if (typeof dataValue === 'boolean') {
                    dataValue = dataValue ? 1 : 0;
                }
                // Use default from schema if data value is undefined
                if (dataValue === undefined) {
                    dataValue = typeof schemaValue === 'boolean' ? (schemaValue ? 1 : 0) : schemaValue;
                }
                this._setNumericField(componentId, entityId, fieldPath, dataValue);
            } else if (schemaValue === null) {
                // null schema fields: use null sentinel as default
                if (dataValue === undefined) {
                    dataValue = null;
                }
                this._setNumericField(componentId, entityId, fieldPath, this._toStorageValue(dataValue));
            } else if (schemaValue && typeof schemaValue === 'object' && !Array.isArray(schemaValue)) {
                this._writeNumericComponent(componentId, entityId, data, schemaValue, fieldPath);
            }
        }
    }

    /**
     * Read component data from TypedArrays and return as proxy object
     * Proxy reads/writes directly from TypedArrays on every access (no stale data)
     * Proxies are cached per entity+component to avoid GC churn
     */
    _readNumericComponent(componentId, entityId, schema, prefix = '') {
        // For top-level calls (no prefix), check proxy cache first
        if (!prefix) {
            let componentCache = this._proxyCache.get(componentId);
            if (!componentCache) {
                componentCache = new Map();
                this._proxyCache.set(componentId, componentCache);
            }
            const cached = componentCache.get(entityId);
            if (cached) {
                return cached;
            }
            // Create and cache the proxy
            const proxy = this._createComponentProxy(componentId, entityId, schema, '');
            componentCache.set(entityId, proxy);
            return proxy;
        }
        // Nested objects (with prefix) still create proxies but aren't cached separately
        return this._createComponentProxy(componentId, entityId, schema, prefix);
    }

    /**
     * Create a proxy that reads/writes directly from TypedArrays
     * Every property access goes through the proxy traps for live data
     */
    _createComponentProxy(componentId, entityId, schema, prefix) {
        const game = this;

        // Build schema info for fast lookups
        const schemaInfo = {};
        for (const key in schema) {
            const schemaValue = schema[key];
            schemaInfo[key] = {
                fieldPath: prefix ? `${prefix}.${key}` : key,
                type: schemaValue === null ? 'null' :
                      typeof schemaValue === 'boolean' ? 'boolean' :
                      (typeof schemaValue === 'number' || typeof schemaValue === 'string') ? 'number' :
                      (schemaValue && schemaValue.$fixedArray) ? 'fixedArray' :
                      (schemaValue && schemaValue.$bitmask) ? 'bitmask' :
                      (schemaValue && schemaValue.$enum) ? 'enum' :
                      (schemaValue && typeof schemaValue === 'object') ? 'nested' : 'unknown',
                schemaValue
            };
        }

        // Cache for nested proxies (fixedArray, bitmask, nested objects)
        const nestedCache = {};

        return new Proxy({}, {
            get(target, prop) {
                // Support JSON.stringify
                if (prop === 'toJSON') {
                    return () => {
                        const result = {};
                        for (const key in schemaInfo) {
                            const info = schemaInfo[key];
                            if (info.type === 'number' || info.type === 'enum') {
                                result[key] = game._getNumericField(componentId, entityId, info.fieldPath);
                            } else if (info.type === 'boolean') {
                                result[key] = game._getNumericField(componentId, entityId, info.fieldPath) !== 0;
                            } else if (info.type === 'null') {
                                result[key] = game._getNumericField(componentId, entityId, info.fieldPath);
                            } else if (info.type === 'fixedArray' || info.type === 'bitmask' || info.type === 'nested') {
                                // Trigger the getter to get the nested proxy, then toJSON it
                                const nested = nestedCache[key] || game._createNestedProxy(componentId, entityId, key, info, prefix);
                                result[key] = nested.toJSON ? nested.toJSON() : nested;
                            }
                        }
                        return result;
                    };
                }

                const info = schemaInfo[prop];
                if (!info) return undefined;

                if (info.type === 'number' || info.type === 'enum') {
                    return game._getNumericField(componentId, entityId, info.fieldPath);
                } else if (info.type === 'boolean') {
                    return game._getNumericField(componentId, entityId, info.fieldPath) !== 0;
                } else if (info.type === 'null') {
                    return game._getNumericField(componentId, entityId, info.fieldPath);
                } else if (info.type === 'fixedArray' || info.type === 'bitmask' || info.type === 'nested') {
                    // Cache nested proxies to avoid recreation
                    if (!nestedCache[prop]) {
                        nestedCache[prop] = game._createNestedProxy(componentId, entityId, prop, info, prefix);
                    }
                    return nestedCache[prop];
                }
                return undefined;
            },
            set(target, prop, value) {
                const info = schemaInfo[prop];
                if (!info) return false;

                let storedValue = value;
                if (info.type === 'boolean') {
                    storedValue = value ? 1 : 0;
                } else if (info.type === 'null') {
                    storedValue = game._toStorageValue(value);
                }

                if (info.type === 'number' || info.type === 'boolean' || info.type === 'null' || info.type === 'enum') {
                    game._setNumericField(componentId, entityId, info.fieldPath, storedValue);
                    return true;
                }
                return false;
            },
            ownKeys() {
                return Object.keys(schemaInfo);
            },
            getOwnPropertyDescriptor(target, prop) {
                if (prop in schemaInfo) {
                    return { configurable: true, enumerable: true };
                }
                return undefined;
            }
        });
    }

    /**
     * Create nested proxy for fixedArray, bitmask, or nested object
     */
    _createNestedProxy(componentId, entityId, key, info, prefix) {
        if (info.type === 'fixedArray') {
            return this._createFixedArrayProxy(componentId, entityId, key, info.schemaValue.$fixedArray, prefix);
        } else if (info.type === 'bitmask') {
            return this._createBitmaskProxy(componentId, entityId, key, info.schemaValue.$bitmask, prefix);
        } else if (info.type === 'nested') {
            return this._createComponentProxy(componentId, entityId, info.schemaValue, info.fieldPath);
        }
        return undefined;
    }

    /**
     * Create an array-like proxy for $fixedArray fields
     * Allows array[index] access that maps to individual TypedArray fields
     */
    _createFixedArrayProxy(componentId, entityId, baseName, config, prefix = '') {
        const game = this;
        // Support both static size and dynamic sizeFrom (enum-based)
        let size = config.size || 0;
        if (config.sizeFrom) {
            const enumMap = this.componentGenerator.getEnumMap(config.sizeFrom);
            size = enumMap?.toValue?.length || 0;
        }
        const fields = config.fields;
        const fieldPrefix = prefix ? `${prefix}.${baseName}` : baseName;

        if (fields && Array.isArray(fields)) {
            // Multi-field array: each element is an object with the specified fields
            // Fields stored as: baseName_field0, baseName_field1, etc.
            return new Proxy({}, {
                get(target, prop) {
                    if (prop === 'length') return size;
                    // Support JSON.stringify via toJSON
                    if (prop === 'toJSON') {
                        return () => {
                            const arr = [];
                            for (let i = 0; i < size; i++) {
                                const element = {};
                                for (const field of fields) {
                                    element[field] = game._getNumericField(componentId, entityId, `${fieldPrefix}_${field}${i}`);
                                }
                                arr[i] = element;
                            }
                            return arr;
                        };
                    }
                    const index = parseInt(prop, 10);
                    if (!isNaN(index) && index >= 0 && index < size) {
                        // Return object with all fields for this index
                        const element = {};
                        for (const field of fields) {
                            element[field] = game._getNumericField(componentId, entityId, `${fieldPrefix}_${field}${index}`);
                        }
                        // Return proxy for field writes
                        return new Proxy(element, {
                            set(t, f, v) {
                                t[f] = v;
                                game._setNumericField(componentId, entityId, `${fieldPrefix}_${f}${index}`, game._toStorageValue(v));
                                return true;
                            }
                        });
                    }
                    return undefined;
                },
                set(target, prop, value) {
                    const index = parseInt(prop, 10);
                    if (!isNaN(index) && index >= 0 && index < size && typeof value === 'object') {
                        for (const field of fields) {
                            if (value[field] !== undefined) {
                                game._setNumericField(componentId, entityId, `${fieldPrefix}_${field}${index}`, game._toStorageValue(value[field]));
                            }
                        }
                        return true;
                    }
                    return false;
                },
                ownKeys(target) {
                    const keys = [];
                    for (let i = 0; i < size; i++) {
                        keys.push(String(i));
                    }
                    return keys;
                },
                getOwnPropertyDescriptor(target, prop) {
                    const index = parseInt(prop, 10);
                    if (!isNaN(index) && index >= 0 && index < size) {
                        const element = {};
                        for (const field of fields) {
                            element[field] = game._getNumericField(componentId, entityId, `${fieldPrefix}_${field}${index}`);
                        }
                        return {
                            value: element,
                            writable: true,
                            enumerable: true,
                            configurable: true
                        };
                    }
                    return undefined;
                }
            });
        } else {
            // Simple array: baseName0, baseName1, etc.
            return new Proxy({}, {
                get(target, prop) {
                    if (prop === 'length') return size;
                    // Support JSON.stringify via toJSON
                    if (prop === 'toJSON') {
                        return () => {
                            const arr = [];
                            for (let i = 0; i < size; i++) {
                                arr[i] = game._getNumericField(componentId, entityId, `${fieldPrefix}${i}`);
                            }
                            return arr;
                        };
                    }
                    const index = parseInt(prop, 10);
                    if (!isNaN(index) && index >= 0 && index < size) {
                        return game._getNumericField(componentId, entityId, `${fieldPrefix}${index}`);
                    }
                    return undefined;
                },
                set(target, prop, value) {
                    const index = parseInt(prop, 10);
                    if (!isNaN(index) && index >= 0 && index < size) {
                        game._setNumericField(componentId, entityId, `${fieldPrefix}${index}`, game._toStorageValue(value));
                        return true;
                    }
                    return false;
                },
                ownKeys(target) {
                    // Return numeric indices as strings for JSON.stringify enumeration
                    const keys = [];
                    for (let i = 0; i < size; i++) {
                        keys.push(String(i));
                    }
                    return keys;
                },
                getOwnPropertyDescriptor(target, prop) {
                    const index = parseInt(prop, 10);
                    if (!isNaN(index) && index >= 0 && index < size) {
                        return {
                            value: game._getNumericField(componentId, entityId, `${fieldPrefix}${index}`),
                            writable: true,
                            enumerable: true,
                            configurable: true
                        };
                    }
                    return undefined;
                }
            });
        }
    }

    /**
     * Create a proxy for $bitmask fields
     * Bitmask is stored as individual 32-bit fields (baseName0, baseName1, etc.)
     * Returns a number representing the combined bitmask value
     */
    _createBitmaskProxy(componentId, entityId, baseName, config, prefix = '') {
        const game = this;
        let bitCount;

        if (config.sizeFrom) {
            const enumMap = this.componentGenerator.getEnumMap(config.sizeFrom);
            bitCount = enumMap?.toValue?.length || 32;
        } else {
            bitCount = config.size || 32;
        }

        const fieldCount = Math.ceil(bitCount / 32);
        const fieldPrefix = prefix ? `${prefix}.${baseName}` : baseName;

        // For simplicity, return a simple value for single-field bitmasks
        // and an array-like proxy for multi-field bitmasks
        if (fieldCount === 1) {
            // Single 32-bit field - just return the value with a toJSON
            const value = game._getNumericField(componentId, entityId, `${fieldPrefix}0`) || 0;
            return value;
        }

        // Multi-field bitmask - return array-like proxy
        return new Proxy({}, {
            get(target, prop) {
                if (prop === 'length') return fieldCount;
                if (prop === 'toJSON') {
                    return () => {
                        const arr = [];
                        for (let i = 0; i < fieldCount; i++) {
                            arr[i] = game._getNumericField(componentId, entityId, `${fieldPrefix}${i}`) || 0;
                        }
                        return arr;
                    };
                }
                const index = parseInt(prop, 10);
                if (!isNaN(index) && index >= 0 && index < fieldCount) {
                    return game._getNumericField(componentId, entityId, `${fieldPrefix}${index}`) || 0;
                }
                return undefined;
            },
            set(target, prop, value) {
                const index = parseInt(prop, 10);
                if (!isNaN(index) && index >= 0 && index < fieldCount) {
                    game._setNumericField(componentId, entityId, `${fieldPrefix}${index}`, game._toStorageValue(value));
                    return true;
                }
                return false;
            },
            ownKeys(target) {
                const keys = [];
                for (let i = 0; i < fieldCount; i++) {
                    keys.push(String(i));
                }
                return keys;
            },
            getOwnPropertyDescriptor(target, prop) {
                const index = parseInt(prop, 10);
                if (!isNaN(index) && index >= 0 && index < fieldCount) {
                    return {
                        value: game._getNumericField(componentId, entityId, `${fieldPrefix}${index}`) || 0,
                        writable: true,
                        enumerable: true,
                        configurable: true
                    };
                }
                return undefined;
            }
        });
    }

    /**
     * Get a nested value from an object using dot notation path
     */
    _getNestedValue(obj, path) {
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }
        return current;
    }

    // Service registry methods (delegated to GameServices)
    register(key, method) {
        this._services.register(key, method);
    }

    hasService(key) {
        return this._services.has(key);
    }

    call(key, ...args) {
        const result = this._services.call(key, ...args);
        if (this.callLogger) {
            this.callLogger.log(key, args, result, this.state.now);
        }
        return result;
    }

    listServices() {
        return this._services.listServices();
    }

    async init(isServer = false, config) {
        this.isServer = isServer;
        if(!this.isServer){
            document.addEventListener('keydown', (e) => {
                this.triggerEvent('onKeyDown', e.key);
            });
        }
        await this.loadGameScripts(config);
    }

    async loadGameScripts(config, options = {}) {
        this.collections = this.getCollections();
        this.gameConfig = config ? config : (this.isServer ? this.collections.configs.server : this.collections.configs.game);

        // Initialize SceneManager (handles lazy system instantiation)
        this.sceneManager = new GUTS.SceneManager(this);

        // Store available system types for lazy instantiation
        this.availableSystemTypes = this.gameConfig.systems || [];
        // Map to track instantiated systems by name
        this.systemsByName = new Map();

        // Load initial scene if configured (skip for editors that manage scene loading explicitly)
        if (!options.skipInitialScene) {
            await this.loadInitialScene();
        }
    }

    /**
     * Load the initial scene from game config
     * @returns {Promise<void>}
     */
    async loadInitialScene() {
        const initialScene = this.gameConfig.initialScene;
        if (initialScene && this.sceneManager) {
            await this.sceneManager.loadScene(initialScene);
        } else {
            console.warn('[BaseECSGame] No initialScene configured in game config');
        }
    }

    /**
     * Get or create a system by name (lazy instantiation)
     * @param {string} systemName - The system class name
     * @returns {Object|null} The system instance or null if not available
     */
    getOrCreateSystem(systemName) {
        // Check if already instantiated
        if (this.systemsByName.has(systemName)) {
            return this.systemsByName.get(systemName);
        }

        // Check if this system type is available (skip check if no whitelist defined)
        if (this.availableSystemTypes.length > 0 && !this.availableSystemTypes.includes(systemName)) {
            console.warn(`[BaseECSGame] System '${systemName}' not in available systems list`);
            return null;
        }

        // Check if the class exists
        if (!GUTS[systemName]) {
            console.error(`[BaseECSGame] System class '${systemName}' not found in GUTS`);
            return null;
        }

        // Create the system
        const params = { canvas: this.canvas };
        const systemInst = new GUTS[systemName](this);
        systemInst.enabled = false;

        // Auto-register services from static services array
        const SystemClass = GUTS[systemName];
        if (SystemClass.services && Array.isArray(SystemClass.services)) {
            for (const serviceName of SystemClass.services) {
                if (typeof systemInst[serviceName] === 'function') {
                    this.register(serviceName, systemInst[serviceName].bind(systemInst));
                } else {
                    console.warn(`[BaseECSGame] Service '${serviceName}' not found on ${systemName}`);
                }
            }
        }

        if (systemInst.init) {
            systemInst.init(params);
        }

        // Add to tracking
        this.systems.push(systemInst);
        this.systemsByName.set(systemName, systemInst);

        return systemInst;
    }

    /**
     * Check if a system is available (defined in config)
     * @param {string} systemName - The system class name
     * @returns {boolean}
     */
    isSystemAvailable(systemName) {
        return this.availableSystemTypes.includes(systemName);
    }

    /**
     * Switch to a different scene
     * @param {string} sceneName - Name of the scene to load
     * @returns {Promise<void>}
     */
    async switchScene(sceneName) {
        if (this.sceneManager) {
            await this.sceneManager.switchScene(sceneName);
        }
    }

    getEntityId() {
        // Recycle freed entity IDs deterministically - always use lowest available
        // This ensures client and server get the same ID even if destruction order differs
        if (this.freeEntityCount > 0) {
            // Find the minimum ID in the free list for deterministic selection
            let minIdx = 0;
            for (let i = 1; i < this.freeEntityCount; i++) {
                if (this.freeEntityIds[i] < this.freeEntityIds[minIdx]) {
                    minIdx = i;
                }
            }
            const id = this.freeEntityIds[minIdx];
            // Swap with last and decrement count
            this.freeEntityIds[minIdx] = this.freeEntityIds[--this.freeEntityCount];
            return id;
        }
        if (this.nextEntityId >= this.MAX_ENTITIES) {
            throw new Error(`Maximum entity limit (${this.MAX_ENTITIES}) reached`);
        }
        return this.nextEntityId++;
    }

    getCollections() {
        return this.app.getCollections();
    }

    async update(deltaTime) {

        if (!this.state.isPaused) {
            // Start performance frame tracking
            if (this.performanceMonitor) {
                this.performanceMonitor.startFrame();
            }

            // Use tick count based timing to avoid floating-point accumulation errors
            this.tickCount++;
            // Use FIXED_DELTA_TIME for deterministic simulation (ignore variable deltaTime)
            // Round to 2 decimal places to avoid floating-point precision issues
            // (e.g., 3 * 0.05 = 0.15000000000000002 in JavaScript)
            this.currentTime = Math.round(this.tickCount * this.FIXED_DELTA_TIME * 100) / 100;

            // Only update if a reasonable amount of time has passed
            // const timeSinceLastUpdate = this.currentTime - this.lastTime;

            // // Skip update if more than 1 second has passed (tab was inactive)
            // if (timeSinceLastUpdate > 1000) {
            //     this.lastTime = this.currentTime; // Reset timer without updating
            //     return;
            // }
            this.state.now = this.currentTime;
            // Use fixed deltaTime for deterministic simulation
            this.state.deltaTime = this.FIXED_DELTA_TIME;
            this.deltaTime = this.FIXED_DELTA_TIME;

            for (const system of this.systems) {
                // Skip disabled systems
                if (!system.enabled) continue;

                const systemName = system.constructor.name;

                // Start tracking this system
                if (this.performanceMonitor) {
                    this.performanceMonitor.startSystem(systemName);
                }

                if (system.update) {
                    await system.update();
                }

                // End update tracking
                if (this.performanceMonitor) {
                    this.performanceMonitor.endSystemUpdate(systemName);
                }

                if(system.render && !this.isServer){
                    // Start render tracking
                    if (this.performanceMonitor) {
                        this.performanceMonitor.startSystemRender(systemName);
                    }

                    await system.render();

                    // End render tracking
                    if (this.performanceMonitor) {
                        this.performanceMonitor.endSystemRender(systemName);
                    }
                } else if (this.performanceMonitor) {
                    // If no render, still need to end the system tracking
                    this.performanceMonitor.startSystemRender(systemName);
                    this.performanceMonitor.endSystemRender(systemName);
                }
            }

            // Update performance overlay
            if (this.performanceMonitor) {
                this.performanceMonitor.updateOverlay();
            }

            this.postUpdate();
        }
    }

    postUpdate() {
       // this.desyncDebugger?.displaySync(false); 
       
        this.lastTime = this.currentTime;
    
        this.entitiesToAdd.forEach((entity) => this.addEntity(entity));        
        this.entitiesToAdd = [];
        
    }

    createEntity(setId) {
        const id = setId || this.getEntityId();
        // Log if overwriting existing entity - this is a bug!
        if (this.entityAlive[id]) {
            console.error(`[BaseECSGame] createEntity called for existing entity ${id}!`);
            console.trace('createEntity called from:');
        }
        // Mark entity as alive
        this.entityAlive[id] = 1;
        // Clear component bitmask
        this.entityComponentMask[id * 2] = 0;
        this.entityComponentMask[id * 2 + 1] = 0;
        this.entityCount++;
        // When using a specific ID, ensure nextEntityId is always higher
        // This is critical for getEntitiesWith() which iterates up to nextEntityId
        if (id >= this.nextEntityId) {
            this.nextEntityId = id + 1;
        }
                return id;
    }

    destroyEntity(entityId) {
        if (!this.entityAlive[entityId]) return;

        // Notify systems
        for (let i = 0; i < this.systems.length; i++) {
            const system = this.systems[i];
            if (system.entityDestroyed) {
                system.entityDestroyed(entityId);
            }
        }

        // Clear component data from object storage
        for (const [componentType, storage] of this._objectComponents) {
            if (storage[entityId] !== undefined) {
                storage[entityId] = undefined;
            }
        }

        // Clear cached proxies for this entity
        for (const [, componentCache] of this._proxyCache) {
            componentCache.delete(entityId);
        }

        // Note: TypedArray numeric data doesn't need clearing -
        // the bitmask ensures it won't be read

        // Mark entity as dead and recycle ID
        this.entityAlive[entityId] = 0;
        this.entityComponentMask[entityId * 2] = 0;
        this.entityComponentMask[entityId * 2 + 1] = 0;
        this.freeEntityIds[this.freeEntityCount++] = entityId;
        this.entityCount--;
            }

    addComponent(entityId, componentId, data) {
        if (!this.entityAlive[entityId]) {
            throw new Error(`Entity ${entityId} does not exist`);
        }

        const componentMethods = this.call('getComponents');
        if (!componentMethods[componentId]) {
            console.warn(`[BaseECSGame] No component factory for '${componentId}'. Add it to the components collection.`);
        }

        // Use factory function if available, otherwise use data directly as fallback
        const componentData = componentMethods[componentId]
            ? componentMethods[componentId](data)
            : { ...data };

        // Get component type ID and set bitmask
        const typeId = this._getComponentTypeId(componentId);
        this._setComponentBit(entityId, typeId);

        // Set up storage on first encounter (analyzes schema for numeric optimization)
        const schema = this.call('getComponentSchema', componentId);
        const enumMap = this.hasService('getEnumMap') ? this.call('getEnumMap', componentId) : null;
        if (schema) {
            this._setupComponentStorage(componentId, schema, enumMap);
        }

        // Check if this is a numeric component (use TypedArrays) or object component
        const componentInfo = this._numericComponentInfo.get(componentId);
        if (componentInfo && componentInfo.isNumeric && schema) {
            // Store in TypedArrays
            this._writeNumericComponent(componentId, entityId, componentData, schema);
        } else {
            // Store in object storage (indexed by entity ID)
            const storage = this._getObjectStorage(componentId);
            storage[entityId] = componentData;
        }

    }

    /**
     * OPTIMIZATION: Add multiple components at once with single cache invalidation
     * @param {*} entityId - Entity ID
     * @param {Object} componentsData - Object mapping componentId -> data
     */
    addComponents(entityId, componentsData) {
        if (!this.entityAlive[entityId]) {
            throw new Error(`Entity ${entityId} does not exist`);
        }

        const componentMethods = this.call('getComponents');
        const hasEnumService = this.hasService('getEnumMap');

        for (const [componentId, data] of Object.entries(componentsData)) {
            // Use factory function if available, otherwise use data directly
            const componentData = componentMethods[componentId]
                ? componentMethods[componentId](data)
                : { ...data };

            // Get component type ID and set bitmask
            const typeId = this._getComponentTypeId(componentId);
            this._setComponentBit(entityId, typeId);

            // Set up storage on first encounter (analyzes schema for numeric optimization)
            const schema = this.call('getComponentSchema', componentId);
            const enumMap = hasEnumService ? this.call('getEnumMap', componentId) : null;
            if (schema) {
                this._setupComponentStorage(componentId, schema, enumMap);
            }

            // Check if this is a numeric component (use TypedArrays) or object component
            const componentInfo = this._numericComponentInfo.get(componentId);
            if (componentInfo && componentInfo.isNumeric && schema) {
                // Store in TypedArrays
                this._writeNumericComponent(componentId, entityId, componentData, schema);
            } else {
                // Store in object storage
                const storage = this._getObjectStorage(componentId);
                storage[entityId] = componentData;
            }
        }

        // Single cache invalidation for all components
    }

    removeComponent(entityId, componentType) {
        if (!this.entityAlive[entityId]) return null;

        const component = this.getComponent(entityId, componentType);
        if (component === undefined) return null;

        // Clear bitmask
        const typeId = this._componentTypeId.get(componentType);
        if (typeId !== undefined) {
            this._clearComponentBit(entityId, typeId);
        }

        // Clear object storage
        const storage = this._objectComponents.get(componentType);
        if (storage) {
            storage[entityId] = undefined;
        }

        // Clear cached proxy for this entity+component
        const componentCache = this._proxyCache.get(componentType);
        if (componentCache) {
            componentCache.delete(entityId);
        }

        return component;
    }

    getComponent(entityId, componentType) {
        // Fast path: check bitmask first
        const typeId = this._componentTypeId.get(componentType);
        if (typeId === undefined) return undefined;
        if (!this._hasComponentBit(entityId, typeId)) return undefined;

        // Check if this is a numeric component (stored in TypedArrays)
        const componentInfo = this._numericComponentInfo.get(componentType);
        if (componentInfo && componentInfo.isNumeric && componentInfo.schema) {
            // Use original schema to preserve $fixedArray info for array proxy creation
            const schema = componentInfo.originalSchema || componentInfo.schema;
            return this._readNumericComponent(componentType, entityId, schema);
        }

        // Get from object storage
        const storage = this._objectComponents.get(componentType);
        return storage ? storage[entityId] : undefined;
    }

    /**
     * Serialize a component for network sync
     * Uses getComponent (which returns proxies with toJSON support)
     * Returns a plain object suitable for JSON serialization
     */
    serializeComponent(entityId, componentType) {
        const component = this.getComponent(entityId, componentType);
        if (!component) return null;
        // JSON.parse(JSON.stringify) converts proxy to plain object
        // The proxy's toJSON methods handle $fixedArray serialization
        return JSON.parse(JSON.stringify(component));
    }

    /**
     * Get ECS data for network sync
     * @param {boolean} fullSync - If true, sends full state and resets delta tracking.
     *                             If false, sends only changes since last sync.
     * Returns sparse format to minimize payload size
     * Format: {
     *   fullSync: boolean,  // true if this is a full state sync
     *   entityAlive: { entityId: 1, ... },  // sparse: only alive entities (or changed)
     *   entityDead: [entityId, ...],  // only in delta: entities that died since last sync
     *   entityComponentMask: { entityId: [low, high], ... },  // sparse: only entities with components (or changed)
     *   numericArrays: { key: { entityId: value, ... } },  // sparse: only non-zero/non-null values (or changed)
     *   objectComponents: { componentType: { entityId: data } },
     *   nextEntityId: number
     * }
     */
    getECSData(fullSync = true) {
        const maxEntity = this.nextEntityId;
        const lastState = this._lastSyncedState;

        // If fullSync or no previous state, send everything
        if (fullSync || !lastState) {
            const result = this._getFullECSData(maxEntity);
            result.fullSync = true;
            // Store current state for future delta calculations
            this._lastSyncedState = this._captureStateSnapshot(maxEntity);
            return result;
        }

        // Delta sync - only send what changed
        return this._getDeltaECSData(maxEntity, lastState);
    }

    /**
     * Get full ECS state (sparse format)
     */
    _getFullECSData(maxEntity) {
        const result = {
            nextEntityId: this.nextEntityId,
            entityAlive: {},
            entityComponentMask: {},
            numericArrays: {},
            objectComponents: {}
        };

        // Sparse entityAlive - only include alive entities (value = 1)
        for (let i = 0; i < maxEntity; i++) {
            if (this.entityAlive[i] === 1) {
                result.entityAlive[i] = 1;
            }
        }

        // Sparse entityComponentMask - only include entities with components
        // Stored as [low, high] pairs for the two 32-bit parts
        for (let i = 0; i < maxEntity; i++) {
            const low = this.entityComponentMask[i * 2];
            const high = this.entityComponentMask[i * 2 + 1];
            if (low !== 0 || high !== 0) {
                result.entityComponentMask[i] = [low, high];
            }
        }

        // Include numeric arrays in sparse format (only non-zero, non-null values)
        // ALSO include zeros that changed FROM non-zero (to ensure clients reset them)
        // Skip client-only components
        const lastState = this._lastSyncedState;
        for (const [key, arr] of this._numericArrays) {
            // key format is "componentType.fieldPath" - extract component type
            const componentType = key.split('.')[0];
            if (this._clientOnlyComponents.has(componentType)) {
                continue;  // Skip client-only components
            }

            const lastArr = lastState?.numericArrays?.get(key);
            const lastMaxEntity = lastState?.nextEntityId || 0;
            const sparse = {};
            for (let i = 0; i < maxEntity; i++) {
                const val = arr[i];
                // Only check lastArr within its bounds
                const lastVal = (lastArr && i < lastMaxEntity) ? lastArr[i] : 0;
                // Include non-zero values
                // Also include zeros if they were previously non-zero (value changed to 0)
                if (val !== 0 || (lastVal !== 0 && val === 0)) {
                    sparse[i] = this._toSyncValue(val);
                }
            }
            // Only include if there are any values
            if (Object.keys(sparse).length > 0) {
                result.numericArrays[key] = sparse;
            }
        }

        // Include object components - skip client-only
        for (const [componentType, storage] of this._objectComponents) {
            if (this._clientOnlyComponents.has(componentType)) {
                continue;
            }

            const componentData = {};
            for (let i = 0; i < maxEntity; i++) {
                if (storage[i] !== undefined) {
                    componentData[i] = storage[i];
                }
            }
            if (Object.keys(componentData).length > 0) {
                result.objectComponents[componentType] = componentData;
            }
        }

        return result;
    }

    /**
     * Capture a snapshot of current state for delta comparison
     */
    _captureStateSnapshot(maxEntity) {
        const snapshot = {
            nextEntityId: this.nextEntityId,
            entityAlive: new Uint8Array(maxEntity),
            entityComponentMask: new Uint32Array(maxEntity * 2),
            numericArrays: new Map(),
            objectComponents: new Map()
        };

        // Copy entityAlive
        snapshot.entityAlive.set(this.entityAlive.subarray(0, maxEntity));

        // Copy entityComponentMask
        snapshot.entityComponentMask.set(this.entityComponentMask.subarray(0, maxEntity * 2));

        // Copy numeric arrays
        for (const [key, arr] of this._numericArrays) {
            snapshot.numericArrays.set(key, new Float32Array(arr.subarray(0, maxEntity)));
        }

        // Deep copy object components
        for (const [componentType, storage] of this._objectComponents) {
            const copy = new Array(maxEntity);
            for (let i = 0; i < maxEntity; i++) {
                if (storage[i] !== undefined) {
                    copy[i] = JSON.parse(JSON.stringify(storage[i]));
                }
            }
            snapshot.objectComponents.set(componentType, copy);
        }

        return snapshot;
    }

    /**
     * Get delta ECS data - only changes since last sync
     */
    _getDeltaECSData(maxEntity, lastState) {
        const result = {
            fullSync: false,
            nextEntityId: this.nextEntityId,
            entityAlive: {},
            entityDead: [],
            entityComponentMask: {},
            numericArrays: {},
            objectComponents: {}
        };

        const lastMaxEntity = lastState.nextEntityId;

        // Check entityAlive changes
        for (let i = 0; i < maxEntity; i++) {
            const current = this.entityAlive[i];
            const previous = i < lastMaxEntity ? lastState.entityAlive[i] : 0;

            if (current !== previous) {
                if (current === 1) {
                    result.entityAlive[i] = 1;  // Entity became alive
                } else {
                    result.entityDead.push(i);  // Entity died
                }
            }
        }

        // Check entityComponentMask changes
        for (let i = 0; i < maxEntity; i++) {
            const lowCurrent = this.entityComponentMask[i * 2];
            const highCurrent = this.entityComponentMask[i * 2 + 1];
            const lowPrev = i < lastMaxEntity ? lastState.entityComponentMask[i * 2] : 0;
            const highPrev = i < lastMaxEntity ? lastState.entityComponentMask[i * 2 + 1] : 0;

            if (lowCurrent !== lowPrev || highCurrent !== highPrev) {
                result.entityComponentMask[i] = [lowCurrent, highCurrent];
            }
        }

        // Check numeric array changes - skip client-only components
        for (const [key, arr] of this._numericArrays) {
            const componentType = key.split('.')[0];
            if (this._clientOnlyComponents.has(componentType)) {
                continue;
            }

            const lastArr = lastState.numericArrays.get(key);
            const sparse = {};

            for (let i = 0; i < maxEntity; i++) {
                const current = arr[i];
                const previous = (lastArr && i < lastMaxEntity) ? lastArr[i] : 0;

                if (current !== previous) {
                    // Include the new value (even if 0 or -Infinity, since it changed)
                    sparse[i] = this._toSyncValue(current);
                }
            }

            if (Object.keys(sparse).length > 0) {
                result.numericArrays[key] = sparse;
            }
        }

        // Check object component changes - skip client-only
        for (const [componentType, storage] of this._objectComponents) {
            if (this._clientOnlyComponents.has(componentType)) {
                continue;
            }

            const lastStorage = lastState.objectComponents.get(componentType);
            const componentData = {};

            for (let i = 0; i < maxEntity; i++) {
                const current = storage[i];
                const previous = lastStorage ? lastStorage[i] : undefined;

                // Check if changed (simple JSON comparison)
                const currentStr = current !== undefined ? JSON.stringify(current) : undefined;
                const previousStr = previous !== undefined ? JSON.stringify(previous) : undefined;

                if (currentStr !== previousStr) {
                    if (current !== undefined) {
                        componentData[i] = current;
                    } else {
                        // Mark as removed with null
                        componentData[i] = null;
                    }
                }
            }

            if (Object.keys(componentData).length > 0) {
                result.objectComponents[componentType] = componentData;
            }
        }

        // Remove empty arrays/objects from result
        if (result.entityDead.length === 0) delete result.entityDead;
        if (Object.keys(result.entityAlive).length === 0) delete result.entityAlive;
        if (Object.keys(result.entityComponentMask).length === 0) delete result.entityComponentMask;
        if (Object.keys(result.numericArrays).length === 0) delete result.numericArrays;
        if (Object.keys(result.objectComponents).length === 0) delete result.objectComponents;

        // Update snapshot for next delta
        this._lastSyncedState = this._captureStateSnapshot(maxEntity);

        return result;
    }

    /**
     * Reset delta tracking - call this when you want the next sync to be a full sync
     */
    resetSyncState() {
        this._lastSyncedState = null;
    }

    /**
     * Apply ECS data from server (handles both full sync and delta sync)
     */
    applyECSData(data) {
        // Check if this is a full sync or delta sync
        if (data.fullSync !== false) {
            this._applyFullECSData(data);
        } else {
            this._applyDeltaECSData(data);
        }

        // Common cleanup for both sync types
        this._finalizeECSSync(data);
    }

    /**
     * Apply full ECS sync - replaces all state
     */
    _applyFullECSData(data) {
        const maxEntity = data.nextEntityId || this.nextEntityId;

        // Clear and apply entity alive flags from sparse format
        this.entityAlive.fill(0, 0, maxEntity);
        if (data.entityAlive) {
            for (const entityIdStr of Object.keys(data.entityAlive)) {
                this.entityAlive[parseInt(entityIdStr, 10)] = 1;
            }
        }

        // Build bitmask for client-only components to preserve
        let clientOnlyMaskLow = 0;
        let clientOnlyMaskHigh = 0;
        for (const componentType of this._clientOnlyComponents) {
            const typeId = this._componentTypeId.get(componentType);
            if (typeId !== undefined) {
                if (typeId < 32) {
                    clientOnlyMaskLow |= (1 << typeId);
                } else {
                    clientOnlyMaskHigh |= (1 << (typeId - 32));
                }
            }
        }

        // Apply component masks from sparse format, preserving client-only component bits
        for (let i = 0; i < maxEntity; i++) {
            // Preserve client-only bits from current mask
            const preservedLow = this.entityComponentMask[i * 2] & clientOnlyMaskLow;
            const preservedHigh = this.entityComponentMask[i * 2 + 1] & clientOnlyMaskHigh;
            // Clear the mask
            this.entityComponentMask[i * 2] = preservedLow;
            this.entityComponentMask[i * 2 + 1] = preservedHigh;
        }
        if (data.entityComponentMask) {
            for (const [entityIdStr, mask] of Object.entries(data.entityComponentMask)) {
                const entityId = parseInt(entityIdStr, 10);
                // Merge server mask with preserved client-only bits
                this.entityComponentMask[entityId * 2] |= mask[0];
                this.entityComponentMask[entityId * 2 + 1] |= mask[1];
            }
        }

        // Apply numeric arrays - only clear/replace arrays that server sends
        // Skip client-only components even if server sends them (backwards compatibility)
        for (const [key, sparse] of Object.entries(data.numericArrays || {})) {
            const componentType = key.split('.')[0];
            if (this._clientOnlyComponents.has(componentType)) {
                continue;  // Don't apply client-only components from server
            }

            let arr = this._numericArrays.get(key);
            if (!arr) {
                arr = new Float32Array(this.MAX_ENTITIES);
                this._numericArrays.set(key, arr);
            }
            // Clear this specific array before applying server data
            arr.fill(0, 0, maxEntity);
            // Apply server values
            for (const [entityIdStr, value] of Object.entries(sparse)) {
                arr[parseInt(entityIdStr, 10)] = this._fromSyncValue(value);
            }
        }

        // Apply object components - only clear/replace components that server sends
        // Skip client-only components
        for (const [componentType, componentData] of Object.entries(data.objectComponents || {})) {
            if (this._clientOnlyComponents.has(componentType)) {
                continue;
            }

            const storage = this._getObjectStorage(componentType);
            // Clear this specific component type before applying server data
            for (let i = 0; i < maxEntity; i++) {
                storage[i] = undefined;
            }
            // Apply server values
            for (const [entityIdStr, value] of Object.entries(componentData)) {
                storage[parseInt(entityIdStr, 10)] = value;
            }
        }
    }

    /**
     * Apply delta ECS sync - only applies changes
     */
    _applyDeltaECSData(data) {
        // Apply entity deaths
        if (data.entityDead) {
            for (const entityId of data.entityDead) {
                this.entityAlive[entityId] = 0;
                // Clear component mask for dead entities
                this.entityComponentMask[entityId * 2] = 0;
                this.entityComponentMask[entityId * 2 + 1] = 0;
            }
        }

        // Apply new/changed alive entities
        if (data.entityAlive) {
            for (const entityIdStr of Object.keys(data.entityAlive)) {
                this.entityAlive[parseInt(entityIdStr, 10)] = 1;
            }
        }

        // Apply component mask changes, preserving client-only component bits
        if (data.entityComponentMask) {
            // Build bitmask for client-only components to preserve
            let clientOnlyMaskLow = 0;
            let clientOnlyMaskHigh = 0;
            for (const componentType of this._clientOnlyComponents) {
                const typeId = this._componentTypeId.get(componentType);
                if (typeId !== undefined) {
                    if (typeId < 32) {
                        clientOnlyMaskLow |= (1 << typeId);
                    } else {
                        clientOnlyMaskHigh |= (1 << (typeId - 32));
                    }
                }
            }

            for (const [entityIdStr, mask] of Object.entries(data.entityComponentMask)) {
                const entityId = parseInt(entityIdStr, 10);
                // Preserve client-only bits, apply server bits
                const preservedLow = this.entityComponentMask[entityId * 2] & clientOnlyMaskLow;
                const preservedHigh = this.entityComponentMask[entityId * 2 + 1] & clientOnlyMaskHigh;
                this.entityComponentMask[entityId * 2] = mask[0] | preservedLow;
                this.entityComponentMask[entityId * 2 + 1] = mask[1] | preservedHigh;
            }
        }

        // Apply numeric array changes (only changed values)
        // Skip client-only components
        for (const [key, sparse] of Object.entries(data.numericArrays || {})) {
            const componentType = key.split('.')[0];
            if (this._clientOnlyComponents.has(componentType)) {
                continue;
            }

            let arr = this._numericArrays.get(key);
            if (!arr) {
                arr = new Float32Array(this.MAX_ENTITIES);
                this._numericArrays.set(key, arr);
            }
            for (const [entityIdStr, value] of Object.entries(sparse)) {
                arr[parseInt(entityIdStr, 10)] = this._fromSyncValue(value);
            }
        }

        // Apply object component changes - skip client-only
        for (const [componentType, componentData] of Object.entries(data.objectComponents || {})) {
            if (this._clientOnlyComponents.has(componentType)) {
                continue;
            }

            const storage = this._getObjectStorage(componentType);
            for (const [entityIdStr, value] of Object.entries(componentData)) {
                const entityId = parseInt(entityIdStr, 10);
                if (value === null) {
                    // null means removed
                    storage[entityId] = undefined;
                } else {
                    storage[entityId] = value;
                }
            }
        }
    }

    /**
     * Finalize ECS sync - common cleanup for both full and delta
     */
    _finalizeECSSync(data) {
        // Sync entity ID counter
        if (data.nextEntityId !== undefined) {
            this.nextEntityId = data.nextEntityId;
        }

        // Rebuild freeEntityIds from entityAlive to ensure consistency
        this.freeEntityCount = 0;
        for (let i = 1; i < this.nextEntityId; i++) {
            if (this.entityAlive[i] === 0) {
                this.freeEntityIds[this.freeEntityCount++] = i;
            }
        }

        // Clear all cached proxies since data has been overwritten
        for (const [, componentCache] of this._proxyCache) {
            componentCache.clear();
        }

            }

    /**
     * Update specific fields of a component
     * For numeric components (TypedArray storage), this is the only way to persist changes
     * For object components, this also works (direct mutation still works for those)
     * @param {number} entityId
     * @param {string} componentType
     * @param {Object} updates - Object with field updates, e.g. { current: 50 } or { 'nested.field': 10 }
     */
    updateComponent(entityId, componentType, updates) {
        const typeId = this._componentTypeId.get(componentType);
        if (typeId === undefined) return;
        if (!this._hasComponentBit(entityId, typeId)) return;

        const componentInfo = this._numericComponentInfo.get(componentType);
        if (componentInfo && componentInfo.isNumeric) {
            // Write to TypedArrays (convert null to storage sentinel)
            for (const fieldPath in updates) {
                this._setNumericField(componentType, entityId, fieldPath, this._toStorageValue(updates[fieldPath]));
            }
        } else {
            // Update object storage
            const storage = this._objectComponents.get(componentType);
            if (storage && storage[entityId]) {
                for (const fieldPath in updates) {
                    if (fieldPath.includes('.')) {
                        // Handle nested paths
                        this._setNestedValue(storage[entityId], fieldPath, updates[fieldPath]);
                    } else {
                        storage[entityId][fieldPath] = updates[fieldPath];
                    }
                }
            }
        }
    }

    /**
     * Set a nested value in an object using dot notation path
     */
    _setNestedValue(obj, path, value) {
        const parts = path.split('.');
        let current = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (current[parts[i]] === undefined) {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
    }

    hasComponent(entityId, componentType) {
        const typeId = this._componentTypeId.get(componentType);
        if (typeId === undefined) return false;
        return this._hasComponentBit(entityId, typeId);
    }

    getEntitiesWith(...componentTypes) {
        // Create cache key from component types
        const queryKey = componentTypes.join(',');

        // Get or create reusable result array for this query
        // This avoids allocations - each unique query gets one array that's reused forever
        let result = this._queryCache.get(queryKey);
        if (!result) {
            result = [];
            this._queryCache.set(queryKey, result);
        }
        result.length = 0;  // Clear without deallocating (keeps underlying buffer)

        // Build query bitmask from component types
        let queryMask0 = 0;
        let queryMask1 = 0;
        for (const componentType of componentTypes) {
            const typeId = this._componentTypeId.get(componentType);
            if (typeId === undefined) {
                // Component type doesn't exist yet, no entities can have it
                return result;  // Return empty reusable array
            }
            if (typeId < 32) {
                queryMask0 |= (1 << typeId);
            } else {
                queryMask1 |= (1 << (typeId - 32));
            }
        }

        // Scan all entities using bitmask matching
        // This is cache-friendly because we iterate contiguously through TypedArrays
        const alive = this.entityAlive;
        const masks = this.entityComponentMask;
        const maxId = this.nextEntityId;

        for (let entityId = 1; entityId < maxId; entityId++) {
            // Skip dead entities
            if (!alive[entityId]) continue;

            // Check if entity has all required components via bitmask
            const mask0 = masks[entityId * 2];
            const mask1 = masks[entityId * 2 + 1];

            if ((mask0 & queryMask0) === queryMask0 &&
                (mask1 & queryMask1) === queryMask1) {
                result.push(entityId);
            }
        }

        return result;
    }
    
    /**
     * Get all alive entity IDs
     * @returns {number[]} Array of alive entity IDs
     */
    getAllEntities() {
        const result = [];
        const alive = this.entityAlive;
        const maxId = this.nextEntityId;
        for (let entityId = 1; entityId < maxId; entityId++) {
            if (alive[entityId]) {
                result.push(entityId);
            }
        }
        return result;
    }

    /**
     * Check if an entity exists
     * @param {number} entityId
     * @returns {boolean}
     */
    entityExists(entityId) {
        return entityId > 0 && entityId < this.MAX_ENTITIES && this.entityAlive[entityId] === 1;
    }

    /**
     * Get count of alive entities
     * @returns {number}
     */
    getEntityCount() {
        return this.entityCount;
    }

    /**
     * Get all component types for an entity
     * @param {number} entityId
     * @returns {string[]} Array of component type names
     */
    getEntityComponentTypes(entityId) {
        if (!this.entityAlive[entityId]) return [];

        const result = [];
        const mask0 = this.entityComponentMask[entityId * 2];
        const mask1 = this.entityComponentMask[entityId * 2 + 1];

        // Check first 32 component types
        for (let bit = 0; bit < 32; bit++) {
            if (mask0 & (1 << bit)) {
                const name = this._componentTypeNames[bit];
                if (name) result.push(name);
            }
        }

        // Check next 32 component types
        for (let bit = 0; bit < 32; bit++) {
            if (mask1 & (1 << bit)) {
                const name = this._componentTypeNames[bit + 32];
                if (name) result.push(name);
            }
        }

        return result;
    }

    /**
     * Iterate over entities with specific components without allocating arrays
     * Calls callback(entityId) for each matching entity
     * @param {string[]} componentTypes - Component types to match
     * @param {function} callback - Called with each matching entityId
     */
    forEachEntityWith(componentTypes, callback) {
        // Build query bitmask
        let queryMask0 = 0;
        let queryMask1 = 0;
        for (const componentType of componentTypes) {
            const typeId = this._componentTypeId.get(componentType);
            if (typeId === undefined) return; // No entities can match
            if (typeId < 32) {
                queryMask0 |= (1 << typeId);
            } else {
                queryMask1 |= (1 << (typeId - 32));
            }
        }

        const alive = this.entityAlive;
        const masks = this.entityComponentMask;
        const maxId = this.nextEntityId;

        for (let entityId = 1; entityId < maxId; entityId++) {
            if (!alive[entityId]) continue;
            const mask0 = masks[entityId * 2];
            const mask1 = masks[entityId * 2 + 1];
            if ((mask0 & queryMask0) === queryMask0 &&
                (mask1 & queryMask1) === queryMask1) {
                callback(entityId);
            }
        }
    }

    /**
     * Clear all entities and reset the ECS state
     */
    clearAllEntities() {
        // Clear all object storage
        for (const storage of this._objectComponents.values()) {
            storage.fill(undefined);
        }

        // Reset TypedArrays
        this.entityAlive.fill(0);
        this.entityComponentMask.fill(0);

        // Reset entity management
        this.freeEntityCount = 0;
        this.nextEntityId = 1;
        this.entityCount = 0;

        // Invalidate query cache
            }

    triggerEvent(eventName, data) {
        for (let i = 0; i < this.systems.length; i++) {
            const system = this.systems[i];
            if (system[eventName]) {
                system[eventName](data);
            }
        }
    }

    gameOver() {
        this.state.gameOver = true;
    }

    gameVictory() {
        this.state.victory = true;
    }

    resetCurrentTime() {
        this.state.now = 0;
        this.lastTime = 0;
        this.currentTime = 0;
        this.tickCount = 0;
    }

    getComponents(){
        if(!this.components){
            this.components = this.componentGenerator.getComponents();
        }
        return this.components;
    }

    getComponentSchema(componentId) {
        return this.componentGenerator.getSchema(componentId);
    }

    /**
     * Get enum map with toIndex and toValue
     * @param {string} enumName - The enum name (e.g., 'team', 'element', 'projectiles')
     * @returns {Object} { toIndex: {string->number}, toValue: [number->string] }
     */
    getEnumMap(enumName) {
        return this.componentGenerator.getEnumMap(enumName);
    }

    /**
     * Get a collection item by numeric index
     * @param {string} collectionName - The collection name (e.g., 'levels', 'units')
     * @param {number} index - The numeric index
     * @returns {Object|undefined} The collection item, or undefined if not found
     */
    getCollectionItem(collectionName, index) {
        const enumMap = this.componentGenerator.getEnumMap(collectionName);
        if (!enumMap?.toValue?.[index]) return undefined;
        const key = enumMap.toValue[index];
        return this.getCollections()[collectionName]?.[key];
    }

    /**
     * Get a collection item key (string name) by numeric index
     * @param {string} collectionName - The collection name (e.g., 'levels', 'units')
     * @param {number} index - The numeric index
     * @returns {string|undefined} The collection key, or undefined if not found
     */
    getCollectionKey(collectionName, index) {
        const enumMap = this.componentGenerator.getEnumMap(collectionName);
        return enumMap?.toValue?.[index];
    }

    /**
     * Get all enums as a convenient lookup object
     * Usage: const enums = game.getEnums();
     *        components.team({ team: enums.team.left })
     * @returns {Object} { team: { neutral: 0, hostile: 1, ... }, element: { ... }, ... }
     */
    getEnums() {
        if (!this._enums) {
            this._enums = this.componentGenerator.getEnums();
        }
        return this._enums;
    }

    /**
     * Get reverse enum lookup (index → key)
     * Usage: const reverseEnums = game.getReverseEnums();
     *        const levelName = reverseEnums.levels[levelIndex];
     * @returns {Object} { levels: { 0: 'level_1', 1: 'level_2' }, ... }
     */
    getReverseEnums() {
        if (!this._reverseEnums) {
            this._reverseEnums = this.componentGenerator.getReverseEnums();
        }
        return this._reverseEnums;
    }

    getUnitTypeDef(unitTypeComponent) {
        if (!unitTypeComponent || unitTypeComponent.collection === -1 || unitTypeComponent.type === -1) {
            return null;
        }

        const collections = this.getCollections();
        const collectionEnumMap = this.getEnumMap('objectTypeDefinitions');
        const collectionName = collectionEnumMap?.toValue?.[unitTypeComponent.collection];

        if (!collectionName || !collections[collectionName]) {
            return null;
        }

        const typeEnumMap = this.getEnumMap(collectionName);
        const typeName = typeEnumMap?.toValue?.[unitTypeComponent.type];

        if (!typeName) {
            return null;
        }

        const def = collections[collectionName][typeName];
        // Include resolved names for convenience
        if (def) {
            return {
                ...def,
                id: typeName,
                collection: collectionName
            };
        }
        return null;
    }
}


// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.BaseECSGame = BaseECSGame;
}

// ES6 exports for webpack bundling
export default BaseECSGame;
export { BaseECSGame };
