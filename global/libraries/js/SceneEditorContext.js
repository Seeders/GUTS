/**
 * SceneEditorContext - Game context for the Scene Editor
 * Uses actual game systems for rendering - entities with components drive everything
 * No hardcoded rendering - systems detect entities and render them
 */
class SceneEditorContext {
    constructor(gameEditor, canvas) {
        this.gameEditor = gameEditor;
        this.canvas = canvas;
        this.collections = gameEditor.getCollections();

        // ECS data structures (same as BaseECSGame)
        this.entities = new Map();
        this.components = new Map();
        this.systems = [];
        this.managers = [];
        this.nextEntityId = 1;

        // Query cache
        this._queryCache = new Map();
        this._queryCacheVersion = 0;

        // Entity labels for editor display
        this.entityLabels = new Map();

        // Scene data
        this.currentSceneData = null;

        // State (required by systems)
        this.state = {
            isPaused: true,
            now: 0,
            deltaTime: 0.016,
            gameOver: false,
            victory: false,
            level: null
        };

        // Game services (required by systems)
        this.gameManager = new GUTS.GameServices();

        // Component generator
        this.componentGenerator = new GUTS.ComponentGenerator(this.collections.components);
        this.gameManager.register("getComponents", this.componentGenerator.getComponents.bind(this.componentGenerator));

        // Animation loop
        this.animationFrameId = null;
        this.clock = new THREE.Clock();

        // Is server flag (always false for editor)
        this.isServer = false;

        // References that systems will populate
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.terrainSystem = null;
        this.worldSystem = null;
        this.renderSystem = null;
        this.terrainTileMapper = null;
        this.modelManager = null;
    }

    /**
     * Initialize the editor context with required systems
     * @param {Array<string>} systemNames - Names of systems to initialize
     */
    async initialize(systemNames = ['GridSystem', 'TerrainSystem', 'WorldSystem', 'RenderSystem']) {
        // Set canvas reference
        this.canvas = this.canvas || document.getElementById('scene-editor-canvas');

        // Initialize model manager
        if (!this.modelManager) {
            const palette = this.gameEditor.getPalette();
            this.modelManager = new GUTS.ModelManager(
                this.gameEditor,
                {},
                { ShapeFactory: GUTS.ShapeFactory, palette, textures: this.collections.textures }
            );

            // Load all models
            for (const objectType in this.collections) {
                await this.modelManager.loadModels(objectType, this.collections[objectType]);
            }
        }

        // Initialize terrain tile mapper
        if (!this.terrainTileMapper) {
            await this.initTerrainTileMapper();
        }

        // Initialize systems in order
        for (const systemName of systemNames) {
            if (GUTS[systemName]) {
                try {
                    const systemInst = new GUTS[systemName](this);
                    systemInst.enabled = true;

                    if (systemInst.init) {
                        systemInst.init({ canvas: this.canvas });
                    }

                    this.systems.push(systemInst);

                    // Store references for common systems
                    if (systemName === 'TerrainSystem') {
                        this.terrainSystem = systemInst;
                    } else if (systemName === 'WorldSystem') {
                        this.worldSystem = systemInst;
                    } else if (systemName === 'RenderSystem') {
                        this.renderSystem = systemInst;
                    } else if (systemName === 'GridSystem') {
                        this.gridSystem = systemInst;
                    }
                } catch (e) {
                    console.warn(`[SceneEditorContext] Could not initialize ${systemName}:`, e);
                }
            }
        }

        // Call postAllInit on systems
        for (const system of this.systems) {
            if (system.postAllInit) {
                system.postAllInit();
            }
        }

        console.log('[SceneEditorContext] Initialized with systems:', systemNames);
    }

    /**
     * Initialize terrain tile mapper for texture rendering
     */
    async initTerrainTileMapper() {
        const gameConfig = this.collections.configs?.game;
        if (!gameConfig) return;

        const palette = this.gameEditor.getPalette();
        const imageManager = new GUTS.ImageManager(
            this.gameEditor,
            { imageSize: gameConfig.imageSize, palette },
            { ShapeFactory: GUTS.ShapeFactory }
        );

        // Load level images (use first available level)
        const levelNames = Object.keys(this.collections.levels || {});
        if (levelNames.length > 0) {
            await imageManager.loadImages("levels", { level: this.collections.levels[levelNames[0]] }, false, false);
            const terrainImages = imageManager.getImages("levels", "level");

            const terrainCanvasBuffer = document.createElement('canvas');
            terrainCanvasBuffer.width = 2048;
            terrainCanvasBuffer.height = 2048;

            this.terrainTileMapper = new GUTS.TileMap({});
            this.terrainTileMapper.init(
                terrainCanvasBuffer,
                gameConfig.gridSize,
                terrainImages,
                gameConfig.isIsometric,
                { skipCliffTextures: false }
            );
        }
    }

    /**
     * Load a scene - spawns entities which systems will detect and render
     * @param {Object} sceneData - Scene configuration with entities array
     */
    async loadScene(sceneData) {
        this.currentSceneData = sceneData;

        // Clear existing entities
        this.clearAllEntities();

        // Spawn entities from scene definition
        if (sceneData?.entities) {
            for (const entityDef of sceneData.entities) {
                await this.spawnEntityFromDefinition(entityDef);
            }
        }

        // Notify systems that scene has loaded - they will detect entities and render
        for (const system of this.systems) {
            if (system.enabled && system.onSceneLoad) {
                await system.onSceneLoad(sceneData);
            }
        }

        console.log('[SceneEditorContext] Scene loaded with', this.entities.size, 'entities');
    }

    /**
     * Spawn an entity from a scene definition (prefab + overrides)
     */
    async spawnEntityFromDefinition(entityDef) {
        const entityId = entityDef.id || `entity_${this.getEntityId()}`;
        const prefabs = this.collections.prefabs || {};

        // Get prefab components
        let components = {};
        if (entityDef.prefab && prefabs[entityDef.prefab]) {
            const prefabData = prefabs[entityDef.prefab];
            components = this.deepClone(prefabData.components || {});
        }

        // Merge with entity-specific overrides
        if (entityDef.components) {
            this.mergeComponents(components, entityDef.components);
        }

        // Create the entity
        this.createEntity(entityId);
        this.entityLabels.set(entityId, entityDef.name || entityDef.prefab || entityId);

        // Add all components
        for (const [componentType, componentData] of Object.entries(components)) {
            this.addComponent(entityId, componentType, componentData);
        }

        return entityId;
    }

    /**
     * Add a new entity from a prefab
     */
    addEntityFromPrefab(prefabName, overrides = {}) {
        const prefabs = this.collections.prefabs || {};
        const prefabData = prefabs[prefabName];

        if (!prefabData) {
            console.error(`[SceneEditorContext] Prefab '${prefabName}' not found`);
            return null;
        }

        const entityId = overrides.id || `entity_${this.getEntityId()}`;
        let components = this.deepClone(prefabData.components || {});

        if (overrides.components) {
            this.mergeComponents(components, overrides.components);
        }

        this.createEntity(entityId);
        this.entityLabels.set(entityId, overrides.name || prefabData.title || prefabName);

        for (const [componentType, componentData] of Object.entries(components)) {
            this.addComponent(entityId, componentType, componentData);
        }

        // Trigger systems to detect the new entity
        this.triggerEvent('onEntityCreated', entityId);

        // If this is a terrain entity, notify systems
        if (components.terrain) {
            for (const system of this.systems) {
                if (system.enabled && system.onSceneLoad) {
                    system.onSceneLoad(this.currentSceneData);
                }
            }
        }

        return entityId;
    }

    /**
     * Remove an entity
     */
    removeEntity(entityId) {
        // Notify systems before removal
        this.triggerEvent('onEntityDestroyed', entityId);

        // Destroy the entity
        this.destroyEntity(entityId);
        this.entityLabels.delete(entityId);
    }

    /**
     * Clear all entities
     */
    clearAllEntities() {
        // Notify systems
        for (const system of this.systems) {
            if (system.onSceneUnload) {
                system.onSceneUnload();
            }
        }

        const entityIds = Array.from(this.entities.keys());
        for (const entityId of entityIds) {
            this.destroyEntity(entityId);
        }
        this.entityLabels.clear();
    }

    // ============ ECS Methods (same as BaseECSGame) ============

    getEntityId() {
        return this.nextEntityId++;
    }

    getCollections() {
        return this.collections;
    }

    createEntity(setId) {
        const id = setId || this.getEntityId();
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

        const componentMethods = this.gameManager.call('getComponents');
        let componentData = data;

        // Use component generator if available
        if (componentMethods && componentMethods[componentId]) {
            componentData = componentMethods[componentId](data);
        }

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
        const queryKey = componentTypes.join(',');
        const cached = this._queryCache.get(queryKey);
        if (cached && cached.version === this._queryCacheVersion) {
            return cached.result;
        }

        const result = [];
        for (const [entityId, entityComponents] of this.entities) {
            if (componentTypes.every(type => entityComponents.has(type))) {
                result.push(entityId);
            }
        }

        if (result.length > 0 && typeof result[0] === 'number') {
            result.sort((a, b) => a - b);
        } else {
            result.sort();
        }

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

    // ============ Render Loop ============

    /**
     * Start the render/update loop
     */
    startRenderLoop() {
        const loop = async () => {
            const deltaTime = this.clock.getDelta();
            this.state.deltaTime = deltaTime;
            this.state.now += deltaTime;

            // Update enabled systems
            for (const system of this.systems) {
                if (!system.enabled) continue;

                if (system.update) {
                    await system.update();
                }

                if (system.render) {
                    await system.render();
                }
            }

            this.animationFrameId = requestAnimationFrame(loop);
        };

        loop();
    }

    /**
     * Stop the render loop
     */
    stopRenderLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    // ============ Utility Methods ============

    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
        const cloned = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                cloned[key] = this.deepClone(obj[key]);
            }
        }
        return cloned;
    }

    mergeComponents(base, overrides) {
        for (const [componentType, componentData] of Object.entries(overrides)) {
            if (base[componentType] && typeof base[componentType] === 'object' && typeof componentData === 'object') {
                this.deepMerge(base[componentType], componentData);
            } else {
                base[componentType] = this.deepClone(componentData);
            }
        }
    }

    deepMerge(target, source) {
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    if (!target[key] || typeof target[key] !== 'object') {
                        target[key] = {};
                    }
                    this.deepMerge(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            }
        }
    }

    getEntityLabel(entityId) {
        return this.entityLabels.get(entityId) || entityId;
    }

    setEntityLabel(entityId, label) {
        this.entityLabels.set(entityId, label);
    }

    /**
     * Export scene to JSON format
     */
    exportScene() {
        const entities = [];

        for (const entityId of this.entities.keys()) {
            const componentTypes = this.entities.get(entityId);
            const componentsObj = {};

            for (const componentType of componentTypes) {
                const componentData = this.getComponent(entityId, componentType);
                if (componentData) {
                    componentsObj[componentType] = componentData;
                }
            }

            entities.push({
                id: entityId,
                name: this.entityLabels.get(entityId) || entityId,
                components: componentsObj
            });
        }

        return {
            title: this.currentSceneData?.title || 'Untitled Scene',
            systems: this.currentSceneData?.systems || [],
            entities
        };
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stopRenderLoop();

        for (const system of this.systems) {
            if (system.destroy) {
                system.destroy();
            }
        }

        this.systems = [];
        this.clearAllEntities();
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SceneEditorContext;
}

if (typeof GUTS !== 'undefined') {
    GUTS.SceneEditorContext = SceneEditorContext;
}

export default SceneEditorContext;
export { SceneEditorContext };
