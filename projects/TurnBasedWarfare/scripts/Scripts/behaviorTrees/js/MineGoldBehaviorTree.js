/**
 * Mine Gold Behavior Tree
 * Main selector for gold mining behavior:
 * 1. Try to deposit gold (if carrying any)
 * 2. Otherwise, gather gold from a mine
 *
 * This replaces the monolithic MineGoldBehaviorAction with a proper
 * tree structure of smaller, reusable nodes.
 *
 * Tree structure:
 * Selector
 * ├── DepositGoldSequence (succeeds if has gold and can deposit)
 * │   ├── HasGoldAction
 * │   ├── FindNearestDepotAction
 * │   ├── MoveToSharedTargetAction
 * │   └── DepositGoldAction
 * │
 * └── GatherGoldSequence (fallback - mine more gold)
 *     ├── FindNearestGoldMineAction
 *     ├── MoveToSharedTargetAction
 *     ├── JoinMineQueueAction
 *     ├── WaitForMineAction
 *     └── ExtractGoldAction
 */
class MineGoldBehaviorTree extends GUTS.BaseBehaviorTree {

    constructor(game, config = {}) {
        super(game, config);

        // Selector behavior - try deposit first, then gather
        this.config.behaviorActions = [
            'DepositGoldSequence',
            'GatherGoldSequence'
        ];
    }

    /**
     * Evaluate as a selector (first success wins)
     * Default BaseBehaviorTree behavior is selector, so we can just call super
     */
    evaluate(entityId, game) {
        return super.evaluate(entityId, game);
    }

    /**
     * Clean up shared state when mining behavior ends
     */
    onEnd(entityId, game) {
        const shared = this.getShared(entityId, game);

        // Clear all mining-related shared state
        shared.targetMine = null;
        shared.targetMinePosition = null;
        shared.targetDepot = null;
        shared.targetDepotPosition = null;
        shared.targetPosition = null;
        shared.inMineQueue = false;
        shared.canMine = false;
        shared.hasGold = false;
        shared.goldAmount = 0;
        shared.miningProgress = 0;

        super.onEnd(entityId, game);
    }

    /**
     * Get shared state (delegates to BaseBehaviorTree helper)
     */
    getShared(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        if (aiState) {
            if (!aiState.shared) {
                aiState.shared = {};
            }
            return aiState.shared;
        }
        return {};
    }
}
