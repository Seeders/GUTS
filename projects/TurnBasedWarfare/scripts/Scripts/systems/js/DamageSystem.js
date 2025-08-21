class DamageSystem {
    constructor(game) {
        this.game = game;
        this.game.damageSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
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
        
        // Configuration
        this.RESISTANCE_CAP = 0.9; // Maximum resistance (90%)
        this.MIN_DAMAGE = 1; // Minimum damage that can be dealt
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
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(targetId, this.componentTypes.DEATH_STATE);

        if (!targetHealth || (targetDeathState && targetDeathState.isDying)) {
            return { damage: 0, prevented: true, reason: 'target_invalid' };
        }

        // Get target's defenses
        const defenses = this.getEntityDefenses(targetId);

        // Handle poison as special case (DoT)
        if (element === this.ELEMENT_TYPES.POISON) {
            return this.applyPoisonDoT(sourceId, targetId, baseDamage, options);
        }

        // Calculate final damage after resistances/armor
        const damageResult = this.calculateFinalDamage(baseDamage, element, defenses, options);
        
        // Apply immediate damage
        targetHealth.current -= damageResult.finalDamage;

        // Visual feedback
        this.applyVisualFeedback(targetId, damageResult, element);

        // Logging
        this.logDamage(sourceId, targetId, damageResult, element, options);

        // Check for death
        if (targetHealth.current <= 0) {
            this.handleEntityDeath(targetId);
        }

        return {
            damage: damageResult.finalDamage,
            originalDamage: baseDamage,
            mitigated: damageResult.mitigated,
            element: element,
            fatal: targetHealth.current <= 0
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
        const sourceTeam = this.game.getComponent(sourceId, this.componentTypes.TEAM);
        
        if (!sourceTeam) return results;

        // Find all entities within splash radius
        const allEntities = this.game.getEntitiesWith(
            this.componentTypes.POSITION, 
            this.componentTypes.HEALTH,
            this.componentTypes.TEAM
        );

        allEntities.forEach(entityId => {
            if (entityId === sourceId && !options.allowSelfDamage) return; // Don't damage source by default
            
            const entityPos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const entityTeam = this.game.getComponent(entityId, this.componentTypes.TEAM);
            
            if (!entityPos || !entityTeam) return;
            if (entityTeam.team === sourceTeam.team && !options.allowFriendlyFire) return;

            // Calculate 3D distance from explosion center
            const distance = this.calculateDistance3D(centerPos, entityPos);
            
            if (distance <= radius) {
                // Calculate damage based on distance (closer = more damage)
                const damageMultiplier = Math.max(0.2, 1 - (distance / radius));
                const adjustedDamage = Math.floor(baseDamage * damageMultiplier);
                
                // Apply damage
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

        // Log splash summary
        if (results.length > 0 && this.game.battleLogSystem) {
            const totalDamage = results.reduce((sum, r) => sum + r.damage, 0);
            const elementText = element !== this.ELEMENT_TYPES.PHYSICAL ? ` ${element}` : '';
            this.game.battleLogSystem.add(
                `${elementText} explosion affects ${results.length} targets for ${totalDamage} total damage!`, 
                'log-explosion'
            );
        }

        return results;
    }

    // =============================================
    // DAMAGE CALCULATION METHODS
    // =============================================

    /**
     * Calculate final damage after all resistances and modifiers
     */
    calculateFinalDamage(baseDamage, element, defenses, options = {}) {
        let finalDamage = baseDamage;
        let mitigated = 0;

        // Apply critical hit multiplier first
        if (options.isCritical) {
            finalDamage *= options.criticalMultiplier || 2.0;
        }

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

        return {
            finalDamage,
            mitigated,
            originalDamage: baseDamage
        };
    }

    /**
     * Get entity's defensive stats from all sources
     */
    getEntityDefenses(entityId) {
        const defenses = {
            armor: 0,
            fireResistance: 0,
            coldResistance: 0,
            lightningResistance: 0
        };

        // Get base defenses from combat component
        const combatComponent = this.game.getComponent(entityId, this.componentTypes.COMBAT);
        if (combatComponent) {
            defenses.armor = combatComponent.armor || 0;
            defenses.fireResistance = combatComponent.fireResistance || 0;
            defenses.coldResistance = combatComponent.coldResistance || 0;
            defenses.lightningResistance = combatComponent.lightningResistance || 0;
            defenses.poisonResistance = combatComponent.poisonResistance || 0;
        }

        // Add equipment bonuses if equipment system exists
        const equipment = this.game.getComponent(entityId, this.componentTypes.EQUIPMENT);
        if (equipment && this.game.equipmentSystem && this.game.equipmentSystem.calculateTotalStats) {
            const equipmentStats = this.game.equipmentSystem.calculateTotalStats(entityId);
            if (equipmentStats) {
                defenses.armor += equipmentStats.armor || 0;
                defenses.fireResistance += equipmentStats.fireResistance || 0;
                defenses.coldResistance += equipmentStats.coldResistance || 0;
                defenses.lightningResistance += equipmentStats.lightningResistance || 0;
            }
        }

        // Add temporary resistance bonuses from status effects
        const tempResistances = this.getTemporaryResistances(entityId);
        if (tempResistances) {
            defenses.armor += tempResistances.armor || 0;
            defenses.fireResistance += tempResistances.fireResistance || 0;
            defenses.coldResistance += tempResistances.coldResistance || 0;
            defenses.lightningResistance += tempResistances.lightningResistance || 0;
        }

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

        // Create new poison effect
        const now = Date.now() / 1000;
        const poisonEffect = {
            sourceId,
            remainingTicks: ticks,
            damagePerTick: perTickDamage,
            tickInterval: duration / ticks,
            nextTickTime: now + (duration / ticks),
            startTime: now,
            totalDamage: perTickDamage * ticks
        };

        statusEffects.poison.push(poisonEffect);

        // Log poison application
        this.logPoisonApplication(sourceId, targetId, poisonEffect);

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
    processStatusEffects(deltaTime) {
        const now = Date.now() / 1000;
        
        for (const [entityId, statusEffects] of this.activeStatusEffects.entries()) {
            const targetHealth = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            const targetDeathState = this.game.getComponent(entityId, this.componentTypes.DEATH_STATE);
            
            if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
                // Entity is dead or dying, remove all status effects
                this.activeStatusEffects.delete(entityId);
                continue;
            }

            // Process poison effects
            statusEffects.poison = statusEffects.poison.filter(poisonEffect => {
                if (now >= poisonEffect.nextTickTime) {
                    // Apply poison damage
                    targetHealth.current -= poisonEffect.damagePerTick;
                    
                    // Visual feedback for poison
                    this.applyVisualFeedback(entityId, { finalDamage: poisonEffect.damagePerTick }, this.ELEMENT_TYPES.POISON);

                    // Log poison damage
                    this.logPoisonTick(entityId, poisonEffect);

                    // Check for death from poison
                    if (targetHealth.current <= 0) {
                        this.handleEntityDeath(entityId);
                        return false; // Remove this poison effect
                    }

                    // Update for next tick
                    poisonEffect.remainingTicks--;
                    poisonEffect.nextTickTime = now + poisonEffect.tickInterval;

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

        // Log cure
        this.logPoisonCure(targetId, removedStacks.length);
        return true;
    }

    // =============================================
    // DELAYED DAMAGE SYSTEM
    // =============================================

    /**
     * Schedule damage to be applied later (for melee attacks, timed effects, etc.)
     */
    scheduleDamage(sourceId, targetId, damage, element, delay, options = {}) {
        const now = Date.now() / 1000;
        const triggerTime = now + delay;
        const eventId = `${sourceId}_${targetId}_${now}_${Math.random()}`;
        
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
    processPendingDamage(deltaTime) {
        const now = Date.now() / 1000;
        const eventsToRemove = [];
        
        for (const [eventId, event] of this.pendingDamageEvents.entries()) {
            if (now >= event.triggerTime) {
                // Check if target is still valid
                const targetHealth = this.game.getComponent(event.targetId, this.componentTypes.HEALTH);
                const targetDeathState = this.game.getComponent(event.targetId, this.componentTypes.DEATH_STATE);
                
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

    // =============================================
    // UTILITY METHODS
    // =============================================

    /**
     * Calculate 3D distance between two positions
     */
    calculateDistance3D(pos1, pos2) {
        const dx = pos2.x - pos1.x;
        const dy = pos2.y - pos1.y;
        const dz = pos2.z - pos1.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Cap resistance values to prevent going over the maximum
     */
    capResistance(resistance) {
        return Math.min(this.RESISTANCE_CAP, Math.max(-1.0, resistance));
    }

    /**
     * Get temporary resistances from status effects
     */
    getTemporaryResistances(entityId) {
        // This could be extended to support buff/debuff systems
        return null;
    }

    /**
     * Check if an entity has specific resistance above a threshold
     */
    hasResistance(entityId, element, threshold = 0.5) {
        const defenses = this.getEntityDefenses(entityId);
        
        switch (element) {
            case this.ELEMENT_TYPES.FIRE:
                return defenses.fireResistance >= threshold;
            case this.ELEMENT_TYPES.COLD:
                return defenses.coldResistance >= threshold;
            case this.ELEMENT_TYPES.LIGHTNING:
                return defenses.lightningResistance >= threshold;
            case this.ELEMENT_TYPES.POISON:
                return false; // Poison cannot be resisted
            case this.ELEMENT_TYPES.PHYSICAL:
                return defenses.armor >= threshold * 50; // Arbitrary scaling for armor
            default:
                return false;
        }
    }

    /**
     * Get poison stack count for an entity
     */
    getPoisonStacks(entityId) {
        const statusEffects = this.activeStatusEffects.get(entityId);
        return statusEffects ? statusEffects.poison.length : 0;
    }

    // =============================================
    // VISUAL AND AUDIO FEEDBACK
    // =============================================

    /**
     * Apply visual feedback for damage
     */
    applyVisualFeedback(targetId, damageResult, element) {
        const targetAnimation = this.game.getComponent(targetId, this.componentTypes.ANIMATION);
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

    // =============================================
    // LOGGING METHODS
    // =============================================

    logDamage(sourceId, targetId, damageResult, element, options = {}) {
        if (!this.game.battleLogSystem) return;
        
        const sourceUnitType = this.game.getComponent(sourceId, this.componentTypes.UNIT_TYPE);
        const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
        const sourceTeam = this.game.getComponent(sourceId, this.componentTypes.TEAM);
        const targetTeam = this.game.getComponent(targetId, this.componentTypes.TEAM);
        
        if (!sourceUnitType || !targetUnitType || !sourceTeam || !targetTeam) return;
        
        const elementText = element !== this.ELEMENT_TYPES.PHYSICAL ? ` (${element})` : '';
        const splashText = options.isSplash ? ' [splash]' : '';
        const critText = options.isCritical ? ' [CRITICAL]' : '';
        
        this.game.battleLogSystem.add(
            `${sourceTeam.team} ${sourceUnitType.type} deals ${damageResult.finalDamage}${elementText}${critText}${splashText} damage to ${targetTeam.team} ${targetUnitType.type}`, 
            'log-damage'
        );
    }

    logPoisonApplication(sourceId, targetId, poisonEffect) {
        if (!this.game.battleLogSystem) return;
        
        const sourceUnitType = this.game.getComponent(sourceId, this.componentTypes.UNIT_TYPE);
        const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
        const sourceTeam = this.game.getComponent(sourceId, this.componentTypes.TEAM);
        const targetTeam = this.game.getComponent(targetId, this.componentTypes.TEAM);
        
        if (targetUnitType && targetTeam) {
            this.game.battleLogSystem.add(
                `${targetTeam.team} ${targetUnitType.type} is poisoned for ${poisonEffect.damagePerTick}/tick!`, 
                'log-poison'
            );
        }
    }

    logPoisonTick(entityId, poisonEffect) {
        if (!this.game.battleLogSystem) return;
        
        const targetUnitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
        const targetTeam = this.game.getComponent(entityId, this.componentTypes.TEAM);
        
        if (targetUnitType && targetTeam) {
            this.game.battleLogSystem.add(
                `${targetTeam.team} ${targetUnitType.type} takes ${poisonEffect.damagePerTick} poison damage (${poisonEffect.remainingTicks} ticks left)`, 
                'log-poison'
            );
        }
    }

    logPoisonResistance(entityId) {
        // Poison resistance logging removed - poison cannot be resisted
        // This method kept for compatibility but does nothing
    }

    logPoisonCure(entityId, stacksRemoved) {
        if (!this.game.battleLogSystem) return;
        
        const targetUnitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
        const targetTeam = this.game.getComponent(entityId, this.componentTypes.TEAM);
        
        if (targetUnitType && targetTeam) {
            this.game.battleLogSystem.add(
                `${targetTeam.team} ${targetUnitType.type} is cured of ${stacksRemoved} poison stack(s)!`, 
                'log-heal'
            );
        }
    }

    // =============================================
    // SYSTEM MANAGEMENT
    // =============================================

    /**
     * Handle entity death
     */
    handleEntityDeath(entityId) {
        // Clear any status effects when unit dies
        this.activeStatusEffects.delete(entityId);
        
        // Notify other systems about death
        if (this.game.combatAISystems) {
            this.game.combatAISystems.startDeathProcess(entityId);
        }
        if (this.game.phaseSystem) {
            this.game.phaseSystem.checkForRoundEnd();
        }
    }

    /**
     * Update method called each frame
     */
    update(deltaTime) {
        this.processStatusEffects(deltaTime);
        this.processPendingDamage(deltaTime);
    }

    /**
     * Clear all status effects for an entity
     */
    clearAllStatusEffects(entityId) {
        this.activeStatusEffects.delete(entityId);
    }

    /**
     * Get all active status effects for an entity
     */
    getStatusEffects(entityId) {
        return this.activeStatusEffects.get(entityId) || { poison: [] };
    }

    /**
     * Debug method to display all active status effects
     */
    debugStatusEffects() {
        console.log('=== Active Status Effects ===');
        for (const [entityId, effects] of this.activeStatusEffects.entries()) {
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
            console.log(`Entity ${entityId} (${team?.team} ${unitType?.type}):`);
            console.log(`  Poison stacks: ${effects.poison.length}`);
            effects.poison.forEach((poison, index) => {
                console.log(`    Stack ${index}: ${poison.remainingTicks} ticks, ${poison.damagePerTick} dmg/tick`);
            });
        }
    }
}