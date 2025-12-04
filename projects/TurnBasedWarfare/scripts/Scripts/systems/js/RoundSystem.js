class RoundSystem extends GUTS.BaseSystem {

    constructor(game){
        super(game);
        this.game.roundSystem = this;
    }
    //cant place this in UnitOrderSystem because UnitOrderSystem doesn't run on the server.
    onPlacementPhaseStart() {
        // Only clear completed player orders at the start of placement phase
        // Orders that weren't completed (unit didn't reach target) should persist
        // so the unit continues following the order in the next battle
        const entities = this.game.getEntitiesWith('playerOrder');
        entities.forEach((entityId) => {
            const playerOrder = this.game.getComponent(entityId, 'playerOrder');
            if (playerOrder && playerOrder.meta?.completed) {
                playerOrder.targetPosition = null;
                playerOrder.meta = {};
                playerOrder.issuedTime = 0;
            }
        });
    }
}