/**
 * Weighted Selector Behavior Tree
 * Selects children based on weighted probabilities
 *
 * Behavior:
 *   - Each child has a weight determining selection probability
 *   - Higher weight = higher chance of being selected
 *   - Selected child is evaluated; if it fails, falls back to priority order
 *
 * Parameters:
 *   weights: object (required)
 *     - Map of childName to weight (number)
 *     - Children not in weights get default weight of 1
 *
 *   fallbackOnFail: boolean (default: true)
 *     - If true, tries other children in weight order when selected fails
 *     - If false, immediately fails if selected child fails
 *
 *   normalizeWeights: boolean (default: true)
 *     - If true, weights are normalized to probabilities
 *     - If false, weights are used as raw values
 *
 * Usage:
 *   {
 *     "fileName": "WeightedAttackSelector",
 *     "behaviorActions": ["MeleeAttack", "RangedAttack", "SpecialAttack"],
 *     "parameters": {
 *       "weights": {
 *         "MeleeAttack": 5,
 *         "RangedAttack": 3,
 *         "SpecialAttack": 1
 *       },
 *       "fallbackOnFail": true
 *     }
 *   }
 */
class WeightedSelectorBehaviorTree extends GUTS.BaseBehaviorTree {

    constructor(game, config = {}) {
        super(game, config);

        // Parse parameters
        const params = config.parameters || {};
        this.weights = params.weights || {};
        this.fallbackOnFail = params.fallbackOnFail !== false;
        this.normalizeWeights = params.normalizeWeights !== false;

        // Track running state per entity
        // Key: entityId, Value: { selectedOrder: [], currentIndex: number }
        this.weightedState = new Map();
    }

    /**
     * Get weight for a child
     */
    getWeight(childName) {
        return this.weights[childName] !== undefined ? this.weights[childName] : 1;
    }

    /**
     * Select a child based on weighted probability
     * Returns the selected index
     */
    weightedSelect(children) {
        const weights = children.map(c => this.getWeight(c));
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);

        if (totalWeight <= 0) {
            return 0; // Fallback to first
        }

        let random = Math.random() * totalWeight;

        for (let i = 0; i < weights.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                return i;
            }
        }

        return weights.length - 1; // Fallback to last
    }

    /**
     * Sort children by weight (descending) for fallback order
     */
    sortByWeight(children) {
        return [...children].sort((a, b) => this.getWeight(b) - this.getWeight(a));
    }

    /**
     * Evaluate using weighted selection
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {Object|null} Selected child result or null
     */
    evaluate(entityId, game) {
        const behaviorActions = this.config.behaviorActions;
        if (!behaviorActions || behaviorActions.length === 0) {
            return null;
        }

        // Get debugger if available
        const debugger_ = game.call('getDebugger');
        const treeId = this.config.id || this.config.fileName || 'WeightedSelectorBehaviorTree';
        const trace = debugger_?.beginEvaluation(entityId, treeId);

        let evaluationOrder;
        let startIndex = 0;

        // Check for existing running state
        const state = this.weightedState.get(entityId);

        if (state) {
            // Resume from running state
            evaluationOrder = state.selectedOrder;
            startIndex = state.currentIndex;
        } else {
            // Create new weighted selection order
            const selectedIndex = this.weightedSelect(behaviorActions);
            const selectedChild = behaviorActions[selectedIndex];

            if (this.fallbackOnFail) {
                // Create fallback order: selected first, then rest by weight
                const remaining = behaviorActions.filter((_, i) => i !== selectedIndex);
                const sortedRemaining = this.sortByWeight(remaining);
                evaluationOrder = [selectedChild, ...sortedRemaining];
            } else {
                // Only try the selected child
                evaluationOrder = [selectedChild];
            }
        }

        // Record selection weights for debugging
        const selectionInfo = {
            weights: {},
            probabilities: {}
        };
        const totalWeight = behaviorActions.reduce((sum, c) => sum + this.getWeight(c), 0);
        behaviorActions.forEach(c => {
            const w = this.getWeight(c);
            selectionInfo.weights[c] = w;
            selectionInfo.probabilities[c] = totalWeight > 0 ? (w / totalWeight * 100).toFixed(1) + '%' : '0%';
        });

        // Evaluate in weighted order
        for (let i = startIndex; i < evaluationOrder.length; i++) {
            const childName = evaluationOrder[i];
            const nodeStartTime = performance.now();
            const result = this.evaluateChild(entityId, game, childName);

            const weight = this.getWeight(childName);
            const probability = totalWeight > 0 ? (weight / totalWeight * 100).toFixed(1) + '%' : '0%';

            if (result === null) {
                // Child failed
                this.recordNodeToTrace(trace, debugger_, {
                    name: childName,
                    type: 'weighted-child',
                    index: i,
                    status: 'failure',
                    duration: performance.now() - nodeStartTime,
                    meta: { weight, probability, isSelected: i === 0 }
                });

                if (!this.fallbackOnFail) {
                    // No fallback - fail immediately
                    this.weightedState.delete(entityId);
                    this.endTrace(debugger_, trace, null, entityId, game);
                    return null;
                }

                continue; // Try next in fallback order
            }

            if (result.status === 'running') {
                // Child is running - save state
                this.recordNodeToTrace(trace, debugger_, {
                    name: childName,
                    type: 'weighted-child',
                    index: i,
                    status: 'running',
                    duration: performance.now() - nodeStartTime,
                    meta: { weight, probability, isSelected: i === 0, ...result.meta }
                });

                this.weightedState.set(entityId, {
                    selectedOrder: evaluationOrder,
                    currentIndex: i
                });

                const runningResult = {
                    action: result.action || childName,
                    status: 'running',
                    meta: {
                        ...result.meta,
                        weight,
                        probability,
                        wasSelectedChild: i === 0,
                        selectionInfo
                    }
                };

                this.endTrace(debugger_, trace, runningResult, entityId, game);
                return runningResult;
            }

            // Child succeeded
            this.recordNodeToTrace(trace, debugger_, {
                name: childName,
                type: 'weighted-child',
                index: i,
                status: 'success',
                duration: performance.now() - nodeStartTime,
                meta: { weight, probability, isSelected: i === 0, ...result.meta }
            });

            this.weightedState.delete(entityId);

            const successResult = {
                action: result.action || childName,
                status: 'success',
                meta: {
                    ...result.meta,
                    weight,
                    probability,
                    wasSelectedChild: i === 0,
                    usedFallback: i > 0,
                    selectionInfo
                }
            };

            this.endTrace(debugger_, trace, successResult, entityId, game);
            return successResult;
        }

        // All children failed
        this.weightedState.delete(entityId);
        this.endTrace(debugger_, trace, null, entityId, game);
        return null;
    }

    /**
     * Evaluate a single child (unified node lookup)
     */
    evaluateChild(entityId, game, childName) {
        const node = game.call('getNodeByType', childName);
        if (!node) {
            console.warn(`Weighted selector child not found: ${childName}`);
            return null;
        }

        // Trees have evaluate() method
        if (node.evaluate) {
            return node.evaluate(entityId, game);
        }

        // Actions and decorators have execute() - use processAction for normalization
        if (node.execute) {
            return this.processAction(entityId, game, childName, node);
        }

        console.warn(`Node has no evaluate or execute method: ${childName}`);
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
     * Clear state when battle ends
     */
    onBattleEnd(entityId, game) {
        super.onBattleEnd(entityId, game);
        this.weightedState.delete(entityId);
    }
}
