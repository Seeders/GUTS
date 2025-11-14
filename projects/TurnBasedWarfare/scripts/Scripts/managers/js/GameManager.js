class GameManager {
    constructor(game) {
        this.game = game;
        this.game.gameManager = this;
        this.services = new Map();
    }

    initializeGame(){
        if (!this.game.screenManager.selectedGameMode) {
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

        this.game.triggerEvent('onGameStarted');

        setTimeout(() => {   
            this.game.state.isPaused = false;
            this.game.uiSystem.start();
            this.game.screenManager.showGameScreen();  
        }, 2000);
        
    }

    pauseGame() {
        this.game.screenManager.pause();
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.style.display = 'flex';
        }
    }

    resumeGame() {
        this.game.screenManager.resume();
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.style.display = 'none';
        }
    }

    restartGame() {
        const confirmRestart = this.game.screenManager.currentScreen === 'gameScreen' 
            ? confirm('Are you sure you want to restart? Your current progress will be lost.')
            : true;

        if (confirmRestart) {
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
        }
    }

    continueGame() {
        // Continue to next round/level
        this.game.screenManager.stats.round++;
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

    has(key){
        return this.services.has(key);
    }

    // Public API
    call(key, ...args) {
        const method = this.services.get(key);
        if (!method) {
            return undefined;
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
