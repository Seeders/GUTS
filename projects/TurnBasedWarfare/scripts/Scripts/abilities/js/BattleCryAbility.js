class BattleCryAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'battle_cry',
            name: 'Battle Cry',
            description: 'Rally nearby allies, boosting their damage and morale (does not stack)',
            cooldown: 15.0,
            range: 150,
            manaCost: 40,
            targetType: 'allies',
            animation: 'cast',
            priority: 8,
            castTime: 1.0,
            ...params
        });
    }
    
    execute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        allies.forEach(allyId => {
            // Check if already rallied - don't stack multiple battle cries
            const existingBuff = this.game.getComponent(allyId, this.game.componentManager.getComponentTypes().BUFF);
            if (existingBuff && existingBuff.buffType === 'rallied') {
                // Refresh duration instead of stacking
                existingBuff.endTime = Date.now() / 1000 + 20;
                return;
            }
            
            const Components = this.game.componentManager.getComponents();
            this.game.addComponent(allyId, this.game.componentManager.getComponentTypes().BUFF, 
                Components.Buff('rallied', { 
                    damageMultiplier: 1.3, 
                    moralBoost: true, 
                    fearImmunity: true 
                }, Date.now() / 1000 + 20, false, 1, 0));
        });
        
        this.logAbilityUsage(casterEntity, `Warlord rallies ${allies.length} allies to battle!`, true);
    }
}
