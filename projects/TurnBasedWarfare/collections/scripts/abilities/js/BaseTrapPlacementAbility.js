// Base class for trap placement abilities (used by units like Scout, Trapper)
// Handles cooldown checking, max trap limits, and trap ownership tracking
class BaseTrapPlacementAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            cooldown: 20.0,
            range: 150,
            manaCost: 0,
            targetType: 'ground',
            animation: 'cast',
            priority: 5,
            castTime: 0,
            autoTrigger: null, // Player-ordered only, not auto-used
            ...abilityData
        });

        // Configurable properties - override in subclasses or via abilityData
        this.maxTraps = abilityData.maxTraps ?? 2;
        this.trapComponentName = abilityData.trapComponentName || 'trap';
        this.placementMessage = abilityData.placementMessage || 'Trap placed!';
    }

    canExecute(casterEntity) {
        // Check cooldown
        if (!this.game.abilitySystem?.isAbilityOffCooldown(casterEntity, this.id)) {
            return false;
        }

        // Check how many traps this unit already has active
        const myTraps = this.getActiveTrapsForCaster(casterEntity);
        return myTraps.length < this.maxTraps;
    }

    getActiveTrapsForCaster(casterEntity) {
        const traps = this.game.getEntitiesWith(this.trapComponentName, "transform", "health");

        return traps.filter(trapId => {
            const trap = this.game.getComponent(trapId, this.trapComponentName);
            const health = this.game.getComponent(trapId, "health");
            return trap && trap.ownerId === casterEntity && health && health.current > 0;
        });
    }

    // Called when a trap building is placed for this unit
    onTrapPlaced(casterEntity, trapEntity) {
        // Add trap component to track ownership
        this.game.addComponent(trapEntity, this.trapComponentName, {
            ownerId: casterEntity,
            triggered: false
        });

        // Start cooldown
        this.game.abilitySystem?.setCooldown(casterEntity, this.id, this.cooldown);

        // Visual effect
        const transform = this.game.getComponent(trapEntity, "transform");
        const trapPos = transform?.position;
        if (trapPos) {
            this.playConfiguredEffects('target', trapPos);
        }

        this.logAbilityUsage(casterEntity, this.placementMessage);
    }

    getActiveTrapCount(casterId) {
        return this.getActiveTrapsForCaster(casterId).length;
    }
}
