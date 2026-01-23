class GameSystem extends GUTS.BaseSystem {
    static services = [
        'initializeGame',
        'pauseGame',
        'resumeGame',
        'restartGame',
        'exitToMenu'
    ];

    static serviceDependencies = [
        'showLoadingScreen',
        'showGameScreen',
        'pauseScreen',
        'resumeScreen',
        'showMainMenu'
    ];

    constructor(game) {
        super(game);
        this.game.gameSystem = this;
    }

    init() {
    }

    initializeGame(multiplayerData = null){
        console.log('[GameSystem] initializeGame called, multiplayerData:', !!multiplayerData, 'gameMode:', this.game.state.gameMode);

        // Check game mode - use state directly (no dependency on GameModeSystem)
        const selectedMode = this.game.state.gameMode;
        if (!multiplayerData && !selectedMode) {
            console.error('[GameSystem] No game mode set in game.state.gameMode');
            alert('Please select a game mode first!');
            return;
        }

        // Only show loading screen for single-player (multiplayer already showed it)
        if (!multiplayerData) {
            if (this.game.hasService('showLoadingScreen')) {
                this.call.showLoadingScreen();
            }

            // Update loading content based on selected mode
            if (selectedMode) {
                const loadingTip = document.querySelector('.loading-tip');
                if (loadingTip) {
                    loadingTip.textContent = `Mode: ${selectedMode.title} - ${selectedMode.description}`;
                }
            }
        }

        this.game.state.isPaused = false;
        if (this.game.hasService('showGameScreen')) {
            this.call.showGameScreen();
        }
        // Trigger onGameStarted AFTER screen is visible so UI elements are accessible
        console.log('[GameSystem] Triggering onGameStarted event');
        this.game.triggerEvent('onGameStarted');
    }

    pauseGame() {
        this.call.pauseScreen();
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.style.display = 'flex';
        }
    }

    resumeGame() {
        this.call.resumeScreen();
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
            this.call.showMainMenu();
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

