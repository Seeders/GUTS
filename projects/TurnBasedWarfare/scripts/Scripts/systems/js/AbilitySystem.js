class AbilitySystem {
    constructor(game) {
        this.game = game;
        this.game.abilitySystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Track entity abilities and cooldowns
        this.entityAbilities = new Map();
        this.abilityCooldowns = new Map();
        this.abilityQueue = new Map();
        
    }    
    
    addAbilitiesToUnit(entityId, abilityIds) {
        if (!Array.isArray(abilityIds)) {
            abilityIds = [abilityIds];
        }
        
        const unitAbilities = [];
        
        abilityIds.forEach(abilityId => {
            const AbilityClass = APP.appClasses[abilityId];
            if (AbilityClass) {
                const abilityInstance = new AbilityClass(this.game, this.game.getCollections().abilities[abilityId]);
                unitAbilities.push(abilityInstance);
                console.log(`equiped '${abilityId}' to ${entityId}`);
            } else {
                console.warn(`Ability '${abilityId}' not found`);
            }
        });
        
        if (unitAbilities.length > 0) {
            this.entityAbilities.set(entityId, unitAbilities);
        }
    }

    update(deltaTime) {
        if (this.game.state.phase !== 'battle') return;
        
        this.processAbilityQueue(deltaTime);
        this.updateAIAbilityUsage(deltaTime);
    }
    
    processAbilityQueue(deltaTime) {
        const now = Date.now() / 1000;
        
        for (const [entityId, queuedAbility] of this.abilityQueue.entries()) {
            if (now >= queuedAbility.executeTime) {
                const abilities = this.entityAbilities.get(entityId);
                if (abilities) {
                    const ability = abilities.find(a => a.id === queuedAbility.abilityId);
                    if (ability) {
                        ability.execute(entityId, queuedAbility.targetData);
                    }
                }
                this.abilityQueue.delete(entityId);
            }
        }
    }
    
    updateAIAbilityUsage(deltaTime) {
        const now = Date.now() / 1000;
        
        for (const [entityId, abilities] of this.entityAbilities.entries()) {
            this.considerAbilityUsage(entityId, abilities, now);
        }
    }
    
    considerAbilityUsage(entityId, abilities, now) {
        // Filter and sort abilities by priority
        const availableAbilities = abilities
            .filter(ability => this.isAbilityOffCooldown(entityId, ability.id, now))
            .filter(ability => ability.canExecute(entityId))
            .sort((a, b) => b.priority - a.priority);
        
        // Use the highest priority available ability
        if (availableAbilities.length > 0) {
            this.useAbility(entityId, availableAbilities[0].id);
        }
    }
    
    // =============================================
    // ABILITY EXECUTION
    // =============================================
    
    useAbility(entityId, abilityId, targetData = null) {
        const abilities = this.entityAbilities.get(entityId);
        if (!abilities) return false;
        
        const ability = abilities.find(a => a.id === abilityId);
        if (!ability) return false;
        
        const now = Date.now() / 1000;
        
        // Check cooldown
        if (!this.isAbilityOffCooldown(entityId, abilityId, now)) {
            return false;
        }
        
        // Check if ability can be executed
        if (!ability.canExecute(entityId, targetData)) {
            return false;
        }
        
        // Start ability animation
        if (ability.animation && this.game.animationSystem) {
            this.startAbilityAnimation(entityId, ability.animation);
        }
        
        // Queue the ability for execution
        this.abilityQueue.set(entityId, {
            abilityId: abilityId,
            targetData: targetData,
            executeTime: now + ability.castTime
        });
        
        // Set cooldown
        this.setCooldown(entityId, abilityId, now, ability.cooldown);
        
        // Log ability start
        ability.logAbilityUsage(entityId);
        
        return true;
    }
    
    startAbilityAnimation(entityId, animationName) {
        if (!this.game.animationSystem?.setEntityAnimation) return;
        
        const animationsToTry = [animationName, 'cast', 'attack', 'idle'];
        
        for (const anim of animationsToTry) {
            const animationActions = this.game.animationSystem.entityAnimations.get(entityId);
            if (animationActions?.[anim]) {
                this.game.animationSystem.setEntityAnimation(entityId, anim, 1.0, 1.5);
                break;
            }
        }
    }
    
    // =============================================
    // COOLDOWN MANAGEMENT
    // =============================================
    
    setCooldown(entityId, abilityId, currentTime, cooldownDuration) {
        const key = `${entityId}_${abilityId}`;
        this.abilityCooldowns.set(key, currentTime + cooldownDuration);
    }
    
    isAbilityOffCooldown(entityId, abilityId, currentTime) {
        const key = `${entityId}_${abilityId}`;
        const cooldownEnd = this.abilityCooldowns.get(key);
        return !cooldownEnd || currentTime >= cooldownEnd;
    }
    
    getRemainingCooldown(entityId, abilityId, currentTime) {
        const key = `${entityId}_${abilityId}`;
        const cooldownEnd = this.abilityCooldowns.get(key);
        return !cooldownEnd ? 0 : Math.max(0, cooldownEnd - currentTime);
    }
    
    // =============================================
    // PUBLIC API
    // =============================================
    
    getEntityAbilities(entityId) {
        return this.entityAbilities.get(entityId) || [];
    }
    
    getAbilityCooldowns(entityId) {
        const abilities = this.getEntityAbilities(entityId);
        const now = Date.now() / 1000;
        
        return abilities.map(ability => ({
            id: ability.id,
            name: ability.name,
            remainingCooldown: this.getRemainingCooldown(entityId, ability.id, now),
            totalCooldown: ability.cooldown
        }));
    }
    
    // Create a new ability instance by ID
    createAbility(abilityId) {
        const AbilityClass = APP.appClasses[abilityId];
        return AbilityClass ? new AbilityClass() : null;
    }
    
    // Get all available ability IDs
    getAvailableAbilityIds() {
        return Object.keys(this.game.getCollections().abilities);
    }
    
    // =============================================
    // CLEANUP
    // =============================================
    
    removeEntityAbilities(entityId) {
        this.entityAbilities.delete(entityId);
        this.abilityQueue.delete(entityId);
        
        // Remove cooldowns
        const keysToRemove = [];
        for (const key of this.abilityCooldowns.keys()) {
            if (key.startsWith(`${entityId}_`)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => this.abilityCooldowns.delete(key));
    }
    
    destroy() {
        this.entityAbilities.clear();
        this.abilityCooldowns.clear();
        this.abilityQueue.clear();
    }
}