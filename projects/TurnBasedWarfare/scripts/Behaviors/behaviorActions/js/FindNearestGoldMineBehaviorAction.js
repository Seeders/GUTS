/**
 * Find Nearest Gold Mine Action
 * Finds the nearest gold mine belonging to the entity's team and stores it in shared state
 *
 * Sets in shared state:
 *   - targetMine: entityId of the gold mine
 *   - targetMinePosition: {x, z} position of the mine
 *
 * Returns:
 *   - SUCCESS if a gold mine was found
 *   - FAILURE if no gold mine exists for this team
 */
class FindNearestGoldMineBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const pos = game.getComponent(entityId, 'position');
        const team = game.getComponent(entityId, 'team');

        if (!pos || !team) {
            return this.failure();
        }

        // Get all gold mine entities
        const goldMineEntities = game.getEntitiesWith('goldMine', 'position', 'team');

        if (!goldMineEntities || goldMineEntities.size === 0) {
            return this.failure();
        }

        // Sort for deterministic iteration
        const sortedMineIds = Array.from(goldMineEntities).sort((a, b) =>
            String(a).localeCompare(String(b))
        );

        let closestMine = null;
        let closestPosition = null;
        let closestDistance = Infinity;

        // Find nearest mine belonging to our team
        for (const mineId of sortedMineIds) {
            const mineTeam = game.getComponent(mineId, 'team');
            const minePos = game.getComponent(mineId, 'position');

            if (mineTeam && mineTeam.team === team.team) {
                const distance = this.distance(pos, minePos);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestMine = mineId;
                    closestPosition = { x: minePos.x, z: minePos.z };
                }
            }
        }

        if (!closestMine) {
            return this.failure();
        }

        // Store in shared state
        const shared = this.getShared(entityId, game);
        shared.targetMine = closestMine;
        shared.targetMinePosition = closestPosition;
        shared.targetPosition = closestPosition; // For movement

        return this.success({
            targetMine: closestMine,
            targetPosition: closestPosition,
            distance: closestDistance
        });
    }
}
