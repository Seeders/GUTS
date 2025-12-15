class CorruptingAuraAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'corrupting_aura',
            name: 'Corrupting Aura',
            description: 'Emanate dark energy that drains enemies and empowers undead (does not stack)',
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
            corruption: {
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
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;
        
        this.createVisualEffect(pos, 'cast');
        this.logAbilityUsage(casterEntity, "Oathbreaker spreads corrupting darkness!");
        
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
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;

        if (!casterHealth || casterHealth.current <= 0 || !casterPos) {
            // Caster is dead, end the aura early
            this.hasActiveAura = false;
            return;
        }
        
        // DESYNC SAFE: Get enemies and allies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        const allies = this.getAlliesInRange(casterEntity);
        
        // Sort for consistent processing order
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        const sortedAllies = allies.slice().sort((a, b) => a - b);
        
        // Process enemies - drain their health
        sortedEnemies.forEach(enemyId => {
            const transform = this.game.getComponent(enemyId, "transform");
            const enemyPos = transform?.position;
            const enemyHealth = this.game.getComponent(enemyId, "health");

            if (!enemyPos || !enemyHealth || enemyHealth.current <= 0) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - casterPos.x, 2) + 
                Math.pow(enemyPos.z - casterPos.z, 2)
            );
            
            if (distance <= this.range) {
                // Apply drain damage
                this.dealDamageWithEffects(casterEntity, enemyId, this.drainPerSecond, 'holy', {
                    isCorruption: true,
                    tickIndex: tickIndex
                });
                
                // Visual corruption effect
                this.createVisualEffect(enemyPos, 'corruption', { heightOffset: 10 });
            }
        });
        
        // Process allies - empower undead
        sortedAllies.forEach(allyId => {
            const unitTypeComp = this.game.getComponent(allyId, "unitType");
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            const transform = this.game.getComponent(allyId, "transform");
            const allyPos = transform?.position;

            if (!unitType || !allyPos) return;

            // Check if this is an undead unit
            if (unitType.id === 'skeleton' || unitType.title?.includes('undead') || unitType.title?.includes('Skeleton')) {
                const distance = Math.sqrt(
                    Math.pow(allyPos.x - casterPos.x, 2) + 
                    Math.pow(allyPos.z - casterPos.z, 2)
                );
                
                if (distance <= this.range) {
                    // Check if already has empowerment buff
                    const enums = this.game.getEnums();
                    const existingBuff = this.game.getComponent(allyId, "buff");

                    if (!existingBuff || existingBuff.buffType !== enums.buffTypes.dark_empowerment) {
                        this.game.addComponent(allyId, "buff", {
                            buffType: enums.buffTypes.dark_empowerment,
                            endTime: this.game.state.now + 3.0,
                            appliedTime: this.game.state.now,
                            stacks: 1,
                            sourceEntity: casterEntity
                        });

                        // Visual empowerment effect
                        this.createVisualEffect(allyPos, 'empowerment', { heightOffset: 5 });
                    }
                }
            }
        });
        
        // Additional visual effects every few ticks
        if (tickIndex % 3 === 0) {
            this.createVisualEffect(casterPos, 'corruption', { 
                count: 6, 
                scaleMultiplier: 2.5,
                heightOffset: 15 
            });
        }
    }
}
