/**
 * BaseBehaviorNode - Unified base class for all behavior tree nodes
 *
 * Node types determined by configuration:
 * - Composite: Has `children` array (Select, Sequence, Parallel, etc.)
 * - Decorator: Has `child` property (Inverter, Cooldown, etc.)
 * - Leaf: No children (actions that do actual work)
 *
 * All nodes share the same interface:
 * - evaluate(entityId, game) - Main entry point, returns {action, status, meta} or null
 * - success(meta), running(meta), failure() - Response helpers
 * - getMemory(entityId), getShared(entityId, game) - State access
 */
class BaseBehaviorNode {
    static STATUS = {
        SUCCESS: 'success',
        FAILURE: 'failure',
        RUNNING: 'running'
    };

    constructor(game, config = {}) {
        this.game = game;
        this.config = config;
        this.parameters = config.parameters || {};
        if (typeof this.parameters === 'string') {
            this.parameters = JSON.parse(this.parameters);
        }

        // Children for composite nodes (array of node names)
        this.children = config.children || config.behaviorActions || [];

        // Child for decorator nodes (single node name)
        this.child = config.child || config.childAction || null;

        // Per-entity memory storage
        this.entityMemory = new Map();
        this.memoryDefaults = config.memory || {};

        // Running state tracking for composites
        this.runningState = new Map();
    }

    // ==================== Core Interface ====================

    /**
     * Main evaluation entry point
     * Routes to appropriate handler based on node type
     */
    evaluate(entityId, game) {
        // Composite node (has children array)
        if (this.children && this.children.length > 0) {
            return this.evaluateComposite(entityId, game);
        }

        // Decorator node (has single child)
        if (this.child) {
            return this.evaluateDecorator(entityId, game);
        }

        // Leaf node (no children)
        return this.evaluateLeaf(entityId, game);
    }

    /**
     * Evaluate as composite - override in Select, Sequence, Parallel, etc.
     * Default behavior: Selector (try each child until one succeeds)
     */
    evaluateComposite(entityId, game) {
        return this.evaluateSelector(entityId, game);
    }

    /**
     * Evaluate as decorator - override in Inverter, Cooldown, etc.
     * Default behavior: Pass through to child
     */
    evaluateDecorator(entityId, game) {
        return this.evaluateChild(entityId, game, this.child);
    }

    /**
     * Evaluate as leaf - override in action nodes
     * Default behavior: Failure
     */
    evaluateLeaf(entityId, game) {
        return this.failure();
    }

    // ==================== Composite Implementations ====================

    /**
     * Selector: Try each child until one succeeds (OR logic)
     */
    evaluateSelector(entityId, game) {
        const debugger_ = game.gameManager?.call('getDebugger');
        const treeId = this.config.id || this.constructor.name;
        const trace = debugger_?.beginEvaluation(entityId, treeId);

        // Check for running state
        const runningInfo = this.runningState.get(entityId);
        let startIndex = 0;

        if (runningInfo) {
            const runningIndex = this.children.indexOf(runningInfo.childName);
            if (runningIndex !== -1) {
                startIndex = runningIndex;
            } else {
                this.runningState.delete(entityId);
            }
        }

        // If resuming a running child, check it first
        if (startIndex > 0) {
            const result = this.evaluateChildWithTrace(entityId, game, this.children[startIndex], startIndex, trace, debugger_);
            if (result !== null) {
                if (result.status === 'running') {
                    this.runningState.set(entityId, { childIndex: startIndex, childName: this.children[startIndex] });
                    this.endTrace(debugger_, trace, result, entityId, game);
                    return result;
                } else {
                    this.runningState.delete(entityId);
                    this.endTrace(debugger_, trace, result, entityId, game);
                    return result;
                }
            }
            this.runningState.delete(entityId);
        }

        // Standard selector: try each child
        for (let i = 0; i < this.children.length; i++) {
            const result = this.evaluateChildWithTrace(entityId, game, this.children[i], i, trace, debugger_);
            if (result !== null) {
                if (result.status === 'running') {
                    this.runningState.set(entityId, { childIndex: i, childName: this.children[i] });
                }
                this.endTrace(debugger_, trace, result, entityId, game);
                return result;
            }
        }

        this.endTrace(debugger_, trace, null, entityId, game);
        return null;
    }

    /**
     * Sequence: Run all children in order until one fails (AND logic)
     */
    evaluateSequence(entityId, game) {
        const debugger_ = game.gameManager?.call('getDebugger');
        const treeId = this.config.id || this.constructor.name;
        const trace = debugger_?.beginEvaluation(entityId, treeId);

        // Check for running state
        const runningInfo = this.runningState.get(entityId);
        let startIndex = 0;

        if (runningInfo) {
            startIndex = runningInfo.childIndex || 0;
        }

        let lastResult = null;

        for (let i = startIndex; i < this.children.length; i++) {
            const result = this.evaluateChildWithTrace(entityId, game, this.children[i], i, trace, debugger_);

            if (result === null) {
                // Child failed, sequence fails
                this.runningState.delete(entityId);
                this.endTrace(debugger_, trace, null, entityId, game);
                return null;
            }

            if (result.status === 'running') {
                // Child still running, save state and return
                this.runningState.set(entityId, { childIndex: i, childName: this.children[i] });
                this.endTrace(debugger_, trace, result, entityId, game);
                return result;
            }

            lastResult = result;
        }

        // All children succeeded
        this.runningState.delete(entityId);
        this.endTrace(debugger_, trace, lastResult, entityId, game);
        return lastResult;
    }

    // ==================== Child Evaluation ====================

    /**
     * Evaluate a single child by name
     */
    evaluateChild(entityId, game, childName) {
        const node = game.gameManager?.call('getNodeByType', childName);
        if (node) {
            return node.evaluate(entityId, game);
        }

        console.warn(`Behavior node not found: ${childName}`);
        return null;
    }

    /**
     * Evaluate child with debug tracing
     */
    evaluateChildWithTrace(entityId, game, childName, index, trace, debugger_) {
        const nodeStartTime = performance.now();
        const result = this.evaluateChild(entityId, game, childName);

        if (debugger_ && trace) {
            const node = game.gameManager?.call('getNodeByType', childName);
            debugger_.recordNode(trace, {
                name: childName,
                type: this.getNodeType(node),
                index: index,
                status: result?.status || (result ? 'success' : 'failure'),
                duration: performance.now() - nodeStartTime,
                meta: result?.meta,
                memory: node?.getMemory?.(entityId)
            });
        }

        return result;
    }

    /**
     * Get node type for debugging
     */
    getNodeType(node) {
        if (!node) return 'unknown';
        if (node.children?.length > 0) return 'composite';
        if (node.child) return 'decorator';
        return 'leaf';
    }

    /**
     * End debug trace
     */
    endTrace(debugger_, trace, result, entityId, game) {
        if (debugger_ && trace) {
            const aiState = game.getComponent?.(entityId, 'aiState');
            const stateSnapshot = aiState?.shared ? { shared: { ...aiState.shared } } : null;
            debugger_.endEvaluation(trace, result, stateSnapshot);
        }
    }

    // ==================== Response Helpers ====================

    success(meta = {}) {
        return {
            action: this.constructor.name,
            status: BaseBehaviorNode.STATUS.SUCCESS,
            meta: meta
        };
    }

    running(meta = {}) {
        return {
            action: this.constructor.name,
            status: BaseBehaviorNode.STATUS.RUNNING,
            meta: meta
        };
    }

    failure() {
        return null;
    }

    // ==================== Memory & State ====================

    getMemory(entityId) {
        if (!this.entityMemory.has(entityId)) {
            this.entityMemory.set(entityId, JSON.parse(JSON.stringify(this.memoryDefaults)));
        }
        return this.entityMemory.get(entityId);
    }

    clearMemory(entityId) {
        this.entityMemory.delete(entityId);
    }

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

    clearRunningState(entityId) {
        this.runningState.delete(entityId);
    }

    // ==================== Lifecycle Hooks ====================

    onStart(entityId, game) {}

    onEnd(entityId, game) {
        this.clearMemory(entityId);
    }

    onBattleStart(entityId, game) {        
        this.children.forEach((childName) => {
            const node = game.gameManager?.call('getNodeByType', childName);
            if(!node.onBattleStart){
                console.warn('missing onBattleStart', childName);
                return;
            }
            node.onBattleStart(entityId, game);
        });
    }

    onBattleEnd(entityId, game) {
        this.children.forEach((childName) => {
            const node = game.gameManager?.call('getNodeByType', childName);
            if(!node.onBattleEnd){
                console.warn('missing onBattleEnd', childName);
                return;                
            }
            node.onBattleEnd(entityId, game);
        });
        this.runningState.delete(entityId);
        this.clearMemory(entityId);
    }

    onPlacementPhaseStart(entityId, game) {

        this.children.forEach((childName) => {
            const node = game.gameManager?.call('getNodeByType', childName);
            if(!node.onPlacementPhaseStart){
                console.warn('missing onPlacementPhaseStart', childName);
                return;                
            }
            node.onPlacementPhaseStart(entityId, game);
        });
    }

    // ==================== Utility Helpers ====================

    distance(pos1, pos2) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}

// Export for use in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BaseBehaviorNode;
}

// Make available on GUTS global
if (typeof GUTS !== 'undefined') {
    GUTS.BaseBehaviorNode = BaseBehaviorNode;
}
