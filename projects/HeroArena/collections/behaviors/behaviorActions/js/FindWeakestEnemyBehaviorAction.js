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
// HeroArena: open-arena targeting that skips VisionSystem's terrain line-of-sight
// filtering (see FindNearestEnemyBehaviorAction) so every unit engages each round.
class FindWeakestEnemyBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'getVisibleEnemiesInRange'
    ];

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';
        const usePercentage = params.usePercentage !== false;
        const maxHealthPercent = params.maxHealthPercent ?? 1.0;

        const combat = game.getComponent(entityId, 'combat');
        const range = params.range ?? (combat?.visionRange || 300);

        const myPos = game.getComponent(entityId, 'transform')?.position;
        const enemyIds = this.call.getVisibleEnemiesInRange( entityId, range);

        let bestId = null;
        let bestMetric = Infinity;
        let bestDistSq = 0;
        let bestPercent = 0;
        const myDef = game.getUnitTypeDef(game.getComponent(entityId, 'unitType'));
        const canHitAir = !!(myDef?.canTargetAir || myDef?.isFlying);
        if (enemyIds) {
            for (const eid of enemyIds) {
                // Air rule (Mechabellum): only air-capable attackers see flyers.
                if (!canHitAir) {
                    const targetDef = game.getUnitTypeDef(game.getComponent(eid, 'unitType'));
                    if (targetDef?.isFlying) continue;
                }
                const health = game.getComponent(eid, 'health');
                if (!health || health.current <= 0) continue;
                const max = health.max || health.current;
                const percent = max > 0 ? health.current / max : 1;
                if (percent > maxHealthPercent) continue;
                const metric = usePercentage ? percent : health.current;

                const pos = game.getComponent(eid, 'transform')?.position;
                let distSq = 0;
                if (myPos && pos) {
                    const dx = pos.x - myPos.x, dz = pos.z - myPos.z;
                    distSq = dx * dx + dz * dz;
                }
                // Lowest health wins; ties broken by entity id for lockstep determinism.
                if (metric < bestMetric || (metric === bestMetric && (bestId == null || eid < bestId))) {
                    bestMetric = metric;
                    bestId = eid;
                    bestDistSq = distSq;
                    bestPercent = percent;
                }
            }
        }

        if (bestId != null) {
            const shared = this.getShared(entityId, game);
            shared[targetKey] = bestId;

            return this.success({
                target: bestId,
                distance: Math.sqrt(bestDistSq),
                healthPercent: bestPercent,
                range
            });
        }

        return this.failure();
    }
}
