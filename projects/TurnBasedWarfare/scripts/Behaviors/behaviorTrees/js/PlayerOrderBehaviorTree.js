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

        // No player order component - skip this tree
        if (!playerOrder) {
            return null;
        }

        // Check for nearby enemies unless this is a force move or build order
        // If enemies are nearby, yield to combat behavior
        const isForceMove = playerOrder.meta?.preventCombat || playerOrder.meta?.preventEnemiesInRangeCheck;
        const isBuildOrder = playerOrder.meta?.isBuildOrder;

        if (!isForceMove && !isBuildOrder) {
            const isEnemyNearby = game.gameManager.call('getNodeByType', 'IsEnemyNearbyBehaviorAction');
            if (isEnemyNearby) {
                const enemyCheckResult = isEnemyNearby.execute(entityId, game);
                if (enemyCheckResult && enemyCheckResult.status === 'success') {
                    // Enemy nearby - return null to let combat behavior take over
                    return null;
                }
            }
        }

        // Use base class evaluate which handles the selector pattern
        // This evaluates: BuildSequence -> HoldPositionBehaviorAction -> MoveBehaviorAction
        return super.evaluate(entityId, game);
    }
}
