class AbilitySystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.abilitySystem = this;
        this.abilityActionCounter = 0;
        // entityAbilities stores class instances with methods - must remain as Map
        this.entityAbilities = new Map();
        // abilityActions stores transient callbacks - must remain as Map
        this.abilityActions = new Map();
    }

    init() {
        // Initialize enums
        this.game.register('getEntityAbilities', this.getEntityAbilities.bind(this));
        this.game.register('removeEntityAbilities', this.removeEntityAbilities.bind(this));
        this.game.register('addAbilitiesToUnit', this.addAbilitiesToUnit.bind(this));
    }

    addAbilitiesToUnit(entityId, abilityIds) {
        if (!Array.isArray(abilityIds)) {
            abilityIds = [abilityIds];
        }
        const unitAbilities = [];
        
        abilityIds.forEach(abilityId => {
            const AbilityClass = GUTS[abilityId];
            if (AbilityClass) {
                const abilityInstance = new AbilityClass(this.game, this.collections.abilities[abilityId]);
                unitAbilities.push(abilityInstance);
            } else {
                console.warn(`Ability '${abilityId}' not found!`);
            }
        });
        
        if (unitAbilities.length > 0) {
            this.entityAbilities.set(entityId, unitAbilities);
        }
    }

    update() {
        if (this.game.state.phase !== this.enums.gamePhase.battle) return;

        this.processAbilityQueue();
        this.processAbilityActions();
        this.updateAIAbilityUsage();
    }
    processAbilityQueue() {
        // Query all entities with abilityQueue component
        const entitiesWithQueue = this.game.getEntitiesWith('abilityQueue');
        const sortedEntityIds = Array.from(entitiesWithQueue).sort((a, b) => a - b);
        const reverseEnums = this.game.getReverseEnums();

        for (const entityId of sortedEntityIds) {
            const queuedAbility = this.game.getComponent(entityId, 'abilityQueue');
            // abilityId is null when no ability queued
            if (!queuedAbility || queuedAbility.abilityId == null) continue;

            if (this.game.state.now >= queuedAbility.executeTime) {
                // Cancel queued ability if caster died
                const deathState = this.game.getComponent(entityId, "deathState");
                if (deathState && deathState.state !== this.enums.deathState.alive) {
                    this.game.removeComponent(entityId, 'abilityQueue');
                    continue;
                }

                const abilities = this.entityAbilities.get(entityId);
                if (abilities) {
                    // queuedAbility.abilityId is numeric index, convert to string name
                    const abilityName = reverseEnums?.abilities?.[queuedAbility.abilityId];
                    const ability = abilities.find(a => a.id === abilityName);
                    if (ability) {
                        // targetData is null when no target
                        const targetData = queuedAbility.targetData;
                        // Execute ability and get potential callback
                        const abilityAction = ability.execute(entityId, targetData);

                        // If ability returns a callback, schedule it deterministically
                        if (typeof abilityAction === 'function') {
                            // Add to a delayed effects queue
                            this.scheduleAbilityAction(abilityAction, ability.castTime);
                        }
                    }
                }
                this.game.removeComponent(entityId, 'abilityQueue');
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
        // OPTIMIZATION: Use numeric sort since entity IDs are numbers (still deterministic, much faster)
        const sortedEntityIds = Array.from(this.entityAbilities.keys()).sort((a, b) => a - b);
        
        sortedEntityIds.forEach(entityId => {
            const abilities = this.entityAbilities.get(entityId);
            this.considerAbilityUsage(entityId, abilities);
        });
    }
    
    considerAbilityUsage(entityId, abilities) {
        const queuedAbility = this.game.getComponent(entityId, 'abilityQueue');
        // abilityId is null when no ability queued
        if (queuedAbility && queuedAbility.abilityId != null) {
            return; // Entity is already casting an ability, wait for it to finish
        }

        // Don't allow dead/dying entities to consider abilities
        const deathState = this.game.getComponent(entityId, "deathState");
        if (deathState && deathState.state !== this.enums.deathState.alive) return;

        const availableAbilities = abilities
            .filter(ability => this.isAbilityOffCooldown(entityId, ability.id))
            .filter(ability => ability.canExecute(entityId))
            .sort((a, b) => b.priority - a.priority);
        
        // With behavior tree system, AI state transitions are handled automatically
        // through priority evaluation - no need to manually change state
        
        if (availableAbilities.length > 0) {
            this.useAbility(entityId, availableAbilities[0].id);
        }
    }
    
    useAbility(entityId, abilityId, targetData = null) {
        // Check if entity already has a queued ability - don't overwrite it
        const existingQueue = this.game.getComponent(entityId, 'abilityQueue');
        if (existingQueue && existingQueue.abilityId != null) {
            return false;
        }

        const abilities = this.entityAbilities.get(entityId);
        if (!abilities) return false;

        const ability = abilities.find(a => a.id === abilityId);
        if (!ability) return false;

        // Don't allow dead/dying entities to use abilities
        const deathState = this.game.getComponent(entityId, "deathState");
        if (deathState && deathState.state !== this.enums.deathState.alive) return false;

        if (!this.isAbilityOffCooldown(entityId, abilityId)) return false;

        if (!ability.canExecute(entityId, targetData)) return false;

        // Face the target before casting (unless targeting self)
        this.faceTarget(entityId, ability);

        if (!ability.isPassive) {
            this.startAbilityAnimation(entityId, ability);
        }
        // Convert ability string ID to numeric index for TypedArray storage
        const abilityIndex = this.enums.abilities[abilityId];
        // targetData is typically a target entity ID or null for no target
        this.game.addComponent(entityId, 'abilityQueue', {
            abilityId: abilityIndex !== undefined ? abilityIndex : null,
            targetData: targetData ?? null,
            executeTime: this.game.state.now + ability.castTime
        });

        // Cooldown includes cast time so it doesn't expire until after the ability executes
        this.setCooldown(entityId, abilityId, ability.castTime + ability.cooldown);
        ability.logAbilityUsage(entityId);
        
        return true;
    }
    
    startAbilityAnimation(entityId, ability) {
        // Use ability's configured animation or default to cast
        const anim = ability.animation !== undefined ? ability.animation : this.enums.animationType.cast;

        // For abilities, calculate animation speed based on cast time
        let animationSpeed = 1.0;
        let minAnimationTime = 1.5;

        if (ability && ability.castTime > 0) {
            // Convert cast time to rate (casts per second)
            const castRate = 1 / ability.castTime;
            animationSpeed = this.game.call('calculateAnimationSpeed', entityId, castRate);
            minAnimationTime = ability.castTime;
        }
        if (this.game.hasService('triggerSinglePlayAnimation')) {
            this.game.call('triggerSinglePlayAnimation', entityId, anim, animationSpeed, minAnimationTime);
        }
    }

    faceTarget(entityId, ability) {
        // Skip rotation for anchored units (buildings)
        const velocity = this.game.getComponent(entityId, "velocity");
        if (velocity?.anchored) return;

        // Get target for facing (targetId is null when no target)
        const targetId = ability.getTargetForFacing(entityId);
        if (targetId == null || targetId === entityId) return;

        const casterTransform = this.game.getComponent(entityId, "transform");
        const targetTransform = this.game.getComponent(targetId, "transform");

        if (!casterTransform?.position || !targetTransform?.position) return;

        const casterPos = casterTransform.position;
        const targetPos = targetTransform.position;

        // Calculate angle to face target
        const dx = targetPos.x - casterPos.x;
        const dz = targetPos.z - casterPos.z;
        const angleToTarget = Math.atan2(dz, dx);

        if (!casterTransform.rotation) {
            casterTransform.rotation = { x: 0, y: 0, z: 0 };
        }
        // Round to 6 decimal places to avoid floating-point precision desync
        casterTransform.rotation.y = Math.round(angleToTarget * 1000000) / 1000000;
    }

    setCooldown(entityId, abilityId, cooldownDuration) {
        let cooldowns = this.game.getComponent(entityId, 'abilityCooldowns');
        if (!cooldowns) {
            this.game.addComponent(entityId, 'abilityCooldowns', {});
            cooldowns = this.game.getComponent(entityId, 'abilityCooldowns');
        }
        // Convert ability string ID to numeric index for TypedArray storage
        const abilityIndex = this.enums.abilities[abilityId];
        if (abilityIndex !== undefined) {
            cooldowns.cooldowns[abilityIndex] = this.game.state.now + cooldownDuration;
        }
        cooldowns.lastAbilityUsed = abilityIndex !== undefined ? abilityIndex : null;
        cooldowns.lastAbilityTime = this.game.state.now;
    }

    isAbilityOffCooldown(entityId, abilityId) {
        const cooldowns = this.game.getComponent(entityId, 'abilityCooldowns');
        if (!cooldowns) return true;
        // Convert ability string ID to numeric index
        const abilityIndex = this.enums.abilities[abilityId];
        if (abilityIndex === undefined) return true;
        const cooldownEnd = cooldowns.cooldowns[abilityIndex];
        return !cooldownEnd || this.game.state.now >= cooldownEnd;
    }

    getRemainingCooldown(entityId, abilityId) {
        const cooldowns = this.game.getComponent(entityId, 'abilityCooldowns');
        if (!cooldowns) return 0;
        // Convert ability string ID to numeric index
        const abilityIndex = this.enums.abilities[abilityId];
        if (abilityIndex === undefined) return 0;
        const cooldownEnd = cooldowns.cooldowns[abilityIndex];
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
        const AbilityClass = GUTS[abilityId];
        return AbilityClass ? new AbilityClass() : null;
    }
    
    getAvailableAbilityIds() {
        return Object.keys(this.collections.abilities);
    }
        
    removeEntityAbilities(entityId) {
        this.entityAbilities.delete(entityId);
        // ECS components are automatically cleaned up when entity is destroyed
        this.game.removeComponent(entityId, 'abilityQueue');
        this.game.removeComponent(entityId, 'abilityCooldowns');
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

        // Clear all ability queues (remove abilityQueue components)
        const entitiesWithQueue = this.game.getEntitiesWith('abilityQueue');
        for (const entityId of entitiesWithQueue) {
            this.game.removeComponent(entityId, 'abilityQueue');
        }

        // Clear all cooldowns (remove abilityCooldowns components)
        const entitiesWithCooldowns = this.game.getEntitiesWith('abilityCooldowns');
        for (const entityId of entitiesWithCooldowns) {
            this.game.removeComponent(entityId, 'abilityCooldowns');
        }

        this.abilityActions.clear();
        this.abilityActionCounter = 0;

    }

    destroy() {
        this.entityAbilities.clear();
        this.abilityActions.clear();
    }
    entityDestroyed(entityId) {
        this.removeEntityAbilities(entityId);
    }
}
