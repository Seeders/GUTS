class TakeOffAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Take Off',
            description: 'Launch into the air to become a flying unit',
            cooldown: 0,
            range: 0,
            manaCost: 0,
            targetType: 'self',
            autoTrigger: null, // Player-activated only
            ...abilityData
        });
    }

    canExecute(casterEntity) {
        return true;
    }

    execute(casterEntity, targetData = null) {
        // Transformation is handled by UnitOrderUISystem.transformToFlying()
    }
}
