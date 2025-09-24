class DeathSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.deathSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
    }
    
    update() {
        // Get all entities with death state
        const dyingEntities = this.game.getEntitiesWith(this.componentTypes.DEATH_STATE);
        dyingEntities.forEach(entityId => {
            const deathState = this.game.getComponent(entityId, this.componentTypes.DEATH_STATE);
            
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
                
                // NEW: Check if animation system says death animation is complete
                const animationCompleted = this.isDeathAnimationCompleted(entityId);
                
                // Convert to corpse when EITHER timer expires OR animation completes (whichever comes first)
                const timerExpired = timeSinceDeath >= deathState.deathAnimationDuration;
                
                if (animationCompleted || timerExpired) {
                    console.log(`[DeathSystem] 💀 Converting entity ${entityId} to corpse:`);
                    console.log(`  - Timer expired: ${timerExpired} (${timeSinceDeath.toFixed(2)}s / ${deathState.deathAnimationDuration}s)`);
                    console.log(`  - Animation completed: ${animationCompleted}`);
                    this.convertToCorpse(entityId);
                }
            }
        });
    }
    
    // NEW: Check if death animation is completed via AnimationSystem
    isDeathAnimationCompleted(entityId) {
        if (!this.game.animationSystem) return false;
        
        const animState = this.game.animationSystem.entityAnimationStates?.get(entityId);
        if (!animState) return false;
        
        // Only check if entity is currently dying and playing death animation
        if (!animState.isDying) return false;
        if (animState.currentClip !== 'death' && animState.currentClip !== 'die') return false;
        
        // Check if the animation system considers the death animation finished
        return this.game.animationSystem.isAnimationFinished(entityId, animState.currentClip);
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
        if (this.game.animationSystem && this.game.animationSystem.setCorpseAnimation) {
            this.game.animationSystem.setCorpseAnimation(entityId);
        }
        
        // Remove death state
        this.game.removeComponent(entityId, this.componentTypes.DEATH_STATE);        
        
        // Add corpse component
        this.game.addComponent(entityId, this.componentTypes.CORPSE, Components.Corpse(
            { ...unitType }, 
            (this.game.state.now || 0), 
            team.team
        ));
        
        console.log(`[DeathSystem] ✅ Converted entity ${entityId} to corpse`);
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