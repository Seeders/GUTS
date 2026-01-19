/**
 * ChasePlayerSequence - Sequence that detects and chases the player
 *
 * Sequence:
 * 1. FindPlayerBehaviorAction - Look for player in vision range
 * 2. ChasePlayerBehaviorAction - Move to and catch the player
 *
 * Returns SUCCESS if player caught (triggers defeat)
 * Returns RUNNING while chasing player
 * Returns FAILURE if player not visible
 */
class ChasePlayerSequence extends GUTS.BaseBehaviorTree {

    /**
     * Override evaluateComposite to use sequence pattern instead of selector
     */
    evaluateComposite(entityId, game) {
        return this.evaluateSequence(entityId, game);
    }
}
