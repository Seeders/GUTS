/**
 * Behavior Tree Processor
 * Single source of truth for behavior tree evaluation
 * Used by both BehaviorSystem (runtime) and BehaviorTreeEditor (simulation)
 */
class BehaviorTreeProcessor {
    constructor(game, options = {}) {
        this.game = game;

        // Unified node storage (new approach)
        this.nodes = new Map();

        // Per-entity blackboards for shared state between nodes
        // Key: entityId, Value: BehaviorTreeBlackboard instance
        this.blackboards = new Map();

        // Debugger for execution tracing
        const DebuggerClass = GUTS?.BehaviorTreeDebugger ||
            (typeof BehaviorTreeDebugger !== 'undefined' ? BehaviorTreeDebugger : null);

        if (DebuggerClass) {
            this.debugger = new DebuggerClass({
                enabled: options.debugEnabled !== false,
                verboseLogging: options.verboseLogging || false,
                maxTracesPerEntity: options.maxTracesPerEntity || 100
            });
        } else {
            this.debugger = null;
        }
    }

    /**
     * Get or create a blackboard for an entity
     * @param {string} entityId - Entity ID
     * @returns {BehaviorTreeBlackboard} Blackboard instance
     */
    getBlackboard(entityId) {
        if (!this.blackboards.has(entityId)) {
            const BlackboardClass = GUTS.BehaviorTreeBlackboard || BehaviorTreeBlackboard;
            this.blackboards.set(entityId, new BlackboardClass());
        }
        return this.blackboards.get(entityId);
    }

    /**
     * Clear blackboard for an entity
     * @param {string} entityId - Entity ID
     */
    clearBlackboard(entityId) {
        const blackboard = this.blackboards.get(entityId);
        if (blackboard) {
            blackboard.clear();
        }
        this.blackboards.delete(entityId);
    }

    /**
     * Clear all blackboards
     */
    clearAllBlackboards() {
        for (const blackboard of this.blackboards.values()) {
            blackboard.clear();
        }
        this.blackboards.clear();
    }

    /**
     * Get the debugger instance
     * @returns {BehaviorTreeDebugger|null}
     */
    getDebugger() {
        return this.debugger;
    }

    /**
     * Enable or disable debugging
     * @param {boolean} enabled
     */
    setDebugEnabled(enabled) {
        if (this.debugger) {
            this.debugger.setEnabled(enabled);
        }
    }

    /**
     * Enable or disable verbose console logging
     * @param {boolean} verbose
     */
    setVerboseLogging(verbose) {
        if (this.debugger) {
            this.debugger.setVerboseLogging(verbose);
        }
    }

    /**
     * Increment the debugger tick counter (call once per evaluation cycle)
     */
    debugTick() {
        if (this.debugger) {
            this.debugger.tick();
        }
    }

    /**
     * Clear debug data for an entity
     * @param {string} entityId
     */
    clearDebugData(entityId) {
        if (this.debugger) {
            this.debugger.clearEntity(entityId);
        }
    }

    /**
     * Clear all debug data
     */
    clearAllDebugData() {
        if (this.debugger) {
            this.debugger.clear();
        }
    }

    /**
     * Initialize from collections (call after construction)
     * @param {Object} collections - Game collections with behaviorNodes 
     */
    initializeFromCollections(collections) {
   

        if (collections.behaviorActions) {
            Object.entries(collections.behaviorActions).forEach(([actionId, actionData]) => {
                this.registerNode(actionId, actionData);
            });
        }

        if (collections.behaviorDecorators) {
            Object.entries(collections.behaviorDecorators).forEach(([decoratorId, decoratorData]) => {
                this.registerNode(decoratorId, decoratorData);
            });
        }

        if (collections.behaviorTrees) {
            Object.entries(collections.behaviorTrees).forEach(([treeId, treeData]) => {
                this.registerNode(treeId, treeData);
            });
        }

        if (collections.sequenceBehaviorTrees) {
            Object.entries(collections.sequenceBehaviorTrees).forEach(([sequenceId, sequenceData]) => {
                this.registerNode(sequenceId, sequenceData);
            });
        }
    }

    /**
     * Register a behavior node (unified)
     * @param {string} nodeId - Node class name
     * @param {Object} nodeData - Node configuration data
     */
    registerNode(nodeId, nodeData) {
        const NodeClass = GUTS[nodeId];

        if (NodeClass) {
            const nodeInstance = new NodeClass(this.game, nodeData);
            this.nodes.set(nodeId, nodeInstance);
        } else {
            console.warn(`Behavior node class not found for: ${nodeId}`);
        }
    }

    /**
     * Get a registered node by type (unified lookup)
     * @param {string} type - Node type name
     * @returns {Object} Node instance
     */
    getNodeByType(type) {
        return this.nodes.get(type);
    }


    /**
     * Evaluate a registered behavior node for an entity
     * @param {string} nodeId - The behavior node ID to evaluate
     * @param {string} entityId - Entity to evaluate for
     * @returns {Object|null} Action result from evaluation
     */
    evaluate(nodeId, entityId) {
        const node = this.nodes.get(nodeId);
        if (!node) {
            console.warn(`Behavior node not found: ${nodeId}`);
            return null;
        }

        return node.evaluate(entityId, this.game);
    }

    /**
     * Evaluate a behavior node from data (for editor simulation)
     * @param {Object} nodeData - Node configuration with fileName and children
     * @param {string} entityId - Entity to evaluate for
     * @returns {Object|null} Action result from evaluation
     */
    evaluateNodeData(nodeData, entityId) {
        const nodeId = nodeData.fileName;
        const NodeClass = GUTS[nodeId];

        if (!NodeClass) {
            console.warn(`Behavior node class not found: ${nodeId}`);
            return null;
        }

        // Create node instance with current data (may differ from collections)
        const node = new NodeClass(this.game, nodeData);
        return node.evaluate(entityId, this.game);
    }

    /**
     * @deprecated Use evaluateNodeData instead
     */
    evaluateTreeData(treeData, entityId) {
        return this.evaluateNodeData(treeData, entityId);
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
