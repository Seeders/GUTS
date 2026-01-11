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
        console.log(`[SceneManager] loadScene('${sceneName}') called`);

        const collections = this.game.getCollections();
        const sceneData = collections.scenes?.[sceneName];

        if (!sceneData) {
            console.warn(`[SceneManager] Scene '${sceneName}' not found`);
            return;
        }

        // Get systems needed by new scene for smart cleanup
        const isServer = !!this.game.isServer;
        const baseSystems = sceneData.systems || [];
        const environmentSystems = isServer
            ? (sceneData.serverSystems || [])
            : (sceneData.clientSystems || []);
        const newSceneSystems = new Set([...baseSystems, ...environmentSystems]);

        // Unload current scene if one is loaded
        if (this.currentScene) {
            console.log(`[SceneManager] Unloading current scene: ${this.currentSceneName}`);
            await this.unloadCurrentScene(newSceneSystems);
        }

        this.currentScene = sceneData;
        this.currentSceneName = sceneName;

        // Load scene-specific interface if defined (must happen first so DOM elements exist)
        if (!isServer && sceneData.interface) {
            this.loadSceneInterface(sceneData.interface, collections);
        }

        // Enable/disable systems based on scene configuration (must happen before loader)
        this.configureSystems(sceneData);

        // Run scene-specific loader if defined (e.g., GameLoader for game scenes)
        if (sceneData.loader && GUTS[sceneData.loader]) {
            console.log(`[SceneManager] Running loader: ${sceneData.loader}`);
            const loader = new GUTS[sceneData.loader](this.game);
            await loader.load();
            console.log(`[SceneManager] Loader complete: ${sceneData.loader}`);
        }

        // Check if we're loading from a save file
        const isLoadingSave = !!this.game.pendingSaveData;

        // Set flag so systems know not to spawn starting entities
        if (isLoadingSave) {
            this.game.state.isLoadingSave = true;
        }

        // Spawn entities from scene definition (skip if loading save - save has all entities)
        if (!isLoadingSave) {
            await this.spawnSceneEntities(sceneData);
        }

        // Inject saved entities if there's pending save data
        if (isLoadingSave) {
            if (this.game.saveSystem) {
                this.game.saveSystem.loadSavedEntities();
            } else {
                console.error('[SceneManager] SaveSystem not available but pendingSaveData exists!');
            }
        }

        // Notify all systems that scene has loaded (initial setup)
        await this.notifySceneLoaded(sceneData);

        // Notify all systems for post-load processing (after all systems have done initial setup)
        this.notifyPostSceneLoad(sceneData);

        console.log(`[SceneManager] loadScene('${sceneName}') complete`);
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
     * @param {Set<string>} [keepSystems] - System names to keep (needed by next scene)
     * @returns {Promise<void>}
     */
    async unloadCurrentScene(keepSystems = new Set()) {
        if (!this.currentScene) return;

        // Clear isLoadingSave flag but preserve pendingSaveData for the next scene
        this.game.state.isLoadingSave = false;
        // Note: Don't clear pendingSaveData here - it may be needed for the incoming scene

        // Notify systems that are being unloaded (not kept)
        this.notifySceneUnloading(keepSystems);

        // Destroy ALL entities - not just scene-spawned ones
        // This includes dynamically created entities (units, projectiles, etc.)
        const allEntityIds = this.game.getAllEntities();
        for (const entityId of allEntityIds) {
            this.game.destroyEntity(entityId);
        }
        this.spawnedEntityIds.clear();

        // Reset entity ID counter so new scene starts fresh
        this.game.nextEntityId = 1;

        // Destroy systems that are NOT needed by the new scene
        this.destroyUnneededSystems(keepSystems);

        this.currentScene = null;
        this.currentSceneName = null;
    }

    /**
     * Destroy enabled systems that are not needed by the next scene
     * @param {Set<string>} keepSystems - System names to keep
     */
    destroyUnneededSystems(keepSystems) {
        const systemsToRemove = [];

        for (const system of this.game.systems) {
            if (system.enabled) {
                const systemName = system.constructor.name;

                // Skip systems that are needed in the next scene
                if (keepSystems.has(systemName)) {
                    continue;
                }

                // Call dispose if available
                if (system.dispose) {
                    system.dispose();
                }

                systemsToRemove.push({ system, systemName });
            }
        }

        // Remove destroyed systems from arrays and maps
        for (const { system, systemName } of systemsToRemove) {
            const index = this.game.systems.indexOf(system);
            if (index > -1) {
                this.game.systems.splice(index, 1);
            }
            this.game.systemsByName.delete(systemName);

            // Reset the postAllInit flag so it can be called again when reinstantiated
            system._postAllInitCalled = false;
        }
    }

    /**
     * Configure which systems are enabled based on scene configuration
     * Uses lazy instantiation - only creates systems when a scene needs them
     * Supports clientSystems and serverSystems for environment-specific systems
     * @param {Object} sceneData - The scene configuration
     */
    configureSystems(sceneData) {
        // Base systems shared by client and server
        const baseSystems = sceneData.systems || [];

        // Environment-specific systems
        const isServer = !!this.game.isServer;
        const environmentSystems = isServer
            ? (sceneData.serverSystems || [])
            : (sceneData.clientSystems || []);

        // Combine base + environment-specific systems
        const sceneSystems = [...baseSystems, ...environmentSystems];

        // Disable all currently active systems first
        for (const system of this.game.systems) {
            system.enabled = false;
        }

        // Lazily instantiate and enable systems required by this scene
        for (const systemName of sceneSystems) {
            const system = this.game.getOrCreateSystem(systemName);
            if (system) {
                system.enabled = true;
            }
        }

        // Call postAllInit on any newly created systems
        // (systems that were just instantiated need this called)
        for (const systemName of sceneSystems) {
            const system = this.game.systemsByName.get(systemName);
            if (system && system.postAllInit && !system._postAllInitCalled) {
                system.postAllInit();
                system._postAllInitCalled = true;
            }
        }
    }

    /**
     * Spawn all entities defined in the scene (deprecated - entities should be in level data)
     * Only supports type prefab format: { prefab: "unit", type: "dragon_red", components: {...} }
     * @param {Object} sceneData - The scene configuration
     * @returns {Promise<void>}
     */
    async spawnSceneEntities(sceneData) {
        const entities = sceneData.entities || [];
        if (entities.length === 0) return;

        const collections = this.game.getCollections();
        const prefabs = collections.prefabs || {};
        const enums = this.game.call?.('getEnums');

        for (const entityDef of entities) {
            if (!entityDef.prefab || !entityDef.type) {
                console.warn(`[SceneManager] Entity missing prefab or type:`, entityDef);
                continue;
            }

            const prefabData = prefabs[entityDef.prefab];
            if (!prefabData) {
                console.warn(`[SceneManager] Prefab '${entityDef.prefab}' not found`);
                continue;
            }

            const collection = prefabData.collection;
            if (!collection) {
                console.warn(`[SceneManager] Prefab '${entityDef.prefab}' missing collection`);
                continue;
            }

            // Get team from components or default to neutral
            const team = entityDef.components?.team?.team ?? enums?.team?.neutral ?? 0;

            // Use createEntityFromPrefab service
            if (this.game.hasService?.('createEntityFromPrefab')) {
                const createdId = this.game.call('createEntityFromPrefab', {
                    prefab: entityDef.prefab,
                    type: entityDef.type,
                    collection: collection,
                    team: team,
                    componentOverrides: entityDef.components || {}
                });

                if (createdId) {
                    this.spawnedEntityIds.add(createdId);
                }
            } else {
                console.warn(`[SceneManager] createEntityFromPrefab service not available`);
            }
        }
    }

    /**
     * Notify all systems that a scene has been loaded
     * @param {Object} sceneData - The scene configuration
     */
    async notifySceneLoaded(sceneData) {
        for (const system of this.game.systems) {
            if (system.enabled && system.onSceneLoad) {
                await system.onSceneLoad(sceneData);
            }
        }
    }

    /**
     * Notify all systems after scene load is complete
     * This runs after all systems have done their initial onSceneLoad setup
     * @param {Object} sceneData - The scene configuration
     */
    notifyPostSceneLoad(sceneData) {
        for (const system of this.game.systems) {
            if (system.enabled && system.postSceneLoad) {
                system.postSceneLoad(sceneData);
            }
        }
    }

    /**
     * Notify systems that the scene is being unloaded
     * Only notifies systems that are being destroyed (not kept for next scene)
     * @param {Set<string>} [keepSystems] - System names that will be kept
     */
    notifySceneUnloading(keepSystems = new Set()) {
        for (const system of this.game.systems) {
            if (system.enabled && system.onSceneUnload) {
                const systemName = system.constructor.name;
                // Only call onSceneUnload for systems being destroyed
                if (!keepSystems.has(systemName)) {
                    system.onSceneUnload();
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

    /**
     * Load a scene-specific interface, replacing the current appContainer content
     * @param {string} interfaceName - The interface name to load
     * @param {Object} collections - The game collections
     */
    loadSceneInterface(interfaceName, collections) {
        const interfaceData = collections.interfaces?.[interfaceName];
        if (!interfaceData) {
            console.warn(`[SceneManager] Interface '${interfaceName}' not found`);
            return;
        }

        const appContainer = document.getElementById('appContainer');
        if (!appContainer) {
            console.warn('[SceneManager] appContainer not found');
            return;
        }

        // Skip if already loaded
        if (appContainer.dataset.currentInterface === interfaceName) {
            return;
        }

        // Replace appContainer content with new interface HTML
        if (interfaceData.html) {
            appContainer.innerHTML = interfaceData.html;
            appContainer.dataset.currentInterface = interfaceName;
        }

        // Inject CSS if not already present
        const styleId = `interface-${interfaceName}-styles`;
        if (interfaceData.css && !document.getElementById(styleId)) {
            const styleSheet = document.createElement('style');
            styleSheet.id = styleId;
            styleSheet.textContent = interfaceData.css;
            document.head.appendChild(styleSheet);
        }
    }
}

// ES6 exports for webpack bundling
// The class-export-loader will automatically add window.GUTS.SceneManager assignment
export default SceneManager;
export { SceneManager };