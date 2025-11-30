/**
 * SetBuildTargetBehaviorAction - Gets building info from playerOrder and stores in shared state
 *
 * Reads playerOrder.meta.buildingId and stores:
 * - shared.targetBuilding - Building entity ID
 * - shared.targetPosition - Building position (for MoveToSharedTargetBehaviorAction)
 * - shared.buildTime - Construction time required
 *
 * Returns SUCCESS if target was set, FAILURE if no valid building
 */
class SetBuildTargetBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');

        if (!playerOrder || !playerOrder.meta || !playerOrder.meta.buildingId) {
            return this.failure();
        }

        const buildingId = playerOrder.meta.buildingId;
        const buildingPos = game.getComponent(buildingId, 'position');
        const buildingPlacement = game.getComponent(buildingId, 'placement');

        if (!buildingPos || !buildingPlacement) {
            return this.failure();
        }

        // Store in shared state
        const shared = this.getShared(entityId, game);
        shared.targetBuilding = buildingId;
        shared.targetPosition = { x: buildingPos.x, z: buildingPos.z };
        shared.buildTime = buildingPlacement.buildTime || this.parameters.defaultBuildTime || 5;

        return this.success();
    }
}
