/**
 * KiteBehaviorAction - Combat action
 * Attack-and-retreat pattern for ranged units
 * Maintains optimal range while attacking
 *
 * Parameters:
 *   targetKey: string (default: 'target') - Key in shared state for target
 *   optimalRange: number (default: uses combat.range * 0.9) - Ideal attack distance
 *   minRange: number (default: 60) - Minimum distance to maintain
 *   backoffDistance: number (default: 80) - How far to back off when too close
 *
 * Returns RUNNING while kiting, FAILURE if no target or can't attack
 */
class KiteBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const pos = game.getComponent(entityId, 'position');
        const team = game.getComponent(entityId, 'team');
        const combat = game.getComponent(entityId, 'combat');
        const health = game.getComponent(entityId, 'health');
        const vel = game.getComponent(entityId, 'velocity');

        if (!pos || !team || !combat || !health || health.current <= 0) {
            return this.failure();
        }

        // Must have ranged attack for kiting
        if (!combat.range || combat.range < 60) {
            return this.failure();
        }

        const optimalRange = params.optimalRange || combat.range * 0.9;
        const minRange = params.minRange || 60;
        const backoffDistance = params.backoffDistance || 80;

        const shared = this.getShared(entityId, game);
        const memory = this.getMemory(entityId);

        // Get or find target
        let targetId = shared[targetKey];

        if (!targetId || !this.isValidTarget(targetId, game)) {
            // Try to find a new target
            const newTarget = this.findNearestEnemy(entityId, game, pos, team, combat.visionRange || 300);
            if (newTarget) {
                targetId = newTarget.id;
                shared[targetKey] = targetId;
            } else {
                return this.failure();
            }
        }

        const targetPos = game.getComponent(targetId, 'position');
        if (!targetPos) {
            return this.failure();
        }

        const distance = this.distance(pos, targetPos);
        memory.kiteState = memory.kiteState || 'attacking';

        // Face the target
        const facing = game.getComponent(entityId, 'facing');
        if (facing) {
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            facing.angle = Math.atan2(dz, dx);
        }

        // Too close - back off
        if (distance < minRange) {
            memory.kiteState = 'backing_off';

            // Calculate backoff position (away from target)
            const dx = pos.x - targetPos.x;
            const dz = pos.z - targetPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz) || 1;

            memory.targetPosition = {
                x: pos.x + (dx / dist) * backoffDistance,
                z: pos.z + (dz / dist) * backoffDistance
            };

            if (vel) vel.anchored = false;

            return this.running({
                status: 'backing_off',
                targetPosition: memory.targetPosition,
                target: targetId,
                distance,
                minRange
            });
        }

        // Too far - move closer
        if (distance > combat.range) {
            memory.kiteState = 'approaching';

            // Move towards target but stop at optimal range
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz) || 1;

            memory.targetPosition = {
                x: targetPos.x - (dx / dist) * optimalRange,
                z: targetPos.z - (dz / dist) * optimalRange
            };

            if (vel) vel.anchored = false;

            return this.running({
                status: 'approaching',
                targetPosition: memory.targetPosition,
                target: targetId,
                distance,
                optimalRange
            });
        }

        // In optimal range - attack and hold position
        memory.kiteState = 'attacking';

        if (vel) {
            vel.anchored = true;
            vel.vx = 0;
            vel.vz = 0;
        }

        // Perform attack
        this.performAttack(entityId, targetId, game, combat);

        delete memory.targetPosition;

        return this.running({
            status: 'attacking',
            target: targetId,
            distance,
            optimalRange,
            inRange: true
        });
    }

    performAttack(attackerId, targetId, game, combat) {
        if (!combat.lastAttack) combat.lastAttack = 0;

        const timeSinceLastAttack = game.state.now - combat.lastAttack;
        if (timeSinceLastAttack < 1 / combat.attackSpeed) {
            return;
        }

        combat.lastAttack = game.state.now;

        if (game.gameManager?.has('triggerSinglePlayAnimation')) {
            game.gameManager.call('triggerSinglePlayAnimation', attackerId, 'attack', combat.attackSpeed);
        }

        if (combat.projectile) {
            const projectileData = game.getCollections().projectiles?.[combat.projectile];
            if (projectileData) {
                game.gameManager.call('fireProjectile', attackerId, targetId, {
                    id: combat.projectile,
                    ...projectileData
                });
            }
        } else if (combat.damage > 0) {
            const damageDelay = (1 / combat.attackSpeed) * 0.5;
            game.gameManager.call('scheduleDamage', attackerId, targetId, combat.damage, 'physical', damageDelay);
        }
    }

    isValidTarget(targetId, game) {
        const targetHealth = game.getComponent(targetId, 'health');
        if (!targetHealth || targetHealth.current <= 0) return false;

        const targetDeathState = game.getComponent(targetId, 'deathState');
        if (targetDeathState && targetDeathState.isDying) return false;

        return true;
    }

    findNearestEnemy(entityId, game, pos, team, range) {
        const potentialTargets = game.getEntitiesWith('position', 'team', 'health');
        let nearest = null;
        let nearestDistance = Infinity;

        for (const targetId of potentialTargets) {
            if (targetId === entityId) continue;

            const targetTeam = game.getComponent(targetId, 'team');
            if (targetTeam.team === team.team) continue;

            if (!this.isValidTarget(targetId, game)) continue;

            const targetPos = game.getComponent(targetId, 'position');
            const distance = this.distance(pos, targetPos);

            if (distance <= range && distance < nearestDistance) {
                nearestDistance = distance;
                nearest = { id: targetId, distance };
            }
        }

        return nearest;
    }

    onEnd(entityId, game) {
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) vel.anchored = false;
        this.clearMemory(entityId);
    }

    distance(pos1, pos2) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
