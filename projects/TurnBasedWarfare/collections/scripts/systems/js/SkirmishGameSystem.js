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
    static services = [
        'startSkirmishGame'
    ];

    constructor(game) {
        super(game);
        this.game.skirmishGameSystem = this;
        this.playerTeam = null;
        this.aiTeam = null;
    }

    init() {
    }

    // ==================== SKIRMISH INITIALIZATION ====================

    async startSkirmishGame() {
        const config = this.game.state.skirmishConfig;
        if (!config) {
            console.error('[SkirmishGameSystem] No skirmish config found');
            return;
        }

        // Check if we're loading from a save file
        const isLoadingSave = !!this.game.pendingSaveData;
        const saveData = this.game.pendingSaveData;
        console.log('[SkirmishGameSystem] startSkirmishGame, isLoadingSave:', isLoadingSave, 'pendingSaveData:', saveData ? 'present' : 'null');

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
        const gameScene = this.collections?.scenes?.game;
        if (gameScene?.entities) {
            const terrainEntity = gameScene.entities.find(e => e.prefab === 'terrain');
            if (terrainEntity) {
                terrainEntity.components = terrainEntity.components || {};
                terrainEntity.components.terrain = terrainEntity.components.terrain || {};
                terrainEntity.components.terrain.level = levelIndex;
            }
        }

        await this.game.switchScene('skirmish');

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
     */
    spawnAIOpponent(config) {
        const aiEntityId = this.game.createEntity();

        // Add team component
        this.game.addComponent(aiEntityId, 'team', {
            team: this.aiTeam
        });

        // Add aiState component pointing to AIOpponentBehaviorTree
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

        console.log('[SkirmishGameSystem] Spawned AI opponent entity:', aiEntityId, 'for team:', this.aiTeam);
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
    }
}
