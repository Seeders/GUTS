class HealAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, {
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
            const poison = this.game.getComponent(allyId, "poison");
            // Ally needs healing OR is poisoned
            return (health && health.current < health.max) || (poison && poison.stacks > 0);
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

        // Cure poison - holy magic cleanses toxins
        if (this.game.hasService('curePoison')) {
            this.game.call('curePoison', targetId);
        }

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
        let hasPoisonedTarget = false;

        sortedAllies.forEach(allyId => {
            const health = this.game.getComponent(allyId, "health");
            const poison = this.game.getComponent(allyId, "poison");
            const isPoisoned = poison && poison.stacks > 0;

            if (health && health.max > 0) {
                const healthRatio = health.current / health.max;

                // Prioritize poisoned allies, then lowest health
                if (isPoisoned && !hasPoisonedTarget) {
                    // First poisoned ally found - prioritize them
                    hasPoisonedTarget = true;
                    lowestHealthRatio = healthRatio;
                    mostInjured = allyId;
                } else if (isPoisoned && hasPoisonedTarget && healthRatio < lowestHealthRatio) {
                    // Another poisoned ally with lower health
                    lowestHealthRatio = healthRatio;
                    mostInjured = allyId;
                } else if (!hasPoisonedTarget && healthRatio < lowestHealthRatio) {
                    // No poisoned allies yet, pick lowest health
                    lowestHealthRatio = healthRatio;
                    mostInjured = allyId;
                }
            }
        });

        return mostInjured;
    }
}
