/**
 * FindWeakestEnemyBehaviorAction - Targeting action
 * Finds the enemy with lowest health and stores it in shared state
 *
 * Parameters:
 *   range: number (default: uses combat.visionRange or 300) - Search range
 *   targetKey: string (default: 'target') - Key to store target in shared state
 *   usePercentage: boolean (default: true) - Sort by health percentage vs absolute
 *   maxHealthPercent: number (default: 1.0) - Only target enemies below this health %
 *
 * Returns SUCCESS if enemy found, FAILURE otherwise
 */
class FindWeakestEnemyBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'findWeakestVisibleEnemy'
    ];

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';
        const usePercentage = params.usePercentage !== false;
        const maxHealthPercent = params.maxHealthPercent ?? 1.0;

        const combat = game.getComponent(entityId, 'combat');
        const range = params.range ?? (combat?.visionRange || 300);

        const weakestEnemy = this.call.findWeakestVisibleEnemy( entityId, range, {
            usePercentage,
            maxHealthPercent
        });

        if (weakestEnemy) {
            const shared = this.getShared(entityId, game);
            shared[targetKey] = weakestEnemy.id;

            return this.success({
                target: weakestEnemy.id,
                distance: weakestEnemy.distance,
                healthPercent: weakestEnemy.healthPercent,
                range
            });
        }

        return this.failure();
    }
}
