class BattleCryAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'battle_cry',
            name: 'Battle Cry',
            description: 'Rally all allies, boosting damage and attack speed',
            cooldown: 25.0,
            range: 200,
            manaCost: 50,
            targetType: 'auto',
            animation: 'cast',
            priority: 6,
            castTime: 1.0,
            autoTrigger: 'battle_start',
            ...params
        });
        
        this.damageBonus = 20;
        this.attackSpeedBonus = 0.3;
        this.duration = 20.0;
    }
    
    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        return allies.length >= 3; // Need multiple allies to make it worthwhile
    }
    
    execute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        const ralliedAllies = [];
        
        allies.forEach(allyId => {
            if (this.applyBattleCryBuff(allyId)) {
                ralliedAllies.push(allyId);
            }
        });
        
        this.logAbilityUsage(casterEntity, 
            `Battle cry rallies ${ralliedAllies.length} allies to fight harder!`);
    }
    
    applyBattleCryBuff(targetId) {
        const combat = this.game.getComponent(targetId, this.componentTypes.COMBAT);
        if (!combat) return false;
        
        // Apply buffs
        const originalDamage = combat.damage || 0;
        const originalAttackSpeed = combat.attackSpeed || 1.0;
        
        combat.damage = originalDamage + this.damageBonus;
        combat.attackSpeed = originalAttackSpeed + this.attackSpeedBonus;
        
        // Create buff effect
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        if (targetPos) {
            this.createVisualEffect(targetPos, 'battle_cry');
        }
        
        // Remove buffs after duration
        setTimeout(() => {
            const combatComp = this.game.getComponent(targetId, this.componentTypes.COMBAT);
            if (combatComp) {
                combatComp.damage = originalDamage;
                combatComp.attackSpeed = originalAttackSpeed;
            }
        }, this.duration * 1000);
        
        return true;
    }
}