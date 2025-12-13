class CombatBehaviorTree extends GUTS.BaseBehaviorTree {
    evaluate(entityId, game) {
        // Check if player order prevents combat
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (playerOrder?.meta?.preventCombat) {
            return null;
        }

        const combat = game.getComponent(entityId, 'combat');
        const health = game.getComponent(entityId, 'health');

        // Skip if unit can't fight
        if (!combat || !health || health.current <= 0) {
            return null;
        }

        // Skip non-combat units (peasants mining, etc.)
        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitType = game.call('getUnitTypeDef', unitTypeComp);
        if (combat.damage === 0 && (!unitType?.abilities || unitType.abilities.length === 0)) {
            return null;
        }

        // Use base class evaluate which handles the selector pattern
        return super.evaluate(entityId, game);
    }
}
