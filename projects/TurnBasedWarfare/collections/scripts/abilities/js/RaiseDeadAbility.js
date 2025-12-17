class RaiseDeadAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
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
            ...abilityData
        });
        
        this.maxCorpsesToRaise = 4;
        this.raisedUnitType = '0_skeleton';
        this.element = 'dark';
    }
    
    canExecute(casterEntity) {
        if (!this.game.deathSystem) return false;
        
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        if (!casterPos) return false;
        
        const validCorpses = this.getValidCorpsesInRange(casterPos);
        return validCorpses.length > 0;
    }
    
    execute(casterEntity) {
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
        const casterTeam = this.game.getComponent(casterEntity, "team");
        
        if (!this.game.deathSystem || !casterPos || !casterTeam) return null;
        
        const validCorpses = this.getValidCorpsesInRange(casterPos);
        if (validCorpses.length === 0) return null;
        
        // Show immediate cast effect
        this.playConfiguredEffects('cast', casterPos);
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
                this.playConfiguredEffects('summon', corpseData.position);
                this.logCorpseRaising(consumedCorpse, team);

                // Enhanced necromantic rising effect (client only) using preset effect system
                if (!this.game.isServer) {
                    this.game.call('playEffectSystem', 'raise_dead',
                        new THREE.Vector3(corpseData.position.x, corpseData.position.y + 20, corpseData.position.z));

                    // Ground disturbance ring using preset effect
                    this.game.call('playEffect', 'undead_summon',
                        new THREE.Vector3(corpseData.position.x, corpseData.position.y + 3, corpseData.position.z));
                }

                // Schedule a delayed necromancy effect for dramatic flair
                this.game.schedulingSystem.scheduleAction(() => {
                    this.playConfiguredEffects('impact', corpseData.position);
                }, 0.5, skeletonId);
            }
        });
        
        if (raisedCount > 0) {
            this.logAbilityUsage(casterEntity, 
                `Necromancy raises ${raisedCount} skeleton${raisedCount > 1 ? 's' : ''} from the dead!`);
                
            // Screen effect for dramatic impact (client only)
            if (!this.game.isServer && this.game.effectsSystem) {
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
            const idComparison = a.entityId - b.entityId;
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


        // FIXED: Deterministic facing based on creation order, not team
        const initialFacing = (creationIndex % 2 === 0) ? 0 : Math.PI;

        try {
            // Add components in deterministic alphabetical order
            this.game.addComponent(skeletonId, "buff", {
                state: 'idle',
                targetPosition: null,
                target: null,
                aiControllerId: null,
                meta: {}
            });

            this.game.addComponent(skeletonId, "buff", {
                scale: 1,
                rotation: 0,
                flash: 0
            });

            this.game.addComponent(skeletonId, "buff", {
                radius: skeletonDef.size,
                height: skeletonDef.height || 50
            });

            this.game.addComponent(skeletonId, "buff", {
                damage: skeletonDef.damage || 15,
                range: skeletonDef.range || 25,
                attackSpeed: skeletonDef.attackSpeed || 1.0,
                projectile: skeletonDef.projectile || null,
                lastAttack: 0,
                element: skeletonDef.element || 'physical',
                armor: skeletonDef.armor || 0,
                fireResistance: skeletonDef.fireResistance || 0,
                coldResistance: skeletonDef.coldResistance || 0,
                lightningResistance: skeletonDef.lightningResistance || 0,
                poisonResistance: 0,
                visionRange: 300
            });

            this.game.addComponent(skeletonId, "buff", {
                slots: {
                    mainHand: null,
                    offHand: null,
                    helmet: null,
                    chest: null,
                    legs: null,
                    feet: null,
                    back: null
                }
            });

            this.game.addComponent(skeletonId, "buff", {
                angle: initialFacing
            });

            this.game.addComponent(skeletonId, "buff", {
                max: skeletonDef.hp || 50,
                current: skeletonDef.hp || 50
            });

            this.game.addComponent(skeletonId, "buff", {
                x: corpsePos.x,
                y: corpsePos.y,
                z: corpsePos.z
            });

            this.game.addComponent(skeletonId, "buff", {
                objectType: "units",
                spawnType: this.raisedUnitType,
                capacity: 128
            });

            this.game.addComponent(skeletonId, "buff", {
                team: team
            });

            this.game.addComponent(skeletonId, "buff", {
                id: this.raisedUnitType,
                title: skeletonDef.title || "Skeleton",
                value: skeletonDef.value || 25
            });

            this.game.addComponent(skeletonId, "velocity", {
                vx: 0,
                vy: 0,
                vz: 0,
                maxSpeed: (skeletonDef.speed || 1) * 20,
                affectedByGravity: true,
                anchored: false
            });

            return skeletonId;

        } catch (error) {
            console.error(`Failed to create skeleton from corpse:`, error);
            return null;
        }
    }
    
    logCorpseRaising(corpse, team) {
       
    }
}
