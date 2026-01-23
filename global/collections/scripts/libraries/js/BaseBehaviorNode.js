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

        // Cached service functions for fast access (e.g., this.call.serviceName)
        // Will be populated later by BehaviorSystem after all systems are loaded
        this.call = {};

        // Children for composite nodes (array of node names)
        this.children = config.children || config.behaviorActions || [];

        // Child for decorator nodes (single node name)
        this.child = config.child || config.childAction || null;

        // Per-entity memory storage
        this.entityMemory = new Map();
        this.memoryDefaults = config.memory || {};

        // Running state tracking for composites
        this.runningState = new Map();

        // Reusable result objects to avoid per-evaluation allocations
        this._successResult = {
            action: this.constructor.name,
            status: BaseBehaviorNode.STATUS.SUCCESS,
            meta: null
        };
        this._runningResult = {
            action: this.constructor.name,
            status: BaseBehaviorNode.STATUS.RUNNING,
            meta: null
        };

        // Reusable running state object per entity
        this._runningStatePool = new Map();
    }

    /**
     * Get or create a reusable running state object for an entity
     */
    _getRunningStateObj(entityId) {
        let obj = this._runningStatePool.get(entityId);
        if (!obj) {
            obj = { childIndex: 0, childName: null };
            this._runningStatePool.set(entityId, obj);
        }
        return obj;
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
     *
     * Important: Always evaluate from index 0 to allow higher-priority behaviors
     * to preempt lower-priority ones. If a running child fails/succeeds, or a
     * higher-priority child wants to run, the selector should switch to that child.
     */
    evaluateSelector(entityId, game) {
        const debugger_ = game.call('getDebugger');
        const treeId = this.config.id || this.constructor.name;
        const trace = debugger_?.beginEvaluation(entityId, treeId);

        // Get previously running child to detect preemption
        const runningInfo = this.runningState.get(entityId);

        // Always evaluate from the beginning to allow preemption
        for (let i = 0; i < this.children.length; i++) {
            const result = this.evaluateChildWithTrace(entityId, game, this.children[i], i, trace, debugger_);
            if (result !== null) {
                // Check if we preempted a different running child
                if (runningInfo && runningInfo.childName !== this.children[i]) {
                    // Notify the previously running child it was preempted
                    const prevNode = game.call('getNodeByType', runningInfo.childName);
                    if (prevNode?.onEnd) {
                        prevNode.onEnd(entityId, game);
                    }
                }

                if (result.status === 'running') {
                    const stateObj = this._getRunningStateObj(entityId);
                    stateObj.childIndex = i;
                    stateObj.childName = this.children[i];
                    this.runningState.set(entityId, stateObj);
                } else {
                    this.runningState.delete(entityId);
                }
                this.endTrace(debugger_, trace, result, entityId, game);
                return result;
            }
        }

        // All children failed - clear running state
        if (runningInfo) {
            const prevNode = game.call('getNodeByType', runningInfo.childName);
            if (prevNode?.onEnd) {
                prevNode.onEnd(entityId, game);
            }
            this.runningState.delete(entityId);
        }

        this.endTrace(debugger_, trace, null, entityId, game);
        return null;
    }

    /**
     * Sequence: Run all children in order until one fails (AND logic)
     *
     * Important: Always re-evaluate from the beginning to check conditions.
     * If a previous child was running, we still need to verify conditions are still valid.
     * Only skip ahead if the running child succeeds, then continue from there.
     */
    evaluateSequence(entityId, game) {
        const debugger_ = game.call('getDebugger');
        const treeId = this.config.id || this.constructor.name;
        const trace = debugger_?.beginEvaluation(entityId, treeId);

        let lastResult = null;

        // Always evaluate from the beginning to re-check conditions
        for (let i = 0; i < this.children.length; i++) {
            const result = this.evaluateChildWithTrace(entityId, game, this.children[i], i, trace, debugger_);

            if (result === null) {
                // Child failed, sequence fails - clear running state
                this.runningState.delete(entityId);
                this.endTrace(debugger_, trace, null, entityId, game);
                return null;
            }

            if (result.status === 'running') {
                // Child still running, save state and return
                const stateObj = this._getRunningStateObj(entityId);
                stateObj.childIndex = i;
                stateObj.childName = this.children[i];
                this.runningState.set(entityId, stateObj);
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
        const node = game.call('getNodeByType', childName);
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
        // Skip timing overhead if not debugging
        if (!debugger_ || !trace) {
            return this.evaluateChild(entityId, game, childName);
        }

        const nodeStartTime = performance.now();
        const result = this.evaluateChild(entityId, game, childName);

        const node = game.call('getNodeByType', childName);
        debugger_.recordNode(trace, {
            name: childName,
            type: this.getNodeType(node),
            index: index,
            status: result?.status || (result ? 'success' : 'failure'),
            duration: performance.now() - nodeStartTime,
            meta: result?.meta,
            memory: node?.getMemory?.(entityId)
        });

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
        if (!debugger_ || !trace) return;

        // Get shared state from BehaviorSystem
        const shared = game.call('getBehaviorShared', entityId);
        // Note: We need to spread here because the debugger stores historical state
        const stateSnapshot = shared ? { shared: { ...shared } } : null;
        debugger_.endEvaluation(trace, result, stateSnapshot);
    }

    // ==================== Response Helpers ====================

    success(meta = {}) {
        // Reuse result object to avoid allocation
        this._successResult.meta = meta;
        return this._successResult;
    }

    running(meta = {}) {
        // Reuse result object to avoid allocation
        this._runningResult.meta = meta;
        return this._runningResult;
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
        // Shared state is now stored in BehaviorSystem, not in the component
        return game.call('getBehaviorShared', entityId);
    }

    getMeta(entityId, game) {
        // Meta state is now stored in BehaviorSystem, not in the component
        return game.call('getBehaviorMeta', entityId);
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
            const node = game.call('getNodeByType', childName);
            if(!node.onBattleStart){
                console.warn('missing onBattleStart', childName);
                return;
            }
            node.onBattleStart(entityId, game);
        });
    }

    onBattleEnd(entityId, game) {
        this.children.forEach((childName) => {
            const node = game.call('getNodeByType', childName);
            if(!node.onBattleEnd){
                console.warn('missing onBattleEnd', childName);
                return;
            }
            node.onBattleEnd(entityId, game);
        });
        this.runningState.delete(entityId);
        this._runningStatePool.delete(entityId);
        this.clearMemory(entityId);
    }

    onPlacementPhaseStart(entityId, game) {

        this.children.forEach((childName) => {
            const node = game.call('getNodeByType', childName);
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


// Auto-generated exports
if (typeof window !== 'undefined' && window.GUTS) {
  window.GUTS.BaseBehaviorNode = BaseBehaviorNode;
}
