class BloodlustAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'bloodlust',
            name: 'Bloodlust',
            description: 'Heal when dealing damage and gain stacking damage bonuses',
            cooldown: 5.0,
            range: 0,
            manaCost: 0,
            targetType: 'self',
            animation: 'cast',
            priority: 7,
            castTime: 1.0,
            ...params
        });
        
        this.lifeStealAmount = 0.3; // 30% life steal
        this.damagePerKill = 5; // Damage bonus per kill
        this.maxStacks = 10; // Maximum kill stacks
        this.duration = 30.0; // 30 seconds duration
    }
    
    defineEffects() {
        return {
            cast: { 
                type: 'magic', 
                options: { 
                    count: 3, 
                    color: 0x880000, 
                    colorRange: { start: 0x880000, end: 0xDC143C },
                    scaleMultiplier: 1.4,
                    speedMultiplier: 1.2
                } 
            },
            bloodlust: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0xB22222,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 0.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Check if already has bloodlust active to prevent stacking
        const existingBuff = this.game.getComponent(casterEntity, this.componentTypes.BUFF);
        return !existingBuff || existingBuff.buffType !== 'bloodlust';
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        // Immediate cast effect
        this.createVisualEffect(pos, 'cast');
        this.logAbilityUsage(casterEntity, "Berserker enters a bloodthirsty frenzy!", true);
        
        // DESYNC SAFE: Use scheduling system for bloodlust activation
        this.game.schedulingSystem.scheduleAction(() => {
            this.activateBloodlust(casterEntity);
        }, this.castTime, casterEntity);
    }
    
    activateBloodlust(casterEntity) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        
        if (!casterHealth || casterHealth.current <= 0 || !casterPos) return;
        
        // Check if already has bloodlust to prevent double application
        const existingBuff = this.game.getComponent(casterEntity, this.componentTypes.BUFF);
        if (existingBuff && existingBuff.buffType === 'bloodlust') {
            // DESYNC SAFE: Refresh duration instead of stacking
            existingBuff.endTime = this.game.state.now + this.duration;
            existingBuff.appliedTime = this.game.state.now;
            
            // Visual refresh effect
            this.createVisualEffect(casterPos, 'bloodlust');
            return;
        }
        
        // Apply bloodlust buff
        const Components = this.game.componentManager.getComponents();
        this.game.addComponent(casterEntity, this.componentTypes.BUFF, 
            Components.Buff('bloodlust', { 
                lifeSteal: this.lifeStealAmount, 
                damagePerKill: this.damagePerKill, 
                maxStacks: this.maxStacks,
                currentStacks: 0 // Start with 0 kill stacks
            }, this.game.state.now + this.duration, true, 1, this.game.state.now));
        
        // Visual bloodlust effect
        this.createVisualEffect(casterPos, 'bloodlust');
        
        // Screen effect for dramatic activation
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenShake(0.2, 1.5);
            this.game.effectsSystem.playScreenFlash('#8B0000', 0.3);
        }
        
        // DESYNC SAFE: Schedule buff removal
        this.game.schedulingSystem.scheduleAction(() => {
            this.removeBloodlust(casterEntity);
        }, this.duration, casterEntity);
        
 
    }
    
    // DESYNC SAFE: Remove bloodlust buff
    removeBloodlust(casterEntity) {
        // Check if entity still exists and has the bloodlust buff
        if (this.game.hasComponent(casterEntity, this.componentTypes.BUFF)) {
            const buff = this.game.getComponent(casterEntity, this.componentTypes.BUFF);
            if (buff && buff.buffType === 'bloodlust') {
                const stacksGained = buff.modifiers.currentStacks || 0;
                
                this.game.removeComponent(casterEntity, this.componentTypes.BUFF);
                
                // Visual effect when bloodlust expires
                const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
                if (casterPos) {
                    this.createVisualEffect(casterPos, 'bloodlust', { 
                        count: 5, 
                        scaleMultiplier: 0.8,
                        color: 0x696969 
                    });
                }
                
             
            }
        }
    }
    
    // Helper method to handle kill stacking (called by damage system when enemy dies)
    onEnemyKilled(killerId) {
        if (!this.game.hasComponent(killerId, this.componentTypes.BUFF)) return;
        
        const buff = this.game.getComponent(killerId, this.componentTypes.BUFF);
        if (!buff || buff.buffType !== 'bloodlust') return;
        
        // Increase kill stacks up to maximum
        const currentStacks = buff.modifiers.currentStacks || 0;
        if (currentStacks < this.maxStacks) {
            buff.modifiers.currentStacks = currentStacks + 1;
            
            // Visual effect for gaining a kill stack
            const killerPos = this.game.getComponent(killerId, this.componentTypes.POSITION);
            if (killerPos) {
                this.createVisualEffect(killerPos, 'bloodlust', { 
                    count: 3, 
                    scaleMultiplier: 1.2,
                    heightOffset: 10 
                });
            }
    
        }
    }
}