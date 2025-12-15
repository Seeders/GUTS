class CombatBehaviorTree extends GUTS.BaseBehaviorTree {
    evaluate(entityId, game) {
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitTypeDef = game.call('getUnitTypeDef', unitTypeComp);

        // Check if player order prevents combat
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (playerOrder?.meta?.preventCombat) {
            this.runningState.delete(entityId);
            return null;
        }

        const combat = game.getComponent(entityId, 'combat');
        const health = game.getComponent(entityId, 'health');

        // Skip if unit can't fight
        if (!combat || !health || health.current <= 0) {
            this.runningState.delete(entityId);
            return null;
        }

        // Skip non-combat units (peasants mining, etc.)
        if (combat.damage === 0 && (!unitTypeDef?.abilities || unitTypeDef.abilities.length === 0)) {
            this.runningState.delete(entityId);
            return null;
        }

        // Use base class evaluate which handles the selector pattern
        return super.evaluate(entityId, game);
    }
}
