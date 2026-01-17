/**
 * SkirmishGameSystem - Handles skirmish (offline vs AI) game mode.
 *
 * This system initializes skirmish games:
 * - Team assignments
 * - Player entity creation
 * - Scene loading
 * - AI placement generation
 *
 * Sets ClientNetworkSystem's local game flag so networking code routes locally.
 *
 * Battle logic (victory conditions, timing) is handled by ServerBattlePhaseSystem,
 * which runs the same code in both multiplayer and local modes.
 */
class SkirmishGameSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.skirmishGameSystem = this;
        this.playerTeam = null;
        this.aiTeam = null;
    }

    init() {
    }

    /**
     * Called when the skirmish scene loads
     * Stores config for postSceneLoad to initialize
     * @param {Object} sceneData - The scene configuration
     * @param {Object} params - Skirmish config passed to switchScene
     */
    onSceneLoad(sceneData, params) {
        if (params && params.isSkirmish) {
            // Store config for postSceneLoad - don't initialize yet
            // Other systems (WorldSystem, etc.) need to complete their onSceneLoad first
            this.pendingSkirmishConfig = params;
        }
    }

    /**
     * Called after all systems have finished onSceneLoad
     * This ensures WorldSystem has created uiScene before we call initializeGame
     */
    postSceneLoad() {
        if (!this.pendingSkirmishConfig) return;

        this.initializeSkirmish(this.pendingSkirmishConfig);
        this.pendingSkirmishConfig = null;
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

    // ==================== LIFECYCLE ====================

    onSceneUnload() {
        // Always disable local game mode when leaving skirmish scene
        this.game.call('setLocalGame', false, 0);
        this.playerTeam = null;
        this.aiTeam = null;
        this.pendingSkirmishConfig = null;
    }
}
