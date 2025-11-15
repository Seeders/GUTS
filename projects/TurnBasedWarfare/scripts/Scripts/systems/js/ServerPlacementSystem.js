/**
 * ServerPlacementSystem - Server-side placement system
 * Thin wrapper that composes PlacementSystem with ServerPlacementController
 */
class ServerPlacementSystem extends PlacementSystem {
    constructor(game) {
        super(game);

        // Initialize server-specific controller
        this.serverController = new ServerPlacementController(this, this.engine);
    }

    init(params) {
        super.init(params);

        // Register server-specific functions
        this.game.gameManager.register('saveBuilding', this.serverController.saveBuilding.bind(this.serverController));
    }
}
