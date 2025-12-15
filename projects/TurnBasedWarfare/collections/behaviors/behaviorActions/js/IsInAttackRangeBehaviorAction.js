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

        // targetId is null/undefined when not set, or could be 0 (valid entity ID)
        if (targetId === undefined || targetId === null || targetId < 0) {
            return this.failure();
        }

        const combat = game.getComponent(entityId, 'combat');
        if (!combat) {
            return this.failure();
        }

        const baseRange = combat.range || 50;
        const distance = GUTS.GameUtils.getDistanceBetweenEntities(game, entityId, targetId);
        const effectiveRange = GUTS.GameUtils.getEffectiveRange(game, entityId, targetId, baseRange);

        if (distance <= effectiveRange) {
            return this.success({
                distance,
                range: effectiveRange,
                target: targetId
            });
        }

        return this.failure();
    }
}
