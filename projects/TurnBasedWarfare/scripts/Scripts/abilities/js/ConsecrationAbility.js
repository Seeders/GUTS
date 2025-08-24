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
        this.duration = 15;
        this.tickDamage = 12;
        this.tickHeal = 8;
    }
    
    defineEffects() {
        return {
            cast: { type: 'magic', options: { count: 25, color: 0xffffaa, scaleMultiplier: 1.6 } },
            consecration: { type: 'heal', options: { count: 4, color: 0xffffdd, scaleMultiplier: 0.6 } },
            purge: { type: 'damage', options: { count: 6, color: 0xffffff, scaleMultiplier: 1.2 } }
        };
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!pos) return;
        
        this.createVisualEffect(pos, 'cast');
        
        // Create consecrated ground effect
        const consecrationId = this.game.createEntity();
        const Components = this.game.componentManager.getComponents();
        
        this.game.addComponent(consecrationId, this.game.componentManager.getComponentTypes().POSITION, 
            Components.Position(pos.x, pos.y, pos.z));
        this.game.addComponent(consecrationId, this.game.componentManager.getComponentTypes().TEMPORARY_EFFECT, 
            Components.TemporaryEffect('consecrated_ground', {
                caster: casterEntity,
                radius: this.consecrationRadius,
                tickInterval: 2.0
            }));
        this.game.addComponent(consecrationId, this.game.componentManager.getComponentTypes().RENDERABLE, 
            Components.Renderable("effects", "consecration"));
        
        // Periodic consecration effects
        const consecrationInterval = setInterval(() => {
            if (!this.game.hasComponent(consecrationId, this.game.componentManager.getComponentTypes().TEMPORARY_EFFECT)) {
                clearInterval(consecrationInterval);
                return;
            }
            
            // Get all units in consecration area
            const allUnits = this.game.getEntitiesWith(
                this.game.componentManager.getComponentTypes().POSITION,
                this.game.componentManager.getComponentTypes().HEALTH
            );
            
            allUnits.forEach(unitId => {
                const unitPos = this.game.getComponent(unitId, this.componentTypes.POSITION);
                const health = this.game.getComponent(unitId, this.componentTypes.HEALTH);
                const team = this.game.getComponent(unitId, this.componentTypes.TEAM);
                const unitType = this.game.getComponent(unitId, this.componentTypes.UNIT_TYPE);
                
                if (!unitPos || !health || !team) return;
                
                const distance = Math.sqrt(
                    Math.pow(unitPos.x - pos.x, 2) + 
                    Math.pow(unitPos.z - pos.z, 2)
                );
                
                if (distance <= this.consecrationRadius) {
                    // Check if unit is undead/evil
                    const isUndead = unitType && (
                        unitType.id === 'skeleton' || 
                        unitType.type.includes('undead') || 
                        unitType.type.includes('demon')
                    );
                    
                    if (isUndead) {
                        // Damage undead
                        this.dealDamageWithEffects(casterEntity, unitId, this.tickDamage, 'divine');
                        this.createVisualEffect(unitPos, 'purge', { heightOffset: 10 });
                    } else {
                        // Heal living allies
                        const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
                        if (casterTeam && team.team === casterTeam.team && health.current < health.max) {
                            const healAmount = Math.min(this.tickHeal, health.max - health.current);
                            health.current += healAmount;
                            this.createVisualEffect(unitPos, 'consecration', { heightOffset: 10 });
                            
                            if (this.game.effectsSystem) {
                                this.game.effectsSystem.showDamageNumber(
                                    unitPos.x, unitPos.y + 15, unitPos.z, 
                                    healAmount, 'heal'
                                );
                            }
                        }
                    }
                }
            });
        }, 2000);
        
        // Clean up after duration
        setTimeout(() => {
            clearInterval(consecrationInterval);
            if (this.game.hasComponent(consecrationId, this.game.componentManager.getComponentTypes().TEMPORARY_EFFECT)) {
                this.game.destroyEntity(consecrationId);
            }
        }, this.duration * 1000);
        
        this.logAbilityUsage(casterEntity, "Templar consecrates the battlefield with holy power!", true);
    }
}