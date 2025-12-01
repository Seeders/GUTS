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

        if (!targetId) {
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

        const attackRange = combat.range || 50;
        const arrivalRange = params.arrivalRange || attackRange;
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
}
