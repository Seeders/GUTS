class DeathSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.deathSystem = this;
    }
    
    update() {
        // Get all entities with death state
        const dyingEntities = this.game.getEntitiesWith(this.componentTypes.DEATH_STATE);
        dyingEntities.forEach(entityId => {
            const deathState = this.game.getComponent(entityId, this.componentTypes.DEATH_STATE);
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
        
            if (deathState.isDying) {
                const timeSinceDeath = this.game.state.now - deathState.deathStartTime;
                
                // Remove health (corpses can't be damaged)
                if (this.game.hasComponent(entityId, this.componentTypes.HEALTH)) {
                    this.game.removeComponent(entityId, this.componentTypes.HEALTH);
                }
                
                // Remove velocity (corpses don't move)
                if (this.game.hasComponent(entityId, this.componentTypes.VELOCITY)) {
                    this.game.removeComponent(entityId, this.componentTypes.VELOCITY);
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
        const Components = this.game.componentManager.getComponents();
        
        // Get current components before conversion
        const position = this.game.getComponent(entityId, this.componentTypes.POSITION);
        const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
        const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
        const renderable = this.game.getComponent(entityId, this.componentTypes.RENDERABLE);
        
        if (!position || !unitType || !team) return;

        // CRITICAL: Notify AnimationSystem FIRST to set corpse state
        if(this.game.gameManager.has('setCorpseAnimation')){
            this.game.gameManager.call('setCorpseAnimation', entityId);
        }

        // Remove death state
        this.game.removeComponent(entityId, this.componentTypes.DEATH_STATE);        
        
        this.game.triggerEvent('onUnitKilled', entityId);
        // Add corpse component
        this.game.addComponent(entityId, this.componentTypes.CORPSE, Components.Corpse(
            { ...unitType }, 
            (this.game.state.now || 0), 
            team.team
        ));
        
    }
    
    // Rest of your existing methods remain the same...
    getCorpsesInRange(position, range, teamFilter = null) {
        const corpses = this.game.getEntitiesWith(this.componentTypes.CORPSE);
        const nearbyCorpses = [];
        
        corpses.forEach(corpseId => {
            const corpsePos = this.game.getComponent(corpseId, this.componentTypes.POSITION);
            const corpse = this.game.getComponent(corpseId, this.componentTypes.CORPSE);
            
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
        const corpse = this.game.getComponent(corpseId, this.componentTypes.CORPSE);
        if (!corpse) return null;
        
        // Return corpse data for the ability to use
        const corpseData = { ...corpse };
        
        // Destroy the corpse entity
        this.game.destroyEntity(corpseId);
        
        return corpseData;
    }
    
    getAllCorpses() {
        return this.game.getEntitiesWith(this.componentTypes.CORPSE);
    }
    
    getCorpsesByTeam(team) {
        const corpses = this.game.getEntitiesWith(this.componentTypes.CORPSE);
        return corpses.filter(corpseId => {
            const corpse = this.game.getComponent(corpseId, this.componentTypes.CORPSE);
            return corpse && corpse.teamAtDeath === team;
        });
    }
}