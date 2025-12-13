class ConsecrationAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'consecration',
            name: 'Consecration',
            description: 'Sanctify the ground, creating a zone that damages undead and heals the living',
            cooldown: 18.0,
            range: 0, // Centered on caster
            manaCost: 50,
            targetType: 'area',
            animation: 'cast',
            priority: 7,
            castTime: 2.0,
            ...params
        });
        
        this.consecrationRadius = 120;
        this.duration = 15.0; // 15 seconds
        this.tickInterval = 2.0; // Every 2 seconds
        this.tickDamage = 12; // Damage to undead per tick
        this.tickHeal = 8; // Healing to living per tick
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 20,
                    color: 0xffdd66,
                    colorRange: { start: 0xffffff, end: 0xffaa00 },
                    scaleMultiplier: 2.5,
                    speedMultiplier: 1.0
                }
            },
            consecration: {
                type: 'heal',
                options: {
                    count: 12,
                    color: 0xffff88,
                    colorRange: { start: 0xffffff, end: 0xffdd44 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 0.6
                }
            },
            purge: {
                type: 'damage',
                options: {
                    count: 15,
                    color: 0xffffff,
                    colorRange: { start: 0xffffff, end: 0xffff88 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 2.5
                }
            },
            ground_glow: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0xffdd44,
                    colorRange: { start: 0xffff88, end: 0xffaa00 },
                    scaleMultiplier: 1.0,
                    speedMultiplier: 0.4
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Check if there are units nearby that would benefit from consecration
        const nearbyUnits = this.getUnitsInRange(casterEntity, this.consecrationRadius);
        return nearbyUnits.length >= 2; // At least 2 units to affect
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        if (!pos) return;
        
        // Immediate cast effect
        this.createVisualEffect(pos, 'cast');
        this.logAbilityUsage(casterEntity, "Templar consecrates the battlefield with holy power!", true);
        
        // DESYNC SAFE: Use scheduling system for consecration creation
        this.game.schedulingSystem.scheduleAction(() => {
            this.createConsecration(casterEntity, pos);
        }, this.castTime, casterEntity);
    }
    
    createConsecration(casterEntity, consecrationPos) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        if (!casterHealth || casterHealth.current <= 0) return;

        // Create consecrated ground entity
        const consecrationId = this.game.createEntity();

        this.game.addComponent(consecrationId, "transform", {
            position: { x: consecrationPos.x, y: consecrationPos.y, z: consecrationPos.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        const enums = this.game.getEnums();
        this.game.addComponent(consecrationId, "temporaryEffect", {
            effectType: enums.temporaryEffectType.consecrated_ground,
            caster: casterEntity,
            radius: this.consecrationRadius,
            tickInterval: this.tickInterval,
            tickDamage: this.tickDamage,
            tickHeal: this.tickHeal,
            createdTime: this.game.state.now
        });

        const objectTypeIndex = this.enums.objectTypeDefinitions?.effects ?? -1;
        const spawnTypeIndex = this.enums.effects?.consecration ?? -1;
        this.game.addComponent(consecrationId, "renderable", {
            objectType: objectTypeIndex,
            spawnType: spawnTypeIndex,
            capacity: 128
        });
        
        // DESYNC SAFE: Schedule all consecration ticks using the scheduling system
        const totalTicks = Math.floor(this.duration / this.tickInterval);
        
        for (let tickIndex = 0; tickIndex < totalTicks; tickIndex++) {
            const tickDelay = this.tickInterval * tickIndex;
            
            this.game.schedulingSystem.scheduleAction(() => {
                this.executeConsecrationTick(consecrationId, casterEntity, consecrationPos, tickIndex);
            }, tickDelay, consecrationId);
        }
        
        // DESYNC SAFE: Schedule consecration cleanup
        this.game.schedulingSystem.scheduleAction(() => {
            this.cleanupConsecration(consecrationId);
        }, this.duration, consecrationId);
        
        // Screen effect for consecration creation
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#ffffaa', 0.5);
        }

        // Create initial burst and continuous ground glow
        if (!this.game.isServer) {
            const glowPos = new THREE.Vector3(consecrationPos.x, consecrationPos.y + 10, consecrationPos.z);

            // Initial holy burst
            this.game.call('createLayeredEffect', {
                position: glowPos,
                layers: [
                    // Expanding golden ring
                    {
                        count: 32,
                        lifetime: 1.0,
                        color: 0xffdd44,
                        colorRange: { start: 0xffffff, end: 0xffaa00 },
                        scale: 15,
                        scaleMultiplier: 1.0,
                        velocityRange: { x: [-100, 100], y: [5, 20], z: [-100, 100] },
                        gravity: 20,
                        drag: 0.9,
                        emitterShape: 'ring',
                        emitterRadius: 20,
                        blending: 'additive'
                    },
                    // Rising light pillars
                    {
                        count: 20,
                        lifetime: 1.5,
                        color: 0xffff88,
                        colorRange: { start: 0xffffff, end: 0xffdd44 },
                        scale: 20,
                        scaleMultiplier: 2.0,
                        velocityRange: { x: [-20, 20], y: [60, 120], z: [-20, 20] },
                        gravity: -40,
                        drag: 0.95,
                        emitterShape: 'disk',
                        emitterRadius: this.consecrationRadius * 0.8,
                        blending: 'additive'
                    }
                ]
            });

            // Schedule continuous ground glow throughout duration
            const glowInterval = 0.5;
            const glowCount = Math.floor(this.duration / glowInterval);

            for (let i = 0; i < glowCount; i++) {
                this.game.schedulingSystem.scheduleAction(() => {
                    // Ground particles
                    this.game.call('createParticles', {
                        position: new THREE.Vector3(consecrationPos.x, consecrationPos.y + 5, consecrationPos.z),
                        count: 10,
                        lifetime: 1.2,
                        visual: {
                            color: 0xffdd44,
                            colorRange: { start: 0xffff88, end: 0xffaa00 },
                            scale: 15,
                            scaleMultiplier: 1.0,
                            fadeOut: true,
                            blending: 'additive'
                        },
                        velocityRange: { x: [-30, 30], y: [20, 50], z: [-30, 30] },
                        gravity: -30,
                        drag: 0.96,
                        emitterShape: 'disk',
                        emitterRadius: this.consecrationRadius * 0.6
                    });

                    // Edge sparkles
                    this.game.call('createParticles', {
                        position: new THREE.Vector3(consecrationPos.x, consecrationPos.y + 5, consecrationPos.z),
                        count: 6,
                        lifetime: 0.8,
                        visual: {
                            color: 0xffffff,
                            colorRange: { start: 0xffffff, end: 0xffffaa },
                            scale: 8,
                            scaleMultiplier: 0.5,
                            fadeOut: true,
                            blending: 'additive'
                        },
                        velocityRange: { x: [-20, 20], y: [30, 60], z: [-20, 20] },
                        gravity: -20,
                        drag: 0.98,
                        emitterShape: 'ring',
                        emitterRadius: this.consecrationRadius * 0.9
                    });
                }, i * glowInterval, consecrationId);
            }
        }
    }
    
    // DESYNC SAFE: Execute a single consecration tick deterministically
    executeConsecrationTick(consecrationId, casterEntity, consecrationPos, tickIndex) {
        // Check if consecration entity still exists
        if (!this.game.hasComponent(consecrationId, "temporaryEffect")) {
            return;
        }

        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        const casterTeam = this.game.getComponent(casterEntity, "team");

        if (!casterHealth || casterHealth.current <= 0 || !casterTeam) {
            // Caster died, end consecration early
            this.cleanupConsecration(consecrationId);
            return;
        }

        // DESYNC SAFE: Get all units in area deterministically
        const allUnits = this.game.getEntitiesWith(
            "transform",
            "health",
            "team"
        );
        
        // Sort units for consistent processing order
        const sortedUnits = allUnits.slice().sort((a, b) => a - b);
        
        let undeadDamaged = 0;
        let livingHealed = 0;
        
        sortedUnits.forEach(unitId => {
            const transform = this.game.getComponent(unitId, "transform");
            const unitPos = transform?.position;
            const health = this.game.getComponent(unitId, "health");
            const team = this.game.getComponent(unitId, "team");
            const unitTypeComp = this.game.getComponent(unitId, "unitType");
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

            if (!unitPos || !health || !team || health.current <= 0) return;

            // Check if unit is in consecration radius
            const distance = Math.sqrt(
                Math.pow(unitPos.x - consecrationPos.x, 2) +
                Math.pow(unitPos.z - consecrationPos.z, 2)
            );

            if (distance <= this.consecrationRadius) {
                // DESYNC SAFE: Determine if unit is undead/evil deterministically
                const isUndead = this.isUndeadUnit(unitType);
                
                if (isUndead) {
                    // Damage undead/evil units
                    this.dealDamageWithEffects(casterEntity, unitId, this.tickDamage, 'divine', {
                        isConsecration: true,
                        tickIndex: tickIndex
                    });
                    this.createVisualEffect(unitPos, 'purge', { heightOffset: 10 });
                    undeadDamaged++;
                } else if (team.team === casterTeam.team) {
                    // Heal living allies
                    if (health.current < health.max) {
                        const healAmount = Math.min(this.tickHeal, health.max - health.current);
                        health.current += healAmount;
                        
                        this.createVisualEffect(unitPos, 'consecration', { heightOffset: 10 });
                        
                        if (!this.game.isServer && this.game.hasService('showDamageNumber')) {
                            this.game.call('showDamageNumber',
                                unitPos.x, unitPos.y + 15, unitPos.z,
                                healAmount, 'heal'
                            );
                        }
                        livingHealed++;
                    }
                }
            }
        });
        
        // Additional visual effects every few ticks
        if (tickIndex % 3 === 0) {
            this.createVisualEffect(consecrationPos, 'consecration', { 
                count: 8, 
                scaleMultiplier: 2.0,
                heightOffset: 5 
            });
        }
        
   
    }
    
    // DESYNC SAFE: Determine if unit is undead deterministically
    isUndeadUnit(unitType) {
        if (!unitType) return false;
        
        // Check various undead/evil identifiers
        return (
            unitType.id === 'skeleton' ||
            unitType.id === 'zombie' ||
            unitType.id === 'lich' ||
            unitType.id === 'wraith' ||
            unitType.id === 'demon'
        );
    }
    
    // DESYNC SAFE: Get all units in range
    getUnitsInRange(casterEntity, radius) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return [];

        const allUnits = this.game.getEntitiesWith(
            "transform",
            "health"
        );

        return allUnits.filter(unitId => {
            const transform = this.game.getComponent(unitId, "transform");
            const unitPos = transform?.position;
            const health = this.game.getComponent(unitId, "health");
            
            if (!unitPos || !health || health.current <= 0) return false;
            
            const distance = Math.sqrt(
                Math.pow(unitPos.x - casterPos.x, 2) + 
                Math.pow(unitPos.z - casterPos.z, 2)
            );
            
            return distance <= radius;
        }).sort((a, b) => a - b); // Sort for determinism
    }
    
    // DESYNC SAFE: Clean up consecration
    cleanupConsecration(consecrationId) {
        if (this.game.hasComponent(consecrationId, "temporaryEffect")) {
            // Visual effect for consecration ending
            const transform = this.game.getComponent(consecrationId, "transform");
            const consecrationPos = transform?.position;
            if (consecrationPos) {
                this.createVisualEffect(consecrationPos, 'consecration', { 
                    count: 12, 
                    scaleMultiplier: 1.5,
                    color: 0xffd700 
                });
            }
            
            this.game.destroyEntity(consecrationId);
            
       
        }
    }
}
