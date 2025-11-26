/**
 * Repeater Decorator
 * Runs the child action multiple times
 * Parameters:
 *   - times: Number of times to repeat (0 = infinite)
 *   - untilFail: If true, repeat until child fails
 *   - untilSuccess: If true, repeat until child succeeds
 */
class RepeaterDecorator extends GUTS.BaseBehaviorDecorator {

    execute(entityId, game) {
        const memory = this.getMemory(entityId);
        const times = this.parameters.times || 0;
        const untilFail = this.parameters.untilFail || false;
        const untilSuccess = this.parameters.untilSuccess || false;

        // Initialize count if needed
        if (memory.count === undefined) {
            memory.count = 0;
        }

        const result = this.executeChild(entityId, game);

        // Handle running status
        if (result && result.status === 'running') {
            return this.running({ ...result.meta, repeatCount: memory.count });
        }

        // Child completed (success or failure)
        const childSucceeded = result !== null;

        // Check termination conditions
        if (untilFail && !childSucceeded) {
            // Wanted to run until fail, child failed - we're done with success
            memory.count = 0;
            return this.success({ repeatCount: memory.count });
        }

        if (untilSuccess && childSucceeded) {
            // Wanted to run until success, child succeeded - we're done
            memory.count = 0;
            return this.success({ ...result.meta, repeatCount: memory.count });
        }

        // Increment count
        memory.count++;

        // Check if we've reached the repeat limit
        if (times > 0 && memory.count >= times) {
            // Reached limit
            const finalCount = memory.count;
            memory.count = 0;
            return childSucceeded ? this.success({ repeatCount: finalCount }) : this.failure();
        }

        // Continue repeating
        return this.running({ repeatCount: memory.count });
    }

    onEnd(entityId, game) {
        super.onEnd(entityId, game);
    }
}
