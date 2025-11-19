class HealAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'heal',
            name: 'Heal',
            description: 'Restores health to the most injured ally',
            cooldown: 30,
            range: 200,
            manaCost: 40,
            targetType: 'ally',
            animation: 'cast',
            priority: 8,
            castTime: 1.0,
            autoTrigger: 'injured_ally',
            ...params
        });
        
        this.healAmount = 80;
        this.element = 'divine';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 2,
                    color: 0x88ff88,
                    colorRange: { start: 0x88ff88, end: 0xffffaa },
                    scaleMultiplier: 1.0,
                    speedMultiplier: 1.0
                }
            },
            heal: {
                type: 'heal',
                options: {
                    count: 3,
                    color: 0x88ffaa,
                    scaleMultiplier: 1.2,
                    speedMultiplier: 0.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        return allies.some(allyId => {
            const health = this.game.getComponent(allyId, this.componentTypes.HEALTH);
            return health && health.current < health.max; // Ally needs healing
        });
    }
        
    execute(casterEntity, targetData = null) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        const allies = this.getAlliesInRange(casterEntity);
        const target = this.findMostInjuredAlly(allies);
        
        if (!target) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Divine light mends wounds!`);
        
    
        this.game.schedulingSystem.scheduleAction(() => {
            const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
            if (targetPos) {
                this.performHeal(casterEntity, target, targetPos);
            }
        }, this.castTime, casterEntity);
    }
    
    performHeal(casterEntity, targetId, targetPos) {
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        if (!targetHealth) return;
        // Heal effect
        this.createVisualEffect(targetPos, 'heal');
        
        // Apply healing
        const actualHeal = Math.min(this.healAmount, targetHealth.max - targetHealth.current);
        targetHealth.current += actualHeal;
        
        // Show heal number
        if (this.game.gameManager && this.game.gameManager.has('showDamageNumber')) {
            this.game.gameManager.call('showDamageNumber',
                targetPos.x, targetPos.y + 50, targetPos.z,
                actualHeal, 'heal'
            );
        }
        
    
    }
        
    findMostInjuredAlly(allies) {
        // Sort allies deterministically first
        const sortedAllies = allies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let mostInjured = null;
        let lowestHealthRatio = 1.0;
        
        sortedAllies.forEach(allyId => {
            const health = this.game.getComponent(allyId, this.componentTypes.HEALTH);
            if (health && health.max > 0) {
                const healthRatio = health.current / health.max;
                // Use <= for consistent tie-breaking (first in sorted order wins)
                if (healthRatio <= lowestHealthRatio) {
                    lowestHealthRatio = healthRatio;
                    mostInjured = allyId;
                }
            }
        });
        
        return mostInjured;
    }
}