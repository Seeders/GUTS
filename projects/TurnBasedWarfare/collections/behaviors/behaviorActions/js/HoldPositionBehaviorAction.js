class HoldPositionBehaviorAction extends GUTS.BaseBehaviorAction {
    /**
     * Action to hold position - prevents unit from moving
     * Activated when player issues a "hold position" order
     */
    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');

        // Check if this is a hold position order
        // Hold position orders have isMoveOrder set to 0 (false) and targetPosition at current location
        if (!playerOrder || playerOrder.isMoveOrder === 1) {
            return this.failure();
        }

        // Stop movement
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.vx = 0;
            vel.vz = 0;
        }

        // Clear pathfinding
        game.call('clearEntityPath', entityId);

        // Return success - unit is holding position
        // This will prevent combat and other behaviors from taking over
        const transform = game.getComponent(entityId, 'transform');
        return this.success({
            holdingPosition: true,
            position: transform?.position
        });
    }
}
