class StatAggregationSystem extends GUTS.BaseSystem {
    static services = [
        'getAggregatedDamageModifiers',
        'getAggregatedDefensiveStats',
        'invalidateModifierCache'
    ];

    constructor(game) {
        super(game);
        this.game.statAggregationSystem = this;
    }

    init() {
        // Cache buff types for modifier lookups
        this.buffTypes = this.collections.buffTypes || {};
        this.buffTypeKeys = Object.keys(this.buffTypes).sort();
        this.upgrades = this.collections.upgrades || {};
    }

    /**
     * Get aggregated damage modifiers for an entity
     * @param {number} entityId - The attacking entity
     * @param {string[]} damageTags - Tags for this damage instance ['spell', 'fire', 'area']
     * @returns {{ increased: number, more: number[] }} Aggregated modifiers
     */
    getAggregatedDamageModifiers(entityId, damageTags) {
        const modifiers = this.collectAllModifiers(entityId);
        return this.filterModifiersByTags(modifiers, damageTags);
    }

    /**
     * Collect all modifier sources for an entity
     * @param {number} entityId
     * @returns {{ increased: Array, more: Array }}
     */
    collectAllModifiers(entityId) {
        const allModifiers = {
            increased: [],  // { tags: [], value: 0.25 }
            more: []        // { tags: [], value: 0.5 }
        };

        // 1. Unit passives (from unit type definition)
        this.collectUnitPassives(entityId, allModifiers);

        // 2. Player upgrades
        this.collectPlayerUpgrades(entityId, allModifiers);

        // 3. Active buffs
        this.collectBuffModifiers(entityId, allModifiers);

        // 4. Equipment (future)
        this.collectEquipmentModifiers(entityId, allModifiers);

        return allModifiers;
    }

    /**
     * Collect passive modifiers from unit type definition
     */
    collectUnitPassives(entityId, modifiers) {
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

        if (unitType?.passives) {
            for (const passive of unitType.passives) {
                if (passive.type === 'increased') {
                    modifiers.increased.push({ tags: passive.tags || [], value: passive.value });
                } else if (passive.type === 'more') {
                    modifiers.more.push({ tags: passive.tags || [], value: passive.value });
                }
            }
        }
    }

    /**
     * Collect modifiers from player upgrades
     */
    collectPlayerUpgrades(entityId, modifiers) {
        const team = this.game.getComponent(entityId, 'team');
        if (!team) return;

        const playerStats = this.game.call('getPlayerStatsByTeam', team.team);
        if (playerStats?.upgrades === undefined) return;

        for (const [upgradeId, upgradeDef] of Object.entries(this.upgrades)) {
            // Check bitmask for upgrade
            const upgradeIndex = this.enums.upgrades?.[upgradeId];
            if (upgradeIndex === undefined) continue;

            if (playerStats.upgrades & (1 << upgradeIndex)) {
                // New format: damageModifiers array
                if (upgradeDef.damageModifiers) {
                    for (const mod of upgradeDef.damageModifiers) {
                        if (mod.type === 'increased') {
                            modifiers.increased.push({ tags: mod.tags || [], value: mod.value });
                        } else if (mod.type === 'more') {
                            modifiers.more.push({ tags: mod.tags || [], value: mod.value });
                        }
                    }
                }
                // Legacy format fallback - check for known upgrade effects
                else if (upgradeDef.effects) {
                    for (const effect of upgradeDef.effects) {
                        if (effect === 'spellDamage') {
                            modifiers.increased.push({ tags: ['spell'], value: 0.25 });
                        }
                    }
                }
            }
        }
    }

    /**
     * Collect modifiers from active buffs
     */
    collectBuffModifiers(entityId, modifiers) {
        const buff = this.game.getComponent(entityId, 'buff');
        if (!buff) return;

        const currentTime = this.game.state.now || 0;
        if (buff.endTime && currentTime > buff.endTime) return;

        const buffTypeDef = this.getBuffTypeDef(buff.buffType);
        if (!buffTypeDef) return;

        // New format: damageModifiers array
        if (buffTypeDef.damageModifiers) {
            for (const mod of buffTypeDef.damageModifiers) {
                let value = mod.value;

                // Handle stacking buffs
                if (buffTypeDef.stackable && mod.valuePerStack && buff.stacks > 1) {
                    value = mod.valuePerStack * buff.stacks;
                } else if (buffTypeDef.stackable && buff.stacks > 1) {
                    value = mod.value * buff.stacks;
                }

                if (mod.type === 'increased') {
                    modifiers.increased.push({ tags: mod.tags || [], value: value });
                } else if (mod.type === 'more') {
                    modifiers.more.push({ tags: mod.tags || [], value: value });
                }
            }
        }
        // Legacy format fallback: convert damageMultiplier to "more" modifier
        else if (buffTypeDef.damageMultiplier && buffTypeDef.damageMultiplier !== 1) {
            let multiplier = buffTypeDef.damageMultiplier;

            // Handle stackable buffs with damagePerStack
            if (buffTypeDef.stackable && buffTypeDef.damagePerStack && buff.stacks > 1) {
                multiplier = 1 + (buffTypeDef.damagePerStack * buff.stacks);
            }

            // Convert multiplier to "more" value (1.5 -> 0.5)
            modifiers.more.push({ tags: [], value: multiplier - 1 });
        }
    }

    /**
     * Get buff type definition by numeric index
     */
    getBuffTypeDef(buffTypeIndex) {
        if (buffTypeIndex < 0 || buffTypeIndex >= this.buffTypeKeys.length) return null;
        const buffTypeKey = this.buffTypeKeys[buffTypeIndex];
        return this.buffTypes[buffTypeKey];
    }

    /**
     * Collect modifiers from equipment (future)
     */
    collectEquipmentModifiers(entityId, modifiers) {
        const equipment = this.game.getComponent(entityId, 'equipment');
        if (!equipment) return;

        // Future: Equipment items would have damageModifiers array similar to buffs
    }

    /**
     * Filter modifiers by damage tags and aggregate
     * @param {{ increased: Array, more: Array }} modifiers
     * @param {string[]} damageTags
     * @returns {{ increased: number, more: number[] }}
     */
    filterModifiersByTags(modifiers, damageTags) {
        const tagSet = new Set(damageTags);

        // Sum all matching increased modifiers
        let totalIncreased = 0;
        for (const mod of modifiers.increased) {
            if (this.modifierApplies(mod.tags, tagSet)) {
                totalIncreased += mod.value;
            }
        }

        // Collect all matching more modifiers (applied multiplicatively)
        const applicableMore = [];
        for (const mod of modifiers.more) {
            if (this.modifierApplies(mod.tags, tagSet)) {
                applicableMore.push(mod.value);
            }
        }

        return {
            increased: totalIncreased,  // Sum: 0.25 + 0.30 = 0.55 -> multiply by 1.55
            more: applicableMore        // Array: [0.2, 0.3] -> multiply by 1.2 * 1.3
        };
    }

    /**
     * Check if a modifier applies to given damage tags
     * Empty tags array = applies to all damage (global modifier)
     * @param {string[]} modifierTags - Tags required by the modifier
     * @param {Set<string>} damageTagSet - Tags on the damage instance
     * @returns {boolean}
     */
    modifierApplies(modifierTags, damageTagSet) {
        // Empty tags = global modifier, applies to everything
        if (!modifierTags || modifierTags.length === 0) {
            return true;
        }

        // All modifier tags must be present in damage tags
        for (const tag of modifierTags) {
            if (!damageTagSet.has(tag)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Get aggregated defensive stats including accuracy and evasion
     * @param {number} entityId
     * @returns {Object} Defensive stats with buff modifiers applied
     */
    getAggregatedDefensiveStats(entityId) {
        const combat = this.game.getComponent(entityId, 'combat');
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

        const stats = {
            armor: combat?.armor || 0,
            fireResistance: combat?.fireResistance || 0,
            coldResistance: combat?.coldResistance || 0,
            lightningResistance: combat?.lightningResistance || 0,
            poisonResistance: combat?.poisonResistance || 0,
            accuracy: combat?.accuracy ?? unitType?.accuracy ?? 100,
            evasion: combat?.evasion ?? unitType?.evasion ?? 0,
            criticalChance: combat?.criticalChance ?? unitType?.criticalChance ?? 0,
            criticalMultiplier: combat?.criticalMultiplier ?? unitType?.criticalMultiplier ?? 1.5
        };

        // Apply buff modifiers
        this.applyDefensiveBuffModifiers(entityId, stats);

        return stats;
    }

    /**
     * Apply buff modifiers to defensive stats
     */
    applyDefensiveBuffModifiers(entityId, stats) {
        const buff = this.game.getComponent(entityId, 'buff');
        if (!buff) return;

        const currentTime = this.game.state.now || 0;
        if (buff.endTime && currentTime > buff.endTime) return;

        const buffTypeDef = this.getBuffTypeDef(buff.buffType);
        if (!buffTypeDef) return;

        // Apply multipliers
        if (buffTypeDef.armorMultiplier) {
            stats.armor *= buffTypeDef.armorMultiplier;
        }

        // Apply additive modifiers
        if (buffTypeDef.evasionModifier) {
            stats.evasion += buffTypeDef.evasionModifier;
        }
        if (buffTypeDef.accuracyModifier) {
            stats.accuracy += buffTypeDef.accuracyModifier;
        }

        // Apply resistance modifiers
        if (buffTypeDef.additionalFireResistance) {
            stats.fireResistance += buffTypeDef.additionalFireResistance;
        }
        if (buffTypeDef.additionalColdResistance) {
            stats.coldResistance += buffTypeDef.additionalColdResistance;
        }
        if (buffTypeDef.additionalLightningResistance) {
            stats.lightningResistance += buffTypeDef.additionalLightningResistance;
        }
        if (buffTypeDef.additionalElementalResistance) {
            stats.fireResistance += buffTypeDef.additionalElementalResistance;
            stats.coldResistance += buffTypeDef.additionalElementalResistance;
            stats.lightningResistance += buffTypeDef.additionalElementalResistance;
        }
    }

    /**
     * Invalidate modifier cache for an entity (called when buffs change)
     */
    invalidateModifierCache(entityId) {
        // Future: If we add caching, invalidate here
    }
}
