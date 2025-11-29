class ChaseSequence extends GUTS.BaseBehaviorTree {
    /**
     * Sequence: runs children in order, fails if any child fails
     * Override evaluateComposite to use sequence pattern instead of selector
     */
    evaluateComposite(entityId, game) {
        return this.evaluateSequence(entityId, game);
    }
}
