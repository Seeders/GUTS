class EventManager {
    constructor(app) {
        this.game = app;
        this.game.eventManager = this;
        this.events = {};
        this.reset();
    }

    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }

    emit(event, ...args) {
        if (this.events[event]) {
            this.events[event].forEach(callback => callback(...args));
        }
    }

    off(event, callback) {
        if (this.events[event]) {
            this.events[event] = this.events[event].filter(cb => cb !== callback);
        }
    }

    
    reset() {
        this.currentScreen = 'mainMenu';
        this.selectedGameMode = null;
        this.gameStartTime = null;
        this.isPaused = false;
        this.stats = {
            round: 1,
            goldEarned: 0,
            unitsDeployed: 0,
            unitsLost: 0,
            totalPlayTime: 0
        };
        this.emit('stateChanged', this);
    }

    setScreen(screenId) {
        const previousScreen = this.currentScreen;
        this.currentScreen = screenId;
        this.emit('screenChanged', screenId, previousScreen);
    }

    setGameMode(mode) {
        this.selectedGameMode = mode;
        this.emit('gameModeChanged', mode);
    }

    startGame() {
        this.gameStartTime = Date.now();
        this.emit('gameStarted');
    }

    endGame(result, finalStats = {}) {
        if (this.gameStartTime) {
            this.stats.totalPlayTime = Date.now() - this.gameStartTime;
        }
        Object.assign(this.stats, finalStats);
        this.emit('gameEnded', result, this.stats);
    }

    updateStats(newStats) {
        Object.assign(this.stats, newStats);
        this.emit('statsUpdated', this.stats);
    }

    pause() {
        this.isPaused = true;
        this.emit('gamePaused');
    }

    resume() {
        this.isPaused = false;
        this.emit('gameResumed');
    }
}