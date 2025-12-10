class BaseECSGame {
    constructor(app) {
        this.app = app;
        this.state = {};

        this.entityId = 0;
        this.entitiesToAdd = [];
        this.entities = new Map();
        this.components = new Map();
        this.classes = [];
        this.systems = [];

        // Scene management
        this.sceneManager = null;

        // Service registry
        this._services = new GUTS.GameServices();

        // Query cache for getEntitiesWith - invalidated on entity/component changes
        this._queryCache = new Map();  // queryKey -> { result: [], version: number }
        this._queryCacheVersion = 0;   // Incremented when entities/components change

        // OPTIMIZATION: Track which entities have each component type for faster queries
        // This inverted index allows O(1) lookup of "which entities have component X"
        // instead of iterating all entities
        this._entitiesByComponent = new Map();  // componentType -> Set of entityIds

        // OPTIMIZATION: Cache component type Maps to avoid repeated lookups
        this._componentMapCache = new Map();  // componentType -> Map (direct reference)

        this.nextEntityId = 1;
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

    init(isServer = false, config) {
        this.isServer = isServer;
        if(!this.isServer){
            document.addEventListener('keydown', (e) => {
                this.triggerEvent('onKeyDown', e.key);
            });
        }
        this.loadGameScripts(config);
    }

    loadGameScripts(config) {
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
        this.loadInitialScene();
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
        if (this.entities.has(id)) {
            const existingComponents = Array.from(this.entities.get(id));
            console.error(`[BaseECSGame] createEntity called for existing entity ${id}! Existing components: ${existingComponents.join(', ')}`);
            console.trace('createEntity called from:');
        }
        this.entities.set(id, new Set());
        this._invalidateQueryCache();
        return id;
    }

    destroyEntity(entityId) {
        if (this.entities.has(entityId)) {

            this.systems.forEach(system => {
                if (system.entityDestroyed) {
                    system.entityDestroyed(entityId);
                }
            });

            // Get component types before we start removing them
            const componentTypes = Array.from(this.entities.get(entityId));

            // Remove from component maps and inverted index
            for (const type of componentTypes) {
                // Remove from component map
                const componentMap = this._componentMapCache.get(type);
                if (componentMap) {
                    componentMap.delete(entityId);
                }

                // Remove from inverted index
                const entitySet = this._entitiesByComponent.get(type);
                if (entitySet) {
                    entitySet.delete(entityId);
                }
            }

            this.entities.delete(entityId);
            this._invalidateQueryCache();
        }
    }

    addComponent(entityId, componentId, data) {
        if (!this.entities.has(entityId)) {
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

        // Get or create the component map
        let componentMap = this._componentMapCache.get(componentId);
        if (!componentMap) {
            componentMap = new Map();
            this.components.set(componentId, componentMap);
            this._componentMapCache.set(componentId, componentMap);
        }

        componentMap.set(entityId, componentData);
        this.entities.get(entityId).add(componentId);

        // OPTIMIZATION: Update inverted index for fast queries
        let entitySet = this._entitiesByComponent.get(componentId);
        if (!entitySet) {
            entitySet = new Set();
            this._entitiesByComponent.set(componentId, entitySet);
        }
        entitySet.add(entityId);

        this._invalidateQueryCache();
    }

    /**
     * OPTIMIZATION: Add multiple components at once with single cache invalidation
     * This is much faster than calling addComponent() multiple times
     * @param {*} entityId - Entity ID
     * @param {Object} componentsData - Object mapping componentId -> data
     */
    addComponents(entityId, componentsData) {
        if (!this.entities.has(entityId)) {
            throw new Error(`Entity ${entityId} does not exist`);
        }

        // Cache lookups once for all components
        const componentMethods = this.call('getComponents');
        const entityComponents = this.entities.get(entityId);

        for (const [componentId, data] of Object.entries(componentsData)) {
            // Use factory function if available, otherwise use data directly
            const componentData = componentMethods[componentId]
                ? componentMethods[componentId](data)
                : { ...data };

            // Get or create the component map
            let componentMap = this._componentMapCache.get(componentId);
            if (!componentMap) {
                componentMap = new Map();
                this.components.set(componentId, componentMap);
                this._componentMapCache.set(componentId, componentMap);
            }

            componentMap.set(entityId, componentData);
            entityComponents.add(componentId);

            // Update inverted index
            let entitySet = this._entitiesByComponent.get(componentId);
            if (!entitySet) {
                entitySet = new Set();
                this._entitiesByComponent.set(componentId, entitySet);
            }
            entitySet.add(entityId);
        }

        // Single cache invalidation for all components
        this._invalidateQueryCache();
    }

    removeComponent(entityId, componentType) {
        let component = this.getComponent(entityId, componentType);

        // Use cached component map for faster access
        const componentMap = this._componentMapCache.get(componentType);
        if (componentMap) {
            componentMap.delete(entityId);
        }

        if (this.entities.has(entityId)) {
            this.entities.get(entityId).delete(componentType);
        }

        // OPTIMIZATION: Update inverted index
        const entitySet = this._entitiesByComponent.get(componentType);
        if (entitySet) {
            entitySet.delete(entityId);
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
        // OPTIMIZATION: Use cached component map for direct access
        const componentMap = this._componentMapCache.get(componentType);
        if (componentMap) {
            return componentMap.get(entityId);
        }
        // Fallback for components added before cache was populated
        if (this.components.has(componentType)) {
            const map = this.components.get(componentType);
            this._componentMapCache.set(componentType, map);
            return map.get(entityId);
        }
        return null;
    }

    hasComponent(entityId, componentType) {
        // OPTIMIZATION: Use cached component map
        const componentMap = this._componentMapCache.get(componentType);
        if (componentMap) {
            return componentMap.has(entityId);
        }
        return this.components.has(componentType) &&
                this.components.get(componentType).has(entityId);
    }

    getEntitiesWith(...componentTypes) {
        // Create cache key from component types
        const queryKey = componentTypes.join(',');

        // Check if we have a valid cached result
        const cached = this._queryCache.get(queryKey);
        if (cached && cached.version === this._queryCacheVersion) {
            return cached.result;
        }

        // OPTIMIZATION: Use inverted index for faster queries
        // Start with the smallest set (component with fewest entities)
        // and intersect with others
        let smallestSet = null;
        let smallestSize = Infinity;

        for (const componentType of componentTypes) {
            const entitySet = this._entitiesByComponent.get(componentType);
            if (!entitySet || entitySet.size === 0) {
                // No entities have this component, result is empty
                const emptyResult = [];
                this._queryCache.set(queryKey, {
                    result: emptyResult,
                    version: this._queryCacheVersion
                });
                return emptyResult;
            }
            if (entitySet.size < smallestSize) {
                smallestSize = entitySet.size;
                smallestSet = entitySet;
            }
        }

        // If only one component type, return entities from that set directly
        if (componentTypes.length === 1) {
            const result = Array.from(smallestSet);
            // Sort for deterministic order
            if (result.length > 1) {
                if (typeof result[0] === 'number') {
                    result.sort((a, b) => a - b);
                } else {
                    result.sort();
                }
            }
            this._queryCache.set(queryKey, {
                result,
                version: this._queryCacheVersion
            });
            return result;
        }

        // Multiple components: iterate smallest set and check others
        const result = [];
        for (const entityId of smallestSet) {
            let hasAll = true;
            for (const componentType of componentTypes) {
                const entitySet = this._entitiesByComponent.get(componentType);
                if (!entitySet || !entitySet.has(entityId)) {
                    hasAll = false;
                    break;
                }
            }
            if (hasAll) {
                result.push(entityId);
            }
        }

        // Sort for deterministic order across clients/server
        if (result.length > 1) {
            if (typeof result[0] === 'number') {
                result.sort((a, b) => a - b);  // Fast numeric sort
            } else {
                result.sort();  // Default string sort
            }
        }

        // Cache the result
        this._queryCache.set(queryKey, {
            result,
            version: this._queryCacheVersion
        });

        return result;
    }
    
    triggerEvent(eventName, data) {
        this.systems.forEach(system => {
            if (system[eventName]) {
                system[eventName](data);
            }
        });
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
}


// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.BaseECSGame = BaseECSGame;
}

// ES6 exports for webpack bundling
export default BaseECSGame;
export { BaseECSGame };
