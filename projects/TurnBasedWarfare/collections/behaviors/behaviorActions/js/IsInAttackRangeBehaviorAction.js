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
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = game.call('getUnitTypeDef', unitTypeComp);
        const teamComp = game.getComponent(entityId, 'team');
        const reverseEnums = game.getReverseEnums();
        const teamName = reverseEnums.team?.[teamComp?.team] || teamComp?.team;
        const unitName = unitDef?.id || 'unknown';

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        // targetId is null/undefined when not set, or could be 0 (valid entity ID)
        if (targetId === undefined || targetId === null || targetId < 0) {
            log.trace('IsInAttackRange', `${unitName}(${entityId}) [${teamName}] FAILURE - no valid target`, {
                targetId
            });
            return this.failure();
        }

        const combat = game.getComponent(entityId, 'combat');
        if (!combat) {
            log.trace('IsInAttackRange', `${unitName}(${entityId}) [${teamName}] FAILURE - no combat component`);
            return this.failure();
        }

        const baseRange = combat.range || 50;
        // Melee units (range < 50) need effective range with collision radii
        // Ranged units use center-to-center to match ability canExecute checks
        const effectiveRange = baseRange < 50
            ? GUTS.GameUtils.getEffectiveRange(game, entityId, targetId, baseRange)
            : baseRange;
        const distance = GUTS.GameUtils.getDistanceBetweenEntities(game, entityId, targetId);

        const inRange = distance <= effectiveRange;

        log.trace('IsInAttackRange', `${unitName}(${entityId}) [${teamName}] ${inRange ? 'SUCCESS' : 'FAILURE'}`, {
            targetId,
            distance: distance.toFixed(0),
            effectiveRange: effectiveRange.toFixed(0)
        });

        if (inRange) {
            return this.success({
                distance,
                effectiveRange,
                target: targetId
            });
        }

        return this.failure();
    }
}
