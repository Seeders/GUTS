class MoveBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (!playerOrder || !playerOrder.meta || !playerOrder.meta.isMoveOrder) {
            return null;
        }

        // Check if enemies are in attack range - yield to combat if so
        // Unless preventEnemiesInRangeCheck is set (for abilities like mining/building)
        if (!playerOrder.meta.preventEnemiesInRangeCheck) {
            if (this.hasEnemyInAttackRange(entityId, game)) {
                return null; // Let CombatBehaviorAction handle this
            }
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

    hasEnemyInAttackRange(entityId, game) {
        const pos = game.getComponent(entityId, 'position');
        const team = game.getComponent(entityId, 'team');
        const combat = game.getComponent(entityId, 'combat');

        if (!pos || !team || !combat) return false;

        const attackRange = combat.range || 50;
        const potentialTargets = game.getEntitiesWith('position', 'team', 'health');

        for (const targetId of potentialTargets) {
            if (targetId === entityId) continue;

            const targetTeam = game.getComponent(targetId, 'team');
            const targetHealth = game.getComponent(targetId, 'health');
            const targetPos = game.getComponent(targetId, 'position');

            // Skip allies
            if (targetTeam.team === team.team) continue;

            // Skip dead units
            if (!targetHealth || targetHealth.current <= 0) continue;

            const distance = this.distance(pos, targetPos);
            if (distance <= attackRange) {
                return true;
            }
        }

        return false;
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.round(Math.sqrt(dx * dx + dz * dz));
    }
}
