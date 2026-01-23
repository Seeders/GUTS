/**
 * IsEnemyNearbyBehaviorAction - Condition action
 * Checks if there are enemies within range
 *
 * Parameters:
 *   range: number (default: uses combat.visionRange or 300) - Detection range
 *   minCount: number (default: 1) - Minimum enemies required
 *   storeNearest: boolean (default: false) - Store nearest enemy in shared state
 *   targetKey: string (default: 'target') - Key for storing nearest enemy
 *
 * Returns SUCCESS if enemies found, FAILURE otherwise
 */
class IsEnemyNearbyBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'getVisibleEnemiesInRange',
        'findNearestVisibleEnemy'
    ];

    execute(entityId, game) {
        const params = this.parameters || {};
        const minCount = params.minCount || 1;
        const storeNearest = params.storeNearest || false;
        const targetKey = params.targetKey || 'target';

        const combat = game.getComponent(entityId, 'combat');
        const range = combat?.visionRange || params.range || 300;

        const enemies = this.call.getVisibleEnemiesInRange( entityId, range);

        if (enemies && enemies.length >= minCount) {
            const result = {
                enemyCount: enemies.length,
                range
            };

            if (storeNearest) {
                const nearestEnemy = this.call.findNearestVisibleEnemy( entityId, range);
                if (nearestEnemy) {
                    const shared = this.getShared(entityId, game);
                    shared[targetKey] = nearestEnemy.id;
                    result.nearestEnemy = nearestEnemy.id;
                    result.nearestDistance = nearestEnemy.distance;
                }
            }

            return this.success(result);
        }

        return this.failure();
    }
}
