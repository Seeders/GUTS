/**
 * Deposit Gold Sequence
 * Sequence that handles the depositing phase of gold mining:
 * 1. Check if carrying gold (fails fast if not)
 * 2. Find nearest depot
 * 3. Move to depot
 * 4. Deposit gold
 *
 * Uses shared state to pass data between child nodes.
 * Extends SequenceBehaviorTree to get proper sequence evaluation.
 */
class DepositGoldSequence extends GUTS.SequenceBehaviorTree {

    constructor(game, config = {}) {
        // Set behaviorActions before calling super
        config.behaviorActions = [
            'HasGoldAction',
            'FindNearestDepotAction',
            'MoveToSharedTargetAction',
            'DepositGoldAction'
        ];
        super(game, config);
    }
}
