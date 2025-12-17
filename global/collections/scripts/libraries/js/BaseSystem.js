class BaseSystem {
    // Static property that subclasses can override to define services to register
    // Format: ['methodName1', 'methodName2', ...]
    // Each method will be auto-registered as game.register('methodName', this.methodName.bind(this))
    static services = [];

    constructor(game) {
        this.game = game;
        this.engine = game.app;
        this.enabled = true;
        this.enums = this.game.getEnums();
        this.collections = this.game.getCollections();
        this.reverseEnums = this.game.getReverseEnums();
    }

    /**
     * Called after all systems are initialized
     */
    postAllInit() {

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

    render() {

    }

}


// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.BaseSystem = BaseSystem;
}

// ES6 exports for webpack bundling
export default BaseSystem;
export { BaseSystem };