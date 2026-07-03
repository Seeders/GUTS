class RaiseDeadAbility extends GUTS.BaseAbility {
    static serviceDependencies = [
        ...GUTS.BaseAbility.serviceDependencies,
        'playEffectSystem',
        'playEffect',
        'createUnit'
    ];

    constructor(game, abilityData = {}) {
        super(game, abilityData);

        this.maxCorpsesToRaise = abilityData.maxCorpsesToRaise ?? 4;
        this.raisedUnitType    = abilityData.raisedUnitType    || '0_skeleton';
        this.element           = abilityData.element || 'dark';
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
                    this.call.playEffectSystem( 'raise_dead',
                        new THREE.Vector3(corpseData.position.x, corpseData.position.y + 20, corpseData.position.z));

                    // Ground disturbance ring using preset effect
                    this.call.playEffect( 'undead_summon',
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
    
    // Raise via the engine's canonical unit creation (full components,
    // render, behavior tree), then tag as a per-battle summon so round
    // cleanup collects it.
    createSkeletonFromCorpse(corpsePos, skeletonDef, team, creationIndex) {
        const enums = this.game.getEnums();
        const collectionIndex = enums.objectTypeDefinitions?.units ?? -1;
        const typeIndex = enums.units?.[this.raisedUnitType] ?? -1;
        if (typeIndex < 0) return null;
        const skeletonId = this.call.createUnit(collectionIndex, typeIndex,
            { position: { x: corpsePos.x, y: corpsePos.y, z: corpsePos.z } }, team);
        if (skeletonId == null) return null;
        this.game.addComponent(skeletonId, 'summoned', { ownerId: skeletonId });
        return skeletonId;
    }

    logCorpseRaising(corpse, team) {
       
    }
}
