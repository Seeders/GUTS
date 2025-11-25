class MoveBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, aiState, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (!playerOrder) {            
            return null;
        }
        const targetPosition = playerOrder.targetPosition;

        if(targetPosition) {
            const pos = game.getComponent(entityId, 'position');
            const distance = this.distance(pos, targetPosition);

            if (distance <= this.parameters.arrivalThreshold) {
                aiState.meta.reachedTarget = true;
            }
            // MovementSystem will handle movement to target
            return this.actionResponse({
                targetPosition: targetPosition, 
                preventEnemiesInRangeCheck: playerOrder.meta.preventEnemiesInRangeCheck || false
            });
        }
        return null;
    }

    onPlacementPhaseStart(entityId, aiState, game){
        console.log('onPlacementPhaseStart', aiState.meta, aiState.meta.reachedTarget);
        if(aiState.meta.reachedTarget){
        console.log('reachedTarget');
            const playerOrder = game.getComponent(entityId, 'playerOrder');
            // Clear player order
            if (playerOrder) {
        console.log('clearedPlayerOrder');
                game.removeComponent(entityId, 'playerOrder');
                game.addComponent(entityId, 'playerOrder', {});
            }        
        }
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
