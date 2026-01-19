/**
 * CombatBehaviorTree - Sequence that guards combat with hiding check
 *
 * Structure:
 * 1. IsNotHidingBehaviorAction - Skip combat if hiding
 * 2. CombatSelectorBehaviorTree - The actual combat logic
 */
class CombatBehaviorTree extends GUTS.BaseBehaviorTree {

    /**
     * Override evaluateComposite to use sequence logic
     * The hiding check and combat selector are run in sequence
     */
    evaluateComposite(entityId, game) {
        return this.evaluateSequence(entityId, game);
    }
}
