/**
 * MoveToEnemyBehaviorAction - Movement action
 * Moves toward the target enemy stored in shared state
 *
 * Parameters:
 *   targetKey: string (default: 'target') - Key in shared state for target entity ID
 *   arrivalRange: number (default: uses combat.range) - Stop when this close to target
 *
 * Returns SUCCESS when in range, RUNNING while moving, FAILURE if no target
 */
class MoveToEnemyBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'getUnitTypeDef'
    ];

    execute(entityId, game) {
        const log = GUTS.HeadlessLogger;
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

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
            log.trace('MoveToEnemy', `${unitName}(${entityId}) [${teamName}] FAILURE - no valid target`, {
                targetId
            });
            return this.failure();
        }

        const targetTransform = game.getComponent(targetId, 'transform');
        const targetPos = targetTransform?.position;
        const combat = game.getComponent(entityId, 'combat');
        const transform = game.getComponent(entityId, 'transform');
        const myPos = transform?.position;

        if (!targetPos || !combat) {
            log.trace('MoveToEnemy', `${unitName}(${entityId}) [${teamName}] FAILURE - missing targetPos or combat`, {
                hasTargetPos: !!targetPos,
                hasCombat: !!combat
            });
            return this.failure();
        }

        const baseRange = params.arrivalRange || combat.range || 50;
        // Melee units (range < 50) need effective range with collision radii
        // Ranged units use center-to-center to match ability canExecute checks
        const arrivalRange = baseRange < 50
            ? GUTS.GameUtils.getEffectiveRange(game, entityId, targetId, baseRange)
            : baseRange;
        const distance = GUTS.GameUtils.getDistanceBetweenEntities(game, entityId, targetId);

        // Check if in range
        if (distance <= arrivalRange) {
            log.debug('MoveToEnemy', `${unitName}(${entityId}) [${teamName}] ARRIVED at target`, {
                targetId,
                distance: distance.toFixed(0),
                arrivalRange
            });
            return this.success({
                arrived: true,
                distance,
                target: targetId
            });
        }

        log.trace('MoveToEnemy', `${unitName}(${entityId}) [${teamName}] MOVING to target`, {
            targetId,
            myPos: myPos ? { x: myPos.x.toFixed(0), z: myPos.z.toFixed(0) } : null,
            targetPos: { x: targetPos.x.toFixed(0), z: targetPos.z.toFixed(0) },
            distance: distance.toFixed(0),
            arrivalRange
        });

        // Still moving - return running with targetPosition for MovementSystem
        return this.running({
            targetPosition: { x: targetPos.x, z: targetPos.z },
            distance,
            target: targetId,
            moving: true
        });
    }
}
