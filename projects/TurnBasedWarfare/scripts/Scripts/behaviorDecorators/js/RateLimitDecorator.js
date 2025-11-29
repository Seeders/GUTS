/**
 * Rate Limit Decorator
 * Limits how often the child node can be executed
 *
 * Parameters:
 *   interval: number - Minimum time (ms) between executions (default: 1000)
 *   maxExecutions: number - Maximum executions per interval (default: 1)
 *   resetOnSuccess: boolean - Reset timer on successful execution (default: false)
 *   resetOnFailure: boolean - Reset timer on failed execution (default: false)
 *   failureResult: string - What to return when rate limited: 'failure', 'success', 'running' (default: 'failure')
 *
 * Usage:
 *   {
 *     "fileName": "RateLimitDecorator",
 *     "childAction": "ExpensiveCalculation",
 *     "parameters": {
 *       "interval": 500,
 *       "maxExecutions": 1,
 *       "failureResult": "running"
 *     }
 *   }
 */
class RateLimitDecorator extends GUTS.BaseBehaviorDecorator {

    constructor(game, config) {
        super(game, config);

        this.interval = this.parameters.interval || 1000;
        this.maxExecutions = this.parameters.maxExecutions || 1;
        this.resetOnSuccess = this.parameters.resetOnSuccess || false;
        this.resetOnFailure = this.parameters.resetOnFailure || false;
        this.failureResult = this.parameters.failureResult || 'failure';

        // Memory defaults for tracking execution times
        this.memoryDefaults = {
            lastExecutionTime: 0,
            executionsInWindow: 0,
            windowStartTime: 0
        };
    }

    /**
     * Execute - only run child if rate limit allows
     */
    execute(entityId, game) {
        const memory = this.getMemory(entityId);
        const now = performance.now();

        // Check if we're in a new time window
        if (now - memory.windowStartTime >= this.interval) {
            // Reset the window
            memory.windowStartTime = now;
            memory.executionsInWindow = 0;
        }

        // Check if we've exceeded the rate limit
        if (memory.executionsInWindow >= this.maxExecutions) {
            return this.getRateLimitedResult(memory);
        }

        // Execute the child
        const childResult = this.executeChild(entityId, game);

        // Track execution
        memory.executionsInWindow++;
        memory.lastExecutionTime = now;

        // Handle reset conditions
        if (childResult) {
            if (this.resetOnSuccess && childResult.status === 'success') {
                memory.executionsInWindow = 0;
                memory.windowStartTime = now;
            }
        } else {
            if (this.resetOnFailure) {
                memory.executionsInWindow = 0;
                memory.windowStartTime = now;
            }
        }

        // Add rate limit info to result
        if (childResult) {
            return {
                ...childResult,
                meta: {
                    ...childResult.meta,
                    rateLimited: false,
                    executionsInWindow: memory.executionsInWindow,
                    maxExecutions: this.maxExecutions,
                    timeUntilReset: Math.max(0, this.interval - (now - memory.windowStartTime))
                }
            };
        }

        return childResult;
    }

    /**
     * Get the result to return when rate limited
     */
    getRateLimitedResult(memory) {
        const now = performance.now();
        const timeUntilReset = Math.max(0, this.interval - (now - memory.windowStartTime));

        const meta = {
            rateLimited: true,
            executionsInWindow: memory.executionsInWindow,
            maxExecutions: this.maxExecutions,
            timeUntilReset: timeUntilReset
        };

        switch (this.failureResult) {
            case 'success':
                return this.success(meta);

            case 'running':
                return this.running(meta);

            case 'failure':
            default:
                return this.failure();
        }
    }

    /**
     * Get time until rate limit resets
     */
    getTimeUntilReset(entityId) {
        const memory = this.getMemory(entityId);
        const now = performance.now();
        return Math.max(0, this.interval - (now - memory.windowStartTime));
    }

    /**
     * Check if currently rate limited
     */
    isRateLimited(entityId) {
        const memory = this.getMemory(entityId);
        const now = performance.now();

        // Check if we're in a new time window
        if (now - memory.windowStartTime >= this.interval) {
            return false;
        }

        return memory.executionsInWindow >= this.maxExecutions;
    }

    /**
     * Manually reset the rate limit for an entity
     */
    resetRateLimit(entityId) {
        const memory = this.getMemory(entityId);
        memory.executionsInWindow = 0;
        memory.windowStartTime = performance.now();
    }
}
