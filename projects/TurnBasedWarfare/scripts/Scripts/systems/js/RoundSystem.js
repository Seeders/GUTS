class RoundSystem extends GUTS.BaseSystem {

    constructor(game){
        super(game);
        this.game.roundSystem = this;
    }
    onPlacementPhaseStart() {
        const entities = this.game.getEntitiesWith('playerOrder', 'aiState');
        entities.forEach((entityId) => {
            const aiState = this.game.getComponent(entityId, 'aiState');
            if(aiState.meta.reachedTarget){
                const playerOrder = this.game.getComponent(entityId, 'playerOrder');
                 if(playerOrder){
                    playerOrder.targetPosition = null;
                    playerOrder.meta = {};
                    playerOrder.issuedTime = 0;
                }
            }
        });
    }
}