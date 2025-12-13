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
        this.MAX_ENTITIES = 16384; // Power of 2 for fast modulo

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

        // Query cache for getEntitiesWith - invalidated on entity/component changes
        this._queryCache = new Map();
        this._queryCacheVersion = 0;

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
    }

    /**
     * Get or create a numeric component type ID
     */
    _getComponentTypeId(componentType) {
        let typeId = this._componentTypeId.get(componentType);
        if (typeId === undefined) {
            if (this._nextComponentTypeId >= 64) {
                throw new Error('Maximum 64 component types supported');
            }
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
     */
    _setNumericField(componentId, entityId, fieldPath, value) {
        const key = `${componentId}.${fieldPath}`;
        const arr = this._numericArrays.get(key);
        if (arr) {
            arr[entityId] = value;
        }
    }

    /**
     * Get a value from a numeric component's TypedArray storage
     */
    _getNumericField(componentId, entityId, fieldPath) {
        const key = `${componentId}.${fieldPath}`;
        const arr = this._numericArrays.get(key);
        return arr ? arr[entityId] : undefined;
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
            } else if (schemaValue && typeof schemaValue === 'object' && !Array.isArray(schemaValue)) {
                this._writeNumericComponent(componentId, entityId, data, schemaValue, fieldPath);
            }
        }
    }

    /**
     * Read component data from TypedArrays and return as proxy object that syncs writes back
     * Converts stored 0/1 back to booleans based on schema type
     * Handles $fixedArray by creating array-like proxy objects
     */
    _readNumericComponent(componentId, entityId, schema, prefix = '') {
        const result = {};
        const game = this;

        for (const key in schema) {
            const fieldPath = prefix ? `${prefix}.${key}` : key;
            const schemaValue = schema[key];

            if (typeof schemaValue === 'number' || typeof schemaValue === 'string') {
                // Numbers and enum values stay as numbers
                result[key] = this._getNumericField(componentId, entityId, fieldPath);
            } else if (typeof schemaValue === 'boolean') {
                // Convert 0/1 back to boolean
                result[key] = this._getNumericField(componentId, entityId, fieldPath) !== 0;
            } else if (schemaValue && typeof schemaValue === 'object' && !Array.isArray(schemaValue)) {
                // Check for $fixedArray directive
                if (schemaValue.$fixedArray) {
                    result[key] = this._createFixedArrayProxy(componentId, entityId, key, schemaValue.$fixedArray, prefix);
                } else if (schemaValue.$bitmask) {
                    // $bitmask is stored as individual 32-bit fields (baseName0, baseName1, etc.)
                    result[key] = this._createBitmaskProxy(componentId, entityId, key, schemaValue.$bitmask, prefix);
                } else if (schemaValue.$enum) {
                    // $enum fields are stored as numeric indices, read directly
                    result[key] = this._getNumericField(componentId, entityId, fieldPath);
                } else {
                    result[key] = this._readNumericComponent(componentId, entityId, schemaValue, fieldPath);
                }
            }
        }

        // Return a proxy that syncs writes back to TypedArrays
        return new Proxy(result, {
            set(target, prop, value) {
                // Convert booleans to 0/1 for storage
                const storedValue = typeof value === 'boolean' ? (value ? 1 : 0) : value;
                target[prop] = value;
                const fieldPath = prefix ? `${prefix}.${prop}` : prop;
                game._setNumericField(componentId, entityId, fieldPath, storedValue);
                return true;
            }
        });
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
                                game._setNumericField(componentId, entityId, `${fieldPrefix}_${f}${index}`, v);
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
                                game._setNumericField(componentId, entityId, `${fieldPrefix}_${field}${index}`, value[field]);
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
                        game._setNumericField(componentId, entityId, `${fieldPrefix}${index}`, value);
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
                    game._setNumericField(componentId, entityId, `${fieldPrefix}${index}`, value);
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
        return this._services.call(key, ...args);
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

    async loadGameScripts(config) {
        this.collections = this.getCollections();
        this.gameConfig = config ? config : (this.isServer ? this.collections.configs.server : this.collections.configs.game);

        // Initialize SceneManager (handles lazy system instantiation)
        this.sceneManager = new GUTS.SceneManager(this);

        // Store available system types for lazy instantiation
        this.availableSystemTypes = this.gameConfig.systems || [];
        // Map to track instantiated systems by name
        this.systemsByName = new Map();

        // Load initial scene if configured
        // This enables systems and triggers onSceneLoad() callbacks
        await this.loadInitialScene();
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

        // Check if this system type is available
        if (!this.availableSystemTypes.includes(systemName)) {
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
        // Recycle freed entity IDs for better memory locality
        if (this.freeEntityCount > 0) {
            return this.freeEntityIds[--this.freeEntityCount];
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
        this._invalidateQueryCache();
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

        // Note: TypedArray numeric data doesn't need clearing -
        // the bitmask ensures it won't be read

        // Mark entity as dead and recycle ID
        this.entityAlive[entityId] = 0;
        this.entityComponentMask[entityId * 2] = 0;
        this.entityComponentMask[entityId * 2 + 1] = 0;
        this.freeEntityIds[this.freeEntityCount++] = entityId;
        this.entityCount--;
        this._invalidateQueryCache();
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

        this._invalidateQueryCache();
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
        this._invalidateQueryCache();
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

        this._invalidateQueryCache();
        return component;
    }

    /**
     * Invalidate all query caches - called when entities/components change
     */
    _invalidateQueryCache() {
        this._queryCacheVersion++;
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
     * Get all ECS data for network sync
     * Returns the raw TypedArrays and object components directly
     * Format: {
     *   entityAlive: Uint8Array,
     *   entityComponentMask: Uint32Array,
     *   numericArrays: { key: Float32Array },
     *   objectComponents: { componentType: { entityId: data } },
     *   nextEntityId: number
     * }
     */
    getECSData() {
        // Get only the used portion of arrays (up to nextEntityId)
        const maxEntity = this.nextEntityId;

        const result = {
            nextEntityId: this.nextEntityId,
            entityAlive: this.entityAlive.slice(0, maxEntity),
            entityComponentMask: this.entityComponentMask.slice(0, maxEntity * 2),
            numericArrays: {},
            objectComponents: {}
        };

        // Include all numeric arrays (sliced to maxEntity)
        for (const [key, arr] of this._numericArrays) {
            result.numericArrays[key] = Array.from(arr.slice(0, maxEntity));
        }

        // Include object components
        for (const [componentType, storage] of this._objectComponents) {
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
     * Apply ECS data from server directly to arrays
     */
    applyECSData(data) {
        // Apply entity alive flags
        if (data.entityAlive) {
            for (let i = 0; i < data.entityAlive.length; i++) {
                this.entityAlive[i] = data.entityAlive[i];
            }
        }

        // Apply component masks
        if (data.entityComponentMask) {
            for (let i = 0; i < data.entityComponentMask.length; i++) {
                this.entityComponentMask[i] = data.entityComponentMask[i];
            }
        }

        // Apply numeric arrays directly
        for (const [key, values] of Object.entries(data.numericArrays || {})) {
            let arr = this._numericArrays.get(key);
            if (!arr) {
                arr = new Float32Array(this.MAX_ENTITIES);
                this._numericArrays.set(key, arr);
            }
            for (let i = 0; i < values.length; i++) {
                arr[i] = values[i];
            }
        }

        // Apply object components
        for (const [componentType, componentData] of Object.entries(data.objectComponents || {})) {
            const storage = this._getObjectStorage(componentType);
            for (const [entityIdStr, value] of Object.entries(componentData)) {
                storage[parseInt(entityIdStr, 10)] = value;
            }
        }

        // Sync entity ID counter
        if (data.nextEntityId !== undefined) {
            this.nextEntityId = data.nextEntityId;
        }

        this._invalidateQueryCache();
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
            // Write to TypedArrays
            for (const fieldPath in updates) {
                this._setNumericField(componentType, entityId, fieldPath, updates[fieldPath]);
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

        // Check if we have a valid cached result
        const cached = this._queryCache.get(queryKey);
        if (cached && cached.version === this._queryCacheVersion) {
            return cached.result;
        }

        // Build query bitmask from component types
        let queryMask0 = 0;
        let queryMask1 = 0;
        for (const componentType of componentTypes) {
            const typeId = this._componentTypeId.get(componentType);
            if (typeId === undefined) {
                // Component type doesn't exist yet, no entities can have it
                const emptyResult = [];
                this._queryCache.set(queryKey, {
                    result: emptyResult,
                    version: this._queryCacheVersion
                });
                return emptyResult;
            }
            if (typeId < 32) {
                queryMask0 |= (1 << typeId);
            } else {
                queryMask1 |= (1 << (typeId - 32));
            }
        }

        // Scan all entities using bitmask matching
        // This is cache-friendly because we iterate contiguously through TypedArrays
        const result = [];
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

        // Result is already in ascending order (we iterate from 1 to maxId)
        // Cache the result
        this._queryCache.set(queryKey, {
            result,
            version: this._queryCacheVersion
        });

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
        this._invalidateQueryCache();
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
     * @returns {Object} { levels: { 0: 'hell', 1: 'level1' }, ... }
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
