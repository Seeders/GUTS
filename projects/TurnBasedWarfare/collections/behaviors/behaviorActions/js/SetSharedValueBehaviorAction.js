/**
 * SetSharedValueBehaviorAction - Utility action
 * Sets a value in the shared state (aiState.shared)
 *
 * Parameters:
 *   key: string (required) - Key to set in shared state
 *   value: any (optional) - Value to set (can be any type)
 *   valueFromKey: string (optional) - Copy value from another shared key
 *   clear: boolean (default: false) - Clear (delete) the key instead of setting
 *   increment: number (optional) - Add this number to existing value
 *   toggle: boolean (default: false) - Toggle boolean value
 *
 * Always returns SUCCESS after setting the value
 */
class SetSharedValueBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const params = this.parameters || {};
        const key = params.key;

        if (!key) {
            console.warn('SetSharedValueBehaviorAction: key parameter is required');
            return this.failure();
        }

        const shared = this.getShared(entityId, game);

        // Clear the key
        if (params.clear) {
            const previousValue = shared[key];
            delete shared[key];
            return this.success({
                key,
                action: 'clear',
                previousValue
            });
        }

        // Toggle boolean
        if (params.toggle) {
            const previousValue = shared[key];
            shared[key] = !previousValue;
            return this.success({
                key,
                action: 'toggle',
                previousValue,
                newValue: shared[key]
            });
        }

        // Increment number
        if (params.increment !== undefined) {
            const previousValue = shared[key] || 0;
            shared[key] = previousValue + params.increment;
            return this.success({
                key,
                action: 'increment',
                increment: params.increment,
                previousValue,
                newValue: shared[key]
            });
        }

        // Copy from another key
        if (params.valueFromKey) {
            const copiedValue = shared[params.valueFromKey];
            shared[key] = copiedValue;
            return this.success({
                key,
                action: 'copy',
                sourceKey: params.valueFromKey,
                newValue: copiedValue
            });
        }

        // Set explicit value
        const previousValue = shared[key];
        shared[key] = params.value;

        return this.success({
            key,
            action: 'set',
            previousValue,
            newValue: params.value
        });
    }
}

