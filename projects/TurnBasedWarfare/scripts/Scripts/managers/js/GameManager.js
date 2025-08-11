class GameManager {
    constructor(app) {
        this.game = app;
        this.game.gameManager = this;
        this.gameInstance = null;
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
        
        // Apply game mode configuration
        const mode = this.game.gameModeManager.getSelectedMode();
        if (mode && this.gameInstance) {
            this.applyModeConfiguration(mode);
        }
        this.game.state.isPaused = false;
        this.game.uiSystem.start();
    }

    applyModeConfiguration(mode) {
        if (this.gameInstance && this.gameInstance.state) {
            this.gameInstance.state.playerGold = mode.startingGold;
            this.gameInstance.state.gameMode = mode.id;
            this.gameInstance.state.maxRounds = mode.maxRounds;
            this.gameInstance.state.goldMultiplier = mode.goldMultiplier;
        }
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
            this.game.screenManager.showMainMenu();
            this.game.eventManager.reset();
        }
    }

    continueGame() {
        // Continue to next round/level
        this.game.eventManager.stats.round++;
        this.initializeGame();
    }

    handleBattleEnd(result, stats = {}) {
        this.game.eventManager.updateStats(stats);
        
        if (result === 'victory') {
            const shouldEnd = this.game.gameModeManager.shouldEndCampaign(this.game.eventManager.stats.round);
            if (shouldEnd) {
                this.game.eventManager.endGame('victory', stats);
                resultsManager.showVictory(this.game.eventManager.stats);
            } else {
                this.showRoundVictory(stats);
            }
        } else {
            this.game.eventManager.endGame('defeat', stats);
            resultsManager.showDefeat(this.game.eventManager.stats);
        }
    }

    showRoundVictory(stats) {
        // Brief victory notification before continuing
        const notification = this.createVictoryNotification(stats);
        document.body.appendChild(notification);

        setTimeout(() => {
            document.body.removeChild(notification);
            // Continue with next round
            this.setupNextRound(stats);
        }, 2000);
    }

    createVictoryNotification(stats) {
        const notification = document.createElement('div');
        notification.className = 'victory-notification';
        notification.innerHTML = `
            <h2>🎉 ROUND ${stats.round} COMPLETE! 🎉</h2>
            <p>Gold Earned: +${50 + (stats.round * 10)}g</p>
            <p style="margin-top: 1rem; color: #888;">Preparing next round...</p>
        `;
        return notification;
    }

    setupNextRound(stats) {
        if (this.gameInstance && this.gameInstance.state) {
            this.gameInstance.state.playerGold += 50 + (stats.round * 10);
            this.gameInstance.state.round++;
            
            // Start next round
            if (this.gameInstance.phaseSystem && this.gameInstance.phaseSystem.startPlacementPhase) {
                this.gameInstance.phaseSystem.startPlacementPhase();
            }
        }
    }
}
