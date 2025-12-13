class ScreenSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.screenSystem = this;
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
