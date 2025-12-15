class PlayerOrderBehaviorTree extends GUTS.BaseBehaviorTree {
    /**
     * Behavior tree for player-issued orders.
     * Checks for different types of player orders and executes them in priority:
     * 1. Build orders (peasants constructing buildings)
     * 2. Hold position orders (unit stays in place)
     * 3. Move orders (unit moves to target position)
     *
     * For normal move orders, checks if enemies are nearby first.
     * If enemies present, fails to let CombatBehaviorAction take over.
     * Force moves ignore enemies and proceed regardless.
     *
     * If no player order exists or order is completed, returns null to allow
     * other behaviors (like combat) to take over.
     */
    evaluate(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');

        // No player order component or order not enabled - skip this tree
        if (!playerOrder || !playerOrder.enabled) {
            // IMPORTANT: Clear our running state when yielding - otherwise the parent
            // selector might resume us when we should be skipped
            this.runningState.delete(entityId);
            return null;
        }

        // Check for nearby enemies unless this is a force move or build order
        // If enemies are nearby, yield to combat behavior
        const isForceMove = playerOrder.preventEnemiesInRangeCheck;
        const buildingState = game.getComponent(entityId, 'buildingState');
        const isBuildOrder = buildingState && buildingState.targetBuildingEntityId !== -1;

        if (!isForceMove && !isBuildOrder) {
            // Use FindNearestEnemyBehaviorAction which both checks for enemies AND sets shared.target
            // This ensures CombatBehaviorTree has a target to use
            const findEnemy = game.call('getNodeByType', 'FindNearestEnemyBehaviorAction');
            if (findEnemy) {
                const findResult = findEnemy.execute(entityId, game);
                if (findResult && findResult.status === 'success') {
                    // Enemy found and shared.target is now set - let combat take over
                    // IMPORTANT: Clear our running state so we don't resume MoveBehaviorAction
                    // when we should be yielding to combat
                    this.runningState.delete(entityId);
                    return null;
                }
            }
        }

        // Use base class evaluate which handles the selector pattern
        // This evaluates: BuildSequence -> HoldPositionBehaviorAction -> MoveBehaviorAction
        return super.evaluate(entityId, game);
    }
}
