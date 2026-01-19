/**
 * ScreenSystem - Basic screen management
 */
class ScreenSystem extends GUTS.BaseSystem {
    static services = [
        'showLoadingScreen',
        'showGameScreen',
        'showMainMenu'
    ];

    constructor(game) {
        super(game);
        this.game.screenSystem = this;
        this.currentScreen = 'loadingScreen';
    }

    init() {
    }

    onSceneLoad(sceneData) {
        const sceneName = this.game.sceneManager.currentSceneName;
        if (sceneName === 'menu') {
            this.showMainMenu();
        }
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
            screen.style.display = '';
        });

        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenId;
        }
    }

    showMainMenu() {
        this.showScreen('mainMenu');
    }

    showLoadingScreen() {
        this.showScreen('loadingScreen');
    }

    showGameScreen() {
        this.showScreen('gameScreen');
    }

    onSceneUnload() {
        this.currentScreen = 'loadingScreen';
    }
}
