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
 * │   ├── HasGoldBehaviorAction
 * │   ├── FindNearestDepotBehaviorAction
 * │   ├── MoveToSharedTargetBehaviorAction
 * │   └── DepositGoldBehaviorAction
 * │
 * └── GatherGoldSequence (fallback - mine more gold)
 *     ├── FindNearestGoldMineBehaviorAction
 *     ├── MoveToSharedTargetBehaviorAction
 *     ├── JoinMineQueueBehaviorAction
 *     ├── WaitForMineBehaviorAction
 *     └── ExtractGoldBehaviorAction
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
        // Check for nearby enemies first - if enemies are nearby, skip mining and let combat take over
        const isEnemyNearby = game.call('getNodeByType', 'IsEnemyNearbyBehaviorAction');
        if (isEnemyNearby) {
            const enemyCheckResult = isEnemyNearby.execute(entityId, game);
            if (enemyCheckResult && enemyCheckResult.status === 'success') {
                // Enemy nearby - return null to let combat behavior take over
                return null;
            }
        }

        return super.evaluate(entityId, game);
    }

    /**
     * Clean up shared state when mining behavior ends
     */
    onEnd(entityId, game) {
        // Clear behavior state via BehaviorSystem
        game.call('clearBehaviorState', entityId);

        super.onEnd(entityId, game);
    }
}
