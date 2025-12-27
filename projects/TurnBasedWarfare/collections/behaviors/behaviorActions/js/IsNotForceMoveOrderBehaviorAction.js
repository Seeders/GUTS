/**
 * IsNotForceMoveOrderBehaviorAction - Condition action
 * Checks if the entity does NOT have an active force move order
 *
 * Returns SUCCESS if NOT force moving, FAILURE if force moving
 *
 * Use as first child in a Sequence to skip the rest during force moves:
 *   Sequence -> IsNotForceMoveOrder -> [rest of combat logic]
 *
 * Force move orders have preventEnemiesInRangeCheck=true and should
 * prevent all combat until the order is cleared.
 */
class IsNotForceMoveOrderBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');

        // Check if there's an active force move order
        if (playerOrder?.enabled && playerOrder?.preventEnemiesInRangeCheck) {
            // Force move is active - block combat
            return this.failure();
        }

        return this.success();
    }
}
