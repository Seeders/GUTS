/**
 * Base class for all unit actions
 * Actions perform specific unit behaviors with consistent state management:
 *
 * STATE MANAGEMENT PATTERN:
 * - controller.actionData: Read-only input from behavior tree (initial config)
 * - aiState.meta: Read-write state for action-specific variables
 *
 * LIFECYCLE:
 * 1. onStart(): Initialize aiState.meta properties
 * 2. execute(): Read/modify aiState.meta as needed
 * 3. onEnd(): Clean up aiState.meta properties (delete them)
 *
 * EXAMPLE:
 * onStart(entityId, controller, game) {
 *     const aiState = game.getComponent(entityId, 'aiState');
 *     aiState.meta.myState = 'initial';
 * }
 *
 * execute(entityId, controller, game, dt) {
 *     const aiState = game.getComponent(entityId, 'aiState');
 *     if (aiState.meta.myState === 'initial') {
 *         aiState.meta.myState = 'processing';
 *     }
 * }
 *
 * onEnd(entityId, controller, game) {
 *     const aiState = game.getComponent(entityId, 'aiState');
 *     delete aiState.meta.myState;
 * }
 */
class BaseBehaviorAction {
    constructor(game, parameters = {}) {
        this.game = game;
        this.parameters = parameters;
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
     * @param {object} controller - UnitController component
     * @param {object} game - Game instance
     * @param {number} dt - Delta time
     * @returns {object} Result object with { complete: boolean, failed?: boolean }
     */
    execute(entityId, controller, game, dt) {
        return { complete: false };
    }

    /**
     * Called when action starts (optional)
     * @param {string} entityId - Entity ID
     * @param {object} controller - UnitController component
     * @param {object} game - Game instance
     */
    onStart(entityId, controller, game) {
        // Override in subclass if needed
    }

    /**
     * Clean up when action ends
     * @param {string} entityId - Entity ID
     * @param {object} controller - UnitController component
     * @param {object} game - Game instance
     */
    onEnd(entityId, controller, game) {
        // Override in subclass
    }

    /**
     * Get action type
     * @returns {string} Action type
     */
    static get TYPE() {
        return 'BASE';
    }

    /**
     * Get action priority
     * @returns {number} Priority value (higher = more important)
     */
    static get PRIORITY() {
        return 0;
    }
}
