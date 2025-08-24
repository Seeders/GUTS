class PhalanxFormationAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'phalanx_formation',
            name: 'Phalanx Formation',
            description: 'Link with nearby Hoplites - more Hoplites = stronger formation bonus',
            cooldown: 18.0,
            range: 80,
            manaCost: 35,
            targetType: 'allies',
            animation: 'cast',
            priority: 7,
            castTime: 1.2,
            ...params
        });
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const casterUnitType = this.game.getComponent(casterEntity, this.componentTypes.UNIT_TYPE);
        if (!casterPos || !casterUnitType) return;
        
        // Only link with other Hoplites to form the phalanx
        const nearbyHoplites = this.getAlliesInRange(casterEntity).filter(allyId => {
            const unitType = this.game.getComponent(allyId, this.componentTypes.UNIT_TYPE);
            return unitType && unitType.id === 'hoplite';
        });
        
        const phalanxSize = nearbyHoplites.length + 1; // Include caster
        const bonusMultiplier = Math.min(1 + (phalanxSize * 0.15), 2.0); // Cap at 2x bonus
        
        // Apply formation buff to all Hoplites in range (including caster)
        const allHoplites = [...nearbyHoplites, casterEntity];
        allHoplites.forEach(hopliteId => {
            const Components = this.game.componentManager.getComponents();
            this.game.addComponent(hopliteId, this.game.componentManager.getComponentTypes().BUFF, 
                Components.Buff('phalanx', { 
                    armorMultiplier: bonusMultiplier,
                    counterAttackChance: 0.2 + (phalanxSize * 0.05), // Scales with formation size
                    formationSize: phalanxSize
                }, Date.now() / 1000 + 25, false, 1, 0));
        });
        
        this.logAbilityUsage(casterEntity, `Hoplite forms phalanx with ${nearbyHoplites.length} allies! (${phalanxSize} total)`);
    }
}