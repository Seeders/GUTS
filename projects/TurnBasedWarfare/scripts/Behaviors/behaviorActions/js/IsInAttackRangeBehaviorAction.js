/**
 * IsInAttackRangeBehaviorAction - Condition action
 * Checks if target is within attack range (uses combat.range)
 *
 * Parameters:
 *   targetKey: string (default: 'target') - Key in shared state for target
 *
 * Returns SUCCESS if in attack range, FAILURE otherwise
 */
class IsInAttackRangeBehaviorAction extends GUTS.BaseBehaviorAction {

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
        const distance = this.distance(pos, targetPos);

        if (distance <= attackRange) {
            return this.success({
                distance,
                range: attackRange,
                target: targetId
            });
        }

        return this.failure();
    }

    distance(pos1, pos2) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
