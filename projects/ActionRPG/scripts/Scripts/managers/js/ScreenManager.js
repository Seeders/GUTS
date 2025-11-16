class ScreenManager {
    constructor(game) {
        this.game = game;
        this.game.screenManager = this;
        this.currentScreen = 'mainMenu';
        this.stats = {
            kills: 0,
            gold: 0,
            level: 1,
            time: 0
        };
    }

    showMainMenu() {
        this.hideAllScreens();
        const mainMenu = document.getElementById('mainMenu');
        if (mainMenu) {
            mainMenu.style.display = 'flex';
            this.currentScreen = 'mainMenu';
        }
        this.game.state.isPaused = true;
    }

    showGameScreen() {
        this.hideAllScreens();
        const gameScreen = document.getElementById('gameScreen');
        if (gameScreen) {
            gameScreen.style.display = 'block';
            this.currentScreen = 'gameScreen';
        }

        // Show HUD
        const gameHUD = document.getElementById('gameHUD');
        if (gameHUD) {
            gameHUD.style.display = 'block';
        }

        this.game.state.isPaused = false;
    }

    showLoadingScreen() {
        this.hideAllScreens();
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.style.display = 'flex';
            this.currentScreen = 'loadingScreen';
        }
        this.game.state.isPaused = true;
    }

    showVictoryScreen() {
        this.hideAllScreens();
        const victoryScreen = document.getElementById('victoryScreen');
        if (victoryScreen) {
            victoryScreen.style.display = 'flex';
            this.currentScreen = 'victoryScreen';
            this.updateVictoryStats();
        }
        this.game.state.isPaused = true;
    }

    showDefeatScreen() {
        this.hideAllScreens();
        const defeatScreen = document.getElementById('defeatScreen');
        if (defeatScreen) {
            defeatScreen.style.display = 'flex';
            this.currentScreen = 'defeatScreen';
            this.updateDefeatStats();
        }
        this.game.state.isPaused = true;
    }

    hideAllScreens() {
        const screens = ['mainMenu', 'gameScreen', 'loadingScreen', 'victoryScreen', 'defeatScreen'];
        screens.forEach(screenId => {
            const screen = document.getElementById(screenId);
            if (screen) {
                screen.style.display = 'none';
            }
        });

        // Hide HUD
        const gameHUD = document.getElementById('gameHUD');
        if (gameHUD) {
            gameHUD.style.display = 'none';
        }
    }

    updateVictoryStats() {
        const statsElement = document.getElementById('victoryStats');
        if (statsElement) {
            statsElement.innerHTML = `
                <p>Level: ${this.stats.level}</p>
                <p>Kills: ${this.stats.kills}</p>
                <p>Gold: ${this.stats.gold}</p>
                <p>Time: ${this.formatTime(this.stats.time)}</p>
            `;
        }
    }

    updateDefeatStats() {
        const statsElement = document.getElementById('defeatStats');
        if (statsElement) {
            statsElement.innerHTML = `
                <p>You survived to level: ${this.stats.level}</p>
                <p>Kills: ${this.stats.kills}</p>
                <p>Gold collected: ${this.stats.gold}</p>
            `;
        }
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    pause() {
        this.game.state.isPaused = true;
    }

    resume() {
        this.game.state.isPaused = false;
    }
}
