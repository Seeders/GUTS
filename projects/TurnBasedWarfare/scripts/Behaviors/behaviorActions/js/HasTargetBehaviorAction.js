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

        const isArcher = entityId.includes('archer') && game.state?.phase === 'battle';

        if (!targetId) {
            if (isArcher) console.log(`[HasTargetBehaviorAction] No target in shared state`);
            return this.failure();
        }

        // Optionally validate target is still alive
        if (validateHealth) {
            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) {
                if (isArcher) console.log(`[HasTargetBehaviorAction] Target ${targetId} is dead (health=${targetHealth?.current}), clearing`);
                // Clear invalid target
                shared[targetKey] = null;
                return this.failure();
            }

            const targetDeathState = game.getComponent(targetId, 'deathState');
            if (targetDeathState && targetDeathState.isDying) {
                if (isArcher) console.log(`[HasTargetBehaviorAction] Target ${targetId} is dying, clearing`);
                shared[targetKey] = null;
                return this.failure();
            }
        }

        if (isArcher) console.log(`[HasTargetBehaviorAction] Target ${targetId} is valid`);
        return this.success({ target: targetId });
    }
}
