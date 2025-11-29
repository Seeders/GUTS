/**
 * Gather Gold Sequence
 * Sequence that handles the gathering phase of gold mining:
 * 1. Find nearest gold mine
 * 2. Move to the mine
 * 3. Join the mining queue
 * 4. Wait for turn
 * 5. Extract gold
 *
 * Uses shared state to pass data between child nodes.
 * Extends SequenceBehaviorTree to get proper sequence evaluation.
 */
class GatherGoldSequence extends GUTS.SequenceBehaviorTree {

    constructor(game, config = {}) {
        // Set behaviorActions before calling super
        config.behaviorActions = [
            'FindNearestGoldMineBehaviorAction',
            'MoveToSharedTargetBehaviorAction',
            'JoinMineQueueBehaviorAction',
            'WaitForMineBehaviorAction',
            'ExtractGoldBehaviorAction'
        ];
        super(game, config);
    }
}
