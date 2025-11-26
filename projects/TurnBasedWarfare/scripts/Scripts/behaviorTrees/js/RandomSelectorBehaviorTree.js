/**
 * Random Selector Behavior Tree
 * Randomly picks and evaluates children instead of priority order
 *
 * Behavior:
 *   - Shuffles children randomly each evaluation (or uses sticky selection)
 *   - Evaluates in random order until one succeeds
 *   - If all children fail, the selector fails
 *
 * Parameters:
 *   sticky: boolean (default: false)
 *     - If true, remembers the last successful child and tries it first
 *     - If false, completely random each evaluation
 *
 *   seed: number (optional)
 *     - Random seed for reproducible behavior (useful for testing)
 *
 * Usage:
 *   {
 *     "fileName": "RandomPatrolSelector",
 *     "behaviorActions": ["PatrolNorth", "PatrolSouth", "PatrolEast"],
 *     "parameters": {
 *       "sticky": true
 *     }
 *   }
 */
class RandomSelectorBehaviorTree extends GUTS.BaseBehaviorTree {

    constructor(game, config = {}) {
        super(game, config);

        // Parse parameters
        const params = config.parameters || {};
        this.sticky = params.sticky || false;
        this.seed = params.seed || null;

        // Track last successful child per entity (for sticky mode)
        // Key: entityId, Value: childName
        this.lastSuccess = new Map();

        // Track running state per entity
        // Key: entityId, Value: { shuffledOrder: [], currentIndex: number }
        this.randomState = new Map();

        // Simple seeded random if seed is provided
        if (this.seed !== null) {
            this.rng = this.createSeededRandom(this.seed);
        } else {
            this.rng = Math.random;
        }
    }

    /**
     * Create a seeded random number generator
     */
    createSeededRandom(seed) {
        let s = seed;
        return () => {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };
    }

    /**
     * Shuffle array using Fisher-Yates algorithm
     */
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * Evaluate children in random order
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {Object|null} First successful result or null
     */
    evaluate(entityId, game) {
        const behaviorActions = this.config.behaviorActions;
        if (!behaviorActions || behaviorActions.length === 0) {
            return null;
        }

        // Get debugger if available
        const debugger_ = game.gameManager.call('getDebugger');
        const treeId = this.config.id || this.config.fileName || 'RandomSelectorBehaviorTree';
        const trace = debugger_?.beginEvaluation(entityId, treeId);

        let evaluationOrder;
        let startIndex = 0;

        // Check for existing running state
        const state = this.randomState.get(entityId);

        if (state) {
            // Resume from running state
            evaluationOrder = state.shuffledOrder;
            startIndex = state.currentIndex;
        } else {
            // Create new random order
            evaluationOrder = this.shuffleArray(behaviorActions);

            // If sticky mode and we have a last success, move it to front
            if (this.sticky) {
                const lastSuccessChild = this.lastSuccess.get(entityId);
                if (lastSuccessChild && evaluationOrder.includes(lastSuccessChild)) {
                    evaluationOrder = evaluationOrder.filter(c => c !== lastSuccessChild);
                    evaluationOrder.unshift(lastSuccessChild);
                }
            }
        }

        // Evaluate in random order
        for (let i = startIndex; i < evaluationOrder.length; i++) {
            const childName = evaluationOrder[i];
            const nodeStartTime = performance.now();
            const result = this.evaluateChild(entityId, game, childName);

            if (result === null) {
                // Child failed - try next
                this.recordNodeToTrace(trace, debugger_, {
                    name: childName,
                    type: 'random-child',
                    index: i,
                    status: 'failure',
                    duration: performance.now() - nodeStartTime
                });
                continue;
            }

            if (result.status === 'running') {
                // Child is running - save state
                this.recordNodeToTrace(trace, debugger_, {
                    name: childName,
                    type: 'random-child',
                    index: i,
                    status: 'running',
                    duration: performance.now() - nodeStartTime,
                    meta: result.meta
                });

                this.randomState.set(entityId, {
                    shuffledOrder: evaluationOrder,
                    currentIndex: i
                });

                const runningResult = {
                    action: result.action || childName,
                    status: 'running',
                    meta: {
                        ...result.meta,
                        randomIndex: i,
                        randomOrder: evaluationOrder
                    }
                };

                this.endTrace(debugger_, trace, runningResult, entityId, game);
                return runningResult;
            }

            // Child succeeded
            this.recordNodeToTrace(trace, debugger_, {
                name: childName,
                type: 'random-child',
                index: i,
                status: 'success',
                duration: performance.now() - nodeStartTime,
                meta: result.meta
            });

            this.randomState.delete(entityId);

            if (this.sticky) {
                this.lastSuccess.set(entityId, childName);
            }

            const successResult = {
                action: result.action || childName,
                status: 'success',
                meta: {
                    ...result.meta,
                    selectedRandomly: true,
                    randomIndex: i
                }
            };

            this.endTrace(debugger_, trace, successResult, entityId, game);
            return successResult;
        }

        // All children failed
        this.randomState.delete(entityId);
        this.endTrace(debugger_, trace, null, entityId, game);
        return null;
    }

    /**
     * Evaluate a single child (action, tree, or decorator)
     */
    evaluateChild(entityId, game, childName) {
        const action = game.gameManager.call('getActionByType', childName);
        if (action) {
            return this.processAction(entityId, game, childName, action);
        }

        const subtree = game.gameManager.call('getBehaviorTreeByType', childName);
        if (subtree) {
            return subtree.evaluate(entityId, game);
        }

        const decorator = game.gameManager.call('getDecoratorByType', childName);
        if (decorator) {
            return decorator.execute(entityId, game);
        }

        console.warn(`Random selector child not found: ${childName}`);
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
        this.lastSuccess.delete(entityId);
        this.randomState.delete(entityId);
    }
}
