class BaseBehaviorAction {
    // Status constants for behavior tree evaluation
    static STATUS = {
        SUCCESS: 'success',
        FAILURE: 'failure',
        RUNNING: 'running'
    };

    constructor(game, config) {
        this.game = game;
        this.config = config;
        this.parameters = config.parameters;
        if (typeof this.parameters == 'string') {
            this.parameters = JSON.parse(this.parameters);
        }

        // Per-entity memory storage
        // Key: entityId, Value: memory object initialized from config.memory
        this.entityMemory = new Map();

        // Default memory schema from config (can be overridden in JSON)
        this.memoryDefaults = config.memory || {};
    }

    /**
     * Get or create memory for an entity
     * Memory is initialized from config.memory defaults
     * @param {string} entityId - Entity ID
     * @returns {Object} Memory object for this entity
     */
    getMemory(entityId) {
        if (!this.entityMemory.has(entityId)) {
            // Deep clone the defaults so each entity has its own copy
            this.entityMemory.set(entityId, JSON.parse(JSON.stringify(this.memoryDefaults)));
        }
        return this.entityMemory.get(entityId);
    }

    /**
     * Clear memory for an entity (call on action end or entity death)
     * @param {string} entityId - Entity ID
     */
    clearMemory(entityId) {
        this.entityMemory.delete(entityId);
    }

    /**
     * Get shared data for an entity (shared state between all behavior nodes)
     * Uses aiState.shared component for ECS-friendly shared state
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {Object} Shared data object
     */
    getShared(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        if (aiState) {
            if (!aiState.shared) {
                aiState.shared = {};
            }
            return aiState.shared;
        }
        return {};
    }

    /**
     * Create a success response
     * @param {Object} meta - Additional data to pass with the action
     * @returns {Object} Success response
     */
    success(meta = {}) {
        return {
            action: this.constructor.name,
            status: BaseBehaviorAction.STATUS.SUCCESS,
            meta: meta
        };
    }

    /**
     * Create a running response (action in progress)
     * @param {Object} meta - Additional data to pass with the action
     * @returns {Object} Running response
     */
    running(meta = {}) {
        return {
            action: this.constructor.name,
            status: BaseBehaviorAction.STATUS.RUNNING,
            meta: meta
        };
    }

    /**
     * Create a failure response (return null for selector to try next)
     * @returns {null}
     */
    failure() {
        return null;
    }

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
     * Execute one tick of the action
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {Object|null} Response with status (success/running) or null for failure
     */
    execute(entityId, game) {
        return this.failure();
    }

    /**
     * Called when action starts (optional)
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     */
    onStart(entityId, game) {
        // Override in subclass if needed
    }

    /**
     * Clean up when action ends
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     */
    onEnd(entityId, game) {
        // Clear entity memory by default
        this.clearMemory(entityId);
    }

    onBattleStart(entityId, game) {
    }

    onBattleEnd(entityId, game) {
    }

    onPlacementPhaseStart(entityId, game) {
    }
}
