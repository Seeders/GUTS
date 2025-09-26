class ConsecrationAbility extends engine.app.appClasses['BaseAbility'] {
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
                    count: 3, 
                    color: 0xffffaa, 
                    colorRange: { start: 0xffffaa, end: 0xffffff },
                    scaleMultiplier: 1.6,
                    speedMultiplier: 1.2
                } 
            },
            consecration: { 
                type: 'heal', 
                options: { 
                    count: 3, 
                    color: 0xffffdd, 
                    scaleMultiplier: 0.6,
                    speedMultiplier: 1.0
                } 
            },
            purge: { 
                type: 'damage', 
                options: { 
                    count: 3, 
                    color: 0xffffff, 
                    scaleMultiplier: 1.2,
                    speedMultiplier: 1.5
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
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
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
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        if (!casterHealth || casterHealth.current <= 0) return;
        
        // Create consecrated ground entity
        const consecrationId = this.game.createEntity();
        const Components = this.game.componentManager.getComponents();
        
        this.game.addComponent(consecrationId, this.componentTypes.POSITION, 
            Components.Position(consecrationPos.x, consecrationPos.y, consecrationPos.z));
        
        this.game.addComponent(consecrationId, this.componentTypes.TEMPORARY_EFFECT, 
            Components.TemporaryEffect('consecrated_ground', {
                caster: casterEntity,
                radius: this.consecrationRadius,
                tickInterval: this.tickInterval,
                tickDamage: this.tickDamage,
                tickHeal: this.tickHeal
            }, this.game.state.now));
        
        this.game.addComponent(consecrationId, this.componentTypes.RENDERABLE, 
            Components.Renderable("effects", "consecration"));
        
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
    }
    
    // DESYNC SAFE: Execute a single consecration tick deterministically
    executeConsecrationTick(consecrationId, casterEntity, consecrationPos, tickIndex) {
        // Check if consecration entity still exists
        if (!this.game.hasComponent(consecrationId, this.componentTypes.TEMPORARY_EFFECT)) {
            return;
        }
        
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        
        if (!casterHealth || casterHealth.current <= 0 || !casterTeam) {
            // Caster died, end consecration early
            this.cleanupConsecration(consecrationId);
            return;
        }
        
        // DESYNC SAFE: Get all units in area deterministically
        const allUnits = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.HEALTH,
            this.componentTypes.TEAM
        );
        
        // Sort units for consistent processing order
        const sortedUnits = allUnits.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let undeadDamaged = 0;
        let livingHealed = 0;
        
        sortedUnits.forEach(unitId => {
            const unitPos = this.game.getComponent(unitId, this.componentTypes.POSITION);
            const health = this.game.getComponent(unitId, this.componentTypes.HEALTH);
            const team = this.game.getComponent(unitId, this.componentTypes.TEAM);
            const unitType = this.game.getComponent(unitId, this.componentTypes.UNIT_TYPE);
            
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
                        
                        if (this.game.effectsSystem) {
                            this.game.effectsSystem.showDamageNumber(
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
        
        // Log significant tick activity
        if (this.game.battleLogSystem && (undeadDamaged > 0 || livingHealed > 0)) {
            let message = `Consecration affects the battlefield`;
            if (undeadDamaged > 0) message += ` (${undeadDamaged} undead purged)`;
            if (livingHealed > 0) message += ` (${livingHealed} allies blessed)`;
            this.game.battleLogSystem.add(message, 'log-ability');
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
            unitType.id === 'demon' ||
            unitType.type.toLowerCase().includes('undead') ||
            unitType.type.toLowerCase().includes('skeleton') ||
            unitType.type.toLowerCase().includes('zombie') ||
            unitType.type.toLowerCase().includes('demon') ||
            unitType.type.toLowerCase().includes('evil')
        );
    }
    
    // DESYNC SAFE: Get all units in range
    getUnitsInRange(casterEntity, radius) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return [];
        
        const allUnits = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.HEALTH
        );
        
        return allUnits.filter(unitId => {
            const unitPos = this.game.getComponent(unitId, this.componentTypes.POSITION);
            const health = this.game.getComponent(unitId, this.componentTypes.HEALTH);
            
            if (!unitPos || !health || health.current <= 0) return false;
            
            const distance = Math.sqrt(
                Math.pow(unitPos.x - casterPos.x, 2) + 
                Math.pow(unitPos.z - casterPos.z, 2)
            );
            
            return distance <= radius;
        }).sort((a, b) => String(a).localeCompare(String(b))); // Sort for determinism
    }
    
    // DESYNC SAFE: Clean up consecration
    cleanupConsecration(consecrationId) {
        if (this.game.hasComponent(consecrationId, this.componentTypes.TEMPORARY_EFFECT)) {
            // Visual effect for consecration ending
            const consecrationPos = this.game.getComponent(consecrationId, this.componentTypes.POSITION);
            if (consecrationPos) {
                this.createVisualEffect(consecrationPos, 'consecration', { 
                    count: 12, 
                    scaleMultiplier: 1.5,
                    color: 0xffd700 
                });
            }
            
            this.game.destroyEntity(consecrationId);
            
            // Log consecration ending
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(
                    `The consecrated ground fades away.`,
                    'log-ability'
                );
            }
        }
    }
}