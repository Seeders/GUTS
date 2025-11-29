/**
 * Find Nearest Depot Action
 * Finds the nearest depot (town hall) belonging to the entity's team and stores it in shared state
 *
 * Sets in shared state:
 *   - targetDepot: entityId of the depot
 *   - targetDepotPosition: {x, z} position of the depot
 *   - targetPosition: same as targetDepotPosition (for movement)
 *
 * Parameters:
 *   - depotType: string - unitType.id to look for (default: 'townHall')
 *
 * Returns:
 *   - SUCCESS if a depot was found
 *   - FAILURE if no depot exists for this team
 */
class FindNearestDepotAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const pos = game.getComponent(entityId, 'position');
        const team = game.getComponent(entityId, 'team');

        if (!pos || !team) {
            return this.failure();
        }

        const depotType = this.parameters.depotType || 'townHall';

        // Get all entities that could be depots
        const depotEntities = game.getEntitiesWith('position', 'team', 'unitType');

        if (!depotEntities || depotEntities.size === 0) {
            return this.failure();
        }

        let closestDepot = null;
        let closestPosition = null;
        let closestDistance = Infinity;

        // Find nearest depot belonging to our team
        for (const depotId of depotEntities) {
            const depotTeam = game.getComponent(depotId, 'team');
            const depotUnitType = game.getComponent(depotId, 'unitType');
            const depotPos = game.getComponent(depotId, 'position');

            if (depotTeam &&
                depotTeam.team === team.team &&
                depotUnitType &&
                depotUnitType.id === depotType) {

                const distance = this.distance(pos, depotPos);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestDepot = depotId;
                    closestPosition = { x: depotPos.x, z: depotPos.z };
                }
            }
        }

        if (!closestDepot) {
            return this.failure();
        }

        // Store in shared state
        const shared = this.getShared(entityId, game);
        shared.targetDepot = closestDepot;
        shared.targetDepotPosition = closestPosition;
        shared.targetPosition = closestPosition; // For movement

        return this.success({
            targetDepot: closestDepot,
            targetPosition: closestPosition,
            distance: closestDistance
        });
    }
}
