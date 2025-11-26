/**
 * Base class for behavior tree decorators
 * Decorators wrap a single child action and modify its behavior
 */
class BaseBehaviorDecorator {
    // Status constants (same as BaseBehaviorAction)
    static STATUS = {
        SUCCESS: 'success',
        FAILURE: 'failure',
        RUNNING: 'running'
    };

    constructor(game, config) {
        this.game = game;
        this.config = config;
        this.parameters = config.parameters || {};
        if (typeof this.parameters === 'string') {
            this.parameters = JSON.parse(this.parameters);
        }

        // The child action this decorator wraps
        this.childActionType = config.childAction || null;

        // Per-entity memory storage
        this.entityMemory = new Map();
        this.memoryDefaults = config.memory || {};
    }

    /**
     * Get or create memory for an entity
     * @param {string} entityId - Entity ID
     * @returns {Object} Memory object for this entity
     */
    getMemory(entityId) {
        if (!this.entityMemory.has(entityId)) {
            this.entityMemory.set(entityId, JSON.parse(JSON.stringify(this.memoryDefaults)));
        }
        return this.entityMemory.get(entityId);
    }

    /**
     * Clear memory for an entity
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
     * Get the child action instance
     * @param {object} game - Game instance
     * @returns {Object|null} Child action instance
     */
    getChildAction(game) {
        if (!this.childActionType) return null;
        return game.gameManager.call('getActionByType', this.childActionType);
    }

    /**
     * Execute the child action
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {Object|null} Result from child action
     */
    executeChild(entityId, game) {
        const child = this.getChildAction(game);
        if (!child) {
            console.warn(`Decorator child action not found: ${this.childActionType}`);
            return null;
        }
        return child.execute(entityId, game);
    }

    /**
     * Create a success response
     * @param {Object} meta - Additional data
     * @returns {Object} Success response
     */
    success(meta = {}) {
        return {
            action: this.constructor.name,
            status: BaseBehaviorDecorator.STATUS.SUCCESS,
            meta: meta
        };
    }

    /**
     * Create a running response
     * @param {Object} meta - Additional data
     * @returns {Object} Running response
     */
    running(meta = {}) {
        return {
            action: this.constructor.name,
            status: BaseBehaviorDecorator.STATUS.RUNNING,
            meta: meta
        };
    }

    /**
     * Create a failure response
     * @returns {null}
     */
    failure() {
        return null;
    }

    /**
     * Execute the decorator - override in subclasses
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {Object|null} Modified result
     */
    execute(entityId, game) {
        // Default: just pass through to child
        return this.executeChild(entityId, game);
    }

    /**
     * Called when decorator starts
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     */
    onStart(entityId, game) {
        // Override in subclass if needed
    }

    /**
     * Called when decorator ends
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     */
    onEnd(entityId, game) {
        this.clearMemory(entityId);
    }
}
