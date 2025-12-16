/**
 * EditorECSGame - ECS game context for editors
 * Extends BaseECSGame similar to how ECSGame extends it for runtime
 * Used by TerrainMapEditor, SceneEditor, and any other editors
 */
class EditorECSGame extends GUTS.BaseECSGame {
    constructor(app, canvas) {
        super(app);
        this.canvas = canvas;
        this.isServer = false;
        this.isEditor = true;  // Flag for systems to detect editor mode

        // Entity labels for editor display
        this.entityLabels = new Map();

        // Editor-specific state (required by systems)
        this.state = {
            isPaused: false,
            now: 0,
            deltaTime: 0.016,
            gameOver: false,
            victory: false,
            level: null,
            selectedEntity: {
                entityId: null,
                collection: null
            }
        };

        // Game services
        this.gameSystem = new GUTS.GameServices();

        // Register getCollections (ComponentSystem handles getComponents)
        this.register("getCollections", () => this.getCollections());

        // Animation loop
        this.animationFrameId = null;
        this.clock = new THREE.Clock();

        // Event listeners for editor callbacks
        this.eventListeners = new Map();
    }

    /**
     * Initialize - called by EditorLoader after assets are loaded
     * Mirrors ECSGame.init() pattern
     */
    init(isServer = false, config = {}) {
        this.isServer = isServer;

        // Load game scripts (sets up SceneManager, systems)
        this.loadGameScripts(config);
    }

    /**
     * Override loadGameScripts to use ONLY the passed config (not game config)
     * and skip loading initial scene (editors handle scene loading explicitly)
     */
    loadGameScripts(config) {
        this.collections = this.getCollections();
        // Use ONLY the passed config - don't fall back to game config
        this.gameConfig = config;

        // Initialize SceneManager
        this.sceneManager = new GUTS.SceneManager(this);

        // Store available system types for lazy instantiation
        this.availableSystemTypes = this.gameConfig.systems || [];
        this.systemsByName = new Map();

        // NOTE: Don't call loadInitialScene() - editors handle scene loading explicitly
    }

    /**
     * Load a scene - uses SceneManager like the game does
     * @param {Object} sceneData - Scene data for systems (can include entities array)
     */
    async loadScene(sceneData = {}) {
        // Use SceneManager's methods directly (same pattern as runtime)
        this.sceneManager.currentScene = sceneData;
        this.sceneManager.currentSceneName = sceneData.title || 'editor_scene';

        // Enable systems for this scene
        this.sceneManager.configureSystems(sceneData);

        // Spawn entities using SceneManager
        await this.sceneManager.spawnSceneEntities(sceneData);

        // Notify systems using SceneManager (must await async notifySceneLoaded)
        await this.sceneManager.notifySceneLoaded(sceneData);
        this.sceneManager.notifyPostSceneLoad(sceneData);

        console.log('[EditorECSGame] Scene loaded with', this.getEntityCount(), 'entities');
    }

    /**
     * Add a new entity from a prefab (uses SceneManager's utility methods)
     */
    addEntityFromPrefab(prefabName, overrides = {}) {
        const prefabs = this.getCollections().prefabs || {};
        const prefabData = prefabs[prefabName];

        if (!prefabData) {
            console.error(`[EditorECSGame] Prefab '${prefabName}' not found`);
            return null;
        }

        const entityId = overrides.id || `entity_${this.nextEntityId++}`;

        // Use SceneManager's utility methods
        let components = this.sceneManager.deepClone(prefabData.components || {});

        if (overrides.components) {
            this.sceneManager.mergeComponents(components, overrides.components);
        }

        this.createEntity(entityId);
        this.entityLabels.set(entityId, overrides.name || prefabData.title || prefabName);

        for (const [componentType, componentData] of Object.entries(components)) {
            this.addComponent(entityId, componentType, componentData);
        }

        // Track entity in SceneManager
        this.sceneManager.spawnedEntityIds.add(entityId);

        // Trigger systems to detect the new entity
        this.triggerEvent('onEntityCreated', entityId);

        return entityId;
    }

    /**
     * Remove an entity
     */
    removeEntity(entityId) {
        this.triggerEvent('onEntityDestroyed', entityId);
        this.destroyEntity(entityId);
        this.entityLabels.delete(entityId);
    }

    /**
     * Clear all entities (uses SceneManager)
     */
    clearAllEntities() {
        if (this.sceneManager) {
            this.sceneManager.unloadCurrentScene();
        }
        this.entityLabels.clear();
    }

    /**
     * Start the render/update loop
     */
    startRenderLoop() {
        const loop = () => {
            const deltaTime = this.clock.getDelta();
            this.state.deltaTime = deltaTime;
            this.state.now += deltaTime;

            // Update enabled systems
            for (const system of this.systems) {
                if (!system.enabled) continue;
                if (system.update) {
                    system.update();
                }
            }

            // Update and render via WorldSystem's worldRenderer
            if (this.worldSystem?.worldRenderer) {
                this.worldSystem.worldRenderer.update(deltaTime);
                this.worldSystem.worldRenderer.render();
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

    // ============ Editor-specific Utility Methods ============

    getEntityLabel(entityId) {
        return this.entityLabels.get(entityId) || entityId;
    }

    setEntityLabel(entityId, label) {
        this.entityLabels.set(entityId, label);
    }

    /**
     * Register an event listener callback
     * @param {string} eventName - Event name to listen for
     * @param {Function} callback - Callback function
     */
    on(eventName, callback) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName).push(callback);
    }

    /**
     * Remove an event listener
     * @param {string} eventName - Event name
     * @param {Function} callback - Callback to remove
     */
    off(eventName, callback) {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            const index = listeners.indexOf(callback);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
        }
    }

    /**
     * Override triggerEvent to also call registered listeners
     */
    triggerEvent(eventName, data) {
        // Call parent implementation (notifies systems)
        super.triggerEvent(eventName, data);

        // Also call registered listeners
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            for (const callback of listeners) {
                callback(data);
            }
        }
    }

    /**
     * Export scene to JSON format
     */
    exportScene() {
        const entities = [];

        for (const entityId of this.getAllEntities()) {
            const componentTypes = this.getEntityComponentTypes(entityId);
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
            title: this.sceneManager?.currentSceneName || 'Untitled Scene',
            systems: this.availableSystemTypes || [],
            entities
        };
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stopRenderLoop();

        for (const system of this.systems) {
            if (system.onSceneUnload) {
                system.onSceneUnload();
            }
            if (system.destroy) {
                system.destroy();
            }
        }

        this.systems = [];

        const entityIds = this.getAllEntities();
        for (const entityId of entityIds) {
            this.destroyEntity(entityId);
        }

        // Clear event listeners
        this.eventListeners.clear();
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EditorECSGame;
}

if (typeof GUTS !== 'undefined') {
    GUTS.EditorECSGame = EditorECSGame;
}

export default EditorECSGame;
export { EditorECSGame };
