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
        this.loadingOverlay = null;
    }

    /**
     * Show a loading overlay during scene transitions
     */
    showLoadingOverlay() {
        if (this.game.isServer) return;

        // Create overlay if it doesn't exist
        if (!this.loadingOverlay) {
            this.loadingOverlay = document.createElement('div');
            this.loadingOverlay.id = 'sceneLoadingOverlay';
            this.loadingOverlay.innerHTML = `
                <div class="scene-loading-content">
                    <div class="scene-loading-spinner"></div>
                    <div class="scene-loading-text">Loading...</div>
                </div>
            `;

            // Inject styles if not present
            if (!document.getElementById('scene-loading-styles')) {
                const style = document.createElement('style');
                style.id = 'scene-loading-styles';
                style.textContent = `
                    #sceneLoadingOverlay {
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(10, 10, 26, 0.95);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        z-index: 10000;
                        opacity: 0;
                        transition: opacity 0.2s ease;
                    }
                    #sceneLoadingOverlay.visible {
                        opacity: 1;
                    }
                    .scene-loading-content {
                        text-align: center;
                    }
                    .scene-loading-spinner {
                        width: 50px;
                        height: 50px;
                        border: 4px solid rgba(139, 92, 246, 0.2);
                        border-top-color: #8b5cf6;
                        border-radius: 50%;
                        animation: sceneLoadingSpin 1s linear infinite;
                        margin: 0 auto 15px;
                    }
                    .scene-loading-text {
                        font-size: 18px;
                        color: #8b5cf6;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    }
                    @keyframes sceneLoadingSpin {
                        to { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
        }

        document.body.appendChild(this.loadingOverlay);
        // Force reflow then add visible class for transition
        this.loadingOverlay.offsetHeight;
        this.loadingOverlay.classList.add('visible');
    }

    /**
     * Hide the loading overlay
     */
    hideLoadingOverlay() {
        if (this.game.isServer) return;

        if (this.loadingOverlay && this.loadingOverlay.parentNode) {
            this.loadingOverlay.classList.remove('visible');
            // Remove after transition
            setTimeout(() => {
                if (this.loadingOverlay.parentNode) {
                    this.loadingOverlay.parentNode.removeChild(this.loadingOverlay);
                }
            }, 200);
        }
    }

    /**
     * Load a scene by name
     * @param {string} sceneName - The name of the scene to load (from scenes collection)
     * @param {Object} [params] - Optional parameters to pass to the scene's systems via onSceneLoad
     * @returns {Promise<void>}
     */
    async loadScene(sceneName, params = null) {
        console.log(`[SceneManager] loadScene('${sceneName}') called`, params ? 'with params' : '');

        const collections = this.game.getCollections();
        const sceneData = collections.scenes?.[sceneName];

        if (!sceneData) {
            console.warn(`[SceneManager] Scene '${sceneName}' not found`);
            return;
        }

        // Show loading overlay during scene transition (only if switching scenes)
        const isSceneSwitch = this.currentScene !== null;
        if (isSceneSwitch) {
            this.showLoadingOverlay();
            // Allow overlay to render before blocking operations
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Unload current scene if one is loaded
        if (this.currentScene) {
            console.log(`[SceneManager] Unloading current scene: ${this.currentSceneName}`);
            await this.unloadCurrentScene();
        }

        this.currentScene = sceneData;
        this.currentSceneName = sceneName;

        // Load scene-specific interface if defined (must happen first so DOM elements exist)
        if (!this.game.isServer && sceneData.interface) {
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

        // Store params for systems to access
        this.currentSceneParams = params;

        // Notify all systems that scene has loaded (initial setup)
        await this.notifySceneLoaded(sceneData, params);

        // Notify all systems for post-load processing (after all systems have done initial setup)
        this.notifyPostSceneLoad(sceneData, params);

        // Hide loading overlay
        this.hideLoadingOverlay();

        console.log(`[SceneManager] loadScene('${sceneName}') complete`);
    }

    /**
     * Switch to a different scene
     * @param {string} sceneName - The name of the scene to switch to
     * @param {Object} [params] - Optional parameters to pass to the scene's systems via onSceneLoad
     * @returns {Promise<void>}
     */
    async switchScene(sceneName, params = null) {
        await this.loadScene(sceneName, params);
    }

    /**
     * Unload the current scene
     * @returns {Promise<void>}
     */
    async unloadCurrentScene() {
        if (!this.currentScene) return;

        // Clear isLoadingSave flag but preserve pendingSaveData for the next scene
        this.game.state.isLoadingSave = false;
        // Note: Don't clear pendingSaveData here - it may be needed for the incoming scene

        // Clear the current interface marker so the next scene's interface will be loaded
        const appContainer = document.getElementById('appContainer');
        if (appContainer) {
            delete appContainer.dataset.currentInterface;
        }

        // Notify all systems that scene is being unloaded
        this.notifySceneUnloading();

        // Destroy ALL entities - not just scene-spawned ones
        // This includes dynamically created entities (units, projectiles, etc.)
        const allEntityIds = this.game.getAllEntities();
        for (const entityId of allEntityIds) {
            this.game.destroyEntity(entityId);
        }
        this.spawnedEntityIds.clear();

        // Reset entity ID counter so new scene starts fresh
        this.game.nextEntityId = 1;

        // Destroy ALL systems for a clean slate (they'll be recreated by configureSystems)
        this.destroyAllSystems();

        this.currentScene = null;
        this.currentSceneName = null;
    }

    /**
     * Destroy all enabled systems for a clean slate
     * Systems will be recreated by configureSystems for the new scene
     */
    destroyAllSystems() {
        const systemsToRemove = [];

        for (const system of this.game.systems) {
            if (system.enabled) {
                const systemName = system.constructor.name;

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

        // Create and enable systems required by this scene
        for (const systemName of sceneSystems) {
            const system = this.game.createSystem(systemName);
            if (system) {
                system.enabled = true;
            }
        }
        // Call postAllInit on any newly created systems
        // (systems that were just instantiated need this called)
        for (const systemName of sceneSystems) {
            const system = this.game.systemsByName.get(systemName);
            if(system) {
                this.game.getServiceDependencies(system);
                if (system.postAllInit && !system._postAllInitCalled) {
                    system.postAllInit();
                    system._postAllInitCalled = true;
                }
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
        const enums = this.game.getEnums();

        for (const entityDef of entities) {
            if (!entityDef.spawnType || !entityDef.type) {
                console.warn(`[SceneManager] Entity missing spawnType or type:`, entityDef);
                continue;
            }

            const prefabData = prefabs[entityDef.spawnType];
            if (!prefabData) {
                console.warn(`[SceneManager] SpawnType '${entityDef.spawnType}' not found in prefabs`);
                continue;
            }

            const collection = prefabData.collection;
            if (!collection) {
                console.warn(`[SceneManager] SpawnType '${entityDef.spawnType}' missing collection`);
                continue;
            }

            // Get team from components or default to neutral
            const team = entityDef.components?.team?.team ?? enums?.team?.neutral ?? 0;

            // Use createEntityFromPrefab service
            if (this.game.hasService?.('createEntityFromPrefab')) {
                const createdId = this.game.call('createEntityFromPrefab', {
                    prefab: entityDef.spawnType,
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
     * @param {Object} [params] - Optional parameters passed to switchScene
     */
    async notifySceneLoaded(sceneData, params = null) {
        for (const system of this.game.systems) {
            if (system.enabled && system.onSceneLoad) {
                await system.onSceneLoad(sceneData, params);
            }
        }
    }

    /**
     * Notify all systems after scene load is complete
     * This runs after all systems have done their initial onSceneLoad setup
     * @param {Object} sceneData - The scene configuration
     * @param {Object} [params] - Optional parameters passed to switchScene
     */
    notifyPostSceneLoad(sceneData, params = null) {
        for (const system of this.game.systems) {
            if (system.enabled && system.postSceneLoad) {
                system.postSceneLoad(sceneData, params);
            }
        }
    }

    /**
     * Notify systems that the scene is being unloaded
     * Calls onSceneUnload on ALL enabled systems so they can clean up resources
     */
    notifySceneUnloading() {
        for (const system of this.game.systems) {
            if (system.enabled && system.onSceneUnload) {
                system.onSceneUnload();
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