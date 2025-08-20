class MassHealAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'mass_heal',
            name: 'Mass Heal',
            description: 'Heal all injured allies across the battlefield',
            cooldown: 15.0,
            range: 300,
            manaCost: 60,
            targetType: 'auto',
            animation: 'cast',
            priority: 9,
            castTime: 2.0,
            autoTrigger: 'low_team_health',
            ...params
        });
        
        this.healPercent = 0.4; // 40% of max health
        this.minInjuredAllies = 3;
    }
    
    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        const injuredAllies = allies.filter(allyId => {
            const health = this.game.getComponent(allyId, this.componentTypes.HEALTH);
            return health && health.current < health.max * 0.8;
        });
        
        return injuredAllies.length >= this.minInjuredAllies;
    }
    
    execute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        const healedAllies = [];
        
        allies.forEach(allyId => {
            const health = this.game.getComponent(allyId, this.componentTypes.HEALTH);
            if (health && health.current < health.max) {
                const healAmount = Math.floor(health.max * this.healPercent);
                health.current = Math.min(health.max, health.current + healAmount);
                healedAllies.push(allyId);
                
                // Create heal effect on each ally
                const allyPos = this.game.getComponent(allyId, this.componentTypes.POSITION);
                if (allyPos) {
                    this.createVisualEffect(allyPos, 'heal');
                }
            }
        });
        
        this.logAbilityUsage(casterEntity, 
            `Mass heal restores ${healedAllies.length} allies!`);
    }
}