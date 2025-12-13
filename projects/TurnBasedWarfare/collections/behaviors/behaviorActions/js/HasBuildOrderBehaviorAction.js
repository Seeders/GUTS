/**
 * HasBuildOrderBehaviorAction - Condition check for valid build order
 *
 * Checks if entity has a valid build order with:
 * - buildingState.targetBuildingEntityId exists (not -1)
 * - Building exists and is under construction
 *
 * Returns SUCCESS if valid build order exists, FAILURE otherwise
 */
class HasBuildOrderBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const buildingState = game.getComponent(entityId, 'buildingState');

        // Check if we have a build order
        if (!buildingState || buildingState.targetBuildingEntityId === -1) {
            return this.failure();
        }

        const buildingId = buildingState.targetBuildingEntityId;
        const buildingPlacement = game.getComponent(buildingId, 'placement');

        // Check if building exists and is under construction
        if (!buildingPlacement || !buildingPlacement.isUnderConstruction) {
            return this.failure();
        }

        return this.success();
    }
}
