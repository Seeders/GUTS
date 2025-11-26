/**
 * FindWeakestEnemyAction - Targeting action
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
class FindWeakestEnemyAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';
        const usePercentage = params.usePercentage !== false;
        const maxHealthPercent = params.maxHealthPercent !== undefined ? params.maxHealthPercent : 1.0;

        const pos = game.getComponent(entityId, 'position');
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
        const potentialTargets = game.getEntitiesWith('position', 'team', 'health');
        const enemies = [];

        for (const targetId of potentialTargets) {
            if (targetId === entityId) continue;

            const targetTeam = game.getComponent(targetId, 'team');
            if (targetTeam.team === team.team) continue;

            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) continue;

            const targetDeathState = game.getComponent(targetId, 'deathState');
            if (targetDeathState && targetDeathState.isDying) continue;

            const targetPos = game.getComponent(targetId, 'position');
            const distance = this.distance(pos, targetPos);

            if (distance > range) continue;

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

    distance(pos1, pos2) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
