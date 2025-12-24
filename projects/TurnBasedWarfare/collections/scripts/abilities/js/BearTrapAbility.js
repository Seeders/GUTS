class BearTrapAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
            name: 'Bear Trap',
            description: 'Place a hidden trap that snares enemies',
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

        this.maxTrapsPerScout = 2;
    }

    canExecute(casterEntity) {
        // Check cooldown
        if (!this.game.abilitySystem?.isAbilityOffCooldown(casterEntity, this.id)) {
            return false;
        }

        // Check how many traps this scout already has active
        const myTraps = this.getActiveTrapsForCaster(casterEntity);
        return myTraps.length < this.maxTrapsPerScout;
    }

    getActiveTrapsForCaster(casterEntity) {
        const traps = this.game.getEntitiesWith("trap", "transform", "health");

        return traps.filter(trapId => {
            const trap = this.game.getComponent(trapId, "trap");
            const health = this.game.getComponent(trapId, "health");
            return trap && trap.ownerId === casterEntity && health && health.current > 0;
        });
    }

    // Called when a trap building is placed for this scout
    onTrapPlaced(casterEntity, trapEntity) {
        // Add trap component to track ownership
        this.game.addComponent(trapEntity, "trap", {
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

        this.logAbilityUsage(casterEntity, "Scout sets a bear trap!");
    }

    getActiveTrapCount(scoutId) {
        return this.getActiveTrapsForCaster(scoutId).length;
    }
}
