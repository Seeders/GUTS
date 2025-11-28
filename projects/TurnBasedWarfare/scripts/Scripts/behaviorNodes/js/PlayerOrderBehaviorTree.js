class PlayerOrderBehaviorTree extends GUTS.BaseBehaviorTree {
    /**
     * Behavior tree for player-issued orders.
     * Checks for different types of player orders and executes them in priority:
     * 1. Build orders (peasants constructing buildings)
     * 2. Hold position orders (unit stays in place)
     * 3. Move orders (unit moves to target position)
     *
     * If no player order exists or order is completed, returns null to allow
     * other behaviors (like combat) to take over.
     */
    evaluate(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');

        // No player order component - skip this tree
        if (!playerOrder) {
            return null;
        }

        // Use base class evaluate which handles the selector pattern
        return super.evaluate(entityId, game);
    }
}
