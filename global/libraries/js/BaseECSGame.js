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

        // Service registry (moved from GameServices)
        this.services = new Map();

        // Query cache for getEntitiesWith - invalidated on entity/component changes
        this._queryCache = new Map();  // queryKey -> { result: [], version: number }
        this._queryCacheVersion = 0;   // Incremented when entities/components change

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

    // Service registry methods (from GameServices)
    register(key, method) {
        if (this.services.has(key)) {
            console.warn(`[BaseECSGame] Service ${key} already registered! Overwriting.`);
        }
        this.services.set(key, method);
    }

    hasService(key) {
        return this.services.has(key);
    }

    call(key, ...args) {
        const method = this.services.get(key);
        if (!method) {
            console.warn('[BaseECSGame] missing service method', key);
            return undefined;
        }
        return method(...args);
    }

    listServices() {
        return Array.from(this.services.keys());
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

            const componentTypes = this.entities.get(entityId);
            componentTypes.forEach(type => {
                this.removeComponent(entityId, type);
            });
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
        if (!this.components.has(componentId)) {
            this.components.set(componentId, new Map());
        }

        this.components.get(componentId).set(entityId, componentData);
        this.entities.get(entityId).add(componentId);
        this._invalidateQueryCache();
    }

    removeComponent(entityId, componentType) {
        let component = this.getComponent(entityId, componentType);
        if (this.components.has(componentType)) {
            this.components.get(componentType).delete(entityId);
        }
        if (this.entities.has(entityId)) {
            this.entities.get(entityId).delete(componentType);
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
        if (this.components.has(componentType)) {
            return this.components.get(componentType).get(entityId);
        }
        return null;
    }
    
    hasComponent(entityId, componentType) {
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

        // Compute new result
        const result = [];
        for (const [entityId, entityComponents] of this.entities) {
            if (componentTypes.every(type => entityComponents.has(type))) {
                result.push(entityId);
            }
        }

        // Sort for deterministic order across clients/server
        // Use efficient numeric/string comparison based on ID type
        if (result.length > 0 && typeof result[0] === 'number') {
            result.sort((a, b) => a - b);  // Fast numeric sort
        } else {
            result.sort();  // Default string sort (faster than localeCompare)
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
