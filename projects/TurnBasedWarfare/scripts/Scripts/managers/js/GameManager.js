class GameManager {
    constructor(game) {
        this.game = game;
        this.game.gameManager = this;
        this.services = new Map();
    }

    startSelectedMode() {
        if (!this.game.eventManager.selectedGameMode) {
            alert('Please select a game mode first!');
            return;
        }

        this.game.screenManager.showLoadingScreen();
        
        // Update loading content based on selected mode
        const mode = this.game.gameModeManager.getSelectedMode();
        if (mode) {
            const loadingTip = document.querySelector('.loading-tip');
            if (loadingTip) {
                loadingTip.textContent = `Mode: ${mode.title} - ${mode.description}`;
            }
        }
        
        // Start loading process
        this.game.loadingManager.showLoadingWithProgress(() => {
            this.initializeGame();
        });
    }

    initializeGame() {
        this.game.eventManager.startGame();
        this.game.screenManager.showGameScreen();        
        this.game.state.isPaused = false;
        this.game.uiSystem.start();
    }

    pauseGame() {
        this.game.eventManager.pause();
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.style.display = 'flex';
        }
    }

    resumeGame() {
        this.game.eventManager.resume();
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.style.display = 'none';
        }
    }

    restartGame() {
        const confirmRestart = this.game.eventManager.currentScreen === 'gameScreen' 
            ? confirm('Are you sure you want to restart? Your current progress will be lost.')
            : true;

        if (confirmRestart) {
            this.game.eventManager.reset();
            this.game.eventManager.setGameMode(this.game.eventManager.selectedGameMode); // Restore selected mode
            this.initializeGame();
        }
        
        // Hide pause menu if open
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.style.display = 'none';
        }
    }

    exitToMenu() {
        if (confirm('Are you sure you want to exit to the main menu? Your progress will be lost.')) {
            this.game.phaseSystem.reset();
            this.game.screenManager.showMainMenu();
            this.game.eventManager.reset();
        }
    }

    continueGame() {
        // Continue to next round/level
        this.game.eventManager.stats.round++;
        this.initializeGame();
    }

    // Systems call this in constructor or init()
    register(key, method) {
        if (this.services.has(key)) {
            debugger;
            console.warn(`Service ${key} already registered! Overwriting.`);
        }
        this.services.set(key, method);
    }

    // Public API
    call(key, ...args) {
        const method = this.services.get(key);
        if (!method) {
            throw new Error(`Service not found: ${key}`);
        }
        return method(...args);
    }

    // Optional: async version
    async callAsync(key, ...args) {
        return this.call(key, ...args);
    }

    // Debug
    listServices() {
        return Array.from(this.services.keys());
    }

}
