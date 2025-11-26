/**
 * Behavior Tree Processor
 * Single source of truth for behavior tree evaluation
 * Used by both BehaviorSystem (runtime) and BehaviorTreeEditor (simulation)
 */
class BehaviorTreeProcessor {
    constructor(game) {
        this.game = game;
        this.actions = new Map();
        this.behaviorTrees = new Map();
    }

    /**
     * Initialize from collections (call after construction)
     * @param {Object} collections - Game collections with behaviorActions and behaviorTrees
     */
    initializeFromCollections(collections) {
        // Register behavior actions
        if (collections.behaviorActions) {
            Object.entries(collections.behaviorActions).forEach(([actionId, actionData]) => {
                this.registerAction(actionId, actionData);
            });
        }

        // Register behavior trees
        if (collections.behaviorTrees) {
            Object.entries(collections.behaviorTrees).forEach(([treeId, treeData]) => {
                this.registerBehaviorTree(treeId, treeData);
            });
        }
    }

    /**
     * Register an action executor
     * @param {string} actionId - Action class name (e.g., "CombatBehaviorAction")
     * @param {Object} actionData - Action configuration data
     */
    registerAction(actionId, actionData) {
        const ActionClass = GUTS[actionId];

        if (ActionClass) {
            const actionInstance = new ActionClass(this.game, actionData);
            this.actions.set(actionId, actionInstance);
            console.log(`Registered behavior action: ${actionId}`);
        } else {
            console.warn(`Action class not found for: ${actionId}`);
        }
    }

    /**
     * Register a behavior tree
     * @param {string} treeId - Tree class name (e.g., "UniversalBehaviorTree")
     * @param {Object} treeData - Tree configuration data
     */
    registerBehaviorTree(treeId, treeData) {
        const TreeClass = GUTS[treeId];

        if (TreeClass) {
            const treeInstance = new TreeClass(this.game, treeData);
            this.behaviorTrees.set(treeId, treeInstance);
        } else {
            console.warn(`Behavior tree class not found for: ${treeId}`);
        }
    }

    /**
     * Get a registered action by type
     * @param {string} type - Action type name
     * @returns {Object} Action instance
     */
    getActionByType(type) {
        return this.actions.get(type);
    }

    /**
     * Get a registered behavior tree by type
     * @param {string} type - Tree type name
     * @returns {Object} Tree instance
     */
    getBehaviorTreeByType(type) {
        return this.behaviorTrees.get(type);
    }

    /**
     * Evaluate a registered behavior tree for an entity
     * @param {string} treeId - The behavior tree ID to evaluate
     * @param {string} entityId - Entity to evaluate for
     * @returns {Object|null} Action result from tree evaluation
     */
    evaluate(treeId, entityId) {
        const tree = this.behaviorTrees.get(treeId);
        if (!tree) {
            console.warn(`Behavior tree not found: ${treeId}`);
            return null;
        }

        return tree.evaluate(entityId, this.game);
    }

    /**
     * Evaluate a behavior tree from data (for editor simulation)
     * @param {Object} treeData - Tree configuration with fileName and behaviorActions
     * @param {string} entityId - Entity to evaluate for
     * @returns {Object|null} Action result from tree evaluation
     */
    evaluateTreeData(treeData, entityId) {
        const treeId = treeData.fileName;
        const TreeClass = GUTS[treeId];

        if (!TreeClass) {
            console.warn(`Behavior tree class not found: ${treeId}`);
            return null;
        }

        // Create tree instance with current data (may differ from collections)
        const tree = new TreeClass(this.game, treeData);
        return tree.evaluate(entityId, this.game);
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BehaviorTreeProcessor;
}

// Make available on GUTS global
if (typeof GUTS !== 'undefined') {
    GUTS.BehaviorTreeProcessor = BehaviorTreeProcessor;
}
