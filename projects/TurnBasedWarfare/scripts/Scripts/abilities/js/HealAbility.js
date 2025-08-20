
class HealAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'heal',
            name: 'Heal',
            description: 'Restore health to target ally',
            cooldown: 6.0,
            range: 80,
            manaCost: 20,
            targetType: 'ally',
            animation: 'cast',
            priority: 7,
            castTime: 1.0,
            ...params
        });
        
        this.healPercent = 0.5; // Heal 50% of max health
    }
    
    canExecute(casterEntity) {
        const injuredAllies = this.getValidTargets(casterEntity, this.game, 'ally').filter(allyId => {
            const health = this.game.getComponent(allyId, this.game.componentManager.getComponentTypes().HEALTH);
            return health && health.current < health.max;
        });
        
        return injuredAllies.length > 0;
    }
    
    execute(casterEntity, targetData = null) {
        // Find the most injured ally
        const injuredAllies = this.getValidTargets(casterEntity, this.game, 'ally')
            .map(allyId => {
                const health = this.game.getComponent(allyId, this.game.componentManager.getComponentTypes().HEALTH);
                const pos = this.game.getComponent(allyId, this.game.componentManager.getComponentTypes().POSITION);
                
                if (!health || !pos || health.current >= health.max) return null;
                
                return {
                    entityId: allyId,
                    health,
                    pos,
                    healthPercent: health.current / health.max
                };
            })
            .filter(ally => ally !== null)
            .sort((a, b) => a.healthPercent - b.healthPercent);
        
        if (injuredAllies.length === 0) return;
        
        const target = injuredAllies[0];
        const healAmount = Math.floor(target.health.max * this.healPercent);
        
        // Apply healing
        target.health.current = Math.min(target.health.max, target.health.current + healAmount);
        
             // Log healing
        this.logHealing(this.game, casterEntity, target.entityId, healAmount);
    }
   
    
    logHealing(casterId, targetId, healAmount) {
        if (!this.game.battleLogSystem) return;
        
        const casterType = this.game.getComponent(casterId, this.game.componentManager.getComponentTypes().UNIT_TYPE);
        const targetType = this.game.getComponent(targetId, this.game.componentManager.getComponentTypes().UNIT_TYPE);
        const casterTeam = this.game.getComponent(casterId, this.game.componentManager.getComponentTypes().TEAM);
        
        if (casterType && targetType && casterTeam) {
            this.game.battleLogSystem.add(
                `${casterTeam.team} ${casterType.type} heals ${targetType.type} for ${healAmount} HP!`,
                'log-heal'
            );
        }
    }
}