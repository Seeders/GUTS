/**
 * MoveToEnemyBehaviorAction - Movement action
 * Moves toward the target enemy stored in shared state
 *
 * Parameters:
 *   targetKey: string (default: 'target') - Key in shared state for target entity ID
 *   arrivalRange: number (default: uses combat.range) - Stop when this close to target
 *
 * Returns SUCCESS when in range, RUNNING while moving, FAILURE if no target
 */
class MoveToEnemyBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        // targetId is null/undefined when not set, or could be 0 (valid entity ID)
        if (targetId === undefined || targetId === null || targetId < 0) {
            return this.failure();
        }

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const targetTransform = game.getComponent(targetId, 'transform');
        const targetPos = targetTransform?.position;
        const combat = game.getComponent(entityId, 'combat');

        if (!pos || !targetPos || !combat) {
            return this.failure();
        }

        const effectiveRange = this.getEffectiveAttackRange(entityId, targetId, game);
        const arrivalRange = params.arrivalRange || effectiveRange;
        const distance = this.distance(pos, targetPos);

        // Check if in range
        if (distance <= arrivalRange) {
            return this.success({
                arrived: true,
                distance,
                target: targetId
            });
        }

        // Still moving - return running with targetPosition for MovementSystem
        return this.running({
            targetPosition: { x: targetPos.x, z: targetPos.z },
            distance,
            target: targetId,
            moving: true
        });
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
