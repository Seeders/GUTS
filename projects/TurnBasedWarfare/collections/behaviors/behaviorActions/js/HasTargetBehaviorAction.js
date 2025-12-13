/**
 * HasTargetBehaviorAction - Condition action
 * Checks if entity has a valid target stored in shared state
 *
 * Parameters:
 *   targetKey: string (default: 'target') - Key in shared state to check
 *   validateHealth: boolean (default: true) - Check if target is alive
 *
 * Returns SUCCESS if target exists and is valid, FAILURE otherwise
 */
class HasTargetBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';
        const validateHealth = params.validateHealth !== false;

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        // targetId is null/undefined when not set, or could be 0 (valid entity ID)
        if (targetId === undefined || targetId === null || targetId < 0) {
            return this.failure();
        }

        // Optionally validate target is still alive
        if (validateHealth) {
            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) {
                // Clear invalid target
                shared[targetKey] = null;
                return this.failure();
            }

            const targetDeathState = game.getComponent(targetId, 'deathState');
            const enums = game.call('getEnums');
            if (targetDeathState && targetDeathState.state !== enums?.deathState?.alive) {
                shared[targetKey] = null;
                return this.failure();
            }
        }

        return this.success({ target: targetId });
    }
}
