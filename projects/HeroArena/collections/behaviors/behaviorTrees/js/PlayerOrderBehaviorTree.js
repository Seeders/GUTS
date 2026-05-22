class PlayerOrderBehaviorTree extends GUTS.BaseBehaviorTree {
    static serviceDependencies = [
        'getNodeByType'
    ];

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
        const log = GUTS.HeadlessLogger;
        const playerOrder = game.getComponent(entityId, 'playerOrder');

        log.trace('PlayerOrderBT', `${entityId} evaluate`, {
            hasOrder: !!playerOrder,
            enabled: playerOrder?.enabled,
            isMoveOrder: playerOrder?.isMoveOrder,
            completed: playerOrder?.completed
        });

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
        // A build order exists if we have an active building target OR a pending building to spawn
        const isBuildOrder = buildingState && (buildingState.targetBuildingEntityId !== -1 || buildingState.pendingUnitTypeId != null);

        // Hidden units should not engage in combat - skip enemy detection entirely
        if (!isForceMove && !isBuildOrder && !playerOrder.isHiding) {
            // Use FindNearestEnemyBehaviorAction which both checks for enemies AND sets shared.target
            // This ensures CombatBehaviorTree has a target to use
            const findEnemy = this.call.getNodeByType( 'FindNearestEnemyBehaviorAction');
            if (findEnemy) {
                const findResult = findEnemy.execute(entityId, game);
                if (findResult && findResult.status === 'success') {
                    // Enemy found and shared.target is now set - let combat take over
                    // IMPORTANT: Clear our running state so we don't resume MoveBehaviorAction
                    // when we should be yielding to combat
                    GUTS.HeadlessLogger.debug('PlayerOrderBT', `${entityId} YIELDING - enemy found`, { target: findResult.data?.target });
                    this.runningState.delete(entityId);
                    return null;
                }
            }

            // If no visible enemy, check if we were recently attacked
            // This allows ranged units to respond to attackers they can't see
            const investigateAttacker = this.call.getNodeByType( 'InvestigateAttackerBehaviorAction');
            if (investigateAttacker) {
                const investigateResult = investigateAttacker.execute(entityId, game);
                if (investigateResult && investigateResult.status === 'success') {
                    // Attacker set as target - yield to combat so we can pursue them
                    GUTS.HeadlessLogger.debug('PlayerOrderBT', `${entityId} YIELDING - investigating attacker`, { target: investigateResult.data?.target });
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
