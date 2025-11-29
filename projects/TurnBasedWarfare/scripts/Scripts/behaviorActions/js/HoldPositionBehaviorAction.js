class HoldPositionBehaviorAction extends GUTS.BaseBehaviorAction {
    /**
     * Action to hold position - prevents unit from moving
     * Activated when player issues a "hold position" order
     */
    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');

        // Check if this is a hold position order
        if (!playerOrder || !playerOrder.meta || playerOrder.meta.allowMovement !== false) {
            return this.failure();
        }

        // Stop movement
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.anchored = true;
            vel.vx = 0;
            vel.vz = 0;
        }

        // Clear pathfinding
        const pathfinding = game.getComponent(entityId, 'pathfinding');
        if (pathfinding) {
            pathfinding.path = [];
        }

        // Return success - unit is holding position
        // This will prevent combat and other behaviors from taking over
        return this.success({
            holdingPosition: true,
            position: game.getComponent(entityId, 'position')
        });
    }
}
