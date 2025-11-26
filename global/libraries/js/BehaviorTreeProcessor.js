/**
 * Shared Behavior Tree Processor
 * Used by both the game (BehaviorSystem) and editor (simulation)
 *
 * This is a thin wrapper that finds and instantiates behavior tree classes,
 * then delegates to BaseBehaviorTree.evaluate() for actual evaluation.
 * The same BaseBehaviorTree class is used in both runtime and editor.
 */
class BehaviorTreeProcessor {
    /**
     * Evaluate a behavior tree and return the selected action
     * @param {Object} treeData - The full behavior tree data (including behaviorActions array)
     * @param {Object|MockGameContext} gameContext - Game context with ECS methods and gameManager
     * @param {string} rootNode - Unused (kept for backward compatibility)
     * @param {string} entityId - Entity ID to evaluate for
     * @returns {Object} - { success: boolean, action: string, target: any, priority: number, activePath: string[] }
     */
    static evaluate(treeData, gameContext, rootNode = 'root', entityId = null) {
        // Find and instantiate the behavior tree class
        const TreeClass = this.findClass(treeData.fileName);

        if (!TreeClass) {
            console.warn(`Behavior tree script not found: ${treeData.fileName}`);
            return { success: false, action: null, activePath: [] };
        }

        // Instantiate the tree with game context and config (same as BehaviorSystem does)
        // treeData contains behaviorActions array which BaseBehaviorTree.evaluate() uses
        const tree = new TreeClass(gameContext, treeData);

        // Use mock entity ID if not provided
        if (!entityId) {
            entityId = gameContext.currentEntityId || Array.from(gameContext.entities?.keys() || [])[0] || 'mock-entity-1';
        }

        // Evaluate the tree using BaseBehaviorTree.evaluate()
        // This iterates through config.behaviorActions - same code path as runtime
        const result = tree.evaluate(entityId, gameContext);

        // Convert the result to our standard format
        return {
            success: result !== null && result.action !== null,
            action: result ? result.action : null,
            target: result ? result.target : null,
            priority: result ? result.priority : 0,
            data: result ? result.data : null,
            activePath: result ? result.activePath : []
        };
    }

    /**
     * Find a class by name (behavior tree, action, etc.)
     * Used by both BehaviorSystem (runtime) and editor (simulation)
     * @param {string} className - The class name to find
     * @returns {Function|null} - The class constructor or null
     */
    static findClass(className) {
        if (!className) return null;

        // Try GUTS global first (e.g., GUTS.UniversalBehaviorTree, GUTS.CombatBehaviorAction)
        if (typeof GUTS !== 'undefined' && GUTS[className]) {
            return GUTS[className];
        }

        // Try window global
        if (typeof window !== 'undefined' && window[className]) {
            return window[className];
        }

        return null;
    }

    /**
     * Capitalize first letter
     * @private
     */
    static capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BehaviorTreeProcessor;
}

// Also make available on GUTS global if it exists
if (typeof GUTS !== 'undefined') {
    GUTS.BehaviorTreeProcessor = BehaviorTreeProcessor;
}
