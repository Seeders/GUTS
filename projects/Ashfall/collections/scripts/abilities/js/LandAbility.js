class LandAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);
    }

    canExecute(casterEntity) {
        return true;
    }

    execute(casterEntity, targetData = null) {
        // Transformation is handled by UnitOrderUISystem.transformToGround()
    }
}
