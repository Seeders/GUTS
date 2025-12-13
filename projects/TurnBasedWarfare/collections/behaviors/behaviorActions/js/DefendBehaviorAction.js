/**
 * DefendBehaviorAction - Combat action
 * Holds position and attacks enemies that come within range
 *
 * Parameters:
 *   defendRadius: number (default: 100) - Attack enemies within this radius
 *   anchorPosition: boolean (default: true) - Stay at current position
 *   positionKey: string (optional) - Key in shared for defend position
 *
 * Returns RUNNING while defending, SUCCESS if no enemies, FAILURE if can't defend
 */
class DefendBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const defendRadius = params.defendRadius || 100;
        const anchorPosition = params.anchorPosition !== false;
        const positionKey = params.positionKey;

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const team = game.getComponent(entityId, 'team');
        const combat = game.getComponent(entityId, 'combat');
        const health = game.getComponent(entityId, 'health');
        const vel = game.getComponent(entityId, 'velocity');

        if (!pos || !team || !combat || !health || health.current <= 0) {
            return this.failure();
        }

        const memory = this.getMemory(entityId);
        const shared = this.getShared(entityId, game);

        // Set defend position
        if (!memory.defendPosition) {
            if (positionKey && shared[positionKey]) {
                memory.defendPosition = { ...shared[positionKey] };
            } else {
                memory.defendPosition = { x: pos.x, z: pos.z };
            }
        }

        // Anchor at defend position
        if (anchorPosition && vel) {
            vel.anchored = true;
            vel.vx = 0;
            vel.vz = 0;
        }

        // Find enemies in defend radius
        const enemy = this.findNearestEnemyInRadius(entityId, game, memory.defendPosition, team, defendRadius);

        if (!enemy) {
            // No enemies - just defending
            return this.success({
                status: 'defending',
                position: memory.defendPosition,
                noEnemies: true
            });
        }

        // Check if we're in attack range (accounting for unit sizes)
        const attackRange = this.getEffectiveAttackRange(entityId, enemy.id, game);
        const enemyTransform = game.getComponent(enemy.id, 'transform');
        const distanceToEnemy = this.distance(pos, enemyTransform?.position);

        if (distanceToEnemy <= attackRange) {
            // Attack the enemy
            this.performAttack(entityId, enemy.id, game, combat);

            return this.running({
                status: 'attacking',
                target: enemy.id,
                distance: distanceToEnemy,
                position: memory.defendPosition
            });
        }

        // Enemy in defend radius but not attack range - stay put and wait
        return this.running({
            status: 'watching',
            target: enemy.id,
            distance: distanceToEnemy,
            position: memory.defendPosition
        });
    }

    findNearestEnemyInRadius(entityId, game, centerPos, team, radius) {
        // Use spatial grid for efficient lookup - returns array of entityIds
        const nearbyEntityIds = game.call('getNearbyUnits', centerPos, radius, entityId);
        if (!nearbyEntityIds || nearbyEntityIds.length === 0) return null;

        let nearest = null;
        let nearestDistance = Infinity;

        for (const targetId of nearbyEntityIds) {
            const targetTeam = game.getComponent(targetId, 'team');
            if (!targetTeam || targetTeam.team === team.team) continue;

            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) continue;

            const targetDeathState = game.getComponent(targetId, 'deathState');
            const enums = game.call('getEnums');
            if (targetDeathState && targetDeathState.state !== enums?.deathState?.alive) continue;

            const targetTransform = game.getComponent(targetId, 'transform');
            const targetPos = targetTransform?.position;
            if (!targetPos) continue;

            const dx = targetPos.x - centerPos.x;
            const dz = targetPos.z - centerPos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = { id: targetId, distance };
            }
        }

        return nearest;
    }

    performAttack(attackerId, targetId, game, combat) {
        if (!combat.lastAttack) combat.lastAttack = 0;

        const timeSinceLastAttack = game.state.now - combat.lastAttack;
        if (timeSinceLastAttack < 1 / combat.attackSpeed) {
            return; // On cooldown
        }

        combat.lastAttack = game.state.now;

        // Face the target
        const attackerTransform = game.getComponent(attackerId, 'transform');
        const attackerPos = attackerTransform?.position;
        const targetTransform = game.getComponent(targetId, 'transform');
        const targetPos = targetTransform?.position;

        if (attackerPos && targetPos && attackerTransform) {
            const dx = targetPos.x - attackerPos.x;
            const dz = targetPos.z - attackerPos.z;
            if (!attackerTransform.rotation) attackerTransform.rotation = { x: 0, y: 0, z: 0 };
            attackerTransform.rotation.y = Math.atan2(dz, dx);
        }

        // Trigger attack
        if (game.has('triggerSinglePlayAnimation')) {
            const enums = game.call('getEnums');
            game.call('triggerSinglePlayAnimation', attackerId, enums.animationType.attack, combat.attackSpeed);
        }

        if (combat.projectile) {
            const projectileData = game.getCollections().projectiles?.[combat.projectile];
            if (projectileData) {
                game.call('fireProjectile', attackerId, targetId, {
                    id: combat.projectile,
                    ...projectileData
                });
            }
        } else if (combat.damage > 0) {
            const damageDelay = (1 / combat.attackSpeed) * 0.5;
            game.call('scheduleDamage', attackerId, targetId, combat.damage, 'physical', damageDelay);
        }
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

    /**
     * Get effective attack range accounting for unit collision radii
     * Effective range = base range + attacker radius + target radius
     */
    getEffectiveAttackRange(attackerId, targetId, game) {
        const combat = game.getComponent(attackerId, 'combat');
        const baseRange = combat?.range || 50;

        const attackerCollision = game.getComponent(attackerId, 'collision');
        const targetCollision = game.getComponent(targetId, 'collision');

        const attackerRadius = attackerCollision?.radius || 0;
        const targetRadius = targetCollision?.radius || 0;

        return baseRange + attackerRadius + targetRadius;
    }
}