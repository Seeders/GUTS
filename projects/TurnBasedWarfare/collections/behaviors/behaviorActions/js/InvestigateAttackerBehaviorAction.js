/**
 * InvestigateAttackerBehaviorAction - Retaliation action
 * When a unit has no target but was recently attacked, this action
 * sets the attacker as the target so the unit can investigate/pursue them.
 *
 * This helps ranged units respond to attacks from enemies they couldn't see
 * (e.g., when LOS was blocked but they got hit by a projectile).
 *
 * Parameters:
 *   targetKey: string (default: 'target') - Key to store target in shared state
 *   maxAge: number (default: 5) - Maximum age in seconds for lastAttacker to be valid
 *
 * Returns SUCCESS if attacker set as target, FAILURE if no valid attacker or already has target
 */
class InvestigateAttackerBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'getUnitTypeDef'
    ];

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';
        const maxAge = params.maxAge || 5; // seconds

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = this.call.getUnitTypeDef( unitTypeComp);
        const teamComp = game.getComponent(entityId, 'team');
        const reverseEnums = game.getReverseEnums();
        const teamName = reverseEnums.team?.[teamComp?.team] || teamComp?.team;
        const unitName = unitDef?.id || 'unknown';

        // Check if we already have a target
        const shared = this.getShared(entityId, game);
        const currentTarget = shared[targetKey];

        if (currentTarget !== undefined && currentTarget !== null && currentTarget >= 0) {
            // Already have a target - check if it's still valid
            const targetHealth = game.getComponent(currentTarget, 'health');
            const targetDeathState = game.getComponent(currentTarget, 'deathState');
            const enums = game.getEnums();

            if (targetHealth && targetHealth.current > 0 &&
                (!targetDeathState || targetDeathState.state === enums.deathState.alive)) {
                log.trace('InvestigateAttacker', `${unitName}(${entityId}) [${teamName}] SKIP - already has valid target`, {
                    currentTarget
                });
                return this.failure();
            }
        }

        // Check combatState for lastAttacker
        const combatState = game.getComponent(entityId, 'combatState');
        if (!combatState || combatState.lastAttacker === undefined || combatState.lastAttacker === null) {
            log.trace('InvestigateAttacker', `${unitName}(${entityId}) [${teamName}] FAILURE - no lastAttacker`);
            return this.failure();
        }

        // Check if the attack was recent enough
        const timeSinceAttack = game.state.now - combatState.lastAttackTime;
        if (timeSinceAttack > maxAge) {
            log.trace('InvestigateAttacker', `${unitName}(${entityId}) [${teamName}] FAILURE - attack too old`, {
                timeSinceAttack: timeSinceAttack.toFixed(1),
                maxAge
            });
            return this.failure();
        }

        const attackerId = combatState.lastAttacker;

        // Validate attacker is still alive and is an enemy
        const attackerHealth = game.getComponent(attackerId, 'health');
        const attackerDeathState = game.getComponent(attackerId, 'deathState');
        const attackerTeam = game.getComponent(attackerId, 'team');
        const enums = game.getEnums();

        if (!attackerHealth || attackerHealth.current <= 0 ||
            (attackerDeathState && attackerDeathState.state !== enums.deathState.alive)) {
            log.trace('InvestigateAttacker', `${unitName}(${entityId}) [${teamName}] FAILURE - attacker dead`, {
                attackerId
            });
            return this.failure();
        }

        if (!attackerTeam || attackerTeam.team === teamComp?.team) {
            log.trace('InvestigateAttacker', `${unitName}(${entityId}) [${teamName}] FAILURE - attacker not enemy`, {
                attackerId,
                attackerTeam: attackerTeam?.team
            });
            return this.failure();
        }

        // Get attacker info for logging
        const attackerUnitTypeComp = game.getComponent(attackerId, 'unitType');
        const attackerUnitDef = this.call.getUnitTypeDef( attackerUnitTypeComp);
        const attackerName = attackerUnitDef?.id || 'unknown';
        const attackerTeamName = reverseEnums.team?.[attackerTeam?.team] || attackerTeam?.team;

        // Set attacker as target
        shared[targetKey] = attackerId;

        log.info('InvestigateAttacker', `${unitName}(${entityId}) [${teamName}] INVESTIGATING attacker ${attackerName}(${attackerId}) [${attackerTeamName}]`, {
            timeSinceAttack: timeSinceAttack.toFixed(1)
        });

        return this.success({
            target: attackerId,
            timeSinceAttack
        });
    }
}
