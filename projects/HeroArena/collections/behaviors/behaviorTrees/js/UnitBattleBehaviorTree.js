class UnitBattleBehaviorTree extends GUTS.BaseBehaviorTree {
    /**
     * Main behavior tree for units during battle phase.
     * Children: PlayerOrderBehaviorTree -> AbilitiesBehaviorTree -> CombatBehaviorTree -> IdleBehaviorAction
     */
    evaluate(entityId, game) {
        return super.evaluate(entityId, game);
    }
}

