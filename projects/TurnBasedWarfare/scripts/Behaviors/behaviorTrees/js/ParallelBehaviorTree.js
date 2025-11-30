/**
 * Parallel Behavior Tree
 * Evaluates all children simultaneously on each tick
 *
 * Policies:
 *   successPolicy: 'all' | 'any' (default: 'all')
 *     - 'all': Succeed when ALL children succeed
 *     - 'any': Succeed when ANY child succeeds
 *
 *   failurePolicy: 'all' | 'any' (default: 'any')
 *     - 'all': Fail when ALL children fail
 *     - 'any': Fail when ANY child fails
 *
 * Usage in behaviorActions:
 *   "behaviorActions": [
 *     "CombatParallelTree",  // A ParallelBehaviorTree instance
 *     "IdleBehaviorAction"
 *   ]
 *
 * The parallel tree config:
 *   {
 *     "fileName": "CombatParallelTree",
 *     "behaviorActions": ["AttackAction", "DefendBehaviorAction"],
 *     "parameters": {
 *       "successPolicy": "any",
 *       "failurePolicy": "any"
 *     }
 *   }
 */
class ParallelBehaviorTree extends GUTS.BaseBehaviorTree {

    constructor(game, config = {}) {
        super(game, config);

        // Parse parameters
        const params = config.parameters || {};
        this.successPolicy = params.successPolicy || 'all';
        this.failurePolicy = params.failurePolicy || 'any';

        // Track running children per entity
        // Key: entityId, Value: Set of running child names
        this.runningChildren = new Map();
    }

    /**
     * Evaluate all children in parallel
     * @param {string} entityId - Entity ID
     * @param {object} game - Game instance
     * @returns {Object|null} Combined result based on policies
     */
    evaluate(entityId, game) {
        const behaviorActions = this.config.behaviorActions;
        if (!behaviorActions || behaviorActions.length === 0) {
            return null;
        }

        // Get or create running children set for this entity
        if (!this.runningChildren.has(entityId)) {
            this.runningChildren.set(entityId, new Set());
        }
        const running = this.runningChildren.get(entityId);

        // Evaluate all children
        const results = [];
        let successCount = 0;
        let failureCount = 0;
        let runningCount = 0;
        let primaryResult = null;

        for (const childName of behaviorActions) {
            const result = this.evaluateChild(entityId, game, childName);
            results.push({ name: childName, result });

            if (result === null) {
                // Child failed
                failureCount++;
                running.delete(childName);
            } else if (result.status === 'running') {
                // Child is running
                runningCount++;
                running.add(childName);
                if (!primaryResult) primaryResult = result;
            } else {
                // Child succeeded
                successCount++;
                running.delete(childName);
                if (!primaryResult) primaryResult = result;
            }
        }

        const totalChildren = behaviorActions.length;

        // Apply failure policy
        if (this.failurePolicy === 'any' && failureCount > 0) {
            this.runningChildren.delete(entityId);
            return null; // Fail immediately on any failure
        }
        if (this.failurePolicy === 'all' && failureCount === totalChildren) {
            this.runningChildren.delete(entityId);
            return null; // Fail only when all fail
        }

        // Apply success policy
        if (this.successPolicy === 'all' && successCount === totalChildren) {
            // All succeeded
            this.runningChildren.delete(entityId);
            return this.createSuccessResult(primaryResult);
        }
        if (this.successPolicy === 'any' && successCount > 0) {
            // At least one succeeded
            this.runningChildren.delete(entityId);
            return this.createSuccessResult(primaryResult);
        }

        // Still running if we have running children
        if (runningCount > 0) {
            return this.createRunningResult(primaryResult, {
                parallelRunning: Array.from(running),
                successCount,
                failureCount,
                runningCount
            });
        }

        // Default: use primary result or null
        return primaryResult;
    }

    /**
     * Evaluate a single child (unified node lookup)
     */
    evaluateChild(entityId, game, childName) {
        const node = game.gameManager.call('getNodeByType', childName);
        if (!node) {
            console.warn(`Parallel child not found: ${childName}`);
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
     * Create a success result
     */
    createSuccessResult(primaryResult) {
        return {
            action: primaryResult?.action || 'ParallelBehaviorTree',
            status: 'success',
            meta: primaryResult?.meta || {}
        };
    }

    /**
     * Create a running result with parallel metadata
     */
    createRunningResult(primaryResult, parallelMeta) {
        return {
            action: primaryResult?.action || 'ParallelBehaviorTree',
            status: 'running',
            meta: {
                ...(primaryResult?.meta || {}),
                ...parallelMeta
            }
        };
    }

    /**
     * Clear running state when battle ends
     */
    onBattleEnd(entityId, game) {
        super.onBattleEnd(entityId, game);
        this.runningChildren.delete(entityId);
    }
}
