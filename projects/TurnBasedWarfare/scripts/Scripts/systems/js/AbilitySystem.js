class AbilitySystem {
    constructor(game) {
        this.game = game;
        this.game.abilitySystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
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
        const availableAbilities = abilities
            .filter(ability => this.isAbilityOffCooldown(entityId, ability.id, now))
            .filter(ability => ability.canExecute(entityId))
            .sort((a, b) => b.priority - a.priority);
        
        // Check if unit is waiting and now has abilities available
        const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
        if (aiState && aiState.state === 'waiting' && availableAbilities.length > 0) {
            // Transition back to attacking state since we have abilities ready
            if (this.game.combatAISystems) {
                this.game.combatAISystems.changeAIState(aiState, 'attacking', now);
                
                // Re-enable movement decisions by resetting decision time
                if (aiState.aiBehavior) {
                    aiState.aiBehavior.lastDecisionTime = 0;
                }
            }
        }
        
        if (availableAbilities.length > 0) {
            this.useAbility(entityId, availableAbilities[0].id);
        }
    }
    
    useAbility(entityId, abilityId, targetData = null) {
        const abilities = this.entityAbilities.get(entityId);
        if (!abilities) return false;
        
        const ability = abilities.find(a => a.id === abilityId);
        if (!ability) return false;
        
        const now = Date.now() / 1000;
        
        if (!this.isAbilityOffCooldown(entityId, abilityId, now)) {
            return false;
        }
        
        if (!ability.canExecute(entityId, targetData)) {
            return false;
        }
        
        if (ability.animation && this.game.animationSystem) {
            this.startAbilityAnimation(entityId, ability);
        }
        
        this.abilityQueue.set(entityId, {
            abilityId: abilityId,
            targetData: targetData,
            executeTime: now + ability.castTime
        });
        
        this.setCooldown(entityId, abilityId, now, ability.cooldown);
        ability.logAbilityUsage(entityId);
        
        return true;
    }
    
    startAbilityAnimation(entityId, ability) {
        if (!this.game.animationSystem?.triggerSinglePlayAnimation) return;
        
        const animationsToTry = [ability.animationName, 'cast', 'attack', 'idle'];
        
        for (const anim of animationsToTry) {
            const animationActions = this.game.animationSystem.entityAnimations.get(entityId);
            if (animationActions?.[anim]) {
                // For abilities, use normal speed unless it's an attack-based ability
                let animationSpeed = 1.0;
                let minAnimationTime = 1.5;
                
                // If this is an attack-based ability, scale with attack speed
                if (anim === 'attack') {
                    const combat = this.game.getComponent(entityId, this.componentTypes.COMBAT);
                    if (combat && this.game.combatAISystems) {
                        animationSpeed = this.game.combatAISystems.calculateAttackAnimationSpeed(entityId, { ...combat, attackSpeed: ability.castTime });
                        minAnimationTime = 1 / combat.attackSpeed * 0.8;
                    }
                }
                
                this.game.animationSystem.triggerSinglePlayAnimation(entityId, anim, animationSpeed, minAnimationTime);
                break;
            }
        }
    }
    
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
    
    createAbility(abilityId) {
        const AbilityClass = APP.appClasses[abilityId];
        return AbilityClass ? new AbilityClass() : null;
    }
    
    getAvailableAbilityIds() {
        return Object.keys(this.game.getCollections().abilities);
    }
    
    removeEntityAbilities(entityId) {
        this.entityAbilities.delete(entityId);
        this.abilityQueue.delete(entityId);
        
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