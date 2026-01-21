/**
 * PauseSystem - Central source of truth for game pause state
 *
 * Exposes services for pausing/unpausing the game so all systems
 * use a consistent pause mechanism.
 */
class PauseSystem extends GUTS.BaseSystem {
    static services = [
        'pauseGame',
        'unpauseGame',
        'togglePause',
        'isPaused'
    ];

    constructor(game) {
        super(game);
        this.game.pauseSystem = this;
    }

    init() {
    }

    onSceneLoad(sceneData) {
        // Always start a new scene unpaused
        this.game.state.isPaused = false;
    }

    onSceneUnload() {
        // Reset pause state when leaving a scene
        this.game.state.isPaused = false;
    }

    /**
     * Pause the game
     */
    pauseGame() {
        this.game.state.isPaused = true;
    }

    /**
     * Unpause the game
     */
    unpauseGame() {
        this.game.state.isPaused = false;
    }

    /**
     * Toggle pause state
     * @returns {boolean} The new pause state
     */
    togglePause() {
        this.game.state.isPaused = !this.game.state.isPaused;
        return this.game.state.isPaused;
    }

    /**
     * Check if the game is paused
     * @returns {boolean} True if paused
     */
    isPaused() {
        return this.game.state.isPaused === true;
    }
}
