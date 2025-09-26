class RaiseDeadAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'raise_dead',
            name: 'Raise Dead',
            description: 'Convert corpses into skeleton warriors',
            cooldown: 1.0,
            range: 150,
            manaCost: 0,
            targetType: 'auto',
            animation: 'cast',
            priority: 1,
            castTime: 1.0,
            autoTrigger: 'corpses_available',
            ...params
        });
        
        this.maxCorpsesToRaise = 4;
        this.raisedUnitType = '0_skeleton';
        this.element = 'dark';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x4B0082,
                    colorRange: { start: 0x4B0082, end: 0x8B008B },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 1.0
                }
            },
            raise_dead: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x8B008B,
                    colorRange: { start: 0x8B008B, end: 0x32CD32 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 0.5
                }
            },
            necromancy: {
                type: 'magic',
                options: {
                    count: 3,
                    color: 0x228B22,
                    scaleMultiplier: 1.8,
                    speedMultiplier: 1.2
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        if (!this.game.deathSystem) return false;
        
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return false;
        
        const validCorpses = this.getValidCorpsesInRange(casterPos);
        return validCorpses.length > 0;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
        
        if (!this.game.deathSystem || !casterPos || !casterTeam) return null;
        
        const validCorpses = this.getValidCorpsesInRange(casterPos);
        if (validCorpses.length === 0) return null;
        
        // Show immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Dark magic stirs the dead...`);
        
        // Schedule the necromancy after cast time
        this.game.schedulingSystem.scheduleAction(() => {
            this.performRaiseDeadRitual(casterEntity, validCorpses, casterTeam.team);
        }, this.castTime, casterEntity);
    }
    
    performRaiseDeadRitual(casterEntity, validCorpses, team) {
        const collections = this.game.getCollections();
        if (!collections?.units?.[this.raisedUnitType]) {
            console.warn(`${this.raisedUnitType} unit type not found`);
            return;
        }
        
        const skeletonDef = collections.units[this.raisedUnitType];
        
        // Sort corpses deterministically for consistent processing order
        const sortedCorpses = this.sortCorpsesDeterministically(validCorpses);
        const corpsesToRaise = sortedCorpses.slice(0, this.maxCorpsesToRaise);
        
        let raisedCount = 0;
        const raisedSkeletons = [];
        
        // Process corpses in deterministic order
        corpsesToRaise.forEach((corpseData, index) => {
            const consumedCorpse = this.game.deathSystem.consumeCorpse(corpseData.entityId);
            if (!consumedCorpse) return;
            
            const skeletonId = this.createSkeletonFromCorpse(
                corpseData.position, 
                skeletonDef, 
                team, 
                index
            );
            
            if (skeletonId !== null) {
                raisedCount++;
                raisedSkeletons.push(skeletonId);
                
                // Create raising effect
                this.createVisualEffect(corpseData.position, 'raise_dead');
                this.logCorpseRaising(consumedCorpse, team);
                
                // Schedule a delayed necromancy effect for dramatic flair
                this.game.schedulingSystem.scheduleAction(() => {
                    this.createVisualEffect(corpseData.position, 'necromancy');
                }, 0.5, skeletonId);
            }
        });
        
        if (raisedCount > 0) {
            this.logAbilityUsage(casterEntity, 
                `Necromancy raises ${raisedCount} skeleton${raisedCount > 1 ? 's' : ''} from the dead!`);
                
            // Screen effect for dramatic impact
            if (this.game.effectsSystem) {
                this.game.effectsSystem.playScreenFlash('#4B0082', 0.4);
            }
        }
    }
    
    // FIXED: Deterministic corpse validation and retrieval
    getValidCorpsesInRange(casterPos) {
        const nearbyCorpses = this.game.deathSystem.getCorpsesInRange(casterPos, this.range);
        
        // Filter out corpses that are already the raised unit type (prevent re-raising skeletons)
        const validCorpses = nearbyCorpses.filter(corpseData => {
            return corpseData.corpse.originalUnitType.id !== this.raisedUnitType;
        });
        
        return validCorpses;
    }
    
    // FIXED: Deterministic corpse sorting
    sortCorpsesDeterministically(corpses) {
        return corpses.slice().sort((a, b) => {
            // Sort by entity ID first for primary determinism
            const idComparison = String(a.entityId).localeCompare(String(b.entityId));
            if (idComparison !== 0) return idComparison;
            
            // Secondary sort by position for additional determinism
            if (a.position.x !== b.position.x) {
                return a.position.x - b.position.x;
            }
            if (a.position.z !== b.position.z) {
                return a.position.z - b.position.z;
            }
            
            return 0;
        });
    }
    
    // FIXED: Deterministic skeleton creation with ordered components
    createSkeletonFromCorpse(corpsePos, skeletonDef, team, creationIndex) {
        const skeletonId = this.game.createEntity ? this.game.createEntity() : null;
        if (skeletonId === null || skeletonId === undefined) return null;
        
        const components = this.game.componentManager.getComponents();
        const componentTypes = this.game.componentManager.getComponentTypes();
        
        // FIXED: Deterministic facing based on creation order, not team
        const initialFacing = (creationIndex % 2 === 0) ? 0 : Math.PI;
        
        try {
            // Add components in deterministic alphabetical order
            this.game.addComponent(skeletonId, componentTypes.AI_STATE, 
                components.AIState('idle'));
                
            this.game.addComponent(skeletonId, componentTypes.ANIMATION, 
                components.Animation());
                
            this.game.addComponent(skeletonId, componentTypes.COLLISION, 
                components.Collision(skeletonDef.size, skeletonDef.height));
                
            this.game.addComponent(skeletonId, componentTypes.COMBAT, 
                components.Combat(
                    skeletonDef.damage || 15, 
                    skeletonDef.range || 25, 
                    skeletonDef.attackSpeed || 1.0,
                    skeletonDef.projectile || null, 
                    0, 
                    skeletonDef.element || 'physical',
                    skeletonDef.armor || 0, 
                    skeletonDef.fireResistance || 0,
                    skeletonDef.coldResistance || 0, 
                    skeletonDef.lightningResistance || 0
                ));
                
            this.game.addComponent(skeletonId, componentTypes.EQUIPMENT, 
                components.Equipment());
                
            this.game.addComponent(skeletonId, componentTypes.FACING, 
                components.Facing(initialFacing));
                
            this.game.addComponent(skeletonId, componentTypes.HEALTH, 
                components.Health(skeletonDef.hp || 50));
                
            this.game.addComponent(skeletonId, componentTypes.POSITION, 
                components.Position(corpsePos.x, corpsePos.y, corpsePos.z));
                
            this.game.addComponent(skeletonId, componentTypes.RENDERABLE, 
                components.Renderable("units", this.raisedUnitType));
                
            this.game.addComponent(skeletonId, componentTypes.TEAM, 
                components.Team(team));
                
            this.game.addComponent(skeletonId, componentTypes.UNIT_TYPE, 
                components.UnitType(
                    this.raisedUnitType, 
                    skeletonDef.title || "Skeleton", 
                    skeletonDef.value || 25
                ));
                
            this.game.addComponent(skeletonId, componentTypes.VELOCITY, 
                components.Velocity(0, 0, 0, (skeletonDef.speed || 1) * 20));
            
            return skeletonId;
            
        } catch (error) {
            console.error(`Failed to create skeleton from corpse:`, error);
            return null;
        }
    }
    
    logCorpseRaising(corpse, team) {
        if (this.game.battleLogSystem) {
            const originalTeam = corpse.teamAtDeath || 'unknown';
            this.game.battleLogSystem.add(
                `A ${originalTeam} corpse rises as a ${team} skeleton!`,
                'log-ability'
            );
        }
    }
}