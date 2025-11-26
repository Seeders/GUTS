/**
 * Inverter Decorator
 * Flips success to failure and failure to success
 * Running status passes through unchanged
 */
class InverterDecorator extends GUTS.BaseBehaviorDecorator {

    execute(entityId, game) {
        const result = this.executeChild(entityId, game);

        if (result === null) {
            // Child failed, return success
            return this.success({});
        }

        if (result.status === 'running') {
            // Pass through running status
            return this.running(result.meta);
        }

        // Child succeeded, return failure
        return this.failure();
    }
}
