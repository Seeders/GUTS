/**
 * Cooldown Decorator
 * Prevents the child action from running more frequently than specified
 * Parameters:
 *   - cooldownTime: Time in seconds between allowed executions
 *   - failOnCooldown: If true, returns failure when on cooldown; otherwise passes through
 */
class CooldownDecorator extends GUTS.BaseBehaviorDecorator {

    execute(entityId, game) {
        const memory = this.getMemory(entityId);
        const cooldownTime = this.parameters.cooldownTime || 1;
        const failOnCooldown = this.parameters.failOnCooldown !== false;

        const now = game.state?.now || Date.now() / 1000;

        // Initialize last execution time if needed
        if (memory.lastExecution === undefined) {
            memory.lastExecution = 0;
        }

        const timeSinceLastExecution = now - memory.lastExecution;

        // Check if on cooldown
        if (timeSinceLastExecution < cooldownTime) {
            if (failOnCooldown) {
                return this.failure();
            }
            // Not failing on cooldown, return running to indicate waiting
            return this.running({
                onCooldown: true,
                remainingCooldown: cooldownTime - timeSinceLastExecution
            });
        }

        // Execute child
        const result = this.evaluateChild(entityId, game, this.child);

        // If child succeeded or is running, update last execution time
        if (result !== null) {
            if (result.status !== 'running') {
                // Only update cooldown on completion, not while running
                memory.lastExecution = now;
            }
            return result;
        }

        // Child failed
        return this.failure();
    }
}
