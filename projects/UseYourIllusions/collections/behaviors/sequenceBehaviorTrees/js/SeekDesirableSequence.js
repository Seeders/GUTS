/**
 * SeekDesirableSequence - Sequence that finds and picks up desirable objects
 *
 * Sequence:
 * 1. FindDesirableObjectBehaviorAction - Look for nearby desirable objects
 * 2. PickUpObjectBehaviorAction - Move to and pick up the object
 *
 * Returns SUCCESS if object found and picked up
 * Returns RUNNING while moving to object
 * Returns FAILURE if no desirable object found
 */
class SeekDesirableSequence extends GUTS.BaseBehaviorTree {

    /**
     * Override evaluateComposite to use sequence pattern instead of selector
     */
    evaluateComposite(entityId, game) {
        return this.evaluateSequence(entityId, game);
    }
}
