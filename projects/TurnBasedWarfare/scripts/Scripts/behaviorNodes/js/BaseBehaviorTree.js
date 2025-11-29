class BaseBehaviorTree extends GUTS.BaseBehaviorNode {
    constructor(game, config = {}) {
        super(game, config);

        // BaseBehaviorNode already handles most initialization
        // We just need to maintain compatibility for legacy code
    }

    onBattleStart() {
    }

    onBattleEnd(entityId, game) {
        // Clear running state when battle ends
        this.runningState.delete(entityId);
    }

    onPlacementPhaseStart(entityId, game) {
    }

    /**
     * Process an action and return standardized result
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @param {string} actionName - Name of the action
     * @param {object} actionInstance - The action instance
     * @returns {Object|null} Result with action, status, and meta
     */
    processAction(entityId, game, actionName, actionInstance) {
        const result = actionInstance.execute(entityId, game);

        if (result === null) {
            return null; // Failure
        }

        // Normalize result to include status if not present (backwards compatibility)
        return {
            action: result.action || actionName,
            status: result.status || 'success',
            meta: result.meta || result
        };
    }

    /**
     * Override evaluateComposite to use legacy tree behavior
     * BaseBehaviorNode calls this when node has children array
     */
    evaluateComposite(entityId, game) {
        // Use the selector pattern from BaseBehaviorNode
        return super.evaluateSelector(entityId, game);
    }

    /**
     * Legacy evaluate method - now delegates to BaseBehaviorNode
     * Kept for backwards compatibility
     */
    evaluate(entityId, game) {
        this.pathSize = game.gameManager?.call('getPlacementGridSize');

        // BaseBehaviorNode.evaluate() will call our evaluateComposite
        return super.evaluate(entityId, game);
    }

    // Note: Most methods now inherited from BaseBehaviorNode
    // Legacy helper methods kept for backwards compatibility:

    /**
     * Helper for creating ad-hoc selectors
     * @deprecated Use BaseBehaviorNode methods instead
     */
    select(checks) {
        for (const check of checks) {
            const result = check();
            if (result !== null) {
                return result;
            }
        }
        return null;
    }

    /**
     * Helper for creating ad-hoc sequences
     * @deprecated Use BaseBehaviorNode methods instead
     */
    sequence(checks) {
        let lastResult = null;
        for (const check of checks) {
            const result = check();
            if (result === null) {
                return null;
            }
            lastResult = result;
        }
        return lastResult;
    }

    /**
     * Helper for creating ad-hoc conditions
     * @deprecated Use BaseBehaviorNode methods instead
     */
    condition(condition, onSuccess) {
        if (condition()) {
            return onSuccess();
        }
        return null;
    }
}
