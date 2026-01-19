/**
 * Has Gold Action
 * Simple condition check - succeeds if entity is carrying gold
 *
 * Reads from shared state:
 *   - hasGold: boolean
 *   - goldAmount: number (optional, for threshold check)
 *
 * Parameters:
 *   - minAmount: number - Minimum gold required (default: 0, any gold)
 *
 * Returns:
 *   - SUCCESS if carrying gold (and meets minAmount if specified)
 *   - FAILURE if not carrying gold
 */
class HasGoldBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const shared = this.getShared(entityId, game);
        const minAmount = this.parameters.minAmount || 0;

        const hasGold = shared.hasGold === true;
        const goldAmount = shared.goldAmount || 0;

        if (hasGold && goldAmount > minAmount) {
            return this.success({
                hasGold: true,
                goldAmount: goldAmount
            });
        }

        return this.failure();
    }
}
