/**
 * TitleSystem - Handles the title screen and transition to game
 */
class TitleSystem extends GUTS.BaseSystem {
    static services = [];
    static serviceDependencies = ['startTitleMusic', 'startGameMusic', 'isMusicEnabled', 'fadeOutMusic'];

    constructor(game) {
        super(game);
        this.musicStarted = false;
    }

    init() {
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

    async startGame() {
        // Fade out music before switching
        const fadeDuration = 1.0;
        this.call.fadeOutMusic?.(fadeDuration);
        await new Promise(resolve => setTimeout(resolve, fadeDuration * 1000));

        if (this.game.sceneManager) {
            // Go directly to the game
            this.game.sceneManager.switchScene('game');
        }
    }

    async startTutorial() {
        // Fade out music before switching
        const fadeDuration = 1.0;
        this.call.fadeOutMusic?.(fadeDuration);
        await new Promise(resolve => setTimeout(resolve, fadeDuration * 1000));

        if (this.game.sceneManager) {
            this.game.sceneManager.switchScene('tutorial');
        }
    }

    update() {
        // Title screen doesn't need update logic
    }
}
