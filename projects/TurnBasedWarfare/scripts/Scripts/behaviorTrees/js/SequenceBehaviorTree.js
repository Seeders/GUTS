/**
 * Sequence Behavior Tree
 * Evaluates children in order until one fails or all succeed
 *
 * Behavior:
 *   - Evaluates children left-to-right
 *   - If a child fails (returns null), the sequence fails immediately
 *   - If a child returns 'running', the sequence pauses and resumes next tick
 *   - If all children succeed, the sequence succeeds
 *
 * Usage in behaviorActions:
 *   "behaviorActions": [
 *     "PrepareSequence",  // A SequenceBehaviorTree instance
 *     "IdleBehaviorAction"
 *   ]
 *
 * The sequence tree config:
 *   {
 *     "fileName": "PrepareSequence",
 *     "behaviorActions": ["CheckAmmo", "ReloadWeapon", "AimAction"],
 *     "parameters": {}
 *   }
 */
class SequenceBehaviorTree extends GUTS.BaseBehaviorTree {

    constructor(game, config = {}) {
        super(game, config);

        // Track current child index per entity for running state
        // Key: entityId, Value: { childIndex: number, childName: string }
        this.sequenceState = new Map();
    }

    /**
     * Evaluate children in sequence
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {Object|null} Result based on sequence evaluation
     */
    evaluate(entityId, game) {
        const behaviorActions = this.config.behaviorActions;
        if (!behaviorActions || behaviorActions.length === 0) {
            return null;
        }

        // Get debugger if available
        const debugger_ = game.gameManager.call('getDebugger');
        const treeId = this.config.id || this.config.fileName || 'SequenceBehaviorTree';
        const trace = debugger_?.beginEvaluation(entityId, treeId);

        // Check if we have a running child
        const state = this.sequenceState.get(entityId);
        let startIndex = 0;

        if (state) {
            // Resume from running child
            const runningIndex = behaviorActions.indexOf(state.childName);
            if (runningIndex !== -1) {
                startIndex = runningIndex;
            } else {
                // Running child no longer exists, restart
                this.sequenceState.delete(entityId);
            }
        }

        let lastSuccessResult = null;

        // Evaluate children in order starting from startIndex
        for (let i = startIndex; i < behaviorActions.length; i++) {
            const childName = behaviorActions[i];
            const nodeStartTime = performance.now();
            const result = this.evaluateChild(entityId, game, childName);

            if (result === null) {
                // Child failed - sequence fails
                this.recordNodeToTrace(trace, debugger_, {
                    name: childName,
                    type: 'sequence-child',
                    index: i,
                    status: 'failure',
                    duration: performance.now() - nodeStartTime
                });

                this.sequenceState.delete(entityId);
                this.endTrace(debugger_, trace, null, entityId, game);
                return null;
            }

            if (result.status === 'running') {
                // Child is running - pause sequence
                this.recordNodeToTrace(trace, debugger_, {
                    name: childName,
                    type: 'sequence-child',
                    index: i,
                    status: 'running',
                    duration: performance.now() - nodeStartTime,
                    meta: result.meta
                });

                this.sequenceState.set(entityId, {
                    childIndex: i,
                    childName: childName
                });

                const runningResult = {
                    action: result.action || childName,
                    status: 'running',
                    meta: {
                        ...result.meta,
                        sequenceIndex: i,
                        sequenceTotal: behaviorActions.length
                    }
                };

                this.endTrace(debugger_, trace, runningResult, entityId, game);
                return runningResult;
            }

            // Child succeeded - continue to next
            this.recordNodeToTrace(trace, debugger_, {
                name: childName,
                type: 'sequence-child',
                index: i,
                status: 'success',
                duration: performance.now() - nodeStartTime,
                meta: result.meta
            });

            lastSuccessResult = result;
        }

        // All children succeeded
        this.sequenceState.delete(entityId);

        const successResult = {
            action: lastSuccessResult?.action || 'SequenceBehaviorTree',
            status: 'success',
            meta: {
                ...(lastSuccessResult?.meta || {}),
                sequenceCompleted: true,
                childrenCount: behaviorActions.length
            }
        };

        this.endTrace(debugger_, trace, successResult, entityId, game);
        return successResult;
    }

    /**
     * Evaluate a single child (action, tree, or decorator)
     */
    evaluateChild(entityId, game, childName) {
        // Try as action
        const action = game.gameManager.call('getActionByType', childName);
        if (action) {
            return this.processAction(entityId, game, childName, action);
        }

        // Try as subtree
        const subtree = game.gameManager.call('getBehaviorTreeByType', childName);
        if (subtree) {
            return subtree.evaluate(entityId, game);
        }

        // Try as decorator
        const decorator = game.gameManager.call('getDecoratorByType', childName);
        if (decorator) {
            return decorator.execute(entityId, game);
        }

        console.warn(`Sequence child not found: ${childName}`);
        return null;
    }

    /**
     * Record a node to the debug trace
     */
    recordNodeToTrace(trace, debugger_, nodeInfo) {
        if (debugger_ && trace) {
            debugger_.recordNode(trace, nodeInfo);
        }
    }

    /**
     * End the debug trace
     */
    endTrace(debugger_, trace, result, entityId, game) {
        if (debugger_ && trace) {
            const aiState = game.getComponent?.(entityId, 'aiState');
            const stateSnapshot = aiState?.shared ? { shared: { ...aiState.shared } } : null;
            debugger_.endEvaluation(trace, result, stateSnapshot);
        }
    }

    /**
     * Clear running state when battle ends
     */
    onBattleEnd(entityId, game) {
        super.onBattleEnd(entityId, game);
        this.sequenceState.delete(entityId);
    }
}
