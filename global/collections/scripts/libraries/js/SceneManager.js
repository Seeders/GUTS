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
            return;
        }

        // Get systems needed by new scene for smart cleanup
        // Include base systems + environment-specific systems
        const isServer = !!this.game.isServer;
        const baseSystems = sceneData.systems || [];
        const environmentSystems = isServer
            ? (sceneData.serverSystems || [])
            : (sceneData.clientSystems || []);
        const newSceneSystems = new Set([...baseSystems, ...environmentSystems]);

        // Unload current scene if one is loaded
        if (this.currentScene) {
            await this.unloadCurrentScene(newSceneSystems);
        }

        this.currentScene = sceneData;
        this.currentSceneName = sceneName;

        // Enable/disable systems based on scene configuration
        this.configureSystems(sceneData);

        // Check if we're loading from a save file
        const isLoadingSave = !!this.game.pendingSaveData;

        console.log(`[SceneManager] Loading scene: ${sceneName}, isLoadingSave: ${isLoadingSave}, hasSaveData: ${!!this.game.pendingSaveData}, hasSaveManager: ${!!this.game.saveSystem}, isServer: ${!!this.game.isServer}`);
        if (this.game.pendingSaveData) {
            console.log(`[SceneManager] pendingSaveData has ${this.game.pendingSaveData.entities?.length || 0} entities`);
        }

        // Set flag so systems know not to spawn starting entities
        if (isLoadingSave) {
            this.game.state.isLoadingSave = true;
        }

        // Spawn entities from scene definition (skip if loading save - save has all entities)
        if (!isLoadingSave) {
            await this.spawnSceneEntities(sceneData);
        } else {
            console.log(`[SceneManager] Skipping scene entities - loading from save`);
        }

        // Inject saved entities if there's pending save data
        if (isLoadingSave) {
            this.game.saveSystem.loadSavedEntities();
        }

        // Notify all systems that scene has loaded (initial setup)
        await this.notifySceneLoaded(sceneData);

        // Notify all systems for post-load processing (after all systems have done initial setup)
        this.notifyPostSceneLoad(sceneData);

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
        const allEntityIds = Array.from(this.game.entities.keys());
        for (const entityId of allEntityIds) {
            this.game.destroyEntity(entityId);
        }
        this.spawnedEntityIds.clear();

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
     * Spawn all entities defined in the scene
     * Supports three formats:
     * 1. Prefab format: { id, prefab }
     * 2. Raw components format: { id, components: { componentType: data, ... } }
     * 3. Collection format (SceneEditor): { id, collection, spawnType, name?, transform? }
     * @param {Object} sceneData - The scene configuration
     * @returns {Promise<void>}
     */
    async spawnSceneEntities(sceneData) {
        const entities = sceneData.entities || [];
        const collections = this.game.getCollections();
        const prefabs = collections.prefabs || {};

        for (const entityDef of entities) {
            const entityId = entityDef.id || this.game.getEntityId();

            // Prefab format: { id, prefab }
            if (entityDef.prefab) {
                const prefabData = prefabs[entityDef.prefab];
                if (!prefabData) {
                    console.warn(`[SceneManager] Prefab '${entityDef.prefab}' not found`);
                    continue;
                }

                const components = JSON.parse(JSON.stringify(prefabData.components || []));

                this.game.createEntity(entityId);
                this.spawnedEntityIds.add(entityId);

                // Array format: [{ componentType: data }, { componentType: data }, ...]
                for (const componentObj of components) {
                    for (const [componentType, componentData] of Object.entries(componentObj)) {
                        this.game.addComponent(entityId, componentType, componentData);
                    }
                }
                continue;
            }

            // Raw components format: { id, components: [...] }
            if (entityDef.components && Array.isArray(entityDef.components)) {
                this.game.createEntity(entityId);
                this.spawnedEntityIds.add(entityId);

                for (const componentObj of entityDef.components) {
                    for (const [componentType, componentData] of Object.entries(componentObj)) {
                        this.game.addComponent(entityId, componentType, componentData);
                    }
                }
                continue;
            }

            // Collection format: { id, collection, spawnType, name?, components?: { transform? } }
            if (!entityDef.collection || !entityDef.spawnType) {
                console.warn(`[SceneManager] Entity missing collection/spawnType or prefab:`, entityDef);
                continue;
            }

            const { collection, spawnType, components } = entityDef;
            const transform = components?.transform;
            const team = components?.team?.team ?? 'left';

            // Use UnitCreationSystem for consistent entity creation
            const unitCreationSystem = this.game.unitCreationSystem || this.game.systemsByName?.get('UnitCreationSystem');

            if (unitCreationSystem) {
                // Calculate grid position from world position for placement component
                const position = transform?.position || { x: 0, y: 0, z: 0 };
                let gridPosition = { x: 0, z: 0 };
                if (this.game.call) {
                    const gridPos = this.game.call('worldToPlacementGrid', position.x, position.z);
                    if (gridPos) {
                        gridPosition = gridPos;
                    }
                }

                // Generate a unique placement ID for scene entities
                const placementId = `scene_${collection}_${spawnType}_${entityId}`;

                // Determine playerId based on team
                // Server: look up player for this team from room
                // Client: use local playerId if entity is on player's side
                let playerId = null;
                if (this.game.isServer) {
                    // Server knows which player owns each side from the room
                    const room = this.game.room;
                    if (room?.players) {
                        for (const [pid, player] of room.players) {
                            if (player.side === team) {
                                playerId = pid;
                                break;
                            }
                        }
                    }
                } else {
                    // Client: assign own playerId to entities on player's side
                    const mySide = this.game.state?.mySide;
                    if (mySide && team === mySide) {
                        playerId = this.game.clientNetworkManager?.playerId || null;
                    }
                }

                // Build placement data to create entity with full placement component
                // This makes scene entities behave like player-placed units
                const placement = {
                    placementId,
                    gridPosition,
                    unitTypeId: spawnType,
                    collection,
                    team,
                    playerId,
                    roundPlaced: 0
                };

                // Use createPlacement so entity gets placement component and is fully controllable
                const createdId = unitCreationSystem.createPlacement(
                    placement,
                    transform || {},
                    team,
                    entityId
                );

                if (createdId) {
                    this.spawnedEntityIds.add(createdId);
                }
            } else {
                // Fallback: Create entity manually
                const itemData = collections[collection]?.[spawnType];

                if (!itemData) {
                    console.warn(`[SceneManager] Item '${spawnType}' not found in collection '${collection}'`);
                    continue;
                }

                this.game.createEntity(entityId);
                this.spawnedEntityIds.add(entityId);

                const position = transform?.position;
                if (position) {
                    this.game.addComponent(entityId, 'transform', {
                        position: {
                            x: position.x ?? 0,
                            y: position.y ?? 0,
                            z: position.z ?? 0
                        },
                        rotation: transform?.rotation || { x: 0, y: 0, z: 0 },
                        scale: transform?.scale || { x: 1, y: 1, z: 1 }
                    });
                }

                this.game.addComponent(entityId, 'renderable', {
                    collection,
                    type: spawnType
                });
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
}

// ES6 exports for webpack bundling
// The class-export-loader will automatically add window.GUTS.SceneManager assignment
export default SceneManager;
export { SceneManager };
