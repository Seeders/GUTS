class DeathSystem {
    constructor(game) {
        this.game = game;
        this.game.deathSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
    }
    
    update(deltaTime) {
        // Get all entities with death state
        const dyingEntities = this.game.getEntitiesWith(this.componentTypes.DEATH_STATE);
        dyingEntities.forEach(entityId => {
            const deathState = this.game.getComponent(entityId, this.componentTypes.DEATH_STATE);
            const now = Date.now() / 1000;
            
            if (deathState.isDying) {
                const timeSinceDeath = now - deathState.deathStartTime;
                // Remove health (corpses can't be damaged)
                if (this.game.hasComponent(entityId, this.componentTypes.HEALTH)) {
                    this.game.removeComponent(entityId, this.componentTypes.HEALTH);
                }
                
                // Remove velocity (corpses don't move)
                if (this.game.hasComponent(entityId, this.componentTypes.VELOCITY)) {
                    this.game.removeComponent(entityId, this.componentTypes.VELOCITY);
                }
                // Check if death animation is complete
                if (timeSinceDeath >= deathState.deathAnimationDuration) {
                    this.convertToCorpse(entityId);
                }
            }
        });
    }
    
    convertToCorpse(entityId) {
        const Components = this.game.componentManager.getComponents();
        
        // Get current components before conversion
        const position = this.game.getComponent(entityId, this.componentTypes.POSITION);
        const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
        const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
        const renderable = this.game.getComponent(entityId, this.componentTypes.RENDERABLE);
        
        if (!position || !unitType || !team) return;
        
        // Remove death state
        this.game.removeComponent(entityId, this.componentTypes.DEATH_STATE);        
        
        // Add corpse component
        this.game.addComponent(entityId, this.componentTypes.CORPSE, Components.Corpse(
            { ...unitType }, 
            Date.now() / 1000, 
            team.team
        ));
        
        // Update renderable to use corpse appearance if available
        if (renderable && this.game.animationSystem && this.game.animationSystem.setCorpseAnimation) {
            this.game.animationSystem.setCorpseAnimation(entityId);
        }
    }
    
    // Utility methods for abilities
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