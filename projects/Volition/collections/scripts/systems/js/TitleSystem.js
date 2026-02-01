/**
 * TitleSystem - Handles the title screen and transition to game
 */
class TitleSystem extends GUTS.BaseSystem {
    static services = [];
    static serviceDependencies = ['startTitleMusic', 'startGameMusic', 'isMusicEnabled'];

    constructor(game) {
        super(game);
        this.musicStarted = false;
    }

    init() {
        console.log('TitleSystem initializing...');
    }

    postAllInit() {
        this.setupButtons();
        this.setupMusicStart();
    }

    setupMusicStart() {
        // Start title music on first user interaction (required by browser autoplay policy)
        const startMusic = () => {
            if (!this.musicStarted && this.call.isMusicEnabled?.()) {
                this.call.startTitleMusic?.();
                this.musicStarted = true;
            }
        };

        document.addEventListener('click', startMusic, { once: true });
        document.addEventListener('touchstart', startMusic, { once: true });
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
        // Switch to battle music when starting the game
        this.call.startGameMusic?.();
        // Switch to the game scene
        if (this.game.sceneManager) {
            this.game.sceneManager.switchScene('game');
        }
    }

    startTutorial() {
        // Switch to battle music when starting tutorial
        this.call.startGameMusic?.();
        // Switch to the tutorial scene
        if (this.game.sceneManager) {
            this.game.sceneManager.switchScene('tutorial');
        }
    }

    update() {
        // Title screen doesn't need update logic
    }
}
