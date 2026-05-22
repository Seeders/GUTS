class AbilitiesBehaviorTree extends GUTS.BaseBehaviorTree {
    static serviceDependencies = [
        'getNodeByType'
    ];

    evaluate(entityId, game) {
        if (!game.abilitySystem) {
            return null;
        }

        // Skip if building is under construction
        const placement = game.getComponent(entityId, 'placement');
        if (placement?.isUnderConstruction) {
            return null;
        }

        const unitTypeComp = game.getComponent(entityId, 'unitType');
        const unitType = game.getUnitTypeDef(unitTypeComp);
        const defaultAbilities = unitType?.abilities || [];

        // Gem-granted abilities (HeroArena): each socketed gem with an abilityId adds
        // that ability as a castable option in addition to the hero's defaults.
        const heroEquipment = game.getComponent(entityId, 'heroEquipment');
        const gemAbilities  = (heroEquipment?.abilitySlots || [])
            .filter(gem => gem?.abilityId)
            .map(gem => gem.abilityId);

        const abilities = defaultAbilities.concat(gemAbilities);
        if (abilities.length === 0) return null;

        // Evaluate abilities using selector pattern (first success wins)
        for (const abilityType of abilities) {
            const ability = game.getCollections().abilities[abilityType];
            if (!ability?.behaviorAction) {
                continue;
            }

            const abilityAction = this.call.getNodeByType( ability.behaviorAction);
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
