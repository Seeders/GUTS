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
            if (playerOrder && playerOrder.completed) {
                // Disable the completed order and reset to defaults
                playerOrder.enabled = false;
                playerOrder.targetPositionX = 0;
                playerOrder.targetPositionY = 0;
                playerOrder.targetPositionZ = 0;
                playerOrder.isMoveOrder = false;
                playerOrder.preventEnemiesInRangeCheck = false;
                playerOrder.completed = false;
                playerOrder.issuedTime = 0;
            }
        });

        // Reset production progress for all buildings at the start of each placement phase
        // This allows buildings to produce again each round
        const placementEntities = this.game.getEntitiesWith('placement', 'unitType');
        placementEntities.forEach((entityId) => {
            const placement = this.game.getComponent(entityId, 'placement');
            const unitType = this.game.getComponent(entityId, 'unitType');
            if (placement && unitType) {
                const unitDef = this.game.call('getUnitTypeDef', unitType);
                if (unitDef?.collection === 'buildings') {
                    placement.productionProgress = 0;
                }
            }
        });
    }
}
