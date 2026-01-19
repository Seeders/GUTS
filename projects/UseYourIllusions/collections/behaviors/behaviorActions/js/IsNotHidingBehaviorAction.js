/**
 * IsNotHidingBehaviorAction - Condition action
 * Checks if the entity is NOT currently hiding
 *
 * Returns SUCCESS if NOT hiding, FAILURE if hiding
 *
 * Use as first child in a Sequence to skip the rest when hiding:
 *   Sequence -> IsNotHiding -> [rest of combat logic]
 */
class IsNotHidingBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');

        if (playerOrder?.isHiding) {
            return this.failure();
        }

        return this.success();
    }
}
