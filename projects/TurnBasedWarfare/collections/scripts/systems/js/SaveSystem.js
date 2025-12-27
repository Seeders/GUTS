class SaveSystem extends GUTS.BaseSystem {
    static services = [
        'saveGame',
        'getSaveData',
        'loadSaveData',
        'listSavedGames',
        'deleteSavedGame',
        'exportSaveFile',
        'importSaveFile'
    ];

    constructor(game) {
        super(game);
        this.game.saveSystem = this;

        // Save format version for compatibility checking
        // v1: Legacy per-entity serialization
        // v2: ECS sparse format with null sentinel support
        this.SAVE_VERSION = 2;

        // Components to exclude from saves (none - all components including renderable are needed)
        this.EXCLUDED_COMPONENTS = new Set([]);

        // Entity ID prefixes to exclude from saves
        // Note: terrain_ is INCLUDED because we need to save terrain state
        this.EXCLUDED_ENTITY_PREFIXES = [
            'camera_'
        ];
    }

    init() {
    }

    /**
     * Save the current game state
     * @param {string} saveName - Optional name for the save
     * @returns {Object} The save data object
     */
    saveGame(saveName = null) {
        const saveData = this.getSaveData();

        // Generate save name if not provided
        const timestamp = Date.now();
        const name = saveName || `save_${new Date(timestamp).toISOString().replace(/[:.]/g, '-')}`;
        saveData.saveName = name;

        // Store in localStorage
        const saveKey = `tbw_save_${name}`;
        localStorage.setItem(saveKey, JSON.stringify(saveData));

        // Update save index
        this.updateSaveIndex(name, timestamp);

        return saveData;
    }

    /**
     * Get the current game state as a serializable object
     * @returns {Object} The complete game state
     */
    getSaveData() {
        const saveData = {
            // Metadata
            saveVersion: this.SAVE_VERSION,
            timestamp: Date.now(),
            sceneName: this.game.sceneManager?.getCurrentSceneName() || 'game',

            // Level/terrain info (numeric index)
            level: this.game.state.level ?? 1,

            // Game state
            state: this.serializeGameState(),

            // ECS data in sparse format (efficient, handles null sentinels correctly)
            ecsData: this.game.getECSData(true),

            // Player data (from room if multiplayer)
            players: this.serializePlayers()
        };

        return saveData;
    }

    /**
     * Serialize core game state
     */
    serializeGameState() {
        const state = this.game.state;
        return {
            phase: state.phase,
            round: state.round || 1,
            now: state.now || 0,
            gameOver: state.gameOver || false,
            victory: state.victory || false,
            myTeam: state.myTeam,
            teamMaxHealth: state.teamMaxHealth,
            startingGold: state.startingGold
        };
    }

    // ============================================
    // LEGACY METHODS (for loading v1 saves)
    // New saves use getECSData() sparse format
    // ============================================

    /**
     * Serialize all game entities and their components
     * @deprecated Use getECSData() for new saves
     */
    serializeEntities() {
        const entities = [];
        const allEntityIds = this.game.getAllEntities();

        for (const entityId of allEntityIds) {
            // Skip excluded entities (terrain, camera, etc.)
            if (this.shouldExcludeEntity(entityId)) {
                continue;
            }

            const entityData = {
                id: entityId,
                components: {}
            };

            // Get component types for this entity
            const componentTypes = this.game.getEntityComponentTypes(entityId);

            // Serialize each component
            for (const componentType of componentTypes) {
                // Skip excluded components
                if (this.EXCLUDED_COMPONENTS.has(componentType)) {
                    continue;
                }

                const componentData = this.game.getComponent(entityId, componentType);
                if (componentData) {
                    // Deep clone to avoid circular references
                    entityData.components[componentType] = this.serializeComponent(componentType, componentData);
                }
            }

            // Only save entities that have components
            if (Object.keys(entityData.components).length > 0) {
                entities.push(entityData);
            }
        }

        return entities;
    }

    /**
     * Check if an entity should be excluded from saves
     */
    shouldExcludeEntity(entityId) {
        // Entity IDs can be numbers or strings (e.g., 'terrain_main')
        // Only check prefixes for string IDs
        if (typeof entityId !== 'string') {
            return false;
        }
        for (const prefix of this.EXCLUDED_ENTITY_PREFIXES) {
            if (entityId.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Serialize a single component, handling special cases
     */
    serializeComponent(componentType, componentData) {
        // Deep clone the component data
        const serialized = JSON.parse(JSON.stringify(componentData, (key, value) => {
            // Handle special cases that can't be serialized
            if (value instanceof Function) {
                return undefined;
            }
            if (value instanceof Map) {
                return { __type: 'Map', data: Array.from(value.entries()) };
            }
            if (value instanceof Set) {
                return { __type: 'Set', data: Array.from(value) };
            }
            return value;
        }));

        return serialized;
    }

    /**
     * Serialize player data
     */
    serializePlayers() {
        const players = [];
        const room = this.game.room;

        if (room && room.players) {
            for (const [playerId, player] of room.players) {
                players.push({
                    playerId: playerId,
                    name: player.name,
                    isHost: player.isHost,
                    stats: player.stats ? { ...player.stats } : null,
                    ready: player.ready,
                    placementReady: player.placementReady
                });
            }
        } else {
            // Single player or client-side - get from game state
            const state = this.game.state;
            if (state.playerId) {
                players.push({
                    playerId: state.playerId,
                    name: 'Player',
                    isHost: true,
                    stats: {
                        gold: state.gold || state.startingGold,
                        health: state.health || state.teamMaxHealth,
                        team: state.myTeam ?? this.enums.team.left
                    }
                });
            }
        }

        return players;
    }

    // Note: serializePlacements removed - placement data is on entity's placement component

    /**
     * Load save data and restore game state
     * @param {Object} saveData - The save data to load
     * @returns {Promise<boolean>} Success status
     */
    async loadSaveData(saveData) {
        // Support both v1 (legacy) and v2 (ECS sparse format)
        if (!saveData || (saveData.saveVersion !== 1 && saveData.saveVersion !== 2)) {
            console.error('[SaveManager] Invalid or incompatible save data');
            return false;
        }

        try {
            // Store save data for SceneManager to use
            this.game.pendingSaveData = saveData;

            // Update level in state before scene load (convert string to index if needed for backwards compat)
            let levelValue = saveData.level ?? 1;
            if (typeof levelValue === 'string') {
                const enums = this.game.getEnums();
                levelValue = enums.levels?.[levelValue] ?? 1;
            }
            this.game.state.level = levelValue;

            // The scene will be loaded and save data injected via loadSavedEntities
            return true;
        } catch (error) {
            console.error('[SaveManager] Error preparing save data:', error);
            return false;
        }
    }

    /**
     * Called by SceneManager after scene entities are spawned
     * Injects saved entities into the scene
     */
    loadSavedEntities() {
        console.log('[SaveSystem] loadSavedEntities called, pendingSaveData:', this.game.pendingSaveData ? 'present' : 'null');
        const saveData = this.game.pendingSaveData;
        if (!saveData) {
            console.log('[SaveSystem] No pendingSaveData, returning false');
            return false;
        }
        console.log('[SaveSystem] Loading save, version:', saveData.saveVersion, 'has ecsData:', !!saveData.ecsData);

        // Restore game state (but preserve current player's team and playerId)
        // Phase IS restored from save - if saved during battle, load into battle
        if (saveData.state) {
            const preservedMySide = this.game.state.myTeam;
            const preservedPlayerId = this.game.state.playerId;
            Object.assign(this.game.state, saveData.state);
            // Restore current player info (team/playerId may differ from when saved)
            this.game.state.myTeam = preservedMySide;
            this.game.state.playerId = preservedPlayerId;
            console.log('[SaveSystem] Restored game state, phase:', this.game.state.phase, 'round:', this.game.state.round);
        }

        // Load ECS data using new format if available
        if (saveData.ecsData) {
            this.game.applyECSData(saveData.ecsData);

            // Recreate client-only components (renderable, animationState) that aren't saved
            this.initializeRenderablesForLoadedEntities();

            // Initialize abilities for loaded entities
            // AbilitySystem.entityAbilities Map is not saved, so we need to re-register abilities
            this.initializeAbilitiesForLoadedEntities();
        } else if (saveData.entities) {
            // Legacy format: load entities one by one
            let loadedCount = 0;
            let componentsAdded = 0;
            for (const entityDef of saveData.entities) {
                const entityId = entityDef.id;

                // Create the entity
                this.game.createEntity(entityId);
                loadedCount++;

                // Add all saved components
                for (const [componentType, componentData] of Object.entries(entityDef.components)) {
                    const deserializedData = this.deserializeComponent(componentType, componentData);
                    this.game.addComponent(entityId, componentType, deserializedData);
                    componentsAdded++;
                }
            }

            // Initialize abilities for loaded entities
            this.initializeAbilitiesForLoadedEntities();
        }

        // Note: Placement data is now derived from entities with 'placement' component
        // PlacementSystem.getPlacementById() queries entities directly

        // Clear pending save data
        this.game.pendingSaveData = null;

        // Clear the isLoadingSave flag after a short delay to let systems initialize
        setTimeout(() => {
            this.game.state.isLoadingSave = false;
        }, 100);

        return true;
    }

    /**
     * Deserialize a component, handling special cases
     */
    deserializeComponent(componentType, componentData) {
        // Handle special serialized types
        const deserialized = JSON.parse(JSON.stringify(componentData), (key, value) => {
            if (value && typeof value === 'object') {
                if (value.__type === 'Map') {
                    return new Map(value.data);
                }
                if (value.__type === 'Set') {
                    return new Set(value.data);
                }
            }
            return value;
        });

        return deserialized;
    }

    /**
     * Load a saved game by name
     * @param {string} saveName - Name of the save to load
     * @returns {Object|null} The save data or null if not found
     */
    loadSavedGame(saveName) {
        const saveKey = `tbw_save_${saveName}`;
        const saveJson = localStorage.getItem(saveKey);

        if (!saveJson) {
            console.warn(`[SaveManager] Save "${saveName}" not found`);
            return null;
        }

        try {
            return JSON.parse(saveJson);
        } catch (error) {
            console.error(`[SaveManager] Error parsing save "${saveName}":`, error);
            return null;
        }
    }

    /**
     * List all saved games
     * @returns {Array} Array of save metadata
     */
    listSavedGames() {
        const indexJson = localStorage.getItem('tbw_save_index');
        if (!indexJson) {
            return [];
        }

        try {
            const index = JSON.parse(indexJson);
            return Object.entries(index).map(([name, timestamp]) => ({
                name,
                timestamp,
                date: new Date(timestamp).toLocaleString()
            })).sort((a, b) => b.timestamp - a.timestamp);
        } catch (error) {
            console.error('[SaveManager] Error reading save index:', error);
            return [];
        }
    }

    /**
     * Update the save index
     */
    updateSaveIndex(saveName, timestamp) {
        let index = {};
        const indexJson = localStorage.getItem('tbw_save_index');

        if (indexJson) {
            try {
                index = JSON.parse(indexJson);
            } catch (error) {
                index = {};
            }
        }

        index[saveName] = timestamp;
        localStorage.setItem('tbw_save_index', JSON.stringify(index));
    }

    /**
     * Delete a saved game
     * @param {string} saveName - Name of the save to delete
     */
    deleteSavedGame(saveName) {
        const saveKey = `tbw_save_${saveName}`;
        localStorage.removeItem(saveKey);

        // Update index
        const indexJson = localStorage.getItem('tbw_save_index');
        if (indexJson) {
            try {
                const index = JSON.parse(indexJson);
                delete index[saveName];
                localStorage.setItem('tbw_save_index', JSON.stringify(index));
            } catch (error) {
                // Ignore
            }
        }

    }

    /**
     * Export save data as a downloadable file
     * @param {Object} saveData - The save data to export
     */
    exportSaveFile(saveData) {
        const json = JSON.stringify(saveData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${saveData.saveName || 'game_save'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Import save data from a file
     * @param {File} file - The file to import
     * @returns {Promise<Object>} The parsed save data
     */
    async importSaveFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const saveData = JSON.parse(e.target.result);
                    resolve(saveData);
                } catch (error) {
                    reject(new Error('Invalid save file format'));
                }
            };
            reader.onerror = () => reject(new Error('Error reading file'));
            reader.readAsText(file);
        });
    }

    /**
     * Initialize renderable components for loaded entities
     * renderable is a client-only component and not saved, so we recreate it from unitType
     */
    initializeRenderablesForLoadedEntities() {
        const entitiesWithUnitType = this.game.getEntitiesWith('unitType');
        let renderablesInitialized = 0;

        for (const entityId of entitiesWithUnitType) {
            // Skip if already has renderable
            if (this.game.hasComponent(entityId, 'renderable')) continue;

            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            if (!unitTypeComp) continue;

            // Get collection and type indices
            const collectionIndex = unitTypeComp.collection;
            const spawnTypeIndex = unitTypeComp.type;

            if (collectionIndex != null && spawnTypeIndex != null) {
                this.game.addComponent(entityId, 'renderable', {
                    objectType: collectionIndex,
                    spawnType: spawnTypeIndex,
                    capacity: 128
                });
                renderablesInitialized++;
            }
        }

        console.log('[SaveSystem] Initialized renderables for', renderablesInitialized, 'entities');
    }

    /**
     * Initialize abilities for all loaded entities that have them defined
     * This is needed because AbilitySystem.entityAbilities Map is not saved
     */
    initializeAbilitiesForLoadedEntities() {
        if (!this.game.abilitySystem) {
            console.warn('[SaveManager] AbilitySystem not available, skipping ability initialization');
            return;
        }

        const entitiesWithUnitType = this.game.getEntitiesWith('unitType');
        let abilitiesInitialized = 0;

        for (const entityId of entitiesWithUnitType) {
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            if (unitType && unitType.abilities && unitType.abilities.length > 0) {
                this.game.call('addAbilitiesToUnit', entityId, unitType.abilities);
                abilitiesInitialized++;
            }
        }

    }

    onSceneUnload() {
    }
}
