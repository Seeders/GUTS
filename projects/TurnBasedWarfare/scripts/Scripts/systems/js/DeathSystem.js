class DeathSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.deathSystem = this;
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

                // Remove health (corpses can't be damaged)
                if (this.game.hasComponent(entityId, "health")) {
                    this.game.removeComponent(entityId, "health");
                }

                // Remove velocity (corpses don't move)
                if (this.game.hasComponent(entityId, "velocity")) {
                    this.game.removeComponent(entityId, "velocity");
                }
                
                const timerExpired = timeSinceDeath >= deathState.deathAnimationDuration * 0.975;
                
                if (timerExpired) {
                    console.log(entityId, "DIED");
                    if(unitType && unitType.collection == "buildings"){
                        this.destroyBuilding(entityId);
                    } else {
                        this.convertToCorpse(entityId);
                    }
                }
            }
        });
    }



    destroyBuilding(entityId) {
        this.game.triggerEvent('onDestroyBuilding', entityId);
        this.game.destroyEntity(entityId);  
        return { success: true };
    }
    
    convertToCorpse(entityId) {
        const Components = this.game.gameManager.call('getComponents');

        // Get current components before conversion
        const position = this.game.getComponent(entityId, "position");
        const unitType = this.game.getComponent(entityId, "unitType");
        const team = this.game.getComponent(entityId, "team");
        const renderable = this.game.getComponent(entityId, "renderable");

        if (!position || !unitType || !team) return;

        // CRITICAL: Notify AnimationSystem FIRST to set corpse state
        if(this.game.gameManager.has('setCorpseAnimation')){
            this.game.gameManager.call('setCorpseAnimation', entityId);
        }

        // Remove death state
        this.game.removeComponent(entityId, "deathState");


        this.game.triggerEvent('onUnitKilled', entityId);
        // Add corpse component
        this.game.addComponent(entityId, "corpse", {
            originalUnitType: { ...unitType },
            deathTime: (this.game.state.now || 0),
            teamAtDeath: team.team,
            isCorpse: true
        });
        
    }

    // Rest of your existing methods remain the same...
    getCorpsesInRange(position, range, teamFilter = null) {
        const corpses = this.game.getEntitiesWith("corpse");
        // Sort for deterministic processing order (prevents desync)
        corpses.sort((a, b) => String(a).localeCompare(String(b)));
        const nearbyCorpses = [];

        corpses.forEach(corpseId => {
            const corpsePos = this.game.getComponent(corpseId, "position");
            const corpse = this.game.getComponent(corpseId, "corpse");
            
            if (!corpsePos || !corpse) return;
            
            // Check team filter if specified
            if (teamFilter && corpse.teamAtDeath !== teamFilter) return;
            
            // Check distance
            const dx = corpsePos.x - position.x;
            const dz = corpsePos.z - position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            if (distance <= range) {
                nearbyCorpses.push({
                    entityId: corpseId,
                    position: corpsePos,
                    corpse: corpse,
                    distance: distance
                });
            }
        });
        
        return nearbyCorpses;
    }

    consumeCorpse(corpseId) {
        // Remove corpse from battlefield (for abilities that consume corpses)
        const corpse = this.game.getComponent(corpseId, "corpse");
        if (!corpse) return null;
        
        // Return corpse data for the ability to use
        const corpseData = { ...corpse };
        
        // Destroy the corpse entity
        this.game.destroyEntity(corpseId);
        
        return corpseData;
    }

    getAllCorpses() {
        return this.game.getEntitiesWith("corpse");
    }

    getCorpsesByTeam(team) {
        const corpses = this.game.getEntitiesWith("corpse");
        return corpses.filter(corpseId => {
            const corpse = this.game.getComponent(corpseId, "corpse");
            return corpse && corpse.teamAtDeath === team;
        });
    }
}