class KeyboardManager {
    constructor(app) {
        this.game = app;
        this.game.keyboardManager = this;
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.addEventListener('keydown', (event) => {
            this.handleKeyDown(event);
        });
    }

    handleKeyDown(event) {
        switch(event.key) {
            case 'Escape':
                this.handleEscapeKey();
                break;
            case 'r':
            case 'R':
                if (event.ctrlKey) {
                    event.preventDefault();
                    this.handleRestartKey();
                }
                break;
            case 'h':
            case 'H':
                if (this.game.eventManager.currentScreen === 'gameScreen') {
                    this.showHelpOverlay();
                }
                break;
        }
    }

    handleEscapeKey() {
        const pauseMenu = document.getElementById('pauseMenu');
        
        if (this.game.eventManager.currentScreen === 'gameScreen') {
            this.gameManager.pauseGame();
        } else if (pauseMenu && pauseMenu.style.display === 'flex') {
            this.gameManager.resumeGame();
        }
    }

    handleRestartKey() {
        if (this.game.eventManager.currentScreen === 'gameScreen') {
            this.gameManager.restartGame();
        }
    }

    showHelpOverlay() {
        console.log('Help overlay would appear here');
        // TODO: Implement help overlay
    }
}