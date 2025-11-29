class BaseBehaviorAction extends GUTS.BaseBehaviorNode {
    // Status constants for behavior tree evaluation
    static STATUS = {
        SUCCESS: 'success',
        FAILURE: 'failure',
        RUNNING: 'running'
    };

    constructor(game, config) {
        super(game, config);

        // BaseBehaviorNode already handles memory, parameters, etc.
        // No additional initialization needed
    }

    // Note: getMemory, getShared, success, running, failure
    // are now inherited from BaseBehaviorNode

    /**
     * Legacy helper - creates success response
     * @deprecated Use success() instead
     */
    actionResponse(meta) {
        return this.success(meta);
    }

    /**
     * Check if this action can execute for the given entity
     * @param {string} entityId - Entity ID
     * @param {object} controller - UnitController component
     * @param {object} game - Game instance
     * @returns {boolean} True if action can execute
     */
    canExecute(entityId, controller, game) {
        return true;
    }

    /**
     * Override evaluateLeaf - called by BaseBehaviorNode for leaf nodes
     * Delegates to execute() for backwards compatibility
     */
    evaluateLeaf(entityId, game) {
        return this.execute(entityId, game);
    }

    /**
     * Execute one tick of the action
     * Override this in subclasses
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {Object|null} Response with status (success/running) or null for failure
     */
    execute(entityId, game) {
        return this.failure();
    }

    // Note: onStart, onEnd, onBattleStart, onBattleEnd, onPlacementPhaseStart
    // are now inherited from BaseBehaviorNode
}
