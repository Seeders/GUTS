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

    static serviceDependencies = [];

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';
        const validateHealth = params.validateHealth !== false;

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = game.getUnitTypeDef( unitTypeComp);
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

        // Drop targets that have left vision range. Without this leash a unit
        // chases its first target across the whole map (through fog), ignoring
        // its move order — the combat tree stays "running" and is resumed ahead
        // of PlayerOrderBehaviorTree, so a stale target means a runaway chase.
        //
        // Leash reference point: a unit with a COMPLETED move order defends its
        // ordered spot, so the leash is measured from THAT anchor (otherwise
        // each chase re-measures from the unit's drifting position and the
        // defender ratchets across the map). Marching/unordered units measure
        // from their own position.
        const myPos = game.getComponent(entityId, 'transform')?.position;
        const targetPos = game.getComponent(targetId, 'transform')?.position;
        if (myPos && targetPos) {
            const po = game.getComponent(entityId, 'playerOrder');
            const anchored = po?.enabled && po.isMoveOrder && po.completed;
            const refX = anchored ? po.targetPositionX : myPos.x;
            const refZ = anchored ? po.targetPositionZ : myPos.z;
            const visionRange = game.getComponent(entityId, 'combat')?.visionRange || 300;
            const dx = targetPos.x - refX;
            const dz = targetPos.z - refZ;
            if (dx * dx + dz * dz > visionRange * visionRange) {
                log.trace('HasTarget', `${unitName}(${entityId}) [${teamName}] FAILURE - target left leash`, {
                    targetId,
                    anchored,
                    visionRange
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
