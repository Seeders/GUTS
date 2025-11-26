/**
 * RetreatAction - Combat action
 * Falls back when health is low, combining fleeing with counter-attacks
 *
 * Parameters:
 *   healthThreshold: number (default: 0.3) - Health % to trigger retreat
 *   retreatDistance: number (default: 150) - How far to retreat
 *   counterAttack: boolean (default: true) - Attack while retreating if possible
 *   safeDistance: number (default: 200) - Distance to consider safe
 *
 * Returns RUNNING while retreating, SUCCESS when safe, FAILURE if healthy
 */
class RetreatAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const healthThreshold = params.healthThreshold !== undefined ? params.healthThreshold : 0.3;
        const retreatDistance = params.retreatDistance || 150;
        const counterAttack = params.counterAttack !== false;
        const safeDistance = params.safeDistance || 200;

        const pos = game.getComponent(entityId, 'position');
        const team = game.getComponent(entityId, 'team');
        const health = game.getComponent(entityId, 'health');
        const combat = game.getComponent(entityId, 'combat');
        const vel = game.getComponent(entityId, 'velocity');

        if (!pos || !team || !health) {
            return this.failure();
        }

        const healthPercent = health.current / health.max;

        // Only retreat if health is low
        if (healthPercent >= healthThreshold) {
            return this.failure();
        }

        const memory = this.getMemory(entityId);

        // Find nearest threat
        const threat = this.findNearestEnemy(entityId, game, pos, team, safeDistance * 2);

        if (!threat) {
            // No threats, we're safe
            if (vel) vel.anchored = false;
            return this.success({ status: 'safe', noThreats: true, healthPercent });
        }

        const threatPos = game.getComponent(threat.id, 'position');
        const distanceToThreat = this.distance(pos, threatPos);

        // Already at safe distance
        if (distanceToThreat >= safeDistance) {
            if (vel) vel.anchored = false;
            return this.success({ status: 'safe', distanceToThreat, healthPercent });
        }

        // Counter-attack if in range and able
        if (counterAttack && combat && combat.damage > 0) {
            const attackRange = combat.range || 50;
            if (distanceToThreat <= attackRange) {
                this.performCounterAttack(entityId, threat.id, game, combat);
            }
        }

        // Calculate retreat direction (away from threat)
        const dx = pos.x - threatPos.x;
        const dz = pos.z - threatPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 1;

        const targetX = pos.x + (dx / dist) * retreatDistance;
        const targetZ = pos.z + (dz / dist) * retreatDistance;

        memory.targetPosition = { x: targetX, z: targetZ };
        memory.retreatState = 'retreating';

        if (vel) vel.anchored = false;

        return this.running({
            status: 'retreating',
            targetPosition: memory.targetPosition,
            threat: threat.id,
            distanceToThreat,
            healthPercent
        });
    }

    performCounterAttack(attackerId, targetId, game, combat) {
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

    findNearestEnemy(entityId, game, pos, team, range) {
        const potentialTargets = game.getEntitiesWith('position', 'team', 'health');
        let nearest = null;
        let nearestDistance = Infinity;

        for (const targetId of potentialTargets) {
            if (targetId === entityId) continue;

            const targetTeam = game.getComponent(targetId, 'team');
            if (targetTeam.team === team.team) continue;

            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) continue;

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
