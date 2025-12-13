class AbilitiesBehaviorTree extends GUTS.BaseBehaviorTree {
    evaluate(entityId, game) {
        if (!game.abilitySystem) {
            return null;
        }

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitType = game.call('getUnitTypeDef', unitTypeComp);
        const abilities = unitType?.abilities;

        if (!abilities || abilities.length === 0) return null;

        // Evaluate abilities using selector pattern (first success wins)
        for (const abilityType of abilities) {
            const ability = game.getCollections().abilities[abilityType];
            if (!ability?.behaviorAction) {
                continue;
            }

            const abilityAction = game.call('getNodeByType', ability.behaviorAction);
            if (!abilityAction) {
                continue;
            }

            const result = abilityAction.evaluate(entityId, game);
            if (result !== null) {
                return result;
            }
        }

        return null;
    }
}
