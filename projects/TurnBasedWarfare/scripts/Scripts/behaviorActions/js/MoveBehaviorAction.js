class MoveBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (!playerOrder) {
            return null;
        }

        const targetPosition = playerOrder.targetPosition;

        if(targetPosition) {
            const pos = game.getComponent(entityId, 'position');

            const distanceToTarget = this.distance(pos, targetPosition);
            let reachedTarget = false;
            if (distanceToTarget <= this.parameters.arrivalThreshold) {
                reachedTarget = true;
            }

            // MovementSystem will handle movement to target
            // Set flag so other actions know we're handling this order
            return {
                targetPosition: targetPosition,
                reachedTarget,
                distanceToTarget,
                preventEnemiesInRangeCheck: playerOrder.meta.preventEnemiesInRangeCheck || false,
                handledByMove: true
            };
        }
        return null;
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.round(Math.sqrt(dx * dx + dz * dz));
    }
}
