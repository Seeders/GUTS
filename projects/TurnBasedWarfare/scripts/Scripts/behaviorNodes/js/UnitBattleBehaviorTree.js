class UnitBattleBehaviorTree extends GUTS.BaseBehaviorTree {
    /**
     * Main behavior tree for units during battle.
     * Priority order:
     * 1. Passive abilities (always running)
     * 2. Player orders (manual commands)
     * 3. Autobattle combat (AI decision making)
     * 4. Idle (default fallback)
     *
     * The selector will evaluate children in order and return the first non-null result.
     */
    evaluate(entityId, game) {
        // Use base class evaluate which handles the selector pattern
        // with the behaviorActions from config
        return super.evaluate(entityId, game);
    }
}
