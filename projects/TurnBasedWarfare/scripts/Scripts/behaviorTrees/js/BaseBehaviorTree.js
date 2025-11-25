class BaseBehaviorTree {
    constructor(game, treeData = {}) {
        this.game = game;
        this.treeData = treeData;
    }

    onBattleStart() {
        
    }
    onBattleEnd(entityId, game) {
    
    }

    onPlacementPhaseStart() {

    }
    /**
     * Evaluate the behavior tree and return the desired action
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {object} Action descriptor: { action: string, target: any, priority: number, data?: object }
     */
    evaluate(entityId, game) {
        // Override in subclass
        return { action: 'IDLE', priority: 0 };
    }

    /**
     * Selector node: evaluates all checks and returns the highest priority action
     * @param {Array<Function>} checks - Array of functions that return action descriptors or null
     * @returns {object|null} Highest priority action descriptor, or null if none available
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
     * Sequence node: executes children in order until one fails
     * @param {Array<Function>} checks - Array of functions that return action descriptors or null
     * @returns {object|null} Last successful action descriptor or null if any failed
     */
    sequence(checks) {
        let lastResult = null;
        for (const check of checks) {
            const result = check();
            if (result === null) {
                return null; // Failed, stop sequence
            }
            lastResult = result;
        }
        return lastResult;
    }

    /**
     * Condition node: evaluate a condition and return action if true
     * @param {Function} condition - Function that returns boolean
     * @param {Function} onSuccess - Function to call if condition is true
     * @returns {object|null} Action descriptor if condition succeeds, null otherwise
     */
    condition(condition, onSuccess) {
        if (condition()) {
            return onSuccess();
        }
        return null;
    }

    /**
     * Helper to calculate distance between two positions
     * @param {object} pos1 - Position with x, z properties
     * @param {object} pos2 - Position with x, z properties
     * @returns {number} Distance
     */
    distance(pos1, pos2) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
