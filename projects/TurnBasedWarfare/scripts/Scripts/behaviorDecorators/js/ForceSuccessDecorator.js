/**
 * ForceSuccess Decorator
 * Always returns success regardless of child result
 * Running status passes through unchanged
 */
class ForceSuccessDecorator extends GUTS.BaseBehaviorDecorator {

    execute(entityId, game) {
        const result = this.executeChild(entityId, game);

        if (result && result.status === 'running') {
            // Pass through running status
            return this.running(result.meta);
        }

        // Always return success
        return this.success(result?.meta || {});
    }
}
