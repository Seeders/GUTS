class BaseBehaviorTree extends GUTS.BaseBehaviorNode {

    /**
     * Override evaluateComposite - called by BaseBehaviorNode for composite nodes
     * Uses selector pattern (try each child until one succeeds)
     */
    evaluateComposite(entityId, game) {
        return super.evaluateSelector(entityId, game);
    }

}
