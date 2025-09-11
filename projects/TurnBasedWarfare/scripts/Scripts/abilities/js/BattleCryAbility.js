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
        
        this.damageMultiplier = 1.3; // 30% damage boost
        this.duration = 20.0; // 20 seconds
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0xFFD700,
                    colorRange: { start: 0xFFD700, end: 0xFF4500 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 1.5
                }
            },
            rally: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0xFF6347,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const allies = this.getAlliesInRange(casterEntity);
        // Only use if there are at least 2 allies to rally (including potentially the caster)
        return allies.length >= 2;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        // DESYNC SAFE: Use scheduling system for the rally effect
        this.game.schedulingSystem.scheduleAction(() => {
            this.performBattleCry(casterEntity);
        }, this.castTime, casterEntity);
        
        // Log immediately when cast starts
        const allies = this.getAlliesInRange(casterEntity);
        this.logAbilityUsage(casterEntity, `Warlord rallies ${allies.length} allies to battle!`, true);
    }
    
    performBattleCry(casterEntity) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        
        if (!casterHealth || casterHealth.current <= 0 || !casterPos) return;
        
        // DESYNC SAFE: Get and sort allies deterministically
        const allies = this.getAlliesInRange(casterEntity);
        const sortedAllies = allies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let ralliedCount = 0;
        
        sortedAllies.forEach(allyId => {
            const allyPos = this.game.getComponent(allyId, this.componentTypes.POSITION);
            const allyHealth = this.game.getComponent(allyId, this.componentTypes.HEALTH);
            
            // Only rally living allies
            if (!allyPos || !allyHealth || allyHealth.current <= 0) return;
            
            // DESYNC SAFE: Check if already rallied - don't stack multiple battle cries
            const existingBuff = this.game.getComponent(allyId, this.componentTypes.BUFF);
            
            if (existingBuff && existingBuff.buffType === 'rallied') {
                // DESYNC SAFE: Refresh duration instead of stacking
                existingBuff.endTime = this.game.currentTime + this.duration;
                existingBuff.appliedTime = this.game.currentTime; // Update applied time
            } else {
                // Apply new rally buff
                const Components = this.game.componentManager.getComponents();
                this.game.addComponent(allyId, this.componentTypes.BUFF, 
                    Components.Buff('rallied', { 
                        damageMultiplier: this.damageMultiplier, 
                        moralBoost: true, 
                        fearImmunity: true 
                    }, this.game.currentTime + this.duration, false, 1, this.game.currentTime));
            }
            
            // Visual rally effect on each ally
            this.createVisualEffect(allyPos, 'rally');
            
            // DESYNC SAFE: Schedule buff removal
            this.game.schedulingSystem.scheduleAction(() => {
                this.removeRallyBuff(allyId);
            }, this.duration, allyId);
            
            ralliedCount++;
        });
        
        // Screen effect for dramatic rally
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.3, 2);
            this.game.effectsSystem.playScreenFlash('#FFD700', 0.4);
        }
        
        // Additional visual effect at caster position
        this.createVisualEffect(casterPos, 'rally', { 
            count: 12, 
            scaleMultiplier: 3.0,
            heightOffset: 20 
        });
        
        // Log final rally results
        if (this.game.battleLogSystem && ralliedCount > 0) {
            this.game.battleLogSystem.add(
                `${ralliedCount} allies are filled with battle fury!`,
                'log-ability'
            );
        }
    }
    
    // DESYNC SAFE: Remove rally buff
    removeRallyBuff(allyId) {
        // Check if ally still exists and has the rally buff
        if (this.game.hasComponent(allyId, this.componentTypes.BUFF)) {
            const buff = this.game.getComponent(allyId, this.componentTypes.BUFF);
            if (buff && buff.buffType === 'rallied') {
                this.game.removeComponent(allyId, this.componentTypes.BUFF);
                
                // Visual effect when rally expires
                const allyPos = this.game.getComponent(allyId, this.componentTypes.POSITION);
                if (allyPos) {
                    this.createVisualEffect(allyPos, 'rally', { 
                        count: 2, 
                        scaleMultiplier: 0.8,
                        color: 0xCD853F 
                    });
                }
                
                // Log rally expiration
                if (this.game.battleLogSystem) {
                    const unitType = this.game.getComponent(allyId, this.componentTypes.UNIT_TYPE);
                    if (unitType) {
                        this.game.battleLogSystem.add(
                            `${unitType.type}'s battle fury fades.`,
                            'log-ability'
                        );
                    }
                }
            }
        }
    }
}