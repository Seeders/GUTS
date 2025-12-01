/**
 * SceneEditorContext - Game context for the Scene Editor
 * Provides a real game-like environment for editing scenes with live preview
 * Uses actual game systems (WorldSystem, RenderSystem, etc.) for accurate rendering
 */
class SceneEditorContext extends GUTS.BaseECSGame {
    constructor(gameEditor, canvas, config = {}) {
        super(gameEditor);

        this.gameEditor = gameEditor;
        this.canvas = canvas;
        this.editorConfig = config;

        // Track entity labels for editor display
        this.entityLabels = new Map();

        // Scene data
        this.currentSceneData = null;
        this.currentSceneName = null;

        // Editor-specific state
        this.selectedEntityId = null;
        this.isPlaying = false;

        // Initialize component generator
        this.collections = gameEditor.getCollections();
        this.componentGenerator = new GUTS.ComponentGenerator(this.collections.components);

        // Initialize gameManager with GameServices
        this.gameManager = new GUTS.GameServices();
        this.gameManager.register("getComponents", this.componentGenerator.getComponents.bind(this.componentGenerator));
        this.gameManager.register("getPlacementGridSize", () => {
            return { width: 100, height: 100 };
        });

        // Initialize state
        this.state = {
            isPaused: true, // Editor starts paused
            now: 0,
            deltaTime: 0,
            gameOver: false,
            victory: false,
            level: null
        };

        // Rendering components (initialized later)
        this.worldRenderer = null;
        this.entityRenderer = null;
        this.terrainDataManager = null;
        this.terrainTileMapper = null;

        // Animation loop
        this.animationFrameId = null;
        this.clock = new THREE.Clock();

        // Initialize scene manager
        this.sceneManager = new GUTS.SceneManager(this);
    }

    /**
     * Initialize the editor context with required systems
     * @param {Array<string>} systemNames - Names of systems to initialize
     */
    async initializeSystems(systemNames = ['GridSystem', 'TerrainSystem', 'WorldSystem', 'RenderSystem']) {
        // Initialize only the specified systems
        for (const systemName of systemNames) {
            if (GUTS[systemName]) {
                const systemInst = new GUTS[systemName](this);
                systemInst.enabled = true;
                if (systemInst.init) {
                    systemInst.init({ canvas: this.canvas });
                }
                this.systems.push(systemInst);

                // Store reference for common systems
                if (systemName === 'TerrainSystem') {
                    this.terrainSystem = systemInst;
                } else if (systemName === 'WorldSystem') {
                    this.worldSystem = systemInst;
                } else if (systemName === 'RenderSystem') {
                    this.renderSystem = systemInst;
                }
            }
        }

        // Call postAllInit
        for (const system of this.systems) {
            if (system.postAllInit) {
                system.postAllInit();
            }
        }
    }

    /**
     * Load a scene into the editor
     * @param {string} sceneName - Name of the scene to load
     */
    async loadScene(sceneName) {
        const sceneData = this.collections.scenes?.[sceneName];
        if (!sceneData) {
            console.error(`[SceneEditorContext] Scene '${sceneName}' not found`);
            return;
        }

        this.currentSceneData = sceneData;
        this.currentSceneName = sceneName;

        // Clear existing entities
        this.clearAllEntities();

        // Spawn entities from scene
        await this.spawnSceneEntities(sceneData);

        // Notify systems
        for (const system of this.systems) {
            if (system.enabled && system.onSceneLoad) {
                system.onSceneLoad(sceneData);
            }
        }

        console.log(`[SceneEditorContext] Scene '${sceneName}' loaded`);
    }

    /**
     * Clear all entities from the context
     */
    clearAllEntities() {
        const entityIds = Array.from(this.entities.keys());
        for (const entityId of entityIds) {
            this.destroyEntity(entityId);
        }
        this.entityLabels.clear();
        this.selectedEntityId = null;
    }

    /**
     * Spawn entities from scene data
     * @param {Object} sceneData - The scene configuration
     */
    async spawnSceneEntities(sceneData) {
        const entities = sceneData.entities || [];
        const prefabs = this.collections.prefabs || {};

        for (const entityDef of entities) {
            const entityId = entityDef.id || `entity_${this.getEntityId()}`;

            // Get prefab data if specified
            let components = {};
            if (entityDef.prefab && prefabs[entityDef.prefab]) {
                const prefabData = prefabs[entityDef.prefab];
                components = this.deepClone(prefabData.components || {});
            }

            // Merge with entity-specific component overrides
            if (entityDef.components) {
                this.mergeComponents(components, entityDef.components);
            }

            // Create the entity
            this.createEntity(entityId);
            this.entityLabels.set(entityId, entityDef.name || entityDef.prefab || entityId);

            // Add all components to the entity
            for (const [componentType, componentData] of Object.entries(components)) {
                this.addComponent(entityId, componentType, componentData);
            }
        }
    }

    /**
     * Add a new entity from a prefab
     * @param {string} prefabName - Name of the prefab
     * @param {Object} overrides - Component overrides
     * @returns {string} - Created entity ID
     */
    addEntityFromPrefab(prefabName, overrides = {}) {
        const prefabs = this.collections.prefabs || {};
        const prefabData = prefabs[prefabName];

        if (!prefabData) {
            console.error(`[SceneEditorContext] Prefab '${prefabName}' not found`);
            return null;
        }

        const entityId = `entity_${this.getEntityId()}`;
        let components = this.deepClone(prefabData.components || {});

        // Apply overrides
        if (overrides.components) {
            this.mergeComponents(components, overrides.components);
        }

        // Create entity
        this.createEntity(entityId);
        this.entityLabels.set(entityId, overrides.name || prefabData.title || prefabName);

        // Add components
        for (const [componentType, componentData] of Object.entries(components)) {
            this.addComponent(entityId, componentType, componentData);
        }

        // Trigger update for render system
        this.triggerEvent('onEntityCreated', entityId);

        return entityId;
    }

    /**
     * Update a component on an entity
     * @param {string} entityId - Entity ID
     * @param {string} componentType - Component type
     * @param {Object} data - New component data
     */
    updateComponent(entityId, componentType, data) {
        if (!this.hasComponent(entityId, componentType)) {
            this.addComponent(entityId, componentType, data);
        } else {
            // Get existing component and merge
            const existing = this.getComponent(entityId, componentType);
            Object.assign(existing, data);
        }

        // Trigger update
        this.triggerEvent('onEntityComponentUpdated', { entityId, componentType });
    }

    /**
     * Select an entity in the editor
     * @param {string} entityId - Entity ID to select
     */
    selectEntity(entityId) {
        this.selectedEntityId = entityId;
        this.triggerEvent('onEntitySelected', entityId);
    }

    /**
     * Get the currently selected entity
     * @returns {string|null} - Selected entity ID
     */
    getSelectedEntity() {
        return this.selectedEntityId;
    }

    /**
     * Export current scene to JSON format
     * @returns {Object} - Scene data for saving
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
     * Start the editor render loop
     */
    startRenderLoop() {
        const render = () => {
            const deltaTime = this.clock.getDelta();

            // Update world renderer if available
            if (this.worldSystem?.worldRenderer) {
                this.worldSystem.worldRenderer.update(deltaTime);
                this.worldSystem.worldRenderer.render();
            }

            this.animationFrameId = requestAnimationFrame(render);
        };

        render();
    }

    /**
     * Stop the editor render loop
     */
    stopRenderLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * Deep clone an object
     */
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

    /**
     * Merge component overrides into base components
     */
    mergeComponents(base, overrides) {
        for (const [componentType, componentData] of Object.entries(overrides)) {
            if (base[componentType] && typeof base[componentType] === 'object' && typeof componentData === 'object') {
                this.deepMerge(base[componentType], componentData);
            } else {
                base[componentType] = this.deepClone(componentData);
            }
        }
    }

    /**
     * Deep merge source into target
     */
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

    /**
     * Get collections (required by BaseECSGame)
     */
    getCollections() {
        return this.collections;
    }

    /**
     * Get entity label
     */
    getEntityLabel(entityId) {
        return this.entityLabels.get(entityId) || entityId;
    }

    /**
     * Set entity label
     */
    setEntityLabel(entityId, label) {
        this.entityLabels.set(entityId, label);
    }

    /**
     * Destroy and cleanup
     */
    destroy() {
        this.stopRenderLoop();

        // Destroy all systems
        for (const system of this.systems) {
            if (system.destroy) {
                system.destroy();
            }
        }

        this.systems = [];
        this.clearAllEntities();
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SceneEditorContext;
}

// Also make available on GUTS global if it exists
if (typeof GUTS !== 'undefined') {
    GUTS.SceneEditorContext = SceneEditorContext;
}

export default SceneEditorContext;
export { SceneEditorContext };
