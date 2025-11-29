/**
 * Loop Decorator
 * Executes child node multiple times or until a condition is met
 *
 * Parameters:
 *   loopType: string - Type of loop:
 *     - 'count': Run exactly N times
 *     - 'whileSuccess': Run while child succeeds
 *     - 'whileFailure': Run while child fails
 *     - 'untilSuccess': Run until child succeeds
 *     - 'untilFailure': Run until child fails
 *     - 'forever': Run indefinitely (returns running)
 *
 *   count: number - Number of iterations (for 'count' type, default: 3)
 *   maxIterations: number - Safety limit for non-count loops (default: 100)
 *   breakOnRunning: boolean - Stop loop if child returns running (default: true)
 *   returnLastResult: boolean - Return last child result vs loop status (default: true)
 *
 * Usage:
 *   {
 *     "fileName": "LoopDecorator",
 *     "childAction": "ProcessItemAction",
 *     "parameters": {
 *       "loopType": "count",
 *       "count": 5
 *     }
 *   }
 */
class LoopDecorator extends GUTS.BaseBehaviorDecorator {

    constructor(game, config) {
        super(game, config);

        this.loopType = this.parameters.loopType || 'count';
        this.count = this.parameters.count || 3;
        this.maxIterations = this.parameters.maxIterations || 100;
        this.breakOnRunning = this.parameters.breakOnRunning !== false;
        this.returnLastResult = this.parameters.returnLastResult !== false;

        // Memory defaults for tracking loop state
        this.memoryDefaults = {
            currentIteration: 0,
            completed: false,
            lastResult: null
        };
    }

    /**
     * Execute the loop
     */
    execute(entityId, game) {
        const memory = this.getMemory(entityId);

        // Reset if previously completed
        if (memory.completed) {
            memory.currentIteration = 0;
            memory.completed = false;
            memory.lastResult = null;
        }

        let result = null;
        let iterations = 0;

        while (iterations < this.maxIterations) {
            // Check loop termination conditions before executing
            if (this.shouldTerminate(memory)) {
                break;
            }

            // Execute child
            result = this.executeChild(entityId, game);
            memory.lastResult = result;
            memory.currentIteration++;
            iterations++;

            // Handle running state
            if (result && result.status === 'running') {
                if (this.breakOnRunning) {
                    return this.createLoopResult(memory, result, 'running', false);
                }
                // Continue loop even with running (unusual but supported)
            }

            // Check if loop should continue based on result
            if (!this.shouldContinue(result)) {
                break;
            }
        }

        // Loop completed or terminated
        memory.completed = true;
        const status = this.determineLoopStatus(memory, result);

        return this.createLoopResult(memory, result, status, true);
    }

    /**
     * Check if loop should terminate before next iteration
     */
    shouldTerminate(memory) {
        switch (this.loopType) {
            case 'count':
                return memory.currentIteration >= this.count;

            case 'forever':
                return false;

            default:
                return false;
        }
    }

    /**
     * Check if loop should continue after child execution
     */
    shouldContinue(result) {
        const childSucceeded = result !== null && result.status !== 'failure';
        const childFailed = result === null || result.status === 'failure';

        switch (this.loopType) {
            case 'count':
                // Count-based continues regardless of result
                return true;

            case 'whileSuccess':
                return childSucceeded;

            case 'whileFailure':
                return childFailed;

            case 'untilSuccess':
                return !childSucceeded;

            case 'untilFailure':
                return !childFailed;

            case 'forever':
                return true;

            default:
                return false;
        }
    }

    /**
     * Determine the final loop status
     */
    determineLoopStatus(memory, lastResult) {
        switch (this.loopType) {
            case 'count':
                // Count loops succeed if they completed all iterations
                return memory.currentIteration >= this.count ? 'success' : 'failure';

            case 'whileSuccess':
                // Terminated because child failed - return success (loop completed its purpose)
                return 'success';

            case 'whileFailure':
                // Terminated because child succeeded - return success
                return 'success';

            case 'untilSuccess':
                // Return success if child eventually succeeded
                return lastResult && lastResult.status !== 'failure' ? 'success' : 'failure';

            case 'untilFailure':
                // Return success if child eventually failed
                return lastResult === null || lastResult.status === 'failure' ? 'success' : 'failure';

            case 'forever':
                // Forever loops always return running
                return 'running';

            default:
                return lastResult ? lastResult.status : 'failure';
        }
    }

    /**
     * Create the loop result with metadata
     */
    createLoopResult(memory, childResult, status, completed) {
        const meta = {
            loopType: this.loopType,
            iterations: memory.currentIteration,
            maxIterations: this.loopType === 'count' ? this.count : this.maxIterations,
            completed: completed,
            childResult: childResult ? {
                action: childResult.action,
                status: childResult.status
            } : null
        };

        // Return based on configuration
        if (this.returnLastResult && childResult) {
            return {
                ...childResult,
                meta: {
                    ...childResult.meta,
                    loop: meta
                }
            };
        }

        // Return loop-level result
        switch (status) {
            case 'success':
                return this.success(meta);
            case 'running':
                return this.running(meta);
            default:
                return this.failure();
        }
    }

    /**
     * Reset the loop state for an entity
     */
    resetLoop(entityId) {
        const memory = this.getMemory(entityId);
        memory.currentIteration = 0;
        memory.completed = false;
        memory.lastResult = null;
    }

    /**
     * Get current iteration count
     */
    getCurrentIteration(entityId) {
        return this.getMemory(entityId).currentIteration;
    }

    /**
     * Check if loop is completed
     */
    isCompleted(entityId) {
        return this.getMemory(entityId).completed;
    }

    /**
     * Called when decorator ends - reset loop state
     */
    onEnd(entityId, game) {
        super.onEnd(entityId, game);
    }
}
