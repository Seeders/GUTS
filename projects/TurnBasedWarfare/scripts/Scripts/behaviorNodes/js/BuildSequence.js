/**
 * Build Sequence
 * Sequence that handles the building process:
 * 1. Check if valid build order exists
 * 2. Get build target info and store in shared state
 * 3. Move to the building site
 * 4. Construct the building
 *
 * Uses shared state to pass data between child nodes.
 * Extends SequenceBehaviorTree to get proper sequence evaluation.
 */
class BuildSequence extends GUTS.SequenceBehaviorTree {

    constructor(game, config = {}) {
        // Set behaviorActions before calling super
        config.behaviorActions = [
            'HasBuildOrderAction',
            'SetBuildTargetAction',
            'MoveToSharedTargetAction',
            'ConstructBuildingAction'
        ];
        super(game, config);
    }
}
