/**
 * SetBuildTargetBehaviorAction - Gets building info from buildingState and stores in shared state
 *
 * Handles two cases:
 * 1. Pending building (deferred spawn) - uses pendingGridPosition to calculate target
 * 2. Active building under construction - uses existing building entity position
 *
 * Stores in shared state:
 * - shared.targetBuilding - Building entity ID (or -1 for pending)
 * - shared.targetPosition - Building position (for MoveToSharedTargetBehaviorAction)
 * - shared.buildTime - Construction time required
 *
 * Returns SUCCESS if target was set, FAILURE if no valid building
 */
class SetBuildTargetBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'placementGridToWorld'
    ];

    execute(entityId, game) {
        const buildingState = game.getComponent(entityId, 'buildingState');

        if (!buildingState) {
            return this.failure();
        }

        const shared = this.getShared(entityId, game);

        // Case 1: Pending building (deferred spawn - building will be created when we arrive)
        if (buildingState.pendingUnitTypeId != null) {
            const gridPos = buildingState.pendingGridPosition;
            const worldPos = this.call.placementGridToWorld( gridPos.x, gridPos.z);

            shared.targetBuilding = -1; // No building entity yet
            shared.targetPosition = { x: worldPos.x, z: worldPos.z };
            shared.buildTime = buildingState.buildTime || this.parameters.defaultBuildTime || 5;

            return this.success();
        }

        // Case 2: Active building under construction
        if (buildingState.targetBuildingEntityId === -1) {
            return this.failure();
        }

        const buildingId = buildingState.targetBuildingEntityId;
        const buildingTransform = game.getComponent(buildingId, 'transform');
        const buildingPos = buildingTransform?.position;
        const buildingPlacement = game.getComponent(buildingId, 'placement');

        if (!buildingPos || !buildingPlacement) {
            return this.failure();
        }

        // Store in shared state
        shared.targetBuilding = buildingId;
        shared.targetPosition = { x: buildingPos.x, z: buildingPos.z };
        shared.buildTime = buildingState.buildTime || buildingPlacement.buildTime || this.parameters.defaultBuildTime || 5;

        return this.success();
    }
}
