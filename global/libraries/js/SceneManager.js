/**
 * SceneManager - Handles loading, switching, and managing game scenes
 * Scenes define which systems to run and which entities to spawn
 */
class SceneManager {
    constructor(game) {
        this.game = game;
        this.currentScene = null;
        this.currentSceneName = null;
        this.spawnedEntityIds = new Set();
    }

    /**
     * Load a scene by name
     * @param {string} sceneName - The name of the scene to load (from scenes collection)
     * @returns {Promise<void>}
     */
    async loadScene(sceneName) {
        const collections = this.game.getCollections();
        const sceneData = collections.scenes?.[sceneName];

        if (!sceneData) {
            console.error(`[SceneManager] Scene '${sceneName}' not found in collections`);
            return;
        }

        console.log(`[SceneManager] Loading scene: ${sceneName}`);

        // Unload current scene if one is loaded
        if (this.currentScene) {
            await this.unloadCurrentScene();
        }

        this.currentScene = sceneData;
        this.currentSceneName = sceneName;

        // Enable/disable systems based on scene configuration
        this.configureSystems(sceneData);

        // Spawn entities from scene definition
        await this.spawnSceneEntities(sceneData);

        // Notify all systems that scene has loaded
        this.notifySceneLoaded(sceneData);

        console.log(`[SceneManager] Scene '${sceneName}' loaded successfully`);
    }

    /**
     * Switch to a different scene
     * @param {string} sceneName - The name of the scene to switch to
     * @returns {Promise<void>}
     */
    async switchScene(sceneName) {
        await this.loadScene(sceneName);
    }

    /**
     * Unload the current scene
     * @returns {Promise<void>}
     */
    async unloadCurrentScene() {
        if (!this.currentScene) return;

        console.log(`[SceneManager] Unloading scene: ${this.currentSceneName}`);

        // Notify all systems that scene is unloading
        this.notifySceneUnloading();

        // Destroy all entities spawned by this scene
        for (const entityId of this.spawnedEntityIds) {
            if (this.game.entities.has(entityId)) {
                this.game.destroyEntity(entityId);
            }
        }
        this.spawnedEntityIds.clear();

        // Disable all systems
        for (const system of this.game.systems) {
            system.enabled = false;
        }

        this.currentScene = null;
        this.currentSceneName = null;
    }

    /**
     * Configure which systems are enabled based on scene configuration
     * @param {Object} sceneData - The scene configuration
     */
    configureSystems(sceneData) {
        const sceneSystems = new Set(sceneData.systems || []);

        for (const system of this.game.systems) {
            const systemName = system.constructor.name;
            const isRequired = sceneSystems.has(systemName);

            // Enable or disable system based on scene requirements
            system.enabled = isRequired;

            if (isRequired) {
                console.log(`[SceneManager] Enabled system: ${systemName}`);
            }
        }
    }

    /**
     * Spawn all entities defined in the scene
     * @param {Object} sceneData - The scene configuration
     * @returns {Promise<void>}
     */
    async spawnSceneEntities(sceneData) {
        const entities = sceneData.entities || [];
        const collections = this.game.getCollections();
        const prefabs = collections.prefabs || {};

        for (const entityDef of entities) {
            const entityId = entityDef.id || this.game.getEntityId();

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
            this.game.createEntity(entityId);
            this.spawnedEntityIds.add(entityId);

            // Add all components to the entity
            for (const [componentType, componentData] of Object.entries(components)) {
                this.game.addComponent(entityId, componentType, componentData);
            }

            console.log(`[SceneManager] Spawned entity: ${entityId} with components: ${Object.keys(components).join(', ')}`);
        }
    }

    /**
     * Notify all systems that a scene has been loaded
     * @param {Object} sceneData - The scene configuration
     */
    notifySceneLoaded(sceneData) {
        for (const system of this.game.systems) {
            if (system.enabled && system.onSceneLoad) {
                system.onSceneLoad(sceneData);
            }
        }
    }

    /**
     * Notify all systems that the scene is being unloaded
     */
    notifySceneUnloading() {
        for (const system of this.game.systems) {
            if (system.onSceneUnload) {
                system.onSceneUnload();
            }
        }
    }

    /**
     * Deep clone an object
     * @param {Object} obj - Object to clone
     * @returns {Object} Cloned object
     */
    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.deepClone(item));
        }
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
     * @param {Object} base - Base components object
     * @param {Object} overrides - Override components object
     */
    mergeComponents(base, overrides) {
        for (const [componentType, componentData] of Object.entries(overrides)) {
            if (base[componentType] && typeof base[componentType] === 'object' && typeof componentData === 'object') {
                // Deep merge for objects
                this.deepMerge(base[componentType], componentData);
            } else {
                // Replace for primitives or new components
                base[componentType] = this.deepClone(componentData);
            }
        }
    }

    /**
     * Deep merge source into target
     * @param {Object} target - Target object
     * @param {Object} source - Source object
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
     * Get the current scene data
     * @returns {Object|null} Current scene data or null
     */
    getCurrentScene() {
        return this.currentScene;
    }

    /**
     * Get the current scene name
     * @returns {string|null} Current scene name or null
     */
    getCurrentSceneName() {
        return this.currentSceneName;
    }

    /**
     * Check if a scene is currently loaded
     * @returns {boolean} True if a scene is loaded
     */
    hasLoadedScene() {
        return this.currentScene !== null;
    }

    /**
     * Get list of all available scenes
     * @returns {string[]} Array of scene names
     */
    getAvailableScenes() {
        const collections = this.game.getCollections();
        return Object.keys(collections.scenes || {});
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SceneManager;
}

// Make available on window.GUTS for browser
if (typeof window !== 'undefined') {
    if (!window.GUTS) window.GUTS = {};
    window.GUTS.SceneManager = SceneManager;
}

// Make available on global.GUTS for Node.js/server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.SceneManager = SceneManager;
}

// ES6 exports for webpack bundling
export default SceneManager;
export { SceneManager };
