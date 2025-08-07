class ScreenManager {
    constructor(app) {
        this.game = app;
        this.game.screenManager = this;
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.game.eventManager.on('screenChanged', (screenId) => {
            this.showScreen(screenId);
        });
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
        this.game.eventManager.setScreen('mainMenu');
    }

    showGameModeSelect() {
        this.game.eventManager.setScreen('gameModeSelect');
        // Reset selection
        document.querySelectorAll('.mode-card').forEach(card => {
            card.classList.remove('selected');
        });
        this.game.eventManager.selectedGameMode = null;
    }

    showLoadingScreen() {
        this.game.eventManager.setScreen('loadingScreen');
    }

    showGameScreen() {
        this.game.eventManager.setScreen('gameScreen');
    }

    showVictoryScreen() {
        this.game.eventManager.setScreen('victoryScreen');
    }

    showDefeatScreen() {
        this.game.eventManager.setScreen('defeatScreen');
    }
}