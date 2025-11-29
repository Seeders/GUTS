/**
 * Retry Decorator
 * Retries the child action on failure up to a maximum number of attempts
 * Parameters:
 *   - maxAttempts: Maximum number of retry attempts (default: 3)
 *   - retryDelay: Optional delay between retries in seconds (default: 0)
 */
class RetryDecorator extends GUTS.BaseBehaviorDecorator {

    execute(entityId, game) {
        const memory = this.getMemory(entityId);
        const maxAttempts = this.parameters.maxAttempts || 3;
        const retryDelay = this.parameters.retryDelay || 0;

        const now = game.state?.now || Date.now() / 1000;

        // Initialize attempts if needed
        if (memory.attempts === undefined) {
            memory.attempts = 0;
            memory.lastAttemptTime = 0;
        }

        // Check retry delay
        if (retryDelay > 0 && memory.attempts > 0) {
            const timeSinceLastAttempt = now - memory.lastAttemptTime;
            if (timeSinceLastAttempt < retryDelay) {
                return this.running({
                    waiting: true,
                    attempts: memory.attempts,
                    remainingDelay: retryDelay - timeSinceLastAttempt
                });
            }
        }

        // Execute child
        const result = this.executeChild(entityId, game);

        if (result && result.status === 'running') {
            // Child is running
            return this.running({ ...result.meta, attempts: memory.attempts });
        }

        if (result !== null) {
            // Child succeeded
            memory.attempts = 0;
            return this.success({ ...result.meta, attempts: memory.attempts });
        }

        // Child failed
        memory.attempts++;
        memory.lastAttemptTime = now;

        if (memory.attempts >= maxAttempts) {
            // Exhausted all attempts
            const finalAttempts = memory.attempts;
            memory.attempts = 0;
            return this.failure();
        }

        // Will retry next tick
        return this.running({
            retrying: true,
            attempts: memory.attempts,
            maxAttempts: maxAttempts
        });
    }

    onEnd(entityId, game) {
        super.onEnd(entityId, game);
    }
}
