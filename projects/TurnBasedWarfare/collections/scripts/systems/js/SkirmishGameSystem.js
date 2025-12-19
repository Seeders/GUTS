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

        // Enable local game mode (sets game.state.isLocalGame and local player ID)
        this.game.call('setLocalGame', true, 0);

        // Generate game seed for deterministic RNG (use timestamp-based seed)
        this.game.state.gameSeed = Date.now() % 1000000;

        // Team assignments
        const selectedTeam = config.selectedTeam || 'left';
        if (selectedTeam === 'right') {
            this.playerTeam = this.enums.team.right;
            this.aiTeam = this.enums.team.left;
        } else {
            this.playerTeam = this.enums.team.left;
            this.aiTeam = this.enums.team.right;
        }

        this.game.state.myTeam = this.playerTeam;

        // Set up player ID
        if (this.game.clientNetworkManager) {
            this.game.clientNetworkManager.numericPlayerId = 0;
        }

        // Set level
        const levelName = config.selectedLevel;
        const levelIndex = this.enums.levels?.[levelName] ?? 0;
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

        // Create player entities (mimics what ServerGameRoom does in multiplayer)
        this.createLocalRoom(config);

        this.game.call('initializeGame', null);

        // Generate AI placements
        setTimeout(() => {
            this.game.call('generateAIPlacement', this.aiTeam);
        }, 100);
    }

    createLocalRoom(config) {
        const startingGold = config.startingGold || 100;

        // Create player entities for both human and AI
        this.game.call('createPlayerEntity', 0, {
            team: this.playerTeam,
            gold: startingGold,
            upgrades: []
        });

        this.game.call('createPlayerEntity', 1, {
            team: this.aiTeam,
            gold: startingGold,
            upgrades: []
        });
    }

    // ==================== LIFECYCLE ====================

    onSceneUnload() {
        if (this.game.sceneManager?.currentScene !== 'skirmish') {
            // Disable local game mode when leaving skirmish
            this.game.call('setLocalGame', false, 0);
            this.playerTeam = null;
            this.aiTeam = null;
        }
    }
}
