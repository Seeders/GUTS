class MoveBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (!playerOrder || !playerOrder.meta || !playerOrder.meta.isMoveOrder) {
            return this.failure();
        }

        const targetPosition = playerOrder.targetPosition;

        if (targetPosition) {
            const isForceMove = playerOrder.meta.preventEnemiesInRangeCheck || false;
            const transform = game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            const distanceToTarget = this.distance(pos, targetPosition);

            // Check if we've reached the target
            if (distanceToTarget <= this.parameters.arrivalThreshold) {
                // Movement complete - remove the player order so unit can return to normal behavior
                game.removeComponent(entityId, 'playerOrder');

                return this.success({
                    targetPosition: targetPosition,
                    reachedTarget: true,
                    distanceToTarget,
                    preventEnemiesInRangeCheck: isForceMove,
                    handledByMove: true
                });
            }

            // Still moving toward target
            // MovementSystem will handle movement to target
            return this.running({
                targetPosition: targetPosition,
                reachedTarget: false,
                distanceToTarget,
                preventEnemiesInRangeCheck: isForceMove,
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
