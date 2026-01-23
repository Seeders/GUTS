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

    static serviceDependencies = [
        'getUnitTypeDef'
    ];

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';
        const validateHealth = params.validateHealth !== false;

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = this.call.getUnitTypeDef( unitTypeComp);
        const teamComp = game.getComponent(entityId, 'team');
        const reverseEnums = game.getReverseEnums();
        const teamName = reverseEnums.team?.[teamComp?.team] || teamComp?.team;
        const unitName = unitDef?.id || 'unknown';

        // targetId is null/undefined when not set, or could be 0 (valid entity ID)
        if (targetId === undefined || targetId === null || targetId < 0) {
            log.trace('HasTarget', `${unitName}(${entityId}) [${teamName}] FAILURE - no valid target`, {
                targetId,
                targetKey
            });
            return this.failure();
        }

        // Validate target is still an enemy (entity ID might have been reused after death)
        const targetTeam = game.getComponent(targetId, 'team');
        if (!targetTeam || targetTeam.team === teamComp?.team) {
            log.trace('HasTarget', `${unitName}(${entityId}) [${teamName}] FAILURE - target not enemy (ID reused?)`, {
                targetId,
                targetTeam: targetTeam?.team,
                myTeam: teamComp?.team
            });
            shared[targetKey] = null;
            return this.failure();
        }

        // Optionally validate target is still alive
        if (validateHealth) {
            const targetHealth = game.getComponent(targetId, 'health');
            if (!targetHealth || targetHealth.current <= 0) {
                log.trace('HasTarget', `${unitName}(${entityId}) [${teamName}] FAILURE - target dead/no health`, {
                    targetId,
                    health: targetHealth?.current,
                    maxHealth: targetHealth?.max
                });
                shared[targetKey] = null;
                return this.failure();
            }

            const targetDeathState = game.getComponent(targetId, 'deathState');
            const enums = game.getEnums();
            if (targetDeathState && targetDeathState.state !== enums?.deathState?.alive) {
                log.trace('HasTarget', `${unitName}(${entityId}) [${teamName}] FAILURE - target dying/corpse`, {
                    targetId,
                    deathState: targetDeathState.state
                });
                shared[targetKey] = null;
                return this.failure();
            }
        }

        log.trace('HasTarget', `${unitName}(${entityId}) [${teamName}] SUCCESS - target valid`, {
            targetId
        });
        return this.success({ target: targetId });
    }
}
