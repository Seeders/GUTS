class MoveBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (!playerOrder || !playerOrder.meta || !playerOrder.meta.isMoveOrder) {
            return this.failure();
        }

        const targetPosition = playerOrder.targetPosition;

        if (targetPosition) {
            // Check if this is a normal move (not a force move)
            const isForceMove = playerOrder.meta.preventEnemiesInRangeCheck || false;

            // For normal moves, check if enemies are nearby and allow combat to override
            if (!isForceMove) {
                const hasNearbyEnemy = this.hasEnemyInVisionRange(entityId, game);
                if (hasNearbyEnemy) {
                    // Enemy nearby - fail to let CombatBehaviorAction take over
                    return this.failure();
                }
            }
            // Force moves ignore enemies and continue regardless

            const pos = game.getComponent(entityId, 'position');
            const distanceToTarget = this.distance(pos, targetPosition);

            // Check if we've reached the target
            if (distanceToTarget <= this.parameters.arrivalThreshold) {
                // Movement complete
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

    /**
     * Check if there are any enemies within vision range
     * @param {string} entityId - The entity to check for
     * @param {object} game - Game instance
     * @returns {boolean} True if enemy found in range
     */
    hasEnemyInVisionRange(entityId, game) {
        const pos = game.getComponent(entityId, 'position');
        const team = game.getComponent(entityId, 'team');
        const combat = game.getComponent(entityId, 'combat');

        if (!pos || !team || !combat) return false;

        const visionRange = combat.visionRange || 300;

        // Get all potential targets
        const potentialTargets = game.getEntitiesWith('position', 'team', 'health');

        // Sort for deterministic iteration
        const sortedTargets = potentialTargets.sort((a, b) => String(a).localeCompare(String(b)));

        for (const targetId of sortedTargets) {
            if (targetId === entityId) continue;

            const targetTeam = game.getComponent(targetId, 'team');
            const targetHealth = game.getComponent(targetId, 'health');
            const targetPos = game.getComponent(targetId, 'position');
            const targetDeathState = game.getComponent(targetId, 'deathState');

            // Skip allies
            if (targetTeam.team === team.team) continue;

            // Skip dead or dying units
            if (!targetHealth || targetHealth.current <= 0) continue;
            if (targetDeathState && targetDeathState.isDying) continue;

            const distance = this.distance(pos, targetPos);

            // Check if within vision range
            if (distance <= visionRange) {
                return true; // Found an enemy in range
            }
        }

        return false; // No enemies in range
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.round(Math.sqrt(dx * dx + dz * dz));
    }
}
