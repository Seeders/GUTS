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

    execute(entityId, game) {
        const params = this.parameters || {};
        const range = params.range !== undefined ? params.range : 100;
        const comparison = params.comparison || 'within';
        const targetKey = params.targetKey || 'target';
        const minRange = params.minRange || 0;

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        if (!targetId) {
            return this.failure();
        }

        const pos = game.getComponent(entityId, 'position');
        const targetPos = game.getComponent(targetId, 'position');

        if (!pos || !targetPos) {
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
