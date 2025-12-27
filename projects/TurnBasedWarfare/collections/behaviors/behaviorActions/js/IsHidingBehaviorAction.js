/**
 * IsHidingBehaviorAction - Condition action
 * Checks if the entity is currently hiding
 *
 * Returns SUCCESS if hiding, FAILURE otherwise
 *
 * Use with Inverter node to skip combat when hiding:
 *   Inverter -> IsHiding (fails if hiding, allowing sequence to continue if NOT hiding)
 */
class IsHidingBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const playerOrder = game.getComponent(entityId, 'playerOrder');

        if (playerOrder?.isHiding) {
            return this.success();
        }

        return this.failure();
    }
}
