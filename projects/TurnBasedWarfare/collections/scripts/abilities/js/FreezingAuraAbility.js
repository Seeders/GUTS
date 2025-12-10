class FreezingAuraAbility extends GUTS.BaseAbility {
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
            passive: true,
            ...params
        });
        this.drainPerSecond = 8;
        this.cycleDuration = 12.0; // Duration of each cycle
        this.tickInterval = 1.0; // 1 second between ticks
        this.hasActiveAura = false;
        this.assignedCaster = null;
    }

    // Called when ability is assigned to a unit - auto-start the passive aura
    onAssign(casterEntity) {
        this.assignedCaster = casterEntity;
        this.startAuraCycle(casterEntity);
    }

    // Start or restart the perpetual aura cycle
    startAuraCycle(casterEntity) {
        if (this.hasActiveAura) return;

        const casterHealth = this.game.getComponent(casterEntity, "health");
        if (!casterHealth || casterHealth.current <= 0) return;

        this.hasActiveAura = true;

        const totalTicks = Math.floor(this.cycleDuration / this.tickInterval);

        for (let tickIndex = 0; tickIndex < totalTicks; tickIndex++) {
            const tickDelay = this.tickInterval * tickIndex;

            this.game.schedulingSystem.scheduleAction(() => {
                this.executeAuraTick(casterEntity, tickIndex, totalTicks);
            }, tickDelay, casterEntity);
        }

        // Schedule cycle restart for perpetual effect
        this.game.schedulingSystem.scheduleAction(() => {
            this.hasActiveAura = false;
            this.startAuraCycle(casterEntity);
        }, this.cycleDuration, casterEntity);
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
        // Passive ability - cannot be manually executed
        return false;
    }

    execute(casterEntity) {
        // Passive ability - starts automatically via onAssign
        // This method kept for compatibility but redirects to cycle start
        this.startAuraCycle(casterEntity);
    }
    
    // DESYNC SAFE: Execute a single aura tick deterministically
    executeAuraTick(casterEntity, tickIndex, totalTicks) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        
        if (!casterHealth || casterHealth.current <= 0 || !casterPos) {
            // Caster is dead, end the aura early
            this.hasActiveAura = false;
            return;
        }
        
        // DESYNC SAFE: Get enemies and allies deterministically
        const allies = this.getAlliesInRange(casterEntity);
        
        // Sort for consistent processing order
        const sortedAllies = allies.slice().sort((a, b) => a - b);

        
        // Process allies - empower undead
        sortedAllies.forEach(allyId => {
            const unitType = this.game.getComponent(allyId, "unitType");
            const transform = this.game.getComponent(allyId, "transform");
            const allyPos = transform?.position;
            
            if (!unitType || !allyPos) return;
            
            // Check if this is an undead unit
            const distance = Math.sqrt(
                Math.pow(allyPos.x - casterPos.x, 2) + 
                Math.pow(allyPos.z - casterPos.z, 2)
            );
            
            if (distance <= this.range) {
                // Check if already has empowerment buff
                const existingBuff = this.game.getComponent(allyId, "buff");
                
                if (!existingBuff || existingBuff.buffType !== 'ice_armor') {
                    this.game.addComponent(allyId, "buff", {
                        buffType: 'ice_armor',
                        modifiers: {
                            armorMultiplier: 1.5
                        },
                        endTime: this.game.state.now + 3.0,
                        stackable: false,
                        stacks: 1,
                        appliedTime: this.game.state.now,
                        isActive: true
                    });

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

            // Enhanced freezing aura pulse
            if (!this.game.isServer) {
                this.game.call('createLayeredEffect', {
                    position: new THREE.Vector3(casterPos.x, casterPos.y + 20, casterPos.z),
                    layers: [
                        // Ice crystal ring
                        {
                            count: 18,
                            lifetime: 0.8,
                            color: 0x88ddff,
                            colorRange: { start: 0xaaeeff, end: 0x4488cc },
                            scale: 12,
                            scaleMultiplier: 1.5,
                            velocityRange: { x: [-70, 70], y: [5, 40], z: [-70, 70] },
                            gravity: 30,
                            drag: 0.92,
                            blending: 'additive'
                        },
                        // Frost mist rising
                        {
                            count: 15,
                            lifetime: 0.7,
                            color: 0xccffff,
                            colorRange: { start: 0xffffff, end: 0x88ccff },
                            scale: 20,
                            scaleMultiplier: 2.0,
                            velocityRange: { x: [-40, 40], y: [30, 80], z: [-40, 40] },
                            gravity: -30,
                            drag: 0.88,
                            blending: 'additive'
                        },
                        // Snowflakes
                        {
                            count: 12,
                            lifetime: 1.2,
                            color: 0xffffff,
                            colorRange: { start: 0xffffff, end: 0xccddff },
                            scale: 4,
                            scaleMultiplier: 0.4,
                            velocityRange: { x: [-50, 50], y: [-20, 30], z: [-50, 50] },
                            gravity: 60,
                            drag: 0.97,
                            blending: 'additive'
                        }
                    ]
                });
            }
        }
    }
}