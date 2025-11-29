class AbilitiesBehaviorTree extends GUTS.BaseBehaviorTree {
    evaluate(entityId, game) {
        // Get all abilities for this unit from the AbilitySystem
        if (!game.abilitySystem) return null;
        const unitType = game.getComponent(entityId, 'unitType');

        const abilities = unitType.abilities;
        if (!abilities || abilities.length === 0) return null;

        // Collect all behaviors from abilities that can provide them
        const abilityActions = [];

        for (const abilityType of abilities) {
            const ability = game.getCollections().abilities[abilityType];
            // Check if ability can provide a behavior
            if (ability.behaviorAction) {  
                const abilityAction = game.gameManager.call('getNodeByType', ability.behaviorAction);
                abilityActions.push(() => {          
                    return this.processAction(entityId, game, ability.behaviorAction, abilityAction);
                });                
            }
        }

        return this.select(abilityActions);
    }
}
