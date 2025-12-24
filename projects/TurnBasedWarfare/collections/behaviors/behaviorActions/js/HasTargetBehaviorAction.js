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

        // Debug logging
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = game.call('getUnitTypeDef', unitTypeComp);
        const teamComp = game.getComponent(entityId, 'team');
        const reverseEnums = game.getReverseEnums();
        const teamName = reverseEnums.team?.[teamComp?.team] || teamComp?.team;

        // targetId is null/undefined when not set, or could be 0 (valid entity ID)
        if (targetId === undefined || targetId === null || targetId < 0) {
            if (unitDef?.id === '1_d_archer') {
                console.log(`[HasTarget] ${unitDef.id} (${teamName}) FAILURE - no valid target (targetId=${targetId})`);
            }
            return this.failure();
        }

        // Optionally validate target is still alive
        if (validateHealth) {
            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) {
                // Clear invalid target
                if (unitDef?.id === '1_d_archer') {
                    console.log(`[HasTarget] ${unitDef.id} (${teamName}) FAILURE - target ${targetId} has no/zero health`);
                }
                shared[targetKey] = null;
                return this.failure();
            }

            const targetDeathState = game.getComponent(targetId, 'deathState');
            const enums = game.call('getEnums');
            if (targetDeathState && targetDeathState.state !== enums?.deathState?.alive) {
                if (unitDef?.id === '1_d_archer') {
                    console.log(`[HasTarget] ${unitDef.id} (${teamName}) FAILURE - target ${targetId} is dead/dying`);
                }
                shared[targetKey] = null;
                return this.failure();
            }
        }

        if (unitDef?.id === '1_d_archer') {
            console.log(`[HasTarget] ${unitDef.id} (${teamName}) SUCCESS - target ${targetId} is valid`);
        }
        return this.success({ target: targetId });
    }
}
