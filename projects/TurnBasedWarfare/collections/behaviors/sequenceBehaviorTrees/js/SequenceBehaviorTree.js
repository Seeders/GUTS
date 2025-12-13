class SequenceBehaviorTree extends GUTS.BaseBehaviorTree {

    /**
     * Override evaluateComposite to use sequence pattern instead of selector
     * BaseBehaviorNode.evaluateSequence() already handles running state
     */
    evaluateComposite(entityId, game) {
        return this.evaluateSequence(entityId, game);
    }
}
