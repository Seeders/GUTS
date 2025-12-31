class LandAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Land',
            description: 'Land on the ground to become a ground unit',
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
        // Transformation is handled by UnitOrderUISystem.transformToGround()
    }
}
