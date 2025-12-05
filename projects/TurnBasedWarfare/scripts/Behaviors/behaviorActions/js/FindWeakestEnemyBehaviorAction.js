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

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';
        const usePercentage = params.usePercentage !== false;
        const maxHealthPercent = params.maxHealthPercent !== undefined ? params.maxHealthPercent : 1.0;

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const team = game.getComponent(entityId, 'team');
        const combat = game.getComponent(entityId, 'combat');

        if (!pos || !team) {
            return this.failure();
        }

        const range = params.range !== undefined ? params.range : (combat?.visionRange || 300);

        const weakestEnemy = this.findWeakestEnemy(entityId, game, pos, team, range, usePercentage, maxHealthPercent);

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

    findWeakestEnemy(entityId, game, pos, team, range, usePercentage, maxHealthPercent) {
        // Use spatial grid for efficient lookup - returns array of entityIds
        const nearbyEntityIds = game.gameManager.call('getNearbyUnits', pos, range, entityId);
        if (!nearbyEntityIds || nearbyEntityIds.length === 0) return null;

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

            const healthPercent = targetHealth.current / targetHealth.max;
            if (healthPercent > maxHealthPercent) continue;

            enemies.push({
                id: targetId,
                distance,
                healthPercent,
                healthCurrent: targetHealth.current
            });
        }

        if (enemies.length === 0) return null;

        // Sort by health (lowest first), then by distance
        enemies.sort((a, b) => {
            const healthDiff = usePercentage
                ? a.healthPercent - b.healthPercent
                : a.healthCurrent - b.healthCurrent;
            if (Math.abs(healthDiff) > 0.01) return healthDiff;
            return a.distance - b.distance;
        });

        return enemies[0];
    }
}
