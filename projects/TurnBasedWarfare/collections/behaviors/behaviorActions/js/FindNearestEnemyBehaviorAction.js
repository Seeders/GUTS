/**
 * FindNearestEnemyBehaviorAction - Targeting action
 * Finds the nearest enemy and stores it in shared state
 *
 * Parameters:
 *   range: number (default: uses combat.visionRange or 300) - Search range
 *   targetKey: string (default: 'target') - Key to store target in shared state
 *
 * Returns SUCCESS if enemy found, FAILURE otherwise
 */
class FindNearestEnemyBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'findNearestVisibleEnemy'
    ];

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const combat = game.getComponent(entityId, 'combat');
        const range = combat?.visionRange || params.range || 300;
        const nearestEnemy = this.call.findNearestVisibleEnemy( entityId, range);

        if (nearestEnemy) {
            const shared = this.getShared(entityId, game);
            shared[targetKey] = nearestEnemy.id;

            log.debug('FindNearestEnemy', `Entity ${entityId} FOUND enemy`, {
                targetId: nearestEnemy.id,
                distance: nearestEnemy.distance.toFixed(0)
            });

            return this.success({
                target: nearestEnemy.id,
                distance: nearestEnemy.distance,
                range
            });
        }

        return this.failure();
    }
}
