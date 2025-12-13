/**
 * SetBuildTargetBehaviorAction - Gets building info from buildingState and stores in shared state
 *
 * Reads buildingState.targetBuildingEntityId and stores:
 * - shared.targetBuilding - Building entity ID
 * - shared.targetPosition - Building position (for MoveToSharedTargetBehaviorAction)
 * - shared.buildTime - Construction time required
 *
 * Returns SUCCESS if target was set, FAILURE if no valid building
 */
class SetBuildTargetBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const buildingState = game.getComponent(entityId, 'buildingState');

        if (!buildingState || buildingState.targetBuildingEntityId === -1) {
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
        const shared = this.getShared(entityId, game);
        shared.targetBuilding = buildingId;
        shared.targetPosition = { x: buildingPos.x, z: buildingPos.z };
        shared.buildTime = buildingState.buildTime || buildingPlacement.buildTime || this.parameters.defaultBuildTime || 5;

        return this.success();
    }
}
