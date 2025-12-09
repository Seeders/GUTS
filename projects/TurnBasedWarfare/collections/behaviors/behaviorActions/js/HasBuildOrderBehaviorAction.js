/**
 * HasBuildOrderBehaviorAction - Condition check for valid build order
 *
 * Checks if entity has a valid build order with:
 * - playerOrder.meta.buildingId exists
 * - Building exists and is under construction
 *
 * Returns SUCCESS if valid build order exists, FAILURE otherwise
 */
class HasBuildOrderBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');

        // Check if we have a build order
        if (!playerOrder || !playerOrder.meta || !playerOrder.meta.buildingId) {
            return this.failure();
        }

        const buildingId = playerOrder.meta.buildingId;
        const buildingPlacement = game.getComponent(buildingId, 'placement');

        // Check if building exists and is under construction
        if (!buildingPlacement || !buildingPlacement.isUnderConstruction) {
            return this.failure();
        }

        return this.success();
    }
}
