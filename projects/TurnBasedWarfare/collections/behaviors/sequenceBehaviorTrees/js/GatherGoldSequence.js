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
