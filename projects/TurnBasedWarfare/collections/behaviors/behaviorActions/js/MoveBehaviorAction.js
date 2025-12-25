class MoveBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');

        if (!playerOrder || !playerOrder.enabled || !playerOrder.isMoveOrder) {
            return this.failure();
        }

        const targetPosition = {
            x: playerOrder.targetPositionX,
            y: playerOrder.targetPositionY,
            z: playerOrder.targetPositionZ
        };

        // Check if target position is valid (not null/undefined)
        // Note: (0,0) is a valid position, so we can't just check for non-zero
        if (targetPosition.x != null && targetPosition.z != null) {
            const isForceMove = playerOrder.preventEnemiesInRangeCheck;
            const transform = game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            const distanceToTarget = this.distance(pos, targetPosition);

            // Check if we've reached the target
            if (distanceToTarget <= this.parameters.arrivalThreshold) {
                // Movement complete - mark order as complete but keep the component
                // The order will be cleared at the start of the next placement phase
                // This allows the unit to hold position until the battle ends
                playerOrder.completed = true;

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

