class GameManager extends GUTS.GameServices {
    constructor(game) {
        super(game);
        this.game = game;
        this.game.gameManager = this;
    }

    initializeGame(multiplayerData = null){
        // For single-player, require game mode selection
        if (!multiplayerData && !this.game.screenManager.selectedGameMode) {
            alert('Please select a game mode first!');
            return;
        }

        // Only show loading screen for single-player (multiplayer already showed it)
        if (!multiplayerData) {
            this.game.screenManager.showLoadingScreen();

            // Update loading content based on selected mode
            const mode = this.game.gameModeManager.getSelectedMode();
            if (mode) {
                const loadingTip = document.querySelector('.loading-tip');
                if (loadingTip) {
                    loadingTip.textContent = `Mode: ${mode.title} - ${mode.description}`;
                }
            }
        }

        setTimeout(() => {
            this.game.state.isPaused = false;
            this.game.screenManager.showGameScreen();
            // Trigger onGameStarted AFTER screen is visible so UI elements are accessible
            this.game.triggerEvent('onGameStarted');
            this.game.uiSystem.start();
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
}
