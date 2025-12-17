class HealAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
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
            ...abilityData
        });

        this.healAmount = 80;
        this.element = 'holy';
    }

    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        return allies.some(allyId => {
            const health = this.game.getComponent(allyId, "health");
            return health && health.current < health.max; // Ally needs healing
        });
    }
        
    execute(casterEntity, targetData = null) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        
        const allies = this.getAlliesInRange(casterEntity);
        const target = this.findMostInjuredAlly(allies);
        
        if (!target) return null;
        
        // Show immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `Holy light mends wounds!`);

        this.game.schedulingSystem.scheduleAction(() => {
            const transform = this.game.getComponent(target, "transform");
            const targetPos = transform?.position;
            if (targetPos) {
                this.performHeal(casterEntity, target, targetPos);
            }
        }, this.castTime, casterEntity);
    }
    
    performHeal(casterEntity, targetId, targetPos) {
        const targetHealth = this.game.getComponent(targetId, "health");
        if (!targetHealth) return;

        // Heal effect
        this.playConfiguredEffects('impact', targetPos);

        // Apply healing
        const actualHeal = Math.min(this.healAmount, targetHealth.max - targetHealth.current);
        targetHealth.current += actualHeal;

        // Show heal number (client only)
        if (!this.game.isServer && this.game.hasService('showDamageNumber')) {
            this.game.call('showDamageNumber',
                targetPos.x, targetPos.y + 50, targetPos.z,
                actualHeal, 'heal'
            );
        }
    }
        
    findMostInjuredAlly(allies) {
        // Sort allies deterministically first
        const sortedAllies = allies.slice().sort((a, b) => a - b);

        let mostInjured = null;
        let lowestHealthRatio = 1.0;

        sortedAllies.forEach(allyId => {
            const health = this.game.getComponent(allyId, "health");
            if (health && health.max > 0) {
                const healthRatio = health.current / health.max;
                // Use < for consistent tie-breaking (first in sorted order wins)
                if (healthRatio < lowestHealthRatio) {
                    lowestHealthRatio = healthRatio;
                    mostInjured = allyId;
                }
            }
        });

        return mostInjured;
    }
}
