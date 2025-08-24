class RageAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'raging_strike',
            name: 'Raging Strike',
            description: 'Unleash primal fury with increased damage and attack speed',
            cooldown: 8.0,
            range: 0, // Self-buff
            manaCost: 20,
            targetType: 'self',
            animation: 'attack',
            priority: 6,
            castTime: 0.8,
            ...params
        });
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: { count: 12, color: 0xff4444, scaleMultiplier: 1.3 }
            }
        };
    }
    
    canExecute(casterEntity) {
        return this.getEnemiesInRange(casterEntity, 100).length > 0;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        this.createVisualEffect(pos, 'cast');
        
        // Add rage buff component
        const Components = this.game.componentManager.getComponents();
        this.game.addComponent(casterEntity, this.game.componentManager.getComponentTypes().BUFF, 
            Components.Buff('rage', { damageMultiplier: 1.5, attackSpeedMultiplier: 1.3 }, 0, false, 1, 0));
        
        this.logAbilityUsage(casterEntity, null, true);
    }
}