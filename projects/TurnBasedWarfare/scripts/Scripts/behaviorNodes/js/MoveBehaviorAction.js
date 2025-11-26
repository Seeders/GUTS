class MoveBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (!playerOrder || !playerOrder.meta || !playerOrder.meta.isMoveOrder) {
            return this.failure();
        }

        const targetPosition = playerOrder.targetPosition;

        if (targetPosition) {
            const pos = game.getComponent(entityId, 'position');
            const distanceToTarget = this.distance(pos, targetPosition);

            // Check if we've reached the target
            if (distanceToTarget <= this.parameters.arrivalThreshold) {
                // Movement complete
                return this.success({
                    targetPosition: targetPosition,
                    reachedTarget: true,
                    distanceToTarget,
                    preventEnemiesInRangeCheck: playerOrder.meta.preventEnemiesInRangeCheck || false,
                    handledByMove: true
                });
            }

            // Still moving toward target
            // MovementSystem will handle movement to target
            return this.running({
                targetPosition: targetPosition,
                reachedTarget: false,
                distanceToTarget,
                preventEnemiesInRangeCheck: playerOrder.meta.preventEnemiesInRangeCheck || false,
                handledByMove: true
            });
        }
        return this.failure();
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.round(Math.sqrt(dx * dx + dz * dz));
    }
}
