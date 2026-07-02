/**
 * HasBuildOrderBehaviorAction - Condition check for valid build order
 *
 * Checks if entity has a valid build order with:
 * - buildingState.pendingGridPosition exists (pending building to spawn), OR
 * - buildingState.targetBuildingEntityId exists (not -1) and building is under construction
 *
 * Returns SUCCESS if valid build order exists, FAILURE otherwise
 */
class HasBuildOrderBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const buildingState = game.getComponent(entityId, 'buildingState');

        if (!buildingState) {
            return this.failure();
        }

        // Check for pending building (deferred spawn - building will be created when builder arrives)
        // pendingUnitTypeId is set when there's a pending build order
        if (buildingState.pendingUnitTypeId != null) {
            return this.success();
        }

        // Check for active building under construction
        if (buildingState.targetBuildingEntityId === -1) {
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
