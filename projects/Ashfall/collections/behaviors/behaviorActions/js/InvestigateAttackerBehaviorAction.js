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

    static serviceDependencies = [];

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';
        const maxAge = params.maxAge || 5; // seconds

        // Never derail an active attack-move order. This action is reached from
        // BOTH PlayerOrderBehaviorTree and CombatSelector's InvestigateSequence —
        // the latter stays "running" and is resumed ahead of the order tree, so a
        // single pot-shot (e.g. from a sentry outpost) would otherwise send the
        // unit marching at the attacker and the move order would never resume.
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (playerOrder?.enabled && playerOrder.isMoveOrder && !playerOrder.completed) {
            return this.failure();
        }

        // Pursuing attackers the unit cannot even see (fog of war) is also
        // capped for unordered units: only investigate attackers within vision
        // range — units hold their ground rather than marching into the dark.
        const myPosForLeash = game.getComponent(entityId, 'transform')?.position;
        const combatStateEarly = game.getComponent(entityId, 'combatState');
        const earlyAttackerId = combatStateEarly?.lastAttacker;
        if (myPosForLeash && earlyAttackerId != null && earlyAttackerId >= 0) {
            const attackerPos = game.getComponent(earlyAttackerId, 'transform')?.position;
            if (attackerPos) {
                const visionRange = game.getComponent(entityId, 'combat')?.visionRange || 300;
                const dx = attackerPos.x - myPosForLeash.x;
                const dz = attackerPos.z - myPosForLeash.z;
                if (dx * dx + dz * dz > visionRange * visionRange) {
                    return this.failure();
                }
            }
        }

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = game.getUnitTypeDef( unitTypeComp);
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
        const attackerUnitDef = game.getUnitTypeDef( attackerUnitTypeComp);
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
