/**
 * Timeout Decorator
 * Fails if the child action takes longer than specified time
 * Parameters:
 *   - timeout: Maximum time in seconds for child to complete
 */
class TimeoutDecorator extends GUTS.BaseBehaviorDecorator {

    execute(entityId, game) {
        const memory = this.getMemory(entityId);
        const timeout = this.parameters.timeout || 5;

        const now = game.state?.now || Date.now() / 1000;

        // Initialize start time if this is a new execution
        if (memory.startTime === undefined) {
            memory.startTime = now;
        }

        const elapsed = now - memory.startTime;

        // Check if we've exceeded timeout
        if (elapsed >= timeout) {
            // Timeout exceeded, fail
            memory.startTime = undefined;
            return this.failure();
        }

        // Execute child
        const result = this.evaluateChild(entityId, game, this.child);

        if (result === null) {
            // Child failed
            memory.startTime = undefined;
            return this.failure();
        }

        if (result.status === 'running') {
            // Child still running, check timeout next tick
            return this.running({
                ...result.meta,
                elapsed: elapsed,
                remaining: timeout - elapsed
            });
        }

        // Child succeeded
        memory.startTime = undefined;
        return this.success(result.meta);
    }

    onEnd(entityId, game) {
        const memory = this.getMemory(entityId);
        memory.startTime = undefined;
        super.onEnd(entityId, game);
    }
}
