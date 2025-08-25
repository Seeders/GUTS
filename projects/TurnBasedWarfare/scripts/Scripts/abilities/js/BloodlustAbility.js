class BloodlustAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'bloodlust',
            name: 'Bloodlust',
            description: 'Heal when dealing damage and gain stacking damage bonuses',
            cooldown: 5.0,
            range: 0,
            manaCost: 0,
            targetType: 'self',
            animation: 'cast',
            priority: 7,
            castTime: 1.0,
            ...params
        });
    }
    
    defineEffects() {
        return {
            cast: { type: 'magic', options: { count: 15, color: 0x880000, scaleMultiplier: 1.4 } }
        };
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        this.createVisualEffect(pos, 'cast');
        
        const Components = this.game.componentManager.getComponents();
        this.game.addComponent(casterEntity, this.game.componentManager.getComponentTypes().BUFF, 
            Components.Buff('bloodlust', { 
                lifeSteal: 0.3, 
                damagePerKill: 5, 
                maxStacks: 10 
            }, 0, true, 1, 0));
        
        this.logAbilityUsage(casterEntity, "Berserker enters a bloodthirsty frenzy!", true);
    }
}