/**
 * Sequence Behavior Tree
 * Evaluates children in order until one fails or all succeed
 *
 * Behavior:
 *   - Evaluates children left-to-right
 *   - If a child fails (returns null), the sequence fails immediately
 *   - If a child returns 'running', the sequence pauses and resumes next tick
 *   - If all children succeed, the sequence succeeds
 *
 * Usage in behaviorActions:
 *   "behaviorActions": [
 *     "PrepareSequence",  // A SequenceBehaviorTree instance
 *     "IdleBehaviorAction"
 *   ]
 *
 * The sequence tree config:
 *   {
 *     "fileName": "PrepareSequence",
 *     "behaviorActions": ["CheckAmmo", "ReloadWeapon", "AimAction"],
 *     "parameters": {}
 *   }
 */
class SequenceBehaviorTree extends GUTS.BaseBehaviorTree {

    /**
     * Override evaluateComposite to use sequence pattern instead of selector
     * BaseBehaviorNode.evaluateSequence() already handles running state
     */
    evaluateComposite(entityId, game) {
        return this.evaluateSequence(entityId, game);
    }
}
