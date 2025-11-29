/**
 * Base class for behavior tree decorators
 * Decorators wrap a single child node and modify its behavior
 *
 * Extends BaseBehaviorNode for unified behavior tree interface
 */
class BaseBehaviorDecorator extends GUTS.BaseBehaviorNode {

    constructor(game, config = {}) {
        super(game, config);

        // BaseBehaviorNode already handles child setup via config.child
        // No additional initialization needed
    }

    /**
     * Override evaluateDecorator - called by BaseBehaviorNode for decorator nodes
     * Delegates to execute() for decorator-specific logic
     */
    evaluateDecorator(entityId, game) {
        return this.execute(entityId, game);
    }

    /**
     * Execute the decorator - override in subclasses
     * Default behavior: pass through to child
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {Object|null} Modified result
     */
    execute(entityId, game) {
        // Default: pass through to child using parent's evaluateChild
        return this.evaluateChild(entityId, game, this.child);
    }

    // Note: getMemory, getShared, success, running, failure, onStart, onEnd
    // are now inherited from BaseBehaviorNode
}
