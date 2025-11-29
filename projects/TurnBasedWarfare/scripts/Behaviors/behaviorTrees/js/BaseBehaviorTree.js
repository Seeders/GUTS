class BaseBehaviorTree extends GUTS.BaseBehaviorNode {
    constructor(game, config = {}) {
        super(game, config);
    }

    onBattleStart() {
    }

    onBattleEnd(entityId, game) {
        this.runningState.delete(entityId);
    }

    onPlacementPhaseStart(entityId, game) {
    }

    /**
     * Override evaluateComposite - called by BaseBehaviorNode for composite nodes
     * Uses selector pattern (try each child until one succeeds)
     */
    evaluateComposite(entityId, game) {
        return super.evaluateSelector(entityId, game);
    }

    /**
     * Override evaluate to set pathSize before delegation
     */
    evaluate(entityId, game) {
        this.pathSize = game.gameManager?.call('getPlacementGridSize');
        return super.evaluate(entityId, game);
    }
}
