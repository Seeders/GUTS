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

    execute(entityId, game) {
        const params = this.parameters || {};
        const targetKey = params.targetKey || 'target';

        const shared = this.getShared(entityId, game);
        const targetId = shared[targetKey];

        // targetId is null/undefined when not set, or could be 0 (valid entity ID)
        if (targetId === undefined || targetId === null || targetId < 0) {
            return this.failure();
        }

        const targetTransform = game.getComponent(targetId, 'transform');
        const targetPos = targetTransform?.position;
        const combat = game.getComponent(entityId, 'combat');

        if (!targetPos || !combat) {
            return this.failure();
        }

        const baseRange = combat.range || 50;
        const arrivalRange = params.arrivalRange || GUTS.GameUtils.getEffectiveRange(game, entityId, targetId, baseRange);
        const distance = GUTS.GameUtils.getDistanceBetweenEntities(game, entityId, targetId);

        // Debug logging
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitDef = game.call('getUnitTypeDef', unitTypeComp);
        const teamComp = game.getComponent(entityId, 'team');
        const reverseEnums = game.getReverseEnums();
        const teamName = reverseEnums.team?.[teamComp?.team] || teamComp?.team;

        // Check if in range
        if (distance <= arrivalRange) {
            console.log(`[MoveToEnemy] ${unitDef?.id} (${teamName}) ARRIVED at target ${targetId}, distance: ${distance.toFixed(0)}, range: ${arrivalRange}`);
            return this.success({
                arrived: true,
                distance,
                target: targetId
            });
        }

        console.log(`[MoveToEnemy] ${unitDef?.id} (${teamName}) moving to target ${targetId}, distance: ${distance.toFixed(0)}, range: ${arrivalRange}`);

        // Still moving - return running with targetPosition for MovementSystem
        return this.running({
            targetPosition: { x: targetPos.x, z: targetPos.z },
            distance,
            target: targetId,
            moving: true
        });
    }
}
