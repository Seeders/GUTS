/**
 * IsInRangeBehaviorAction - Condition action
 * Checks if entity is within range of a target
 *
 * Parameters:
 *   range: number (default: 100) - Distance threshold
 *   comparison: string (default: 'within') - 'within', 'outside', 'tooClose'
 *   targetKey: string (default: 'target') - Key in shared state for target
 *   minRange: number (default: 0) - Minimum range for 'tooClose' check
 *
 * Returns SUCCESS if condition is met, FAILURE otherwise
 */
class IsInRangeBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'getUnitTypeDef'
    ];

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const range = params.range !== undefined ? params.range : 100;
        const comparison = params.comparison || 'within';
        const targetKey = params.targetKey || 'target';
        const minRange = params.minRange || 0;

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = this.call.getUnitTypeDef( unitTypeComp);
        const teamComp = game.getComponent(entityId, 'team');
        const reverseEnums = game.getReverseEnums();
        const teamName = reverseEnums.team?.[teamComp?.team] || teamComp?.team;
        const unitName = unitDef?.id || 'unknown';

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        // targetId is null/undefined when not set, or could be 0 (valid entity ID)
        if (targetId === undefined || targetId === null || targetId < 0) {
            log.trace('IsInRange', `${unitName}(${entityId}) [${teamName}] FAILURE - no valid target`, {
                targetId
            });
            return this.failure();
        }

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const targetTransform = game.getComponent(targetId, 'transform');
        const targetPos = targetTransform?.position;

        if (!pos || !targetPos) {
            log.trace('IsInRange', `${unitName}(${entityId}) [${teamName}] FAILURE - missing position`, {
                hasPos: !!pos,
                hasTargetPos: !!targetPos
            });
            return this.failure();
        }

        const distance = this.distance(pos, targetPos);

        let conditionMet = false;
        switch (comparison) {
            case 'within':
                conditionMet = distance <= range;
                break;
            case 'outside':
                conditionMet = distance > range;
                break;
            case 'tooClose':
                conditionMet = distance < minRange;
                break;
            case 'between':
                conditionMet = distance >= minRange && distance <= range;
                break;
        }

        log.trace('IsInRange', `${unitName}(${entityId}) [${teamName}] ${conditionMet ? 'SUCCESS' : 'FAILURE'}`, {
            comparison,
            distance: distance.toFixed(0),
            range,
            minRange,
            targetId
        });

        if (conditionMet) {
            return this.success({
                distance,
                range,
                minRange,
                comparison,
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
