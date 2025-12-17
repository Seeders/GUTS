class GameSystem extends GUTS.BaseSystem {
    static services = [
        'initializeGame',
        'pauseGame',
        'resumeGame',
        'restartGame',
        'exitToMenu'
    ];

    constructor(game) {
        super(game);
        this.game.gameSystem = this;
    }

    init() {
    }

    initializeGame(multiplayerData = null){
        // For single-player, require game mode selection
        const selectedMode = this.game.call('getSelectedMode');
        if (!multiplayerData && !selectedMode) {
            alert('Please select a game mode first!');
            return;
        }

        // Only show loading screen for single-player (multiplayer already showed it)
        if (!multiplayerData) {
            this.game.call('showLoadingScreen');

            // Update loading content based on selected mode
            if (selectedMode) {
                const loadingTip = document.querySelector('.loading-tip');
                if (loadingTip) {
                    loadingTip.textContent = `Mode: ${selectedMode.title} - ${selectedMode.description}`;
                }
            }
        }

        this.game.state.isPaused = false;
        this.game.call('showGameScreen');
        // Trigger onGameStarted AFTER screen is visible so UI elements are accessible
        this.game.triggerEvent('onGameStarted');
    }

    pauseGame() {
        this.game.call('pauseScreen');
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.style.display = 'flex';
        }
    }

    resumeGame() {
        this.game.call('resumeScreen');
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.style.display = 'none';
        }
    }

    restartGame() {
        const confirmRestart = confirm('Are you sure you want to restart? Your current progress will be lost.');

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
            this.game.call('showMainMenu');
        }
    }

    continueGame() {
        // Continue to next round/level
        this.game.state.round++;
        this.initializeGame();
    }

    onSceneUnload() {
    }
}

