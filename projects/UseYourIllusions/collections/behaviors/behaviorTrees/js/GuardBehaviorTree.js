/**
 * GuardBehaviorTree - Behavior tree for puzzle guards
 *
 * Priority (selector):
 * 1. SeekDesirableSequence - If a desirable object is detected, go pick it up
 * 2. PatrolBehaviorAction - Otherwise, patrol waypoints
 *
 * Guards will interrupt patrol to chase desirable objects (like presents)
 */
class GuardBehaviorTree extends GUTS.BaseBehaviorTree {
    // Inherits selector behavior from BaseBehaviorTree (default is selector)
    // Children are defined in data file

    evaluate(entityId, game) {
        return super.evaluate(entityId, game);;
    }
}
