class DamageSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.damageSystem = this;
        
        // Element types
        this.ELEMENT_TYPES = {
            PHYSICAL: 'physical',
            FIRE: 'fire',
            COLD: 'cold',
            LIGHTNING: 'lightning',
            POISON: 'poison',
            DIVINE: 'divine'
        };

        // Poison DoT configuration
        this.POISON_CONFIG = {
            DEFAULT_DURATION: 5.0,  // seconds
            DEFAULT_TICKS: 5,       // number of damage instances
            STACK_LIMIT: 50,         // maximum poison stacks
            STACK_REFRESH: true     // new poison refreshes duration
        };

        // Status effect tracking
        this.activeStatusEffects = new Map(); // entityId -> { poison: [...], other effects }
        
        // Damage event queue for delayed damage (melee attacks, etc.)
        this.pendingDamageEvents = new Map();

        // Deterministic counter for event IDs (prevents desync)
        this.damageEventCounter = 0;

        // Configuration
        this.RESISTANCE_CAP = 0.9; // Maximum resistance (90%)
        this.MIN_DAMAGE = 1; // Minimum damage that can be dealt
    }

    init() {
        // Register methods with GameManager
        this.game.gameManager.register('applyDamage', this.applyDamage.bind(this));
        this.game.gameManager.register('applySplashDamage', this.applySplashDamage.bind(this));
        this.game.gameManager.register('getDamageElementTypes', () => this.ELEMENT_TYPES);
        this.game.gameManager.register('scheduleDamage', this.scheduleDamage.bind(this));
        this.game.gameManager.register('curePoison', this.curePoison.bind(this));
        this.game.gameManager.register('getPoisonStacks', this.getPoisonStacks.bind(this));
        this.game.gameManager.register('clearAllDamageEffects', this.clearAllDamageEffects.bind(this));
        this.game.gameManager.register('clearAllStatusEffects', this.clearAllStatusEffects.bind(this));
        this.game.gameManager.register('getAttackerModifiers', this.getAttackerModifiers.bind(this));
    }

    // =============================================
    // CORE DAMAGE APPLICATION METHODS
    // =============================================

    /**
     * Main damage application method - handles all damage types and resistances
     * @param {number} sourceId - Entity dealing damage
     * @param {number} targetId - Entity receiving damage  
     * @param {number} baseDamage - Base damage amount
     * @param {string} element - Damage element type
     * @param {Object} options - Additional options (splash, crit, etc.)
     */
    applyDamage(sourceId, targetId, baseDamage, element = this.ELEMENT_TYPES.PHYSICAL, options = {}) {
        const targetHealth = this.game.getComponent(targetId, "health");
        const targetDeathState = this.game.getComponent(targetId, "deathState");
        const targetUnitType = this.game.getComponent(targetId, "unitType");
        const targetTransform = this.game.getComponent(targetId, "transform");
        const targetPos = targetTransform?.position;

        if (!targetHealth || (targetDeathState && targetDeathState.isDying)) {
            return { damage: 0, prevented: true, reason: 'target_invalid' };
        }
        
        const defenderMods = this.getDefenderModifiers(targetId);
        // Get target's defenses
        const defenses = this.getEntityDefenses(targetId, defenderMods);
        const attackerMods = this.getAttackerModifiers(sourceId);
        let buffedDamage = baseDamage * attackerMods.damageMultiplier;

        

        if (options.isCritical) {
            buffedDamage *= options.criticalMultiplier || 2.0;
        }
        // Handle poison as special case (DoT)
        if (element === this.ELEMENT_TYPES.POISON) {
            return this.applyPoisonDoT(sourceId, targetId, buffedDamage, options);
        }
        // Calculate final damage after resistances/armor
        const damageResult = this.calculateFinalDamage(sourceId, targetId, buffedDamage, element, defenses, defenderMods, options);

        // Apply immediate damage
        targetHealth.current -= damageResult.finalDamage;

        // Visual feedback
        this.applyVisualFeedback(targetId, damageResult, element);

        // Check for death
        if (targetHealth.current <= 0) {
            this.handleEntityDeath(targetId);
        }

        // Track attacker for retaliation in behavior tree
        if (sourceId && damageResult.finalDamage > 0) {
            const combatState = this.game.getComponent(targetId, "combatState");
            if (combatState) {
                combatState.lastAttacker = sourceId;
                combatState.lastAttackTime = this.game.state.now;
            }
        }
        
        this.game.gameManager.call('showDamageNumber', targetPos.x, targetPos.y + targetUnitType.height, targetPos.z, damageResult.finalDamage, element);
        
        return {
            damage: damageResult.finalDamage,
            originalDamage: baseDamage,
            buffedDamage: buffedDamage,
            mitigated: damageResult.mitigated,
            element: element,
            fatal: targetHealth.current <= 0
        };
    }
    getAttackerModifiers(attackerId) {
        const buff = this.game.getComponent(attackerId, "buff");
        if (!buff || !buff.isActive) return { 
            damageMultiplier: 1.0,
            attackSpeedMultiplier: 1.0 
        };
        
        const currentTime = this.game.state.now || 0;
        if (buff.endTime && currentTime > buff.endTime) return { 
            damageMultiplier: 1.0,
            attackSpeedMultiplier: 1.0 
        };
        
        return {
            damageMultiplier: buff.modifiers?.damageMultiplier || 1.0,
            attackSpeedMultiplier: buff.modifiers?.attackSpeedMultiplier || 1.0
        };
    }
    getDefenderModifiers(defenderId) {
        const buff = this.game.getComponent(defenderId, "buff");
        if (!buff || !buff.isActive) return { 
            armorMultiplier: 1.0, 
            damageTakenMultiplier: 1.0, 
            damageReduction: 0 
        };
        
        const currentTime = this.game.state.now || 0;
        if (buff.endTime && currentTime > buff.endTime) return { 
            armorMultiplier: 1.0, 
            damageTakenMultiplier: 1.0, 
            damageReduction: 0 
        };
        
        return {
            armorMultiplier: buff.modifiers?.armorMultiplier || buff.armorMultiplier || 1.0,
            damageTakenMultiplier: buff.modifiers?.damageTakenMultiplier || buff.damageTakenMultiplier || 1.0,
            damageReduction: buff.modifiers?.damageReduction || buff.damageReduction || 0,
            additionalLightningResistance: buff.modifiers?.additionalLightningResistance || buff.additionalLightningResistance || 0,
            additionalFireResistance: buff.modifiers?.additionalFireResistance || buff.additionalFireResistance || 0,
            additionalColdResistance: buff.modifiers?.additionalColdResistance || buff.additionalColdResistance || 0,
            additionalElementalResistance: buff.modifiers?.additionalElementalResistance || buff.additionalElementalResistance || 0
        };
    }
    /**
     * Apply splash/area damage around a point
     * @param {number} sourceId - Source of the damage
     * @param {Object} centerPos - Center position {x, y, z}
     * @param {number} baseDamage - Base damage amount
     * @param {string} element - Damage element
     * @param {number} radius - Splash radius
     * @param {Object} options - Additional options
     */
    applySplashDamage(sourceId, centerPos, baseDamage, element, radius, options = {}) {
        const results = [];
        const sourceTeam = this.game.getComponent(sourceId, "team");
        
        if (!sourceTeam) return results;

        // Find all entities within splash radius
        const allEntities = this.game.getEntitiesWith(
            "transform",
            "health",
            "team"
        );
        // Sort for deterministic processing order (prevents desync)
        allEntities.sort((a, b) => String(a).localeCompare(String(b)));
        allEntities.forEach(entityId => {
            if (entityId === sourceId && !options.allowSelfDamage) return; // Don't damage source by default

            const entityTransform = this.game.getComponent(entityId, "transform");
            const entityPos = entityTransform?.position;
            const entityTeam = this.game.getComponent(entityId, "team");
            
            if (!entityPos || !entityTeam) return;
            if (entityTeam.team === sourceTeam.team && !options.allowFriendlyFire) return;

            // Calculate 3D distance from explosion center
            const distance = this.calculateDistance3D(centerPos, entityPos);
            
            if (distance <= radius) {
                // Calculate damage based on distance (closer = more damage)
                const damageMultiplier = Math.max(0.2, 1 - (distance / radius));
                const adjustedDamage = Math.floor(baseDamage * damageMultiplier);
           
                // Apply damage (experience will be awarded inside applyDamage)
                const result = this.applyDamage(sourceId, entityId, adjustedDamage, element, {
                    ...options,
                    isSplash: true,
                    splashDistance: distance,
                    splashMultiplier: damageMultiplier
                });
                

                if (result.damage > 0) {
                    results.push({
                        entityId,
                        ...result,
                        distance
                    });
                }
            }
        });

        return results;
    }

    // =============================================
    // DAMAGE CALCULATION METHODS
    // =============================================

    /**
     * Calculate final damage after all resistances and modifiers
     */
    calculateFinalDamage(sourceId, targetId, baseDamage, element, defenses, defenderMods, options = {}) {
        let finalDamage = baseDamage;
        let mitigated = 0;

        // Apply element-specific damage reduction
        switch (element) {
            case this.ELEMENT_TYPES.PHYSICAL:
                const armor = defenses.armor || 0;
                mitigated = Math.min(armor, finalDamage - this.MIN_DAMAGE);
                finalDamage = Math.max(this.MIN_DAMAGE, finalDamage - armor);
                break;

            case this.ELEMENT_TYPES.FIRE:
                const fireResist = this.capResistance(defenses.fireResistance || 0);
                mitigated = Math.floor(finalDamage * fireResist);
                finalDamage = Math.max(this.MIN_DAMAGE, Math.floor(finalDamage * (1 - fireResist)));
                break;

            case this.ELEMENT_TYPES.COLD:
                const coldResist = this.capResistance(defenses.coldResistance || 0);
                mitigated = Math.floor(finalDamage * coldResist);
                finalDamage = Math.max(this.MIN_DAMAGE, Math.floor(finalDamage * (1 - coldResist)));
                break;

            case this.ELEMENT_TYPES.LIGHTNING:
                const lightningResist = this.capResistance(defenses.lightningResistance || 0);
                mitigated = Math.floor(finalDamage * lightningResist);
                finalDamage = Math.max(this.MIN_DAMAGE, Math.floor(finalDamage * (1 - lightningResist)));
                break;

            case this.ELEMENT_TYPES.DIVINE:
                // Divine damage cannot be reduced
                mitigated = 0;
                finalDamage = Math.max(this.MIN_DAMAGE, Math.floor(finalDamage));
                break;

            default:
                console.warn(`Unknown damage element: ${element}, treating as physical`);
                const defaultArmor = defenses.armor || 0;
                mitigated = Math.min(defaultArmor, finalDamage - this.MIN_DAMAGE);
                finalDamage = Math.max(this.MIN_DAMAGE, finalDamage - defaultArmor);
                break;
        }
        // Apply damage taken multiplier (from marks, etc.)
        finalDamage *= defenderMods.damageTakenMultiplier;
        
        // Apply flat damage reduction (from intimidation, shield wall, etc.)
        if (defenderMods.damageReduction > 0) {
            const reductionAmount = Math.floor(finalDamage * defenderMods.damageReduction);
            finalDamage -= reductionAmount;
            mitigated += reductionAmount;
        }
        return {
            finalDamage,
            mitigated,
            originalDamage: baseDamage
        };
    }

    /**
     * Get entity's defensive stats from all sources
     */
    getEntityDefenses(entityId, defenderMods) {
        const defenses = {
            armor: 0,
            fireResistance: 0,
            coldResistance: 0,
            lightningResistance: 0
        };

        // Get base defenses from combat component
        const combatComponent = this.game.getComponent(entityId, "combat");
        if (combatComponent) {
            defenses.armor = combatComponent.armor || 0;
            defenses.fireResistance = combatComponent.fireResistance || 0;
            defenses.coldResistance = combatComponent.coldResistance || 0;
            defenses.lightningResistance = combatComponent.lightningResistance || 0;
        }

        // Add temporary resistance bonuses from status effects
        defenses.armor *= defenderMods.armorMultiplier; // Apply armor multiplier from buffs
        defenses.fireResistance = defenses.fireResistance + defenderMods.additionalFireResistance + defenderMods.additionalElementalResistance;
        defenses.coldResistance = defenses.coldResistance + defenderMods.additionalColdResistance + defenderMods.additionalElementalResistance;
        defenses.lightningResistance = defenses.lightningResistance + defenderMods.additionalLightningResistance + defenderMods.additionalElementalResistance;

        return defenses;
    }

    // =============================================
    // POISON SYSTEM METHODS
    // =============================================

    /**
     * Apply poison damage over time - poison cannot be resisted, only cured
     */
    applyPoisonDoT(sourceId, targetId, totalDamage, options = {}) {
        const duration = options.duration || this.POISON_CONFIG.DEFAULT_DURATION;
        const ticks = options.ticks || this.POISON_CONFIG.DEFAULT_TICKS;
        
        // Poison cannot be resisted - it always applies at full strength
        const perTickDamage = Math.max(1, Math.ceil(totalDamage / ticks));

        // Initialize status effects for target if needed
        if (!this.activeStatusEffects.has(targetId)) {
            this.activeStatusEffects.set(targetId, { poison: [] });
        }

        const statusEffects = this.activeStatusEffects.get(targetId);
        
        // Check current poison stacks
        if (statusEffects.poison.length >= this.POISON_CONFIG.STACK_LIMIT) {
            if (this.POISON_CONFIG.STACK_REFRESH) {
                // Remove oldest poison stack and add new one
                statusEffects.poison.shift();
            } else {
                // Cannot add more poison
                return { damage: 0, prevented: true, reason: 'stack_limit' };
            }
        }
        const poisonEffect = {
            sourceId,
            remainingTicks: ticks,
            damagePerTick: perTickDamage,
            tickInterval: duration / ticks,
            nextTickTime: this.game.state.now + (duration / ticks),
            startTime: this.game.state.now,
            totalDamage: perTickDamage * ticks
        };

        statusEffects.poison.push(poisonEffect);

      
        return {
            damage: poisonEffect.totalDamage,
            isPoison: true,
            stacks: statusEffects.poison.length,
            tickDamage: perTickDamage,
            duration: duration
        };
    }

    /**
     * Process ongoing poison damage
     */
    processStatusEffects() {
        // Sort entity IDs for deterministic processing order (prevents desync)
        const sortedEntityIds = Array.from(this.activeStatusEffects.keys()).sort((a, b) => String(a).localeCompare(String(b)));

        for (const entityId of sortedEntityIds) {
            const statusEffects = this.activeStatusEffects.get(entityId);
            const targetHealth = this.game.getComponent(entityId, "health");
            const targetDeathState = this.game.getComponent(entityId, "deathState");
            
            if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
                // Entity is dead or dying, remove all status effects
                this.activeStatusEffects.delete(entityId);
                continue;
            }
            // Process poison effects
            statusEffects.poison = statusEffects.poison.filter(poisonEffect => {
                if (this.game.state.now >= poisonEffect.nextTickTime) {
                    // Apply poison damage
                    targetHealth.current -= poisonEffect.damagePerTick;
                    
                    // Visual feedback for poison
                    this.applyVisualFeedback(entityId, { finalDamage: poisonEffect.damagePerTick }, this.ELEMENT_TYPES.POISON);

                    // Check for death from poison
                    if (targetHealth.current <= 0) {
                        this.handleEntityDeath(entityId);
                        return false; // Remove this poison effect
                    }

                    // Update for next tick
                    poisonEffect.remainingTicks--;
                    poisonEffect.nextTickTime = this.game.state.now + poisonEffect.tickInterval;

                    // Keep poison if ticks remain
                    return poisonEffect.remainingTicks > 0;
                }
                return true; // Keep poison effect
            });

            // Remove entity from status effects if no effects remain
            if (statusEffects.poison.length === 0) {
                this.activeStatusEffects.delete(entityId);
            }
        }
    }

    /**
     * Cure poison effects
     */
    curePoison(targetId, stacksToRemove = null) {
        const statusEffects = this.activeStatusEffects.get(targetId);
        if (!statusEffects || statusEffects.poison.length === 0) return false;

        const removeCount = stacksToRemove || statusEffects.poison.length;
        const removedStacks = statusEffects.poison.splice(0, removeCount);

        if (statusEffects.poison.length === 0) {
            this.activeStatusEffects.delete(targetId);
        }

        return true;
    }

    // =============================================
    // DELAYED DAMAGE SYSTEM
    // =============================================

    /**
     * Schedule damage to be applied later (for melee attacks, timed effects, etc.)
     */
    scheduleDamage(sourceId, targetId, damage, element, delay, options = {}) {
        const triggerTime = this.game.state.now + delay;
        const eventId = `${sourceId}_${targetId}_${Math.round(this.game.state.now * 1000)}_${this.damageEventCounter++}`;
        
        this.pendingDamageEvents.set(eventId, {
            sourceId,
            targetId,
            damage,
            element: element || this.ELEMENT_TYPES.PHYSICAL,
            triggerTime,
            options,
            eventId
        });
        
        return eventId;
    }

    /**
     * Process pending damage events
     */
    processPendingDamage() {
        const eventsToRemove = [];

        // Sort event IDs for deterministic processing order (prevents desync)
        const sortedEventIds = Array.from(this.pendingDamageEvents.keys()).sort((a, b) => a.localeCompare(b));

        for (const eventId of sortedEventIds) {
            const event = this.pendingDamageEvents.get(eventId);

            if (this.game.state.now >= event.triggerTime) {
                // Check if target is still valid
                const targetHealth = this.game.getComponent(event.targetId, "health");
                const targetDeathState = this.game.getComponent(event.targetId, "deathState");
                
                if (targetHealth && targetHealth.current > 0 && (!targetDeathState || !targetDeathState.isDying)) {
                    // Apply the delayed damage
                     this.applyDamage(event.sourceId, event.targetId, event.damage, event.element, {
                        ...event.options,
                        isDelayed: true
                    });
                }
                
                eventsToRemove.push(eventId);
            }
        }
        
        eventsToRemove.forEach(id => this.pendingDamageEvents.delete(id));
    }


    calculateDistance3D(pos1, pos2) {
        const dx = pos2.x - pos1.x;
        const dy = pos2.y - pos1.y;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    capResistance(resistance) {
        return Math.min(this.RESISTANCE_CAP, Math.max(-1.0, resistance));
    }

    getPoisonStacks(entityId) {
        const statusEffects = this.activeStatusEffects.get(entityId);
        return statusEffects ? statusEffects.poison.length : 0;
    }


    applyVisualFeedback(targetId, damageResult, element) {
        const targetAnimation = this.game.getComponent(targetId, "animation");
        if (targetAnimation) {
            // Different flash intensities based on element
            switch (element) {
                case this.ELEMENT_TYPES.FIRE:
                    targetAnimation.flash = 0.6;
                    break;
                case this.ELEMENT_TYPES.COLD:
                    targetAnimation.flash = 0.5;
                    break;
                case this.ELEMENT_TYPES.LIGHTNING:
                    targetAnimation.flash = 0.8;
                    break;
                case this.ELEMENT_TYPES.POISON:
                    targetAnimation.flash = 0.3; // Subtle for DoT
                    break;
                case this.ELEMENT_TYPES.DIVINE:
                    targetAnimation.flash = 0.7;
                    break;
                default:
                    targetAnimation.flash = 0.5;
                    break;
            }
        }
    }


    handleEntityDeath(entityId) {
        // Notify other systems about death
        this.game.gameManager.call('startDeathProcess', entityId);
    }

    entityDestroyed(entityId) {
        // Clear pending damage events for this entity
        const eventsToRemove = [];
        for (const [eventId, event] of this.pendingDamageEvents.entries()) {
            if (event.sourceId === entityId || event.targetId === entityId) {
                eventsToRemove.push(eventId);
            }
        }
        eventsToRemove.forEach(id => this.pendingDamageEvents.delete(id));
        
        // Clear status effects
        this.activeStatusEffects.delete(entityId);
    }

    update() {
        this.processStatusEffects();
        this.processPendingDamage();
    }

    clearAllStatusEffects(entityId) {
        this.activeStatusEffects.delete(entityId);
    }

    clearAllDamageEffects() {        
        this.activeStatusEffects.clear();  
        this.pendingDamageEvents.clear();
    }

    getStatusEffects(entityId) {
        return this.activeStatusEffects.get(entityId) || { poison: [] };
    }

}