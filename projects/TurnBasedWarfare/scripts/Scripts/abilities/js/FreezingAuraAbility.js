class FreezingAuraAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'freezing_aura',
            name: 'Freezing Aura',
            description: 'Emanate freezing cold',
            cooldown: 0,
            range: 100,
            manaCost: 0,
            targetType: 'area',
            animation: 'cast',
            priority: 6,
            castTime: 0,
            ...params
        });
        this.drainPerSecond = 8;
        this.duration = 12.0; // 12 seconds instead of 1200 seconds
        this.tickInterval = 1.0; // 1 second between ticks
        this.hasActiveAura = false;
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x4B0082,
                    colorRange: { start: 0x4B0082, end: 0x000000 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.8
                }
            },
            freezing: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x2F4F4F,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.0
                }
            },
            empowerment: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x8B0000,
                    scaleMultiplier: 1.3,
                    speedMultiplier: 1.2
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Only allow one active aura per caster
        return !this.hasActiveAura;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        this.createVisualEffect(pos, 'cast');
        // Mark aura as active
        this.hasActiveAura = true;
        
        // DESYNC SAFE: Schedule all aura ticks using the scheduling system
        const totalTicks = Math.floor(this.duration / this.tickInterval);
        
        for (let tickIndex = 0; tickIndex < totalTicks; tickIndex++) {
            const tickDelay = this.tickInterval * tickIndex;
            
            this.game.schedulingSystem.scheduleAction(() => {
                this.executeAuraTick(casterEntity, tickIndex, totalTicks);
            }, tickDelay, casterEntity);
        }
        
        // DESYNC SAFE: Schedule aura cleanup
        this.game.schedulingSystem.scheduleAction(() => {
            this.hasActiveAura = false;
        }, this.duration, casterEntity);
    }
    
    // DESYNC SAFE: Execute a single aura tick deterministically
    executeAuraTick(casterEntity, tickIndex, totalTicks) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        
        if (!casterHealth || casterHealth.current <= 0 || !casterPos) {
            // Caster is dead, end the aura early
            this.hasActiveAura = false;
            return;
        }
        
        // DESYNC SAFE: Get enemies and allies deterministically
        const allies = this.getAlliesInRange(casterEntity);
        
        // Sort for consistent processing order
        const sortedAllies = allies.slice().sort((a, b) => String(a).localeCompare(String(b)));

        
        // Process allies - empower undead
        sortedAllies.forEach(allyId => {
            const unitType = this.game.getComponent(allyId, this.componentTypes.UNIT_TYPE);
            const allyPos = this.game.getComponent(allyId, this.componentTypes.POSITION);
            
            if (!unitType || !allyPos) return;
            
            // Check if this is an undead unit
            const distance = Math.sqrt(
                Math.pow(allyPos.x - casterPos.x, 2) + 
                Math.pow(allyPos.z - casterPos.z, 2)
            );
            
            if (distance <= this.range) {
                // Check if already has empowerment buff
                const existingBuff = this.game.getComponent(allyId, this.componentTypes.BUFF);
                
                if (!existingBuff || existingBuff.buffType !== 'ice_armor') {
                    const Components = this.game.componentManager.getComponents();
                    this.game.addComponent(allyId, this.componentTypes.BUFF, 
                        Components.Buff('ice_armor', { 
                            armorMultiplier: 1.5
                        }, this.game.state.now + 3.0, false, 1, this.game.state.now));
                    
                    // Visual empowerment effect
                    this.createVisualEffect(allyPos, 'empowerment', { heightOffset: 5 });
                }
            }
            
        });
        
        // Additional visual effects every few ticks
        if (tickIndex % 3 === 0) {
            this.createVisualEffect(casterPos, 'freezing', { 
                count: 6, 
                scaleMultiplier: 2.5,
                heightOffset: 50 
            });
        }
    }
}