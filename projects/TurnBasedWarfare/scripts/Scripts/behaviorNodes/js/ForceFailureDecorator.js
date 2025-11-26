/**
 * ForceFailure Decorator
 * Always returns failure regardless of child result
 * Running status passes through unchanged
 */
class ForceFailureDecorator extends GUTS.BaseBehaviorDecorator {

    execute(entityId, game) {
        const result = this.executeChild(entityId, game);

        if (result && result.status === 'running') {
            // Pass through running status
            return this.running(result.meta);
        }

        // Always return failure
        return this.failure();
    }
}
