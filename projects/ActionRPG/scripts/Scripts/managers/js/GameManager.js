class GameManager {
    constructor(game) {
        this.game = game;
        this.game.gameManager = this;
        this.services = new Map();
    }

    initializeGame() {
        this.game.screenManager.showLoadingScreen();

        const loadingTip = document.querySelector('.loading-tip');
        if (loadingTip) {
            loadingTip.textContent = 'Generating dungeon...';
        }

        this.game.triggerEvent('onGameStarted');

        setTimeout(() => {
            this.game.state.isPaused = false;
            this.game.uiSystem?.start();
            this.game.screenManager.showGameScreen();
        }, 2000);
    }

    pauseGame() {
        this.game.state.isPaused = true;
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.style.display = 'flex';
        }
    }

    resumeGame() {
        this.game.state.isPaused = false;
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.style.display = 'none';
        }
    }

    restartGame() {
        const confirmRestart = confirm('Are you sure you want to restart? Your current progress will be lost.');

        if (confirmRestart) {
            // Reset game state
            this.game.clearAllEntities();
            this.initializeGame();
        }

        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.style.display = 'none';
        }
    }

    exitToMenu() {
        if (confirm('Are you sure you want to exit to the main menu? Your progress will be lost.')) {
            this.game.clearAllEntities();
            this.game.screenManager.showMainMenu();
        }
    }

    playerDied() {
        this.game.state.isPaused = true;
        this.game.screenManager.showDefeatScreen();
    }

    levelComplete() {
        this.game.state.isPaused = true;
        this.game.screenManager.showVictoryScreen();
    }

    // Service locator pattern - systems register their public methods
    register(key, method) {
        if (this.services.has(key)) {
            console.warn(`Service ${key} already registered! Overwriting.`);
        }
        this.services.set(key, method);
    }

    has(key) {
        return this.services.has(key);
    }

    call(key, ...args) {
        const method = this.services.get(key);
        if (!method) {
            console.warn(`Service ${key} not found`);
            return undefined;
        }
        return method(...args);
    }
}
