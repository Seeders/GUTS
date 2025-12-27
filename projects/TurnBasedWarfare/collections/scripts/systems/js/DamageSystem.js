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
            STACK_LIMIT: 10,        // maximum poison stacks (matches $fixedArray size)
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
        const log = GUTS.HeadlessLogger;
        const targetHealth = this.game.getComponent(targetId, "health");
        const targetDeathState = this.game.getComponent(targetId, "deathState");
        const targetUnitTypeComp = this.game.getComponent(targetId, "unitType");
        const targetUnitType = this.game.call('getUnitTypeDef', targetUnitTypeComp);
        const targetTransform = this.game.getComponent(targetId, "transform");
        const targetPos = targetTransform?.position;

        // Get source info for logging
        const sourceUnitTypeComp = this.game.getComponent(sourceId, "unitType");
        const sourceUnitType = this.game.call('getUnitTypeDef', sourceUnitTypeComp);
        const sourceTeamComp = this.game.getComponent(sourceId, "team");
        const targetTeamComp = this.game.getComponent(targetId, "team");
        const sourceName = sourceUnitType?.id || 'unknown';
        const targetName = targetUnitType?.id || 'unknown';
        const sourceTeam = this.reverseEnums.team?.[sourceTeamComp?.team] || sourceTeamComp?.team;
        const targetTeam = this.reverseEnums.team?.[targetTeamComp?.team] || targetTeamComp?.team;
        const elementName = this.reverseEnums.element?.[element] || element;

        if (!targetHealth || (targetDeathState && targetDeathState.state !== this.enums.deathState.alive)) {
            log.trace('Damage', `BLOCKED: ${sourceName}(${sourceId}) -> ${targetName}(${targetId})`, {
                reason: !targetHealth ? 'no_health' : 'not_alive',
                deathState: targetDeathState?.state
            });
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

        // Log damage application
        log.debug('Damage', `${sourceName}(${sourceId}) [${sourceTeam}] -> ${targetName}(${targetId}) [${targetTeam}]`, {
            baseDamage,
            finalDamage: damageResult.finalDamage,
            element: elementName,
            healthBefore: targetHealth.current + damageResult.finalDamage,
            healthAfter: targetHealth.current,
            isMelee: options.isMelee,
            isCritical: options.isCritical
        });

        // Check for death
        if (targetHealth.current <= 0) {
            log.info('Damage', `FATAL: ${targetName}(${targetId}) [${targetTeam}] killed by ${sourceName}(${sourceId}) [${sourceTeam}]`);
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
            fatal: targetHealth.current <= 0,
            healthRemaining: targetHealth.current,
            healthMax: targetHealth.max
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

                // Apply damage via game.call for logging (experience will be awarded inside applyDamage)
                const result = this.game.call('applyDamage', sourceId, entityId, adjustedDamage, element, {
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
     * Apply poison damage over time - poison cannot be resisted, only cured.
     * Uses a dedicated poison component that tracks stacks and refreshes duration on each application.
     */
    applyPoisonDoT(sourceId, targetId, totalDamage, options = {}) {
        const duration = options.duration || this.POISON_CONFIG.DEFAULT_DURATION;
        const tickInterval = options.tickInterval || 1.0; // Damage every 1 second

        // Get or create poison component for target
        let poison = this.game.getComponent(targetId, 'poison');
        if (!poison) {
            this.game.addComponent(targetId, 'poison', {
                stacks: 0,
                maxStacks: this.POISON_CONFIG.STACK_LIMIT,
                damagePerStack: 0,
                duration: 0,
                startTime: 0,
                lastTickTime: 0,
                tickInterval: tickInterval,
                sourceId: null
            });
            poison = this.game.getComponent(targetId, 'poison');
        }

        // Calculate damage per stack from this application
        const damagePerStack = Math.max(1, Math.ceil(totalDamage / this.POISON_CONFIG.DEFAULT_TICKS));

        // Add stacks (capped at maxStacks)
        const previousStacks = poison.stacks;
        poison.stacks = Math.min(poison.stacks + 1, poison.maxStacks);

        // Refresh duration and update damage (average of existing + new)
        if (previousStacks > 0) {
            // Weighted average: keep most of existing damage, blend in new
            poison.damagePerStack = Math.ceil((poison.damagePerStack * previousStacks + damagePerStack) / poison.stacks);
        } else {
            poison.damagePerStack = damagePerStack;
        }

        poison.duration = duration;
        poison.startTime = this.game.state.now;
        poison.sourceId = sourceId;
        poison.tickInterval = tickInterval;

        // Initialize lastTickTime if this is first application
        if (previousStacks === 0) {
            poison.lastTickTime = this.game.state.now;
        }

        return {
            damage: poison.damagePerStack * poison.stacks,
            isPoison: true,
            stacks: poison.stacks,
            tickDamage: poison.damagePerStack,
            duration: duration
        };
    }

    /**
     * Process ongoing poison damage for all poisoned entities
     */
    processStatusEffects() {
        // Query all entities with poison component
        const poisonedEntities = this.game.getEntitiesWith('poison');
        // Sort for deterministic processing order
        const sortedEntityIds = Array.from(poisonedEntities).sort((a, b) => a - b);

        for (const entityId of sortedEntityIds) {
            const poison = this.game.getComponent(entityId, 'poison');
            if (!poison || poison.stacks === 0) {
                continue;
            }

            const targetHealth = this.game.getComponent(entityId, "health");
            const targetDeathState = this.game.getComponent(entityId, "deathState");

            // Skip dead/dying entities
            if (!targetHealth || targetHealth.current <= 0 ||
                (targetDeathState && targetDeathState.state !== this.enums.deathState.alive)) {
                this.game.removeComponent(entityId, 'poison');
                continue;
            }

            // Check if poison has expired
            const elapsed = this.game.state.now - poison.startTime;
            if (elapsed >= poison.duration) {
                this.game.removeComponent(entityId, 'poison');
                continue;
            }

            // Check if it's time for a tick
            const timeSinceLastTick = this.game.state.now - poison.lastTickTime;
            if (timeSinceLastTick >= poison.tickInterval) {
                // Apply poison damage (damage = damagePerStack * stacks)
                const tickDamage = poison.damagePerStack * poison.stacks;
                targetHealth.current -= tickDamage;
                poison.lastTickTime = this.game.state.now;

                // Visual feedback for poison
                this.applyVisualFeedback(entityId, { finalDamage: tickDamage }, this.enums.element.poison);

                // Check for death from poison
                if (targetHealth.current <= 0) {
                    this.handleEntityDeath(entityId);
                    this.game.removeComponent(entityId, 'poison');
                }
            }
        }
    }

    /**
     * Cure poison effects - removes stacks or clears entirely
     */
    curePoison(targetId, stacksToRemove = null) {
        const poison = this.game.getComponent(targetId, 'poison');
        if (!poison || poison.stacks === 0) return false;

        if (stacksToRemove === null || stacksToRemove >= poison.stacks) {
            // Remove all poison
            this.game.removeComponent(targetId, 'poison');
        } else {
            // Remove some stacks
            poison.stacks = Math.max(0, poison.stacks - stacksToRemove);
            if (poison.stacks === 0) {
                this.game.removeComponent(targetId, 'poison');
            }
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
                    // Apply the delayed damage via game.call for logging
                     this.game.call('applyDamage', event.sourceId, event.targetId, event.damage, event.element, {
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
        const poison = this.game.getComponent(entityId, 'poison');
        return poison?.stacks || 0;
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
