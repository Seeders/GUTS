class DamageSystem extends GUTS.BaseSystem {
    static services = [
        'applyDamage',
        'applySplashDamage',
        'scheduleDamage',
        'curePoison',
        'getPoisonStacks',
        'clearAllDamageEffects',
        'clearAllStatusEffects',
        'getAttackerModifiers',
        'getBuffTypeDef'
    ];

    constructor(game) {
        super(game);
        this.game.damageSystem = this;

        // Poison DoT configuration
        this.POISON_CONFIG = {
            DEFAULT_DURATION: 5.0,  // seconds
            DEFAULT_TICKS: 5,       // number of damage instances
            STACK_LIMIT: 50,         // maximum poison stacks
            STACK_REFRESH: true     // new poison refreshes duration
        };

        // Damage event queue for delayed damage (melee attacks, etc.)
        this.pendingDamageEvents = new Map();

        // Deterministic counter for event IDs (prevents desync)
        this.damageEventCounter = 0;

        // Configuration
        this.RESISTANCE_CAP = 0.9; // Maximum resistance (90%)
        this.MIN_DAMAGE = 1; // Minimum damage that can be dealt
    }

    init() {
        // Cache buffTypes collection for modifier lookups
        this.buffTypes = this.collections.buffTypes;
        this.buffTypeKeys = Object.keys(this.buffTypes).sort();
    }

    /**
     * Get buff type definition by numeric index
     */
    getBuffTypeDef(buffTypeIndex) {
        if (buffTypeIndex < 0 || buffTypeIndex >= this.buffTypeKeys.length) return null;
        const buffTypeKey = this.buffTypeKeys[buffTypeIndex];
        return this.buffTypes[buffTypeKey];
    }

    // =============================================
    // CORE DAMAGE APPLICATION METHODS
    // =============================================

    /**
     * Main damage application method - handles all damage types and resistances
     * @param {number} sourceId - Entity dealing damage
     * @param {number} targetId - Entity receiving damage
     * @param {number} baseDamage - Base damage amount
     * @param {number} element - Damage element type (numeric enum value)
     * @param {Object} options - Additional options (splash, crit, etc.)
     */
    applyDamage(sourceId, targetId, baseDamage, element = this.enums.element.physical, options = {}) {
        const targetHealth = this.game.getComponent(targetId, "health");
        const targetDeathState = this.game.getComponent(targetId, "deathState");
        const targetUnitTypeComp = this.game.getComponent(targetId, "unitType");
        const targetUnitType = this.game.call('getUnitTypeDef', targetUnitTypeComp);
        const targetTransform = this.game.getComponent(targetId, "transform");
        const targetPos = targetTransform?.position;

        if (!targetHealth || (targetDeathState && targetDeathState.state !== this.enums.deathState.alive)) {
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
        if (element === this.enums.element.poison) {
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

        if (targetPos && targetUnitType) {
            this.game.call('showDamageNumber', targetPos.x, targetPos.y + targetUnitType.height, targetPos.z, damageResult.finalDamage, element);
        }

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
        const defaultMods = {
            damageMultiplier: 1.0,
            attackSpeedMultiplier: 1.0
        };

        if (!buff) return defaultMods;

        const currentTime = this.game.state.now || 0;
        if (buff.endTime && currentTime > buff.endTime) return defaultMods;

        // Look up buff type definition from collection
        const buffTypeDef = this.getBuffTypeDef(buff.buffType);
        if (!buffTypeDef) return defaultMods;

        // Apply stack multiplier for stackable buffs (e.g., marked damage increase)
        let damageMultiplier = buffTypeDef.damageMultiplier || 1.0;
        if (buffTypeDef.stackable && buffTypeDef.damagePerStack && buff.stacks > 1) {
            damageMultiplier = 1 + (buffTypeDef.damagePerStack * buff.stacks);
        }

        return {
            damageMultiplier: damageMultiplier,
            attackSpeedMultiplier: buffTypeDef.attackSpeedMultiplier || 1.0
        };
    }

    getDefenderModifiers(defenderId) {
        const buff = this.game.getComponent(defenderId, "buff");
        const defaultMods = {
            armorMultiplier: 1.0,
            damageTakenMultiplier: 1.0,
            damageReduction: 0,
            additionalLightningResistance: 0,
            additionalFireResistance: 0,
            additionalColdResistance: 0,
            additionalElementalResistance: 0
        };

        if (!buff) return defaultMods;

        const currentTime = this.game.state.now || 0;
        if (buff.endTime && currentTime > buff.endTime) return defaultMods;

        // Look up buff type definition from collection
        const buffTypeDef = this.getBuffTypeDef(buff.buffType);
        if (!buffTypeDef) return defaultMods;

        // Apply stack multiplier for stackable buffs (e.g., marked damage taken increase)
        let damageTakenMultiplier = buffTypeDef.damageTakenMultiplier || 1.0;
        if (buffTypeDef.stackable && buffTypeDef.damagePerStack && buff.stacks > 1) {
            damageTakenMultiplier = 1 + (buffTypeDef.damagePerStack * buff.stacks);
        }

        return {
            armorMultiplier: buffTypeDef.armorMultiplier || 1.0,
            damageTakenMultiplier: damageTakenMultiplier,
            damageReduction: buffTypeDef.damageReduction || 0,
            additionalLightningResistance: buffTypeDef.additionalLightningResistance || 0,
            additionalFireResistance: buffTypeDef.additionalFireResistance || 0,
            additionalColdResistance: buffTypeDef.additionalColdResistance || 0,
            additionalElementalResistance: buffTypeDef.additionalElementalResistance || 0
        };
    }
    /**
     * Apply splash/area damage around a point
     * @param {number} sourceId - Source of the damage
     * @param {Object} centerPos - Center position {x, y, z}
     * @param {number} baseDamage - Base damage amount
     * @param {number} element - Damage element (numeric)
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
        // OPTIMIZATION: Use numeric sort since entity IDs are numbers (much faster than localeCompare)
        allEntities.sort((a, b) => a - b);
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

        // Apply element-specific damage reduction using numeric comparisons
        if (element === this.enums.element.physical) {
            const armor = defenses.armor || 0;
            mitigated = Math.min(armor, finalDamage - this.MIN_DAMAGE);
            finalDamage = Math.max(this.MIN_DAMAGE, finalDamage - armor);
        } else if (element === this.enums.element.fire) {
            const fireResist = this.capResistance(defenses.fireResistance || 0);
            mitigated = Math.floor(finalDamage * fireResist);
            finalDamage = Math.max(this.MIN_DAMAGE, Math.floor(finalDamage * (1 - fireResist)));
        } else if (element === this.enums.element.cold) {
            const coldResist = this.capResistance(defenses.coldResistance || 0);
            mitigated = Math.floor(finalDamage * coldResist);
            finalDamage = Math.max(this.MIN_DAMAGE, Math.floor(finalDamage * (1 - coldResist)));
        } else if (element === this.enums.element.lightning) {
            const lightningResist = this.capResistance(defenses.lightningResistance || 0);
            mitigated = Math.floor(finalDamage * lightningResist);
            finalDamage = Math.max(this.MIN_DAMAGE, Math.floor(finalDamage * (1 - lightningResist)));
        } else if (element === this.enums.element.holy || element === this.enums.element.shadow) {
            // Holy and Shadow damage cannot be reduced
            mitigated = 0;
            finalDamage = Math.max(this.MIN_DAMAGE, Math.floor(finalDamage));
        } else {
            // Unknown element - treat as physical
            console.warn(`Unknown damage element: ${element}, treating as physical`);
            const defaultArmor = defenses.armor || 0;
            mitigated = Math.min(defaultArmor, finalDamage - this.MIN_DAMAGE);
            finalDamage = Math.max(this.MIN_DAMAGE, finalDamage - defaultArmor);
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

        // Get or create statusEffect component for target
        let statusEffect = this.game.getComponent(targetId, 'statusEffect');
        if (!statusEffect) {
            this.game.addComponent(targetId, 'statusEffect', { poison: [] });
            statusEffect = this.game.getComponent(targetId, 'statusEffect');
        }
        if (!statusEffect.poison) {
            statusEffect.poison = [];
        }

        // Check current poison stacks
        if (statusEffect.poison.length >= this.POISON_CONFIG.STACK_LIMIT) {
            if (this.POISON_CONFIG.STACK_REFRESH) {
                // Remove oldest poison stack and add new one
                statusEffect.poison.shift();
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

        statusEffect.poison.push(poisonEffect);


        return {
            damage: poisonEffect.totalDamage,
            isPoison: true,
            stacks: statusEffect.poison.length,
            tickDamage: perTickDamage,
            duration: duration
        };
    }

    /**
     * Process ongoing poison damage
     */
    processStatusEffects() {
        // Query all entities with statusEffect component
        const entitiesWithEffects = this.game.getEntitiesWith('statusEffect');
        // Sort for deterministic processing order
        const sortedEntityIds = Array.from(entitiesWithEffects).sort((a, b) => a - b);

        for (const entityId of sortedEntityIds) {
            const statusEffect = this.game.getComponent(entityId, 'statusEffect');
            if (!statusEffect || !statusEffect.poison || statusEffect.poison.length === 0) {
                continue;
            }

            const targetHealth = this.game.getComponent(entityId, "health");
            const targetDeathState = this.game.getComponent(entityId, "deathState");

            if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.state !== this.enums.deathState.alive)) {
                // Entity is dead or dying, remove status effect component
                this.game.removeComponent(entityId, 'statusEffect');
                continue;
            }
            // Process poison effects
            statusEffect.poison = statusEffect.poison.filter(poisonEffect => {
                if (this.game.state.now >= poisonEffect.nextTickTime) {
                    // Apply poison damage
                    targetHealth.current -= poisonEffect.damagePerTick;

                    // Visual feedback for poison
                    this.applyVisualFeedback(entityId, { finalDamage: poisonEffect.damagePerTick }, this.enums.element.poison);

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

            // Remove statusEffect component if no effects remain
            if (statusEffect.poison.length === 0) {
                this.game.removeComponent(entityId, 'statusEffect');
            }
        }
    }

    /**
     * Cure poison effects
     */
    curePoison(targetId, stacksToRemove = null) {
        const statusEffect = this.game.getComponent(targetId, 'statusEffect');
        if (!statusEffect || !statusEffect.poison || statusEffect.poison.length === 0) return false;

        const removeCount = stacksToRemove || statusEffect.poison.length;
        statusEffect.poison.splice(0, removeCount);

        if (statusEffect.poison.length === 0) {
            this.game.removeComponent(targetId, 'statusEffect');
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
            element: element ?? this.enums.element.physical,
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

                if (targetHealth && targetHealth.current > 0 && (!targetDeathState || targetDeathState.state === this.enums.deathState.alive)) {
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
        const statusEffect = this.game.getComponent(entityId, 'statusEffect');
        return statusEffect?.poison?.length || 0;
    }


    applyVisualFeedback(targetId, damageResult, element) {
        const targetAnimation = this.game.getComponent(targetId, "animation");
        if (targetAnimation) {
            // Different flash intensities based on element (using numeric comparisons)
            if (element === this.enums.element.fire) {
                targetAnimation.flash = 0.6;
            } else if (element === this.enums.element.cold) {
                targetAnimation.flash = 0.5;
            } else if (element === this.enums.element.lightning) {
                targetAnimation.flash = 0.8;
            } else if (element === this.enums.element.poison) {
                targetAnimation.flash = 0.3; // Subtle for DoT
            } else if (element === this.enums.element.holy || element === this.enums.element.shadow) {
                targetAnimation.flash = 0.7;
            } else {
                targetAnimation.flash = 0.5;
            }
        }

        // Play blood spray effect for physical damage
        if (element === this.enums.element.physical && damageResult.finalDamage > 0) {
            const targetTransform = this.game.getComponent(targetId, "transform");
            if (targetTransform?.position) {
                const pos = targetTransform.position;
                this.game.call('playEffect', 'blood_spray', { x: pos.x, y: pos.y, z: pos.z });
            }
        }
    }


    handleEntityDeath(entityId) {
        // Notify other systems about death
        this.game.call('startDeathProcess', entityId);
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

        // Status effects are automatically cleaned up by ECS when entity is destroyed
    }

    update() {
        this.processStatusEffects();
        this.processPendingDamage();
    }

    clearAllStatusEffects(entityId) {
        this.game.removeComponent(entityId, 'statusEffect');
    }

    clearAllDamageEffects() {
        // Remove all statusEffect components
        const entitiesWithEffects = this.game.getEntitiesWith('statusEffect');
        for (const entityId of entitiesWithEffects) {
            this.game.removeComponent(entityId, 'statusEffect');
        }
        this.pendingDamageEvents.clear();
    }

    getStatusEffects(entityId) {
        const statusEffect = this.game.getComponent(entityId, 'statusEffect');
        return statusEffect || { poison: [] };
    }

}
