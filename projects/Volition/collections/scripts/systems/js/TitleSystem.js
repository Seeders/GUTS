/**
 * TitleSystem - Handles the title screen and transition to game
 */
class TitleSystem extends GUTS.BaseSystem {
    static services = [];
    static serviceDependencies = [];

    constructor(game) {
        super(game);
    }

    init() {
        console.log('TitleSystem initializing...');
    }

    postAllInit() {
        this.setupButtons();
    }

    setupButtons() {
        const playBtn = document.getElementById('playBtn');
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                this.startGame();
            });
        }

        const tutorialBtn = document.getElementById('tutorialLinkBtn');
        if (tutorialBtn) {
            tutorialBtn.addEventListener('click', () => {
                this.startTutorial();
            });
        }
    }

    startGame() {
        // Switch to the game scene
        if (this.game.sceneManager) {
            this.game.sceneManager.switchScene('game');
        }
    }

    startTutorial() {
        // Switch to the tutorial scene
        if (this.game.sceneManager) {
            this.game.sceneManager.switchScene('tutorial');
        }
    }

    update() {
        // Title screen doesn't need update logic
    }
}
