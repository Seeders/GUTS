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
        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const team = game.getComponent(entityId, 'team');

        if (!pos || !team) {
            console.log(`[FindNearestGoldMine] Entity ${entityId}: FAILURE - no pos or team`);
            return this.failure();
        }

        // Get all gold mine entities
        const goldMineEntities = game.getEntitiesWith('goldMine', 'transform', 'team');

        console.log(`[FindNearestGoldMine] Entity ${entityId}: Found ${goldMineEntities?.length || 0} gold mines, my team=${team.team}`);

        if (!goldMineEntities || goldMineEntities.length === 0) {
            console.log(`[FindNearestGoldMine] Entity ${entityId}: FAILURE - no gold mines found`);
            return this.failure();
        }

        // OPTIMIZATION: Use numeric sort since entity IDs are numbers (still deterministic, much faster)
        const sortedMineIds = Array.from(goldMineEntities).sort((a, b) => a - b);

        let closestMine = null;
        let closestPosition = null;
        let closestDistance = Infinity;

        // Find nearest mine belonging to our team
        for (const mineId of sortedMineIds) {
            const mineTeam = game.getComponent(mineId, 'team');
            const mineTransform = game.getComponent(mineId, 'transform');
            const minePos = mineTransform?.position;

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
            console.log(`[FindNearestGoldMine] Entity ${entityId}: FAILURE - no mine for team ${team.team}`);
            return this.failure();
        }

        // Store in shared state
        const shared = this.getShared(entityId, game);
        shared.targetMine = closestMine;
        shared.targetMinePosition = closestPosition;
        shared.targetPosition = closestPosition; // For movement

        console.log(`[FindNearestGoldMine] Entity ${entityId}: SUCCESS - found mine ${closestMine} at distance ${closestDistance.toFixed(1)}`);

        return this.success({
            targetMine: closestMine,
            targetPosition: closestPosition,
            distance: closestDistance
        });
    }
}