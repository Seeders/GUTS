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
        this.element = 'divine';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0x88ff88,
                    colorRange: { start: 0x88ff88, end: 0xffffaa },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.0
                }
            },
            heal: {
                type: 'heal',
                options: {
                    count: 5,
                    color: 0x88ffaa,
                    scaleMultiplier: 1.2,
                    speedMultiplier: 0.8
                }
            },
            mass_heal: {
                type: 'heal',
                options: {
                    count: 8,
                    color: 0xaaffaa,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 0.6
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        const injuredAllies = this.getInjuredAllies(allies);
        return injuredAllies.length >= this.minInjuredAllies;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return null;
        
        const allies = this.getAlliesInRange(casterEntity);
        const injuredAllies = this.getInjuredAllies(allies);
        
        if (injuredAllies.length < this.minInjuredAllies) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Divine energy gathers to heal the wounded!`);
        
        // Schedule the mass heal to trigger after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.performMassHeal(casterEntity, injuredAllies);
        }, this.castTime, casterEntity);
    }
    
    performMassHeal(casterEntity, targetAllies) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        let healedCount = 0;
        let totalHealing = 0;
        
        // Sort allies deterministically for consistent processing order
        const sortedAllies = targetAllies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        // Process each ally deterministically
        sortedAllies.forEach(allyId => {
            const health = this.game.getComponent(allyId, this.componentTypes.HEALTH);
            const allyPos = this.game.getComponent(allyId, this.componentTypes.POSITION);
            
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
                    this.createVisualEffect(allyPos, 'heal');
                    
                    // Show heal number
                    if (this.game.effectsSystem) {
                        this.game.effectsSystem.showDamageNumber(
                            allyPos.x, allyPos.y + 50, allyPos.z,
                            actualHeal, 'heal'
                        );
                    }
                    
                    // Log individual healing for battle log
                    if (this.game.battleLogSystem) {
                        const allyUnitType = this.game.getComponent(allyId, this.componentTypes.UNIT_TYPE);
                        const allyTeam = this.game.getComponent(allyId, this.componentTypes.TEAM);
                        
                        if (allyUnitType && allyTeam) {
                            this.game.battleLogSystem.add(
                                `${allyTeam.team} ${allyUnitType.type} healed for ${actualHeal} health!`,
                                'log-heal'
                            );
                        }
                    }
                }
            }
        });
        
        // Create major healing effect at caster position
        if (casterPos && healedCount > 0) {
            this.createVisualEffect(casterPos, 'mass_heal');
        }
        
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
        const sortedAllies = allies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        return sortedAllies.filter(allyId => {
            const health = this.game.getComponent(allyId, this.componentTypes.HEALTH);
            // Check if ally is injured (below 80% health threshold)
            return health && health.current < health.max * 0.8;
        });
    }
    
    // Helper method to get all valid heal targets (for future use)
    getAllHealTargets(allies) {
        // Sort allies deterministically first for consistent processing
        const sortedAllies = allies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        return sortedAllies.filter(allyId => {
            const health = this.game.getComponent(allyId, this.componentTypes.HEALTH);
            // Any ally that isn't at full health
            return health && health.current < health.max;
        });
    }
}