class DeathSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.deathSystem = this;
    }

    init() {
        this.game.register("startDeathProcess", this.startDeathProcess.bind(this));
    }

    update() {
        // Get all entities with death state
        const dyingEntities = this.game.getEntitiesWith("deathState");
        // Sort for deterministic processing order (prevents desync)
        dyingEntities.sort((a, b) => String(a).localeCompare(String(b)));
        dyingEntities.forEach(entityId => {
            const deathState = this.game.getComponent(entityId, "deathState");
            const unitType = this.game.getComponent(entityId, "unitType");

            if (deathState.isDying) {
                const timeSinceDeath = this.game.state.now - deathState.deathStartTime;

                const timerExpired = timeSinceDeath >= deathState.deathAnimationDuration * 0.975;
                
                if (timerExpired) {
                    if(unitType && unitType.collection == "buildings"){
                        this.destroyBuilding(entityId);
                    } else {
                        this.convertToCorpse(entityId);
                    }
                }
            }
        });
    }

    startDeathProcess(entityId){
        console.log(entityId, "DIED");

        this.game.addComponent(entityId, 'deathState', {
            isDying: true,
            state: 'dying',
            deathStartTime: this.game.state.now
        });

        // Trigger death animation
        if(this.game.hasService('playDeathAnimation')){
            this.game.call('playDeathAnimation', entityId);
        }

        // Remove health (corpses can't be damaged)
        if (this.game.hasComponent(entityId, "health")) {
            this.game.removeComponent(entityId, "health");
        }

        // Remove velocity (corpses don't move)
        if (this.game.hasComponent(entityId, "velocity")) {
            this.game.removeComponent(entityId, "velocity");
        }

    }

    destroyBuilding(entityId) {
        this.game.triggerEvent('onDestroyBuilding', entityId);
        this.game.destroyEntity(entityId);  
        return { success: true };
    }
    
    convertToCorpse(entityId) {

        // Get current components before conversion
        const transform = this.game.getComponent(entityId, "transform");
        const pos = transform?.position;
        const unitType = this.game.getComponent(entityId, "unitType");
        const team = this.game.getComponent(entityId, "team");

        if (!pos || !unitType || !team) return;

        // CRITICAL: Notify AnimationSystem FIRST to set corpse state
        if(this.game.hasService('setCorpseAnimation')){
            this.game.call('setCorpseAnimation', entityId);
        }

        // Update death state to corpse - keep the component to prevent revival
        const deathState = this.game.getComponent(entityId, "deathState");
        if (deathState) {
            deathState.state = 'corpse';
            deathState.corpseTime = this.game.state.now || 0;
            deathState.teamAtDeath = team.team;
        }

        this.game.triggerEvent('onUnitKilled', entityId);
        
    }

    // Rest of your existing methods remain the same...
    getCorpsesInRange(position, range, teamFilter = null) {
        const corpses = this.game.getEntitiesWith("deathState");
        // Sort for deterministic processing order (prevents desync)
        corpses.sort((a, b) => String(a).localeCompare(String(b)));
        const nearbyCorpses = [];

        corpses.forEach(corpseId => {
            const deathState = this.game.getComponent(corpseId, "deathState");

            // Only include actual corpses, not dying entities
            if (!deathState || deathState.state !== 'corpse') return;

            const transform = this.game.getComponent(corpseId, "transform");
            const corpsePos = transform?.position;
            const unitType = this.game.getComponent(corpseId, "unitType");

            if (!corpsePos || !unitType) return;

            // Check team filter if specified
            if (teamFilter && deathState.teamAtDeath !== teamFilter) return;

            // Check distance
            const dx = corpsePos.x - position.x;
            const dz = corpsePos.z - position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance <= range) {
                nearbyCorpses.push({
                    entityId: corpseId,
                    position: corpsePos,
                    corpse: {
                        originalUnitType: unitType,
                        deathTime: deathState.corpseTime,
                        teamAtDeath: deathState.teamAtDeath
                    },
                    distance: distance
                });
            }
        });

        return nearbyCorpses;
    }

    consumeCorpse(corpseId) {
        // Remove corpse from battlefield (for abilities that consume corpses)
        const deathState = this.game.getComponent(corpseId, "deathState");
        if (!deathState || deathState.state !== 'corpse') return null;

        const unitType = this.game.getComponent(corpseId, "unitType");
        if (!unitType) return null;

        // Return corpse data for the ability to use
        const corpseData = {
            originalUnitType: unitType,
            deathTime: deathState.corpseTime,
            teamAtDeath: deathState.teamAtDeath
        };

        // Destroy the corpse entity
        this.game.destroyEntity(corpseId);

        return corpseData;
    }

    getAllCorpses() {
        const allDeathStates = this.game.getEntitiesWith("deathState");
        return allDeathStates.filter(entityId => {
            const deathState = this.game.getComponent(entityId, "deathState");
            return deathState && deathState.state === 'corpse';
        });
    }

    getCorpsesByTeam(team) {
        const allCorpses = this.getAllCorpses();
        return allCorpses.filter(corpseId => {
            const deathState = this.game.getComponent(corpseId, "deathState");
            return deathState && deathState.teamAtDeath === team;
        });
    }

    onBattleEnd() {
        // Clean up all corpses at the end of battle
        const allCorpses = this.getAllCorpses();
        allCorpses.forEach(corpseId => {
            this.game.destroyEntity(corpseId);
        });
        console.log(`Cleaned up ${allCorpses.length} corpses at end of battle`);
    }
}