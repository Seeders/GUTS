class SummonWolfAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'summon_wolf',
            name: 'Summon Wolf',
            description: 'Call forth a loyal wolf companion (max 1 per Beast Master)',
            cooldown: 0.0,
            range: 0,
            manaCost: 50,
            targetType: 'self',
            animation: 'cast',
            priority: 5,
            castTime: 1.0,
            ...params
        });
        this.hasSummon = false;
        this.summonId = '0_skeleton';
        this.summonedWolfId = null; // Track the specific summoned wolf
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0x228b22,
                    colorRange: { start: 0x228b22, end: 0x90ee90 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.2
                }
            },
            summon: {
                type: 'magic',
                options: {
                    count: 12,
                    color: 0x32cd32,
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.8
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        // Check if this Beast Master already has a summoned wolf that's still alive
        if (this.summonedWolfId) {
            const wolfHealth = this.game.getComponent(this.summonedWolfId, this.componentTypes.HEALTH);
            const wolfDeathState = this.game.getComponent(this.summonedWolfId, this.componentTypes.DEATH_STATE);
            
            // If wolf is dead or dying, reset our tracking
            if (!wolfHealth || wolfHealth.current <= 0 || (wolfDeathState && wolfDeathState.isDying)) {
                this.hasSummon = false;
                this.summonedWolfId = null;
            }
        }
        
        return !this.hasSummon;
    }
    
    execute(casterEntity) {
        const pos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const team = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        if (!pos || !team) return;
        
        // Immediate cast effect
        this.createVisualEffect(pos, 'cast');
        this.logAbilityUsage(casterEntity, "Beast Master summons a faithful wolf!");
        
        // DESYNC SAFE: Use scheduling system for summoning
        this.game.schedulingSystem.scheduleAction(() => {
            this.performSummon(casterEntity, pos, team);
        }, this.castTime, casterEntity);
    }
    
    performSummon(casterEntity, summonPos, team) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        if (!casterHealth || casterHealth.current <= 0) return;
        
        // DESYNC SAFE: Find deterministic summon position
        const wolfPosition = this.findSummonPosition(summonPos);
        
        // Create wolf companion
        const wolfId = this.createSummonedCreature(wolfPosition, this.summonId, team.team, casterEntity);
        
        if (wolfId) {
            this.hasSummon = true;
            this.summonedWolfId = wolfId;
            
            // Summon effect at wolf position
            this.createVisualEffect(wolfPosition, 'summon');
            
            // Screen effect for dramatic summoning
            if (this.game.effectsSystem) {
                this.game.effectsSystem.playScreenShake(150, 1);
            }
        }
    }
    
    // DESYNC SAFE: Find a valid summon position deterministically
    findSummonPosition(basePos) {
        // Try positions in a deterministic pattern around the caster
        const offsets = [
            { x: 30, z: 0 },    // Right
            { x: -30, z: 0 },   // Left
            { x: 0, z: 30 },    // Forward
            { x: 0, z: -30 },   // Back
            { x: 21, z: 21 },   // Diagonal positions
            { x: -21, z: 21 },
            { x: 21, z: -21 },
            { x: -21, z: -21 }
        ];
        
        // Try each position in order until we find a valid one
        for (const offset of offsets) {
            const testPos = {
                x: basePos.x + offset.x,
                y: basePos.y,
                z: basePos.z + offset.z
            };
            
            // Simple position validation (could be enhanced with collision checking)
            if (this.isValidSummonPosition(testPos)) {
                return testPos;
            }
        }
        
        // Fallback to right side of caster if no valid position found
        return {
            x: basePos.x + 30,
            y: basePos.y,
            z: basePos.z
        };
    }
    
    isValidSummonPosition(pos) {
        // Basic validation - ensure position is within reasonable bounds
        // This could be enhanced with collision detection if needed
        return pos.x >= -1000 && pos.x <= 1000 && pos.z >= -1000 && pos.z <= 1000;
    }
    
    createSummonedCreature(pos, unitDefId, team, summoner) {
        try {
            const creatureId = this.game.createEntity();
            const components = this.game.componentManager.getComponents();
            const componentTypes = this.game.componentManager.getComponentTypes();
            
            // Get unit definition for stats (with fallbacks)
            const collections = this.game.getCollections();
            const unitDef = collections?.units?.[unitDefId] || {
                hp: 60,
                damage: 25,
                range: 30,
                attackSpeed: 1.2,
                speed: 40,
                size: 20
            };
            
            // Add all standard unit components
            this.game.addComponent(creatureId, componentTypes.POSITION, 
                components.Position(pos.x, pos.y, pos.z));
            
            this.game.addComponent(creatureId, componentTypes.VELOCITY, 
                components.Velocity(0, 0, 0, (unitDef.speed || 40) * 20));
            
            this.game.addComponent(creatureId, componentTypes.RENDERABLE, 
                components.Renderable("units", unitDefId));
            
            this.game.addComponent(creatureId, componentTypes.HEALTH, 
                components.Health(unitDef.hp || 60));
            
            this.game.addComponent(creatureId, componentTypes.COMBAT, 
                components.Combat(unitDef.damage || 25, unitDef.range || 30, unitDef.attackSpeed || 1.2));
            
            this.game.addComponent(creatureId, componentTypes.COLLISION, 
                components.Collision(unitDef.size || 20));
            
            this.game.addComponent(creatureId, componentTypes.TEAM, 
                components.Team(team));
            
            this.game.addComponent(creatureId, componentTypes.UNIT_TYPE, 
                components.UnitType(unitDefId, 'Summoned Wolf', 0));
            
            this.game.addComponent(creatureId, componentTypes.AI_STATE, 
                components.AIState('idle'));
            
            this.game.addComponent(creatureId, componentTypes.ANIMATION, 
                components.Animation());
            
            this.game.addComponent(creatureId, componentTypes.FACING, 
                components.Facing(0));
            
            // DESYNC SAFE: Use game time for summoned component
            this.game.addComponent(creatureId, componentTypes.SUMMONED, 
                components.Summoned(summoner, unitDefId, null, this.game.currentTime || 0));
            
            return creatureId;
        } catch (error) {
            console.error('Failed to create summoned creature:', error);
            return null;
        }
    }
    
    // Helper method to clean up when the summoner dies
    onSummonerDeath(summonerId) {
        if (this.summonedWolfId && this.game.hasComponent(this.summonedWolfId, this.componentTypes.HEALTH)) {
            // Kill the summoned wolf when summoner dies
            const wolfHealth = this.game.getComponent(this.summonedWolfId, this.componentTypes.HEALTH);
            if (wolfHealth && wolfHealth.current > 0) {
                wolfHealth.current = 0;
                
                // Trigger death system for the wolf
                if (this.game.deathSystem) {
                    this.game.deathSystem.handleEntityDeath(this.summonedWolfId);
                }
            }
        }
        
        this.hasSummon = false;
        this.summonedWolfId = null;
    }
}