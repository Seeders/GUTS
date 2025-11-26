/**
 * FindNearestEnemyAction - Targeting action
 * Finds the nearest enemy and stores it in shared state
 *
 * Parameters:
 *   range: number (default: uses combat.visionRange or 300) - Search range
 *   targetKey: string (default: 'target') - Key to store target in shared state
 *
 * Returns SUCCESS if enemy found, FAILURE otherwise
 */
class FindNearestEnemyAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const pos = game.getComponent(entityId, 'position');
        const team = game.getComponent(entityId, 'team');
        const combat = game.getComponent(entityId, 'combat');

        if (!pos || !team) {
            return this.failure();
        }

        const range = params.range !== undefined ? params.range : (combat?.visionRange || 300);

        const nearestEnemy = this.findNearestEnemy(entityId, game, pos, team, range);

        if (nearestEnemy) {
            const shared = this.getShared(entityId, game);
            shared[targetKey] = nearestEnemy.id;

            return this.success({
                target: nearestEnemy.id,
                distance: nearestEnemy.distance,
                range
            });
        }

        return this.failure();
    }

    findNearestEnemy(entityId, game, pos, team, range) {
        const potentialTargets = game.getEntitiesWith('position', 'team', 'health');
        const sortedTargets = potentialTargets.sort((a, b) => String(a).localeCompare(String(b)));

        let nearest = null;
        let nearestDistance = Infinity;

        for (const targetId of sortedTargets) {
            if (targetId === entityId) continue;

            const targetTeam = game.getComponent(targetId, 'team');
            if (targetTeam.team === team.team) continue;

            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) continue;

            const targetDeathState = game.getComponent(targetId, 'deathState');
            if (targetDeathState && targetDeathState.isDying) continue;

            const targetPos = game.getComponent(targetId, 'position');
            const distance = this.distance(pos, targetPos);

            if (distance <= range && distance < nearestDistance) {
                nearestDistance = distance;
                nearest = { id: targetId, distance };
            }
        }

        return nearest;
    }

    distance(pos1, pos2) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
