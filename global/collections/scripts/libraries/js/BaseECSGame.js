/**
 * BaseECSGame - Optimized Entity Component System
 *
 * This implementation uses multiple optimization strategies:
 * 1. Archetype-based storage for efficient querying
 * 2. TypedArray pools for frequently-accessed numeric components
 * 3. Incremental query cache updates
 * 4. Deferred structural changes for batch operations
 * 5. Batch component access methods
 */
class BaseECSGame {
    constructor(app) {
        this.app = app;
        this.state = {};

        this.entityId = 0;
        this.entitiesToAdd = [];

        // ====== OPTIMIZED STORAGE ======
        // Archetype-based storage (initialized lazily)
        this._archetypeManager = null;

        // TypedArray pools for numeric components
        this._componentPools = null;

        // Entity tracking: entityId -> Set<componentType>
        this.entities = new Map();

        // Component storage: componentType -> SparseSet
        this.components = new Map();

        this.classes = [];
        this.systems = [];

        // Scene management
        this.sceneManager = null;

        // Service registry
        this._services = null;

        // ====== QUERY CACHE ======
        this._queryCache = new Map();
        this._queryCacheVersion = 0;
        this._entityQueryMembership = new Map();

        // ====== DEFERRED CHANGES ======
        this._deferChanges = false;
        this._pendingAddComponents = [];
        this._pendingRemoveComponents = [];
        this._pendingDestroyEntities = [];

        this.nextEntityId = 1;
        this.lastTime = 0;
        this.currentTime = 0;
        this.deltaTime = 0;
        this.tickCount = 0;

        this.FIXED_DELTA_TIME = 1/20;
        this.isServer = false;
        this.performanceMonitor = null;
    }

    _initOptimizedStorage() {
        if (typeof GUTS === 'undefined') return;

        if (!this._services && GUTS.GameServices) {
            this._services = new GUTS.GameServices();
        }

        if (!this._archetypeManager && GUTS.ArchetypeManager) {
            this._archetypeManager = new GUTS.ArchetypeManager();
        }

        if (!this._componentPools && GUTS.ComponentPoolManager) {
            this._componentPools = new GUTS.ComponentPoolManager();
        }

        if (!this.performanceMonitor && GUTS.PerformanceMonitor) {
            this.performanceMonitor = new GUTS.PerformanceMonitor();
        }
    }

    // ====== SERVICE REGISTRY ======

    register(key, method) {
        this._initOptimizedStorage();
        if (this._services) {
            this._services.register(key, method);
        }
    }

    hasService(key) {
        return this._services ? this._services.has(key) : false;
    }

    call(key, ...args) {
        return this._services ? this._services.call(key, ...args) : undefined;
    }

    listServices() {
        return this._services ? this._services.listServices() : [];
    }

    // ====== INITIALIZATION ======

    init(isServer = false, config) {
        this.isServer = isServer;
        this._initOptimizedStorage();

        if (!this.isServer) {
            document.addEventListener('keydown', (e) => {
                this.triggerEvent('onKeyDown', e.key);
            });
        }
        this.loadGameScripts(config);
    }

    loadGameScripts(config) {
        this.collections = this.getCollections();
        this.gameConfig = config ? config : (this.isServer ? this.collections.configs.server : this.collections.configs.game);

        if (GUTS.SceneManager) {
            this.sceneManager = new GUTS.SceneManager(this);
        }

        this.availableSystemTypes = this.gameConfig.systems || [];
        this.systemsByName = new Map();
        this.loadInitialScene();
    }

    async loadInitialScene() {
        const initialScene = this.gameConfig.initialScene;
        if (initialScene && this.sceneManager) {
            await this.sceneManager.loadScene(initialScene);
        } else {
            console.warn('[BaseECSGame] No initialScene configured in game config');
        }
    }

    // ====== SYSTEM MANAGEMENT ======

    getOrCreateSystem(systemName) {
        if (this.systemsByName.has(systemName)) {
            return this.systemsByName.get(systemName);
        }

        if (!this.availableSystemTypes.includes(systemName)) {
            console.warn(`[BaseECSGame] System '${systemName}' not in available systems list`);
            return null;
        }

        if (!GUTS[systemName]) {
            console.error(`[BaseECSGame] System class '${systemName}' not found in GUTS`);
            return null;
        }

        const params = { canvas: this.canvas };
        const systemInst = new GUTS[systemName](this);
        systemInst.enabled = false;

        if (systemInst.init) {
            systemInst.init(params);
        }

        this.systems.push(systemInst);
        this.systemsByName.set(systemName, systemInst);

        return systemInst;
    }

    isSystemAvailable(systemName) {
        return this.availableSystemTypes.includes(systemName);
    }

    async switchScene(sceneName) {
        if (this.sceneManager) {
            await this.sceneManager.switchScene(sceneName);
        }
    }

    // ====== ENTITY MANAGEMENT ======

    getEntityId() {
        return this.nextEntityId++;
    }

    getCollections() {
        return this.app.getCollections();
    }

    createEntity(setId) {
        const id = setId || this.getEntityId();

        if (this.entities.has(id)) {
            const existingComponents = Array.from(this.entities.get(id));
            console.error(`[BaseECSGame] createEntity called for existing entity ${id}! Existing components: ${existingComponents.join(', ')}`);
            console.trace('createEntity called from:');
        }

        this.entities.set(id, new Set());

        if (this._archetypeManager) {
            try {
                this._archetypeManager.createEntity(id);
            } catch (e) { /* ignore duplicate */ }
        }

        this._invalidateQueryCache();
        return id;
    }

    destroyEntity(entityId) {
        if (this._deferChanges) {
            this._pendingDestroyEntities.push(entityId);
            return;
        }
        this._destroyEntityImmediate(entityId);
    }

    _destroyEntityImmediate(entityId) {
        if (!this.entities.has(entityId)) return;

        for (const system of this.systems) {
            if (system.entityDestroyed) {
                system.entityDestroyed(entityId);
            }
        }

        const componentTypes = this.entities.get(entityId);
        for (const type of componentTypes) {
            this._removeComponentImmediate(entityId, type, true);
        }

        this.entities.delete(entityId);
        this._entityQueryMembership.delete(entityId);

        if (this._archetypeManager) {
            this._archetypeManager.destroyEntity(entityId);
        }

        this._invalidateQueryCache();
    }

    // ====== COMPONENT MANAGEMENT ======

    addComponent(entityId, componentId, data) {
        if (this._deferChanges) {
            this._pendingAddComponents.push({ entityId, componentId, data });
            return;
        }
        this._addComponentImmediate(entityId, componentId, data);
    }

    _addComponentImmediate(entityId, componentId, data) {
        if (!this.entities.has(entityId)) {
            throw new Error(`Entity ${entityId} does not exist`);
        }

        const componentMethods = this.call('getComponents');
        if (componentMethods && !componentMethods[componentId]) {
            console.warn(`[BaseECSGame] No component factory for '${componentId}'.`);
        }

        const componentData = (componentMethods && componentMethods[componentId])
            ? componentMethods[componentId](data)
            : { ...data };

        // Store in TypedArray pool if poolable
        if (this._componentPools) {
            this._componentPools.set(componentId, entityId, componentData);
        }

        // Store in SparseSet
        if (!this.components.has(componentId)) {
            this.components.set(componentId, GUTS.SparseSet ? new GUTS.SparseSet() : new Map());
        }
        const storage = this.components.get(componentId);
        if (storage.set) {
            storage.set(entityId, componentData);
        }

        // Update entity signature
        const oldSignature = new Set(this.entities.get(entityId));
        this.entities.get(entityId).add(componentId);
        const newSignature = this.entities.get(entityId);

        // Update archetype
        if (this._archetypeManager) {
            this._archetypeManager.addComponent(entityId, componentId, componentData);
        }

        this._updateQueryCacheForSignatureChange(entityId, oldSignature, newSignature);
    }

    removeComponent(entityId, componentType) {
        if (this._deferChanges) {
            this._pendingRemoveComponents.push({ entityId, componentType });
            return this.getComponent(entityId, componentType);
        }
        return this._removeComponentImmediate(entityId, componentType, false);
    }

    _removeComponentImmediate(entityId, componentType, skipCacheUpdate = false) {
        const component = this.getComponent(entityId, componentType);

        // Remove from pools
        if (this._componentPools) {
            this._componentPools.delete(componentType, entityId);
        }

        // Remove from SparseSet/Map
        const storage = this.components.get(componentType);
        if (storage) {
            storage.delete(entityId);
        }

        if (this.entities.has(entityId)) {
            const oldSignature = new Set(this.entities.get(entityId));
            this.entities.get(entityId).delete(componentType);
            const newSignature = this.entities.get(entityId);

            if (this._archetypeManager) {
                try {
                    this._archetypeManager.removeComponent(entityId, componentType);
                } catch (e) { /* ignore */ }
            }

            if (!skipCacheUpdate) {
                this._updateQueryCacheForSignatureChange(entityId, oldSignature, newSignature);
            }
        }

        return component;
    }

    getComponent(entityId, componentType) {
        // Try TypedArray pool first (returns live proxy for poolable types)
        if (this._componentPools) {
            const pooled = this._componentPools.get(componentType, entityId);
            if (pooled !== null) {
                return pooled;
            }
        }

        // Fall back to SparseSet/Map
        const storage = this.components.get(componentType);
        if (storage) {
            return storage.get(entityId);
        }
        return null;
    }

    hasComponent(entityId, componentType) {
        const storage = this.components.get(componentType);
        if (!storage) return false;
        return storage.has(entityId);
    }

    // ====== BATCH COMPONENT ACCESS ======

    getComponents(entityId, ...componentTypes) {
        const result = {};
        for (const type of componentTypes) {
            result[type] = this.getComponent(entityId, type);
        }
        return result;
    }

    getEntitiesWithData(...componentTypes) {
        const entityIds = this.getEntitiesWith(...componentTypes);
        return entityIds.map(id => ({
            id,
            components: this.getComponents(id, ...componentTypes)
        }));
    }

    // ====== DEFERRED CHANGES ======

    beginBatch() {
        this._deferChanges = true;
    }

    endBatch() {
        this._deferChanges = false;

        for (const { entityId, componentId, data } of this._pendingAddComponents) {
            this._addComponentImmediate(entityId, componentId, data);
        }

        for (const { entityId, componentType } of this._pendingRemoveComponents) {
            this._removeComponentImmediate(entityId, componentType, false);
        }

        for (const entityId of this._pendingDestroyEntities) {
            this._destroyEntityImmediate(entityId);
        }

        this._pendingAddComponents = [];
        this._pendingRemoveComponents = [];
        this._pendingDestroyEntities = [];
        this._invalidateQueryCache();
    }

    cancelBatch() {
        this._deferChanges = false;
        this._pendingAddComponents = [];
        this._pendingRemoveComponents = [];
        this._pendingDestroyEntities = [];
    }

    // ====== QUERY SYSTEM ======

    getEntitiesWith(...componentTypes) {
        if (componentTypes.length === 0) {
            return Array.from(this.entities.keys()).sort((a, b) => a - b);
        }

        const queryKey = componentTypes.slice().sort().join(',');

        // Check cache
        const cached = this._queryCache.get(queryKey);
        if (cached && cached.version === this._queryCacheVersion) {
            return cached.result;
        }

        // Compute result using archetype manager (most efficient)
        let result = [];
        let entitySet = new Set();

        if (this._archetypeManager) {
            result = this._archetypeManager.getEntitiesWith(...componentTypes);
            entitySet = new Set(result);
        } else {
            // Fallback iteration
            for (const [entityId, entityComponents] of this.entities) {
                if (componentTypes.every(type => entityComponents.has(type))) {
                    result.push(entityId);
                    entitySet.add(entityId);
                }
            }

            if (result.length > 0 && typeof result[0] === 'number') {
                result.sort((a, b) => a - b);
            } else {
                result.sort();
            }
        }

        // Cache result
        this._queryCache.set(queryKey, {
            result,
            entities: entitySet,
            componentTypes: componentTypes.slice().sort(),
            version: this._queryCacheVersion
        });

        // Track membership
        for (const entityId of entitySet) {
            if (!this._entityQueryMembership.has(entityId)) {
                this._entityQueryMembership.set(entityId, new Set());
            }
            this._entityQueryMembership.get(entityId).add(queryKey);
        }

        return result;
    }

    _invalidateQueryCache() {
        this._queryCacheVersion++;
    }

    _updateQueryCacheForSignatureChange(entityId, oldSignature, newSignature) {
        for (const [queryKey, cached] of this._queryCache) {
            const queryTypes = cached.componentTypes;
            const wasMatch = queryTypes.every(t => oldSignature.has(t));
            const isMatch = queryTypes.every(t => newSignature.has(t));

            if (wasMatch && !isMatch) {
                const idx = cached.result.indexOf(entityId);
                if (idx !== -1) cached.result.splice(idx, 1);
                cached.entities.delete(entityId);

                const membership = this._entityQueryMembership.get(entityId);
                if (membership) membership.delete(queryKey);
            } else if (!wasMatch && isMatch) {
                this._insertSorted(cached.result, entityId);
                cached.entities.add(entityId);

                if (!this._entityQueryMembership.has(entityId)) {
                    this._entityQueryMembership.set(entityId, new Set());
                }
                this._entityQueryMembership.get(entityId).add(queryKey);
            }
        }
    }

    _insertSorted(arr, entityId) {
        if (arr.length === 0) {
            arr.push(entityId);
            return;
        }

        let low = 0;
        let high = arr.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (arr[mid] < entityId) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        arr.splice(low, 0, entityId);
    }

    // ====== UPDATE LOOP ======

    async update(deltaTime) {
        if (this.state.isPaused) return;

        if (this.performanceMonitor) {
            this.performanceMonitor.startFrame();
        }

        this.tickCount++;
        this.currentTime = Math.round(this.tickCount * this.FIXED_DELTA_TIME * 100) / 100;
        this.state.now = this.currentTime;
        this.state.deltaTime = this.FIXED_DELTA_TIME;
        this.deltaTime = this.FIXED_DELTA_TIME;

        for (const system of this.systems) {
            if (!system.enabled) continue;

            const systemName = system.constructor.name;

            if (this.performanceMonitor) {
                this.performanceMonitor.startSystem(systemName);
            }

            if (system.update) {
                await system.update();
            }

            if (this.performanceMonitor) {
                this.performanceMonitor.endSystemUpdate(systemName);
            }

            if (system.render && !this.isServer) {
                if (this.performanceMonitor) {
                    this.performanceMonitor.startSystemRender(systemName);
                }
                await system.render();
                if (this.performanceMonitor) {
                    this.performanceMonitor.endSystemRender(systemName);
                }
            } else if (this.performanceMonitor) {
                this.performanceMonitor.startSystemRender(systemName);
                this.performanceMonitor.endSystemRender(systemName);
            }
        }

        if (this.performanceMonitor) {
            this.performanceMonitor.updateOverlay();
        }

        this.postUpdate();
    }

    postUpdate() {
        this.lastTime = this.currentTime;
        for (const entity of this.entitiesToAdd) {
            this.addEntity(entity);
        }
        this.entitiesToAdd = [];
    }

    // ====== EVENTS ======

    triggerEvent(eventName, data) {
        for (const system of this.systems) {
            if (system[eventName]) {
                system[eventName](data);
            }
        }
    }

    // ====== GAME STATE ======

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

    // ====== DIAGNOSTICS ======

    getStorageStats() {
        const stats = {
            entityCount: this.entities.size,
            componentTypes: this.components.size,
            cachedQueries: this._queryCache.size,
            queryCacheVersion: this._queryCacheVersion
        };

        if (this._archetypeManager) {
            stats.archetypes = this._archetypeManager.getStats();
        }

        if (this._componentPools) {
            stats.pools = this._componentPools.getStats();
        }

        return stats;
    }
}

// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.BaseECSGame = BaseECSGame;
}

// ES6 exports for webpack bundling
export default BaseECSGame;
export { BaseECSGame };
