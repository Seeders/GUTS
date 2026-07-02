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
        'getVisibleEnemiesInRange'
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

            // HeroArena: pick the nearest WITHOUT terrain line-of-sight filtering
            // (see FindNearestEnemyBehaviorAction) so engagement is guaranteed.
            if (storeNearest) {
                const myPos = game.getComponent(entityId, 'transform')?.position;
                let nearestId = null;
                let nearestDistSq = Infinity;
                if (myPos) {
                    for (const eid of enemies) {
                        const pos = game.getComponent(eid, 'transform')?.position;
                        if (!pos) continue;
                        const dx = pos.x - myPos.x, dz = pos.z - myPos.z;
                        const distSq = dx * dx + dz * dz;
                        if (distSq < nearestDistSq || (distSq === nearestDistSq && (nearestId == null || eid < nearestId))) {
                            nearestDistSq = distSq;
                            nearestId = eid;
                        }
                    }
                }
                if (nearestId != null) {
                    const shared = this.getShared(entityId, game);
                    shared[targetKey] = nearestId;
                    result.nearestEnemy = nearestId;
                    result.nearestDistance = Math.sqrt(nearestDistSq);
                }
            }

            return this.success(result);
        }

        return this.failure();
    }
}
