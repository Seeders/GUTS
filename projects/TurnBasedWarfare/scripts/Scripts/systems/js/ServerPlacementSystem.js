/**
 * ServerPlacementSystem - Server-side placement system
 * Thin wrapper that composes PlacementSystem with ServerPlacementController
 */
class ServerPlacementSystem extends PlacementSystem {
    constructor(game) {
        super(game);

        // Load and initialize server-specific controller
        const ServerPlacementControllerClass = game.moduleManager.getCompiledScript('ServerPlacementController', 'systems');
        this.serverController = new ServerPlacementControllerClass(this, this.engine);
    }

    init(params) {
        super.init(params);

        // Register server-specific functions
        this.game.gameManager.register('saveBuilding', this.serverController.saveBuilding.bind(this.serverController));
    }
}
