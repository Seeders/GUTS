class MassHealAbility extends GUTS.BaseAbility {
    static serviceDependencies = [
        ...GUTS.BaseAbility.serviceDependencies,
        'showDamageNumber'
    ];

    constructor(game, abilityData = {}) {
        super(game, {
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
            ...abilityData
        });
        
        this.healPercent = 0.4; // 40% of max health
        this.minInjuredAllies = 3;
        this.element = 'holy';
    }

    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        const injuredAllies = this.getInjuredAllies(allies);
        return injuredAllies.length >= this.minInjuredAllies;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return null;
        
        const allies = this.getAlliesInRange(casterEntity);
        const injuredAllies = this.getInjuredAllies(allies);
        
        if (injuredAllies.length < this.minInjuredAllies) return null;
        
        // Show immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `Holy energy gathers to heal the wounded!`);
        
        // Schedule the mass heal to trigger after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.performMassHeal(casterEntity, injuredAllies);
        }, this.castTime, casterEntity);
    }
    
    performMassHeal(casterEntity, targetAllies) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        let healedCount = 0;
        let totalHealing = 0;

        // Sort allies deterministically for consistent processing order
        const sortedAllies = targetAllies.slice().sort((a, b) => String(a).localeCompare(String(b)));

        // Create central holy burst at caster
        if (casterPos) {
            this.playConfiguredEffects('burst', casterPos);
        }

        // Process each ally deterministically
        sortedAllies.forEach((allyId) => {
            const health = this.game.getComponent(allyId, "health");
            const transform = this.game.getComponent(allyId, "transform");
            const allyPos = transform?.position;

            if (!health || !allyPos) return;

            // Only heal if ally is still injured
            if (health.current < health.max) {
                const healAmount = Math.floor(health.max * this.healPercent);
                const actualHeal = Math.min(healAmount, health.max - health.current);

                if (actualHeal > 0) {
                    // Apply healing
                    health.current += actualHeal;
                    healedCount++;
                    totalHealing += actualHeal;

                    // Create heal effect on each ally
                    this.playConfiguredEffects('impact', allyPos);

                    // Show heal number
                    if (!this.game.isServer && this.game.hasService('showDamageNumber')) {
                        this.call.showDamageNumber(
                            allyPos.x, allyPos.y + 50, allyPos.z,
                            actualHeal, 'heal'
                        );
                    }
                }
            }
        });

        // Screen effect for dramatic impact
        if (this.game.effectsSystem && healedCount > 0) {
            this.game.effectsSystem.playScreenFlash('#88ff88', 0.3);
        }

        // Log final results
        this.logAbilityUsage(casterEntity,
            `Mass heal restores ${healedCount} allies for ${totalHealing} total health!`);
    }
    
    // FIXED: Deterministic injured ally detection
    getInjuredAllies(allies) {
        // Sort allies deterministically first for consistent processing
        const sortedAllies = allies.slice().sort((a, b) => a - b);
        
        return sortedAllies.filter(allyId => {
            const health = this.game.getComponent(allyId, "health");
            // Check if ally is injured (below 80% health threshold)
            return health && health.current < health.max * 0.8;
        });
    }
    
    // Helper method to get all valid heal targets (for future use)
    getAllHealTargets(allies) {
        // Sort allies deterministically first for consistent processing
        const sortedAllies = allies.slice().sort((a, b) => a - b);
        
        return sortedAllies.filter(allyId => {
            const health = this.game.getComponent(allyId, "health");
            // Any ally that isn't at full health
            return health && health.current < health.max;
        });
    }
}
