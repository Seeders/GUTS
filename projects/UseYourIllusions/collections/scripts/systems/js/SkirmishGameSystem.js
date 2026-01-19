/**
 * SkirmishGameSystem - Handles skirmish game mode (both offline vs AI and online vs human).
 *
 * This system initializes skirmish games:
 * - Team assignments
 * - Player entity creation
 * - AI placement generation (local games only)
 * - Starting units and gold mines for both teams
 *
 * For local games: Sets ClientNetworkSystem's local game flag so networking code routes locally.
 * For online games: ServerGameRoom stores player info in game.state.onlinePlayers for us to use.
 *
 * Battle logic (victory conditions, timing) is handled by ServerBattlePhaseSystem,
 * which runs the same code in both multiplayer and local modes.
 */
class SkirmishGameSystem extends GUTS.BaseSystem {
    static services = [];

    constructor(game) {
        super(game);
        this.game.skirmishGameSystem = this;
        this.playerTeam = null;
        this.aiTeam = null;
        this.isOnlineMatch = false;
    }

    init() {
    }

    /**
     * Called when the skirmish/game scene loads
     * Stores config for postSceneLoad to initialize
     * @param {Object} sceneData - The scene configuration
     * @param {Object} params - Skirmish config passed to switchScene (local) or null (online)
     */
    onSceneLoad(sceneData, params) {
        if (params && params.isSkirmish) {
            // Local skirmish vs AI - store config for postSceneLoad
            this.pendingSkirmishConfig = params;
            this.isOnlineMatch = false;
        } else if (!params || !params.isSkirmish) {
            // Online multiplayer match - ServerGameRoom loaded this scene
            // Check if we're on the server (ServerGameRoom creates player entities)
            if (this.game.serverNetworkManager) {
                this.isOnlineMatch = true;
                this.pendingOnlineMatch = true;
            }
        }
    }

    /**
     * Called after all systems have finished onSceneLoad
     * This ensures WorldSystem has created uiScene before we call initializeGame
     */
    postSceneLoad() {
        if (this.pendingSkirmishConfig) {
            // Local skirmish vs AI
            this.initializeSkirmish(this.pendingSkirmishConfig);
            this.pendingSkirmishConfig = null;
        } else if (this.pendingOnlineMatch) {
            // Online multiplayer - just spawn starting state
            this.initializeOnlineMatch();
            this.pendingOnlineMatch = false;
        }
    }

    // ==================== SKIRMISH INITIALIZATION ====================

    /**
     * Initialize and start a skirmish game
     * @param {Object} config - Skirmish configuration passed from scene switch
     */
    initializeSkirmish(config) {
        if (!config) {
            console.error('[SkirmishGameSystem] No skirmish config provided');
            return;
        }

        // Store config in game state for other systems to access
        this.game.state.skirmishConfig = config;

        // Check if we're loading from a save file
        const isLoadingSave = !!this.game.pendingSaveData;
        const saveData = this.game.pendingSaveData;
        console.log('[SkirmishGameSystem] initializeSkirmish, isLoadingSave:', isLoadingSave, 'pendingSaveData:', saveData ? 'present' : 'null');

        // Enable local game mode (sets game.state.isLocalGame and local player ID)
        this.game.call('setLocalGame', true, 0);

        // Generate game seed for deterministic RNG (use timestamp-based seed)
        // If loading save, preserve saved seed if available
        if (!isLoadingSave) {
            this.game.state.gameSeed = Date.now() % 1000000;
        }

        // Team assignments
        const selectedTeam = config.selectedTeam || 'left';
        if (selectedTeam === 'right') {
            this.playerTeam = this.enums.team.right;
            this.aiTeam = this.enums.team.left;
        } else {
            this.playerTeam = this.enums.team.left;
            this.aiTeam = this.enums.team.right;
        }

        // Set up player ID
        if (this.game.clientNetworkManager) {
            this.game.clientNetworkManager.numericPlayerId = 0;
        }

        // Set level - use saved level if loading, otherwise use config
        let levelIndex;
        if (isLoadingSave && saveData.level !== undefined) {
            levelIndex = saveData.level;
        } else {
            const levelName = config.selectedLevel;
            levelIndex = this.enums.levels?.[levelName] ?? 0;
        }
        this.game.state.level = levelIndex;

        this.game.call('showLoadingScreen');

        // Update terrain
        const gameScene = this.collections?.scenes?.skirmish;
        if (gameScene?.entities) {
            const terrainEntity = gameScene.entities.find(e => e.prefab === 'terrain');
            if (terrainEntity) {
                terrainEntity.components = terrainEntity.components || {};
                terrainEntity.components.terrain = terrainEntity.components.terrain || {};
                terrainEntity.components.terrain.level = levelIndex;
            }
        }

        // When loading a save, SceneManager automatically restores entities via loadSavedEntities()
        // We only need to create player/AI entities for new games
        if (!isLoadingSave) {
            // Create player entities (mimics what ServerGameRoom does in multiplayer)
            this.createLocalRoom(config);

            // Spawn AI opponent entity (uses behavior tree to execute build orders)
            this.spawnAIOpponent(config);

            // Spawn starting units and gold mines for both teams
            this.spawnStartingState();
        }

        // Set active player with team - needed for getActivePlayerTeam() to work
        if (this.game.hasService('setActivePlayer')) {
            this.game.call('setActivePlayer', 0, this.playerTeam);
        }

        this.game.call('initializeGame', null);
    }

    /**
     * Spawn the AI opponent entity from prefab
     * This entity has a behavior tree that executes build orders during placement phase
     *
     * Supports two AI modes:
     * - 'buildOrder' (default): Uses predefined build order JSON files
     * - 'heuristic': Uses heuristic-based decision making that adapts to visible enemies
     */
    spawnAIOpponent(config) {
        const aiEntityId = this.game.createEntity();
        const aiMode = config.aiMode || 'heuristic';

        // Add team component
        this.game.addComponent(aiEntityId, 'team', {
            team: this.aiTeam
        });

        if (aiMode === 'heuristic') {
            // Heuristic AI - adapts based on visible game state
            this.game.addComponent(aiEntityId, 'aiState', {
                rootBehaviorTree: this.enums.behaviorTrees?.AIHeuristicBehaviorTree ?? 0,
                rootBehaviorTreeCollection: this.enums.behaviorCollection?.behaviorTrees ?? 0,
                currentAction: 0,
                currentActionCollection: 0
            });

            // Add heuristic state component for AI memory
            this.game.addComponent(aiEntityId, 'aiHeuristicState', {
                currentStrategy: 'economy',
                strategicPlan: { targetBuildings: [], targetUnits: {} },
                visibleEnemyUnits: {},
                visibleEnemyBuildings: [],
                lastAnalyzedRound: 0,
                executedRound: 0,
                ownArmyPower: 0,
                estimatedEnemyPower: 0
            });

            console.log('[SkirmishGameSystem] Spawned heuristic AI opponent entity:', aiEntityId, 'for team:', this.aiTeam);
        } else {
            // Build order AI - uses predefined build order JSON files
            this.game.addComponent(aiEntityId, 'aiState', {
                rootBehaviorTree: this.enums.behaviorTrees?.AIOpponentBehaviorTree ?? 0,
                rootBehaviorTreeCollection: this.enums.behaviorCollection?.behaviorTrees ?? 0,
                currentAction: 0,
                currentActionCollection: 0
            });

            // Add aiOpponent component with build order config
            this.game.addComponent(aiEntityId, 'aiOpponent', {
                buildOrderId: config.aiBuildOrder || 'basic',
                currentRound: 0,
                actionsExecuted: false,
                actionIndex: 0
            });

            console.log('[SkirmishGameSystem] Spawned build order AI opponent entity:', aiEntityId, 'for team:', this.aiTeam);
        }
    }

    createLocalRoom(config) {
        const startingGold = config.startingGold || 100;

        // Create player entities for both human and AI
        this.game.call('createPlayerEntity', 0, {
            team: this.playerTeam,
            gold: startingGold,
            upgrades: 0
        });

        this.game.call('createPlayerEntity', 1, {
            team: this.aiTeam,
            gold: startingGold,
            upgrades: 0
        });
    }

    /**
     * Spawn starting units and gold mines for both teams
     * Called only for new games (not when loading saves)
     */
    spawnStartingState() {
        // Spawn gold mines for both teams
        this.game.call('spawnGoldMineForTeam', this.playerTeam);
        this.game.call('spawnGoldMineForTeam', this.aiTeam);

        // Spawn starting units for both teams
        this.game.call('spawnStartingUnitsForTeam', this.playerTeam);
        this.game.call('spawnStartingUnitsForTeam', this.aiTeam);

        console.log('[SkirmishGameSystem] Spawned starting state for both teams');
    }

    // ==================== ONLINE MULTIPLAYER ====================

    /**
     * Initialize an online multiplayer match
     * Creates player entities and spawns starting state for both teams
     */
    initializeOnlineMatch() {
        // Check if we're loading from a save file
        const isLoadingSave = !!this.game.pendingSaveData;

        if (isLoadingSave) {
            console.log('[SkirmishGameSystem] Online match loading from save - skipping player/starting state creation');
            return;
        }

        // Get player info stored by ServerGameRoom
        const onlinePlayers = this.game.state.onlinePlayers;
        if (!onlinePlayers || onlinePlayers.length === 0) {
            console.error('[SkirmishGameSystem] No online players found in game state');
            return;
        }

        // Create player entities for all players in the match
        for (const playerInfo of onlinePlayers) {
            this.game.call('createPlayerEntity', playerInfo.playerId, {
                team: playerInfo.team,
                gold: playerInfo.gold,
                upgrades: 0
            });
            console.log('[SkirmishGameSystem] Created player entity for online player:', playerInfo.playerId, 'team:', playerInfo.team);
        }

        // Teams are always left vs right in online matches
        const leftTeam = this.enums.team.left;
        const rightTeam = this.enums.team.right;

        // Spawn gold mines for both teams
        this.game.call('spawnGoldMineForTeam', leftTeam);
        this.game.call('spawnGoldMineForTeam', rightTeam);

        // Spawn starting units for both teams
        this.game.call('spawnStartingUnitsForTeam', leftTeam);
        this.game.call('spawnStartingUnitsForTeam', rightTeam);

        console.log('[SkirmishGameSystem] Initialized online match with', onlinePlayers.length, 'players');
    }

    // ==================== VICTORY CONDITIONS ====================

    /**
     * Called when battle ends - check victory condition for skirmish mode
     * A team loses when all their buildings are destroyed
     */
    onBattleEnd() {
        // Get all alive buildings grouped by team
        const buildingsByTeam = {};
        buildingsByTeam[this.enums.team.left] = [];
        buildingsByTeam[this.enums.team.right] = [];

        const buildingEntities = this.game.getEntitiesWith('unitType', 'team', 'health');
        for (const entityId of buildingEntities) {
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            if (!unitType || unitType.collection !== 'buildings') continue;

            const health = this.game.getComponent(entityId, 'health');
            if (!health || health.current <= 0) continue;

            const deathState = this.game.getComponent(entityId, 'deathState');
            if (deathState && deathState.state >= this.enums.deathState.dying) continue;

            const team = this.game.getComponent(entityId, 'team');
            if (team && buildingsByTeam[team.team] !== undefined) {
                buildingsByTeam[team.team].push(entityId);
            }
        }

        // Check if any team has no buildings left
        let losingTeam = null;
        if (buildingsByTeam[this.enums.team.left].length === 0 && buildingsByTeam[this.enums.team.right].length > 0) {
            losingTeam = this.enums.team.left;
        } else if (buildingsByTeam[this.enums.team.right].length === 0 && buildingsByTeam[this.enums.team.left].length > 0) {
            losingTeam = this.enums.team.right;
        }

        if (losingTeam !== null) {
            // Find the winner (player on the opposite team)
            const playerEntities = this.game.call('getPlayerEntities');
            for (const entityId of playerEntities) {
                const stats = this.game.getComponent(entityId, 'playerStats');
                if (stats && stats.team !== losingTeam) {
                    const result = {
                        winner: stats.playerId,
                        reason: 'buildings_destroyed',
                        finalStats: this.getPlayerStatsForBroadcast(),
                        totalRounds: this.game.state.round
                    };

                    // Broadcast game end and end game
                    this.game.call('broadcastGameEnd', result);
                    this.game.endGame(result);
                    return;
                }
            }
        }

        // No victory yet - game continues to next round
    }

    /**
     * Get player stats for game end broadcast
     */
    getPlayerStatsForBroadcast() {
        const stats = {};
        const playerEntities = this.game.call('getPlayerEntities');
        for (const entityId of playerEntities) {
            const playerStats = this.game.getComponent(entityId, 'playerStats');
            if (playerStats) {
                stats[playerStats.playerId] = {
                    name: playerStats.playerId === 0 ? 'Player' : 'Opponent',
                    stats: {
                        team: playerStats.team,
                        gold: playerStats.gold,
                        upgrades: playerStats.upgrades
                    }
                };
            }
        }
        return stats;
    }

    // ==================== LIFECYCLE ====================

    onSceneUnload() {
        // Disable local game mode when leaving (only matters for local skirmish)
        if (!this.isOnlineMatch) {
            this.game.call('setLocalGame', false, 0);
        }
        this.playerTeam = null;
        this.aiTeam = null;
        this.pendingSkirmishConfig = null;
        this.pendingOnlineMatch = false;
        this.isOnlineMatch = false;
    }
}
