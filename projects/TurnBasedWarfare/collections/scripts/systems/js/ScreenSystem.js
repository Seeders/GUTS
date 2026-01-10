class ScreenSystem extends GUTS.BaseSystem {
    static services = [
        'showLoadingScreen',
        'showGameScreen',
        'showMainMenu',
        'showVictoryScreen',
        'showDefeatScreen',
        'showGameModeSelect',
        'pauseScreen',
        'resumeScreen'
    ];

    constructor(game) {
        super(game);
        this.game.screenSystem = this;
    }

    init() {
    }

    onSceneLoad(sceneData) {
        // When lobby scene loads, show the main menu (transition from loading screen)
        const sceneName = this.game.sceneManager?.getCurrentSceneName?.();
        if (sceneName === 'lobby') {
            this.showMainMenu();
        }
    }

    // Alias methods for service names
    pauseScreen() {
        return this.pause();
    }

    resumeScreen() {
        return this.resume();
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
        }
    }

    showMainMenu() {
        this.setScreen('mainMenu');
    }

    showGameModeSelect() {
        this.setScreen('gameModeSelect');
        // Reset selection
        document.querySelectorAll('.mode-card').forEach(card => {
            card.classList.remove('selected');
        });
        this.selectedGameMode = null;
    }

    showLoadingScreen() {
        this.setScreen('loadingScreen');
    }

    showGameScreen() {
        this.setScreen('gameScreen');
    }

    showVictoryScreen() {
        this.setScreen('victoryScreen');
    }

    showDefeatScreen() {
        this.setScreen('defeatScreen');
    }


    
    reset() {
        this.currentScreen = 'mainMenu';
        this.selectedGameMode = null;
        this.gameStartTime = null;
        this.isPaused = false;
        this.stats = {
            round: 1,
            goldEarned: 0,
            unitsDeployed: 0,
            unitsLost: 0,
            totalPlayTime: 0
        };
    }

    setScreen(screenId) {
        this.currentScreen = screenId;
        this.showScreen(screenId);
    }

    setGameMode(mode) {
        this.selectedGameMode = mode;
    }

    onGameStarted() {
        this.gameStartTime = Date.now();
    }

    endGame(result, finalStats = {}) {
        if (this.gameStartTime) {
            this.stats.totalPlayTime = Date.now() - this.gameStartTime;
        }
        Object.assign(this.stats, finalStats);
    }

    pause() {
        this.isPaused = true;
    }

    resume() {
        this.isPaused = false;
    }

    onSceneUnload() {
        this.reset();
    }
}
