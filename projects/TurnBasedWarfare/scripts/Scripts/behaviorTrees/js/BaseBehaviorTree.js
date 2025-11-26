class BaseBehaviorTree {
    constructor(game, config = {}) {
        this.game = game;
        this.config = config;

        // Track running action index per entity
        // Key: entityId, Value: { actionIndex: number, actionName: string }
        this.runningState = new Map();
    }

    onBattleStart() {
    }

    onBattleEnd(entityId, game) {
        // Clear running state when battle ends
        this.runningState.delete(entityId);
    }

    onPlacementPhaseStart(entityId, game) {
    }

    /**
     * Process an action and return standardized result
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @param {string} actionName - Name of the action
     * @param {object} actionInstance - The action instance
     * @returns {Object|null} Result with action, status, and meta
     */
    processAction(entityId, game, actionName, actionInstance) {
        const result = actionInstance.execute(entityId, game);

        if (result === null) {
            return null; // Failure
        }

        // Normalize result to include status if not present (backwards compatibility)
        return {
            action: result.action || actionName,
            status: result.status || 'success',
            meta: result.meta || result
        };
    }

    /**
     * Evaluate the behavior tree and return the desired action
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {Object|null} Action descriptor with status
     */
    evaluate(entityId, game) {
        this.pathSize = game.gameManager.call('getPlacementGridSize');

        const behaviorActions = this.config.behaviorActions;
        if (!behaviorActions || behaviorActions.length === 0) {
            return null;
        }

        // Check if we have a running action for this entity
        const runningInfo = this.runningState.get(entityId);

        // Build action evaluators (supports both actions and subtrees)
        const actionEvaluators = behaviorActions.map((behaviorAction, index) => ({
            name: behaviorAction,
            index: index,
            evaluate: () => {
                // First try as an action
                const actionInstance = game.gameManager.call('getActionByType', behaviorAction);
                if (actionInstance) {
                    return this.processAction(entityId, game, behaviorAction, actionInstance);
                }

                // Then try as a subtree
                const subtree = game.gameManager.call('getBehaviorTreeByType', behaviorAction);
                if (subtree) {
                    return subtree.evaluate(entityId, game);
                }

                // Finally try as a decorator
                const decorator = game.gameManager.call('getDecoratorByType', behaviorAction);
                if (decorator) {
                    return decorator.execute(entityId, game);
                }

                console.warn(`Behavior node not found (action/tree/decorator): ${behaviorAction}`);
                return null;
            }
        }));

        // If we have a running action, start evaluation from there
        let startIndex = 0;
        if (runningInfo) {
            // Find the running action's current index (in case order changed)
            const runningIndex = behaviorActions.indexOf(runningInfo.actionName);
            if (runningIndex !== -1) {
                startIndex = runningIndex;
            } else {
                // Running action no longer exists, clear state
                this.runningState.delete(entityId);
            }
        }

        // Evaluate using selector pattern, starting from startIndex
        const result = this.selectWithIndex(actionEvaluators, startIndex, entityId);

        return result;
    }

    /**
     * Selector node with support for running state
     * @param {Array} evaluators - Array of {name, index, evaluate} objects
     * @param {number} startIndex - Index to start evaluation from
     * @param {string} entityId - Entity ID for tracking running state
     * @returns {Object|null} Selected action result
     */
    selectWithIndex(evaluators, startIndex, entityId) {
        // First, try the running action if we have one
        if (startIndex > 0) {
            const runningEvaluator = evaluators[startIndex];
            const result = runningEvaluator.evaluate();

            if (result !== null) {
                if (result.status === 'running') {
                    // Still running, return it
                    this.runningState.set(entityId, {
                        actionIndex: startIndex,
                        actionName: runningEvaluator.name
                    });
                    return result;
                } else {
                    // Completed (success), clear running state and return
                    this.runningState.delete(entityId);
                    return result;
                }
            } else {
                // Failed, clear running state and re-evaluate from beginning
                this.runningState.delete(entityId);
            }
        }

        // Standard selector: try each action in order
        for (let i = 0; i < evaluators.length; i++) {
            const evaluator = evaluators[i];
            const result = evaluator.evaluate();

            if (result !== null) {
                if (result.status === 'running') {
                    // Action is running, track it
                    this.runningState.set(entityId, {
                        actionIndex: i,
                        actionName: evaluator.name
                    });
                }
                return result;
            }
        }

        return null;
    }

    /**
     * Standard selector node (no running state tracking)
     * @param {Array<Function>} checks - Array of functions that return action descriptors or null
     * @returns {Object|null} First non-null result
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
     * @returns {Object|null} Last successful action descriptor or null if any failed
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
     * @returns {Object|null} Action descriptor if condition succeeds, null otherwise
     */
    condition(condition, onSuccess) {
        if (condition()) {
            return onSuccess();
        }
        return null;
    }

    /**
     * Clear running state for an entity
     * @param {string} entityId - Entity ID
     */
    clearRunningState(entityId) {
        this.runningState.delete(entityId);
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
