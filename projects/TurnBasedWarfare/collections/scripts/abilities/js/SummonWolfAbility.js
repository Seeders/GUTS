class SummonWolfAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
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
            ...abilityData
        });
        this.hasSummon = false;
        this.summonId = '0_skeleton';
        this.summonedWolfId = null; // Track the specific summoned wolf
    }
    
    canExecute(casterEntity) {
        // Check if this Beast Master already has a summoned wolf that's still alive
        if (this.summonedWolfId) {
            const wolfHealth = this.game.getComponent(this.summonedWolfId, "health");
            const wolfDeathState = this.game.getComponent(this.summonedWolfId, "deathState");
            
            // If wolf is dead or dying, reset our tracking
            const enums = this.game.getEnums();
            if (!wolfHealth || wolfHealth.current <= 0 || (wolfDeathState && wolfDeathState.state !== enums?.deathState?.alive)) {
                this.hasSummon = false;
                this.summonedWolfId = null;
            }
        }
        
        return !this.hasSummon;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const pos = transform?.position;
        const team = this.game.getComponent(casterEntity, "team");
        if (!pos || !team) return;
        
        // Immediate cast effect
        this.playConfiguredEffects('cast', pos);
        this.logAbilityUsage(casterEntity, "Beast Master summons a faithful wolf!");
        
        // DESYNC SAFE: Use scheduling system for summoning
        this.game.schedulingSystem.scheduleAction(() => {
            this.performSummon(casterEntity, pos, team);
        }, this.castTime, casterEntity);
    }
    
    performSummon(casterEntity, summonPos, team) {
        // Check if caster is still alive
        const casterHealth = this.game.getComponent(casterEntity, "health");
        if (!casterHealth || casterHealth.current <= 0) return;
        
        // DESYNC SAFE: Find deterministic summon position
        const wolfPosition = this.findSummonPosition(summonPos);
        
        // Create wolf companion
        const wolfId = this.createSummonedCreature(wolfPosition, this.summonId, team.team, casterEntity);
        
        if (wolfId) {
            this.hasSummon = true;
            this.summonedWolfId = wolfId;
            
            // Summon effect at wolf position
            this.playConfiguredEffects('summon', wolfPosition);
            
            // Screen effect for dramatic summoning
            if (this.game.effectsSystem) {
                this.game.effectsSystem.playScreenShake(0.15, 1);
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
            this.game.addComponent(creatureId, "transform", {
                position: { x: pos.x, y: pos.y, z: pos.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            });

            this.game.addComponent(creatureId, "velocity", {
                vx: 0,
                vy: 0,
                vz: 0,
                maxSpeed: (unitDef.speed) * 20,
                affectedByGravity: true,
                anchored: false
            });

            const objectTypeIndex = this.enums.objectTypeDefinitions?.units ?? -1;
            const spawnTypeIndex = this.enums.units?.[unitDefId] ?? -1;
            this.game.addComponent(creatureId, "renderable", {
                objectType: objectTypeIndex,
                spawnType: spawnTypeIndex,
                capacity: 128
            });

            this.game.addComponent(creatureId, "health", {
                max: unitDef.hp,
                current: unitDef.hp
            });

            const enums = this.game.getEnums();
            this.game.addComponent(creatureId, "combat", {
                damage: unitDef.damage,
                range: unitDef.range,
                attackSpeed: unitDef.attackSpeed,
                projectile: null,
                lastAttack: 0,
                element: enums.element.physical,
                armor: 0,
                fireResistance: 0,
                coldResistance: 0,
                lightningResistance: 0,
                poisonResistance: 0,
                visionRange: 300
            });

            this.game.addComponent(creatureId, "collision", {
                radius: unitDef.size,
                height: unitDef.height || 50
            });

            this.game.addComponent(creatureId, "team", {
                team: team
            });

            this.game.addComponent(creatureId, "unitType", {
                collection: enums.objectTypeDefinitions.units ?? -1,
                type: enums.units[unitDefId] ?? -1
            });

            this.game.addComponent(creatureId, "aiState", {
                currentAction: null,
                currentActionCollection: null,
                rootBehaviorTree: null,
                rootBehaviorTreeCollection: null
            });

            this.game.addComponent(creatureId, "animation", {
                scale: 1,
                rotation: 0,
                flash: 0
            });

            // DESYNC SAFE: Use game time for summoned component
            this.game.addComponent(creatureId, "summoned", {
                summoner: summoner,
                summonType: enums.units[unitDefId] ?? null,
                originalStats: null,
                createdTime: this.game.state.now || 0,
                isSummoned: true
            });

            return creatureId;
        } catch (error) {
            console.error('Failed to create summoned creature:', error);
            return null;
        }
    }
    
    // Helper method to clean up when the summoner dies
    onSummonerDeath(summonerId) {
        if (this.summonedWolfId && this.game.hasComponent(this.summonedWolfId, "health")) {
            // Kill the summoned wolf when summoner dies
            const wolfHealth = this.game.getComponent(this.summonedWolfId, "health");
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
