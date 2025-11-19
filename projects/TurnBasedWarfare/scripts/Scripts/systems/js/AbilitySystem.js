class AbilitySystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.abilitySystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        this.abilityActionCounter = 0;
        this.entityAbilities = new Map();
        this.abilityCooldowns = new Map();
        this.abilityQueue = new Map();
        this.abilityActions = new Map();
    }

    init() {
        this.game.gameManager.register('getEntityAbilities', this.getEntityAbilities.bind(this));
        this.game.gameManager.register('removeEntityAbilities', this.removeEntityAbilities.bind(this));
    }

    addAbilitiesToUnit(entityId, abilityIds) {
        if (!Array.isArray(abilityIds)) {
            abilityIds = [abilityIds];
        }
        const unitAbilities = [];
        
        abilityIds.forEach(abilityId => {
            const AbilityClass = this.game.app.appClasses[abilityId];
            if (AbilityClass) {
                const abilityInstance = new AbilityClass(this.game, this.game.getCollections().abilities[abilityId]);
                unitAbilities.push(abilityInstance);
            } else {
                console.warn(`Ability '${abilityId}' not found`);
            }
        });
        
        if (unitAbilities.length > 0) {
            this.entityAbilities.set(entityId, unitAbilities);
        }
    }

    update() {
        if (this.game.state.phase !== 'battle') return;

        this.processAbilityQueue();
        this.processAbilityActions();
        this.updateAIAbilityUsage();
    }
    processAbilityQueue() {        
        for (const [entityId, queuedAbility] of this.abilityQueue.entries()) {
            if (this.game.state.now >= queuedAbility.executeTime) {
                const abilities = this.entityAbilities.get(entityId);
                if (abilities) {
                    const ability = abilities.find(a => a.id === queuedAbility.abilityId);
                    if (ability) {
                        // Execute ability and get potential callback
                        const abilityAction = ability.execute(entityId, queuedAbility.targetData);
                        
                        // If ability returns a callback, schedule it deterministically
                        if (typeof abilityAction === 'function') {
                            // Add to a delayed effects queue
                            this.scheduleAbilityAction(abilityAction, ability.castTime);
                        }
                    }
                }
                this.abilityQueue.delete(entityId);
            }
        }
    }
    scheduleAbilityAction(action, castTime) {        
        const executeTime = this.game.state.now + castTime;
        const effectId = `${this.game.state.now}_${this.abilityActionCounter++}`;
    
        this.abilityActions.set(effectId, {
            callback: action,
            executeTime: executeTime
        });
    }
    processAbilityActions() {
        if (!this.abilityActions) return;
        
        for (const [effectId, abilityAction] of this.abilityActions.entries()) {
            if (this.game.state.now >= abilityAction.executeTime) {
                abilityAction.callback();
                this.abilityActions.delete(effectId);
            }
        }
    }
    updateAIAbilityUsage() {
        const sortedEntityIds = Array.from(this.entityAbilities.keys()).sort((a, b) => 
            String(a).localeCompare(String(b))
        );
        
        sortedEntityIds.forEach(entityId => {
            const abilities = this.entityAbilities.get(entityId);
            this.considerAbilityUsage(entityId, abilities);
        });
    }
    
    considerAbilityUsage(entityId, abilities) {
        if (this.abilityQueue.has(entityId)) {
            return; // Entity is already casting an ability, wait for it to finish
        }
        
        const availableAbilities = abilities
            .filter(ability => this.isAbilityOffCooldown(entityId, ability.id))
            .filter(ability => ability.canExecute(entityId))
            .sort((a, b) => b.priority - a.priority);
        
        // Check if unit is waiting and now has abilities available
        const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
        if (aiState && aiState.state === 'waiting' && availableAbilities.length > 0) {
            // Transition back to attacking state since we have abilities ready
            if (this.game.combatAISystems) {
                this.game.combatAISystems.changeAIState(aiState, 'attacking');
                
                // Re-enable movement decisions by resetting decision time
                aiState.aiBehavior.lastDecisionTime = 0;
                
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
        

        
        if (!this.isAbilityOffCooldown(entityId, abilityId)) {
            return false;
        }
        
        if (!ability.canExecute(entityId, targetData)) {
            return false;
        }

        // Face the target before casting (unless targeting self)
        this.faceTarget(entityId, ability);

        if (!ability.isPassive) {
            this.startAbilityAnimation(entityId, ability);
        }
        this.abilityQueue.set(entityId, {
            abilityId: abilityId,
            targetData: targetData,
            executeTime: this.game.state.now + ability.castTime
        });

        // Cooldown includes cast time so it doesn't expire until after the ability executes
        this.setCooldown(entityId, abilityId, ability.castTime + ability.cooldown);
        ability.logAbilityUsage(entityId);
        
        return true;
    }
    
    startAbilityAnimation(entityId, ability) {
        const animationsToTry = ['attack', 'idle'];

        for (const anim of animationsToTry) {

            // For abilities, calculate animation speed based on cast time
            let animationSpeed = 1.0;
            let minAnimationTime = 1.5;

            if (ability && ability.castTime > 0) {
                // Convert cast time to rate (casts per second) for calculateAnimationSpeed
                const castRate = 1 / ability.castTime;
                animationSpeed = this.game.gameManager.call('calculateAnimationSpeed', entityId, castRate);
                minAnimationTime = ability.castTime;
            }
            if(this.game.gameManager.has('triggerSinglePlayAnimation')){
                this.game.gameManager.call('triggerSinglePlayAnimation', entityId, anim, animationSpeed, minAnimationTime);
            }
            break;

        }
    }

    faceTarget(entityId, ability) {
        // Get target for facing
        const targetId = ability.getTargetForFacing(entityId);
        if (!targetId || targetId === entityId) return;

        const casterPos = this.game.getComponent(entityId, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        const facing = this.game.getComponent(entityId, this.componentTypes.FACING);

        if (!casterPos || !targetPos || !facing) return;

        // Calculate angle to face target
        const dx = targetPos.x - casterPos.x;
        const dz = targetPos.z - casterPos.z;
        const angleToTarget = Math.atan2(dz, dx);

        facing.angle = angleToTarget;
    }

    setCooldown(entityId, abilityId, cooldownDuration) {
        const key = `${entityId}_${abilityId}`;
        this.abilityCooldowns.set(key, this.game.state.now + cooldownDuration);
    }
    
    isAbilityOffCooldown(entityId, abilityId) {
        const key = `${entityId}_${abilityId}`;
        const cooldownEnd = this.abilityCooldowns.get(key);
        return !cooldownEnd || this.game.state.now >= cooldownEnd;
    }
    
    getRemainingCooldown(entityId, abilityId) {
        const key = `${entityId}_${abilityId}`;
        const cooldownEnd = this.abilityCooldowns.get(key);
        return !cooldownEnd ? 0 : Math.max(0, cooldownEnd - this.game.state.now);
    }
    
    getEntityAbilities(entityId) {
        return this.entityAbilities.get(entityId) || [];
    }
    
    getAbilityCooldowns(entityId) {
        const abilities = this.getEntityAbilities(entityId);

        return abilities.map(ability => ({
            id: ability.id,
            name: ability.name,
            remainingCooldown: this.getRemainingCooldown(entityId, ability.id),
            totalCooldown: ability.cooldown
        }));
    }
    
    createAbility(abilityId) {
        const AbilityClass = this.game.app.appClasses[abilityId];
        return AbilityClass ? new AbilityClass() : null;
    }
    
    getAvailableAbilityIds() {
        return Object.keys(this.game.getCollections().abilities);
    }
        
    removeEntityAbilities(entityId) {
        this.entityAbilities.delete(entityId);
        this.abilityQueue.delete(entityId);
        
        // Clean up cooldowns
        const keysToRemove = [];
        for (const key of this.abilityCooldowns.keys()) {
            if (key.startsWith(`${entityId}_`)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => this.abilityCooldowns.delete(key));
        
    }
    onPlacementPhaseStart() {
        for (const [entityId, abilities] of this.entityAbilities.entries()) {
            abilities.forEach(ability => {
                if (typeof ability.onPlacementPhaseStart === 'function') {
                    ability.onPlacementPhaseStart(entityId);
                }
            });
        }            
    }     
    onBattleEnd() {
        
        // Call onBattleEnd on all ability instances
        for (const [entityId, abilities] of this.entityAbilities.entries()) {
            abilities.forEach(ability => {
                if (typeof ability.onBattleEnd === 'function') {
                    ability.onBattleEnd(entityId);
                }
            });
        }
        
        // Clear all ability queues and cooldowns
        this.abilityQueue.clear();
        this.abilityActions.clear();
        this.abilityCooldowns.clear();
        this.abilityActionCounter = 0;
        
    }

    destroy() {
        this.entityAbilities.clear();
        this.abilityCooldowns.clear();
        this.abilityQueue.clear();
        this.abilityActions.clear();
    }
    entityDestroyed(entityId) {
        this.removeEntityAbilities(entityId);
    }
}