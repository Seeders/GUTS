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
                    <div class="scene-loading-text" id="sceneLoadingText">Loading...</div>
                    <div class="scene-loading-progress-track">
                        <div class="scene-loading-progress-fill" id="sceneLoadingProgressFill"></div>
                    </div>
                    <div class="scene-loading-progress-pct" id="sceneLoadingProgressPct"></div>
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
                        min-width: 320px;
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
                        margin-bottom: 12px;
                    }
                    .scene-loading-progress-track {
                        width: 280px;
                        height: 6px;
                        background: rgba(139, 92, 246, 0.15);
                        border-radius: 3px;
                        margin: 0 auto;
                        overflow: hidden;
                    }
                    .scene-loading-progress-fill {
                        width: 0%;
                        height: 100%;
                        background: linear-gradient(90deg, #8b5cf6, #c4b5fd);
                        transition: width 0.12s ease-out;
                    }
                    .scene-loading-progress-pct {
                        font-size: 11px;
                        color: #8b5cf6;
                        font-family: monospace;
                        margin-top: 6px;
                        min-height: 14px;
                    }
                    @keyframes sceneLoadingSpin {
                        to { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
        }

        document.body.appendChild(this.loadingOverlay);
        // Reset progress for fresh load
        this.setLoadingProgress(0, 'Loading...');
        // Force reflow then add visible class for transition
        this.loadingOverlay.offsetHeight;
        this.loadingOverlay.classList.add('visible');
    }

    /**
     * Update the loading overlay's progress bar and label. Callable from anywhere
     * during scene load via `game.sceneManager.setLoadingProgress(...)`.
     * @param {number} fraction - 0..1
     * @param {string} [label]  - optional label shown above the bar
     */
    setLoadingProgress(fraction, label) {
        if (!this.loadingOverlay) return;
        const pct = Math.max(0, Math.min(1, fraction || 0));
        const fill = this.loadingOverlay.querySelector('#sceneLoadingProgressFill');
        const txt  = this.loadingOverlay.querySelector('#sceneLoadingProgressPct');
        const lbl  = this.loadingOverlay.querySelector('#sceneLoadingText');
        if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
        if (txt)  txt.textContent = pct > 0 ? `${Math.round(pct * 100)}%` : '';
        if (lbl && label) lbl.textContent = label;
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
        const collections = this.game.getCollections();
        const sceneData = collections.scenes?.[sceneName];

        if (!sceneData) {
            console.warn(`[SceneManager] Scene '${sceneName}' not found`);
            return;
        }

        // ── Load profiler ──────────────────────────────────────────────
        const _t0 = performance.now();
        const _phases = {};
        const _mark = (label, startedAt) => { _phases[label] = performance.now() - startedAt; };
        console.log(`[LoadProfiler] === Loading scene '${sceneName}' ===`);

        // Show loading overlay during scene transition (only if switching scenes)
        const isSceneSwitch = this.currentScene !== null;
        if (isSceneSwitch) {
            this.showLoadingOverlay();
            // Allow overlay to render before blocking operations
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Unload current scene if one is loaded
        if (this.currentScene) {
            const _tUnload = performance.now();
            await this.unloadCurrentScene();
            _mark('unloadCurrentScene', _tUnload);
        }

        this.currentScene = sceneData;
        this.currentSceneName = sceneName;

        // Load scene-specific interface if defined (must happen first so DOM elements exist)
        if (!this.game.isServer && sceneData.interface) {
            const _tIface = performance.now();
            this.loadSceneInterface(sceneData.interface, collections);
            _mark('loadSceneInterface', _tIface);
        }

        // Enable/disable systems based on scene configuration (must happen before loader)
        const _tConfig = performance.now();
        this.configureSystems(sceneData);
        _mark('configureSystems', _tConfig);

        // Run scene-specific loader if defined (e.g., GameLoader for game scenes)
        if (sceneData.loader && GUTS[sceneData.loader]) {
            const _tLoader = performance.now();
            const loader = new GUTS[sceneData.loader](this.game);
            await loader.load();
            _mark(`loader:${sceneData.loader}`, _tLoader);
        }

        // Check if we're loading from a save file
        const isLoadingSave = !!this.game.pendingSaveData;

        // Set flag so systems know not to spawn starting entities
        if (isLoadingSave) {
            this.game.state.isLoadingSave = true;
        }

        // Spawn entities from scene definition (skip if loading save - save has all entities)
        if (!isLoadingSave) {
            const _tSpawn = performance.now();
            await this.spawnSceneEntities(sceneData);
            _mark('spawnSceneEntities', _tSpawn);
        }

        // Inject saved entities if there's pending save data
        if (isLoadingSave) {
            if (this.game.saveSystem) {
                const _tSave = performance.now();
                this.game.saveSystem.loadSavedEntities();
                _mark('loadSavedEntities', _tSave);
            } else {
                console.error('[SceneManager] SaveSystem not available but pendingSaveData exists!');
            }
        }

        // Store params for systems to access
        this.currentSceneParams = params;

        // Notify all systems that scene has loaded (initial setup)
        const _tNotify = performance.now();
        await this.notifySceneLoaded(sceneData, params);
        _mark('notifySceneLoaded (total)', _tNotify);

        // Notify all systems for post-load processing (after all systems have done initial setup)
        // Await so async post-load work (e.g. WorldSystem awaiting terrain tile painting)
        // completes before we hide the loading overlay.
        const _tPost = performance.now();
        await this.notifyPostSceneLoad(sceneData, params);
        _mark('notifyPostSceneLoad (total)', _tPost);

        // Hide loading overlay
        this.hideLoadingOverlay();

        // ── Print summary ──────────────────────────────────────────────
        const _total = performance.now() - _t0;
        const _phaseRows = Object.entries(_phases)
            .sort((a, b) => b[1] - a[1])
            .map(([name, ms]) => ({ phase: name, ms: +ms.toFixed(1), pct: +(ms / _total * 100).toFixed(1) }));
        console.log(`[LoadProfiler] Total: ${_total.toFixed(1)} ms`);
        console.table(_phaseRows);
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
        const _perSystem = [];
        for (const system of this.game.systems) {
            if (system.enabled && system.onSceneLoad) {
                const _t = performance.now();
                await system.onSceneLoad(sceneData, params);
                _perSystem.push({ system: system.constructor.name, ms: +(performance.now() - _t).toFixed(1) });
            }
        }
        const _slow = _perSystem.filter(r => r.ms >= 5).sort((a, b) => b.ms - a.ms);
        if (_slow.length) {
            console.log('[LoadProfiler] onSceneLoad per-system (≥5ms, sorted desc):');
            console.table(_slow);
        }
    }

    /**
     * Notify all systems after scene load is complete
     * This runs after all systems have done their initial onSceneLoad setup
     * @param {Object} sceneData - The scene configuration
     * @param {Object} [params] - Optional parameters passed to switchScene
     */
    async notifyPostSceneLoad(sceneData, params = null) {
        const _perSystem = [];
        for (const system of this.game.systems) {
            if (system.enabled && system.postSceneLoad) {
                const _t = performance.now();
                // await so async post-load (e.g. terrain tile painting) completes
                // before we move on and hide the loading overlay.
                await system.postSceneLoad(sceneData, params);
                _perSystem.push({ system: system.constructor.name, ms: +(performance.now() - _t).toFixed(1) });
            }
        }
        const _slow = _perSystem.filter(r => r.ms >= 5).sort((a, b) => b.ms - a.ms);
        if (_slow.length) {
            console.log('[LoadProfiler] postSceneLoad per-system (≥5ms, sorted desc):');
            console.table(_slow);
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