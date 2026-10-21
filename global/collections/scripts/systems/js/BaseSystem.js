// Initialize window.GUTS immediately for browser (before class definition)
if (typeof window !== 'undefined') {
    if (!window.GUTS) window.GUTS = {};
}

class BaseSystem {
    // Static property that subclasses can override to define services to register
    // Format: ['methodName1', 'methodName2', ...]
    // Each method will be auto-registered as game.register('methodName', this.methodName.bind(this))
    static services = [];

    // Static property for services this system depends on (will be cached for fast access)
    // Format: ['serviceName1', 'serviceName2', ...]
    static serviceDependencies = [];

    constructor(game) {
        this.game = game;
        this.engine = game.app;
        this.enabled = true;
        this.enums = this.game.getEnums();
        this.collections = this.game.getCollections();
        this.reverseEnums = this.game.getReverseEnums();

        // Cached service functions for fast access (e.g., this.call.useAbility)
        this.call = {};
    }

    /**
     * Called when a scene is loaded
     * @param {Object} sceneData - The scene configuration data
     */
    onSceneLoad(sceneData) {

    }

    /**
     * Called when a scene is unloaded
     */
    onSceneUnload() {

    }

    /**
     * Check if this system is required for a given scene
     * Override in subclasses to make systems optional based on scene config
     * @param {Object} sceneData - The scene configuration data
     * @returns {boolean} True if this system should be enabled for this scene
     */
    isRequiredForScene(sceneData) {
        // If scene specifies systems, check if this system is in the list
        if (sceneData?.systems && Array.isArray(sceneData.systems)) {
            return sceneData.systems.includes(this.constructor.name);
        }
        // Default: always required
        return true;
    }

    update(){

    }

    /**
     * True where game state is decided: the server in online matches, the
     * local game otherwise. Clients of an online match only mirror it.
     */
    isAuthority() {
        return !!(this.game.isServer || this.game.state?.isLocalGame);
    }

    /**
     * The active game mode's rules object (a BaseGameMode subclass from the
     * gameModes collection). Core systems ask it for mode-specific policy
     * instead of checking which mode is running.
     */
    gameMode() {
        if (this.game.hasService?.('getGameMode')) return this.game.call('getGameMode');
        return GUTS.BaseGameMode ? GUTS.BaseGameMode.fallback(this.game) : null;
    }

    render() {

    }

}


// Assign to global.GUTS for server
if (typeof global !== 'undefined') {
    if (!global.GUTS) global.GUTS = {};
    global.GUTS.BaseSystem = BaseSystem;
}

// Assign to window.GUTS for browser (runs during module evaluation, before other systems)
if (typeof window !== 'undefined') {
    window.GUTS.BaseSystem = BaseSystem;
}

// ES6 exports for webpack bundling
export default BaseSystem;
export { BaseSystem };
