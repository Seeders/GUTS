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

    execute(entityId, game) {
        const params = this.parameters || {};
        const minCount = params.minCount || 1;
        const storeNearest = params.storeNearest || false;
        const targetKey = params.targetKey || 'target';

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const team = game.getComponent(entityId, 'team');
        const combat = game.getComponent(entityId, 'combat');

        if (!pos || !team) {
            return this.failure();
        }

        const range = combat.visionRange;

        const enemies = this.findEnemiesInRange(entityId, game, pos, team, range);

        if (enemies.length >= minCount) {
            const result = {
                enemyCount: enemies.length,
                range
            };

            if (storeNearest && enemies.length > 0) {
                const shared = this.getShared(entityId, game);
                shared[targetKey] = enemies[0].id;
                result.nearestEnemy = enemies[0].id;
                result.nearestDistance = enemies[0].distance;
            }

            return this.success(result);
        }

        return this.failure();
    }

    findEnemiesInRange(entityId, game, pos, team, range) {
        // Use spatial grid for efficient lookup - returns array of entityIds
        const nearbyEntityIds = game.gameManager.call('getNearbyUnits', pos, range, entityId);
        if (!nearbyEntityIds || nearbyEntityIds.length === 0) return [];

        const enemies = [];

        for (const targetId of nearbyEntityIds) {
            const targetTeam = game.getComponent(targetId, 'team');
            if (!targetTeam || targetTeam.team === team.team) continue;

            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) continue;

            const targetDeathState = game.getComponent(targetId, 'deathState');
            if (targetDeathState && targetDeathState.isDying) continue;

            const targetTransform = game.getComponent(targetId, 'transform');
            const targetPos = targetTransform?.position;
            if (!targetPos) continue;

            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            enemies.push({ id: targetId, distance });
        }

        // Sort by distance
        enemies.sort((a, b) => a.distance - b.distance);

        return enemies;
    }
}
