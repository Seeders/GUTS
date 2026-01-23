/**
 * Find Nearest Depot Action
 * Finds the nearest depot (town hall, keep, castle) belonging to the entity's team and stores it in shared state
 *
 * Sets in shared state:
 *   - targetDepot: entityId of the depot
 *   - targetDepotPosition: {x, z} position of the depot
 *   - targetPosition: same as targetDepotPosition (for movement)
 *
 * Parameters:
 *   - depotCategory: string - unitType.category to look for (default: 'townhall')
 *
 * Returns:
 *   - SUCCESS if a depot was found
 *   - FAILURE if no depot exists for this team
 */
class FindNearestDepotBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'getUnitTypeDef'
    ];

    execute(entityId, game) {
        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const team = game.getComponent(entityId, 'team');

        if (!pos || !team) {
            return this.failure();
        }

        const depotCategory = this.parameters.depotCategory || 'townhall';

        // Get all entities that could be depots
        const depotEntities = game.getEntitiesWith('transform', 'team', 'unitType');

        if (!depotEntities || depotEntities.length === 0) {
            return this.failure();
        }

        let closestDepot = null;
        let closestPosition = null;
        let closestDistance = Infinity;

        // Find nearest depot belonging to our team
        for (const depotId of depotEntities) {
            const depotTeam = game.getComponent(depotId, 'team');
            const depotUnitTypeComp = game.getComponent(depotId, 'unitType');
            const depotUnitType = this.call.getUnitTypeDef( depotUnitTypeComp);
            const depotTransform = game.getComponent(depotId, 'transform');
            const depotPos = depotTransform?.position;

            if (!depotTeam || depotTeam.team !== team.team || !depotUnitType) {
                continue;
            }

            // Match by category (townhall includes townHall, keep, castle)
            if (depotUnitType.category === depotCategory) {
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
        shared.targetPosition = closestPosition;

        return this.success({
            targetDepot: closestDepot,
            targetPosition: closestPosition,
            distance: closestDistance
        });
    }
}
