class StatAggregationSystem extends GUTS.BaseSystem {
    static services = [
        'getAggregatedDamageModifiers',
        'getAggregatedSpeedModifiers',
        'getAggregatedCritModifiers',
        'getEffectiveAttackSpeed',
        'getAggregatedDefensiveStats',
        'invalidateModifierCache'
    ];

    static serviceDependencies = [
        'getPlayerStatsByTeam'
    ];

    // ─── Modifier taxonomy ───────────────────────────────────────────────────
    // Attacks and Spells are both abilities; the basic attack is just an Attack.
    // A damage/speed instance carries TAGS, and a modifier applies when every tag
    // it names is present on the instance (no tags = applies to everything).
    //
    // These tables map the authoring shorthand used in `statModifiers` (on items,
    // upgrades, unit techs, unit-modifier cards and leaders) onto tagged
    // "increased" modifiers. ONLY the `.pct` half is consumed here — the `.add`
    // half stays on the combat component, where it means "weapon base" (it feeds
    // combat.damage / combat.attackSpeed, which only the basic Attack reads).
    //
    // Anything more exotic than these (area damage, projectile damage...) is
    // authored as a `damageModifiers` / `speedModifiers` array with explicit tags —
    // the same shape the buffs and unit passives already use.
    //
    // The element entries are deliberately NOT gated on attack-vs-spell: "increased
    // Fire Damage" boosts a fire hit whether it came from a sword or a Fireball.
    // They are narrower than `spellDamage` (they need the element to match), so they
    // are authored at higher values.
    //
    // NOTE: `fireDamage` / `coldDamage` used to mean FLAT added elemental damage on
    // the combat component. Nothing ever read those fields — the affixes that rolled
    // them (Searing, Freezing) were inert. They now mean "% increased <element>
    // damage" and route through this pipeline instead.
    static DAMAGE_PCT_FIELDS = {
        damage:          [],           // all abilities — attacks AND spells
        attackDamage:    ['attack'],
        spellDamage:     ['spell'],
        fireDamage:      ['fire'],
        coldDamage:      ['cold'],
        lightningDamage: ['lightning'],
        physicalDamage:  ['physical'],
        poisonDamage:    ['poison']
    };

    static SPEED_PCT_FIELDS = {
        speed:       [],            // attacks AND casts
        attackSpeed: ['attack'],
        castSpeed:   ['spell']
    };

    // INCREASED CRITICAL STRIKE CHANCE. Crit works PoE-style — these MULTIPLY a base
    // chance rather than adding to it:
    //
    //     chance = base × (1 + Σ increased) × Π (1 + more)
    //
    // So a 10%-base spell on a unit carrying +200% increased crit chance from gear
    // and upgrades crits at 0.10 × (1 + 2.00) = 30%.
    //
    // The BASE comes from one of two places, never both (AccuracySystem.rollCritical):
    //   • an ATTACK takes it from the WEAPON — the unit's combat.criticalChance plus
    //     flat `criticalChance: {add}` from gear. Attack abilities have no base crit
    //     of their own; they crit with the weapon they swing.
    //   • a SPELL takes it from the SKILL — BaseAbility.criticalChance, and nothing
    //     else. Weapon crit never leaks into spells.
    //
    // A `.pct` of 0.6 therefore reads "+60% increased crit chance", NOT "+60% crit".
    // The `.add` half is a different mechanic: flat BASE crit on the combat component,
    // i.e. a weapon's crit rating, so it only ever affects attacks.
    static CRIT_PCT_FIELDS = {
        criticalChance:       [],           // all abilities — attacks AND spells
        attackCriticalChance: ['attack'],
        spellCriticalChance:  ['spell']
    };

    // Fields whose `.pct` is owned by the modifier pipeline above and must NOT
    // also be baked into the combat component (that would double-count them).
    // ArmyShopSystem and LeaderSystem both consult this from _applyStatMods.
    static PIPELINE_PCT_FIELDS = new Set([
        ...Object.keys(StatAggregationSystem.DAMAGE_PCT_FIELDS),
        ...Object.keys(StatAggregationSystem.SPEED_PCT_FIELDS),
        ...Object.keys(StatAggregationSystem.CRIT_PCT_FIELDS)
    ]);

    constructor(game) {
        super(game);
        this.game.statAggregationSystem = this;

        // Cache of the STATIC modifier sources per entity (unit passives, player
        // upgrades, unit techs, unit-modifier cards, equipped items, leader).
        // Buffs are deliberately NOT cached — they come and go every tick.
        this._staticCache = new Map();
    }

    init() {
        // Cache buff types for modifier lookups
        this.buffTypes = this.collections.buffTypes || {};
        this.buffTypeKeys = Object.keys(this.buffTypes).sort();
        this.upgrades = this.collections.upgrades || {};
    }

    // =========================================================================
    // PUBLIC: damage + speed modifier lookup
    // =========================================================================

    /**
     * Get aggregated damage modifiers for an entity.
     * @param {number} entityId - The attacking entity
     * @param {string[]} damageTags - Tags on this damage instance, e.g.
     *                                ['spell', 'fire', 'area'] or ['attack', 'melee']
     * @returns {{ increased: number, more: number[] }}
     */
    getAggregatedDamageModifiers(entityId, damageTags) {
        const modifiers = this.collectAllModifiers(entityId);
        return this.filterModifiersByTags(modifiers.damage, damageTags);
    }

    /**
     * Get aggregated action-speed modifiers for an entity. Attack rate and cast
     * rate are the same mechanic with different tags: ['attack'] for the basic
     * attack and attack abilities, ['spell'] for spells.
     * @param {number} entityId
     * @param {string[]} speedTags
     * @returns {{ increased: number, more: number[] }}
     */
    getAggregatedSpeedModifiers(entityId, speedTags) {
        const modifiers = this.collectAllModifiers(entityId);
        return this.filterModifiersByTags(modifiers.speed, speedTags);
    }

    /**
     * Get aggregated INCREASED CRIT CHANCE modifiers for an entity. These multiply
     * the skill's base crit chance — see CRIT_PCT_FIELDS.
     * @param {number} entityId
     * @param {string[]} tags - tags of the hit being rolled ('attack'/'spell'/...)
     * @returns {{ increased: number, more: number[] }}
     */
    getAggregatedCritModifiers(entityId, tags) {
        const modifiers = this.collectAllModifiers(entityId);
        return this.filterModifiersByTags(modifiers.crit, tags);
    }

    /**
     * The rate the basic attack actually swings at: the unit's base attackSpeed
     * put through the same ['attack'] speed modifiers an attack ABILITY gets, so
     * haste/slow/rage and attack-speed gear hit both equally.
     *
     * Returns 0 when the entity is fully attack-disabled (stun, freeze, polymorph).
     * Callers must treat 0 as "cannot attack", not as "no cooldown".
     */
    getEffectiveAttackSpeed(entityId, baseAttackSpeed) {
        const mods = this.getAggregatedSpeedModifiers(entityId, ['attack']);
        let speed = baseAttackSpeed * (1 + mods.increased);
        for (const more of mods.more) speed *= (1 + more);
        return Math.max(0, speed);
    }

    /**
     * Collect every modifier source for an entity.
     * @returns {{ damage: {increased:Array, more:Array}, speed: {increased:Array, more:Array} }}
     */
    collectAllModifiers(entityId) {
        // Static sources change only when the shop/roster changes, and resolving
        // them means walking playerStats + item affixes. Cache them; damage runs
        // several times per unit per second.
        let statics = this._staticCache.get(entityId);
        if (!statics) {
            statics = this._emptyModifiers();
            this.collectUnitPassives(entityId, statics);
            this.collectPlayerUpgrades(entityId, statics);
            this.collectShopStatModifiers(entityId, statics);
            this.collectLeaderModifiers(entityId, statics);
            this._staticCache.set(entityId, statics);
        }

        // Buffs are volatile — always fresh. This runs per damage instance AND per
        // tick per unit (attack-speed gating), so an unbuffed unit — the common
        // case — hands back the cached object with no copying at all.
        const buffs = this.game.buffEffectsSystem?.getBuffs(entityId) || [];
        if (buffs.length === 0) return statics;

        const all = this._cloneModifiers(statics);
        for (const buff of buffs) {
            this._collectSingleBuffModifiers(buff, all);
        }
        return all;
    }

    _emptyModifiers() {
        return {
            damage: { increased: [], more: [] },   // { tags: [], value: 0.25 }
            speed:  { increased: [], more: [] },
            crit:   { increased: [], more: [] }
        };
    }

    _cloneModifiers(src) {
        return {
            damage: { increased: src.damage.increased.slice(), more: src.damage.more.slice() },
            speed:  { increased: src.speed.increased.slice(),  more: src.speed.more.slice() },
            crit:   { increased: src.crit.increased.slice(),   more: src.crit.more.slice() }
        };
    }

    // =========================================================================
    // SOURCES
    // =========================================================================

    /**
     * Unit passives from the unit type definition.
     * `passives: [{ type: 'increased'|'more', tags: [...], value, stat?: 'damage'|'speed' }]`
     */
    collectUnitPassives(entityId, modifiers) {
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const unitType = this.game.getUnitTypeDef(unitTypeComp);
        this._pushModifierList(unitType?.passives, modifiers);
    }

    /**
     * Player upgrades: the `damageModifiers` / `speedModifiers` arrays, plus the
     * `statModifiers` pct shorthand (target-filtered by ArmyShopSystem).
     */
    collectPlayerUpgrades(entityId, modifiers) {
        const team = this.game.getComponent(entityId, 'team');
        if (!team) return;

        const playerStats = this.call.getPlayerStatsByTeam(team.team);
        if (playerStats?.upgrades === undefined) return;

        for (const [upgradeId, upgradeDef] of Object.entries(this.upgrades)) {
            const upgradeIndex = this.enums.upgrades?.[upgradeId];
            if (upgradeIndex === undefined) continue;
            if (!(playerStats.upgrades & (1 << upgradeIndex))) continue;

            this._pushModifierList(upgradeDef.damageModifiers, modifiers, 'damage');
            this._pushModifierList(upgradeDef.speedModifiers, modifiers, 'speed');
            this._pushModifierList(upgradeDef.critModifiers, modifiers, 'crit');

            // Legacy: `effects: ['spellDamage']` predates damageModifiers.
            if (!upgradeDef.damageModifiers && Array.isArray(upgradeDef.effects)) {
                for (const effect of upgradeDef.effects) {
                    if (effect === 'spellDamage') {
                        modifiers.damage.increased.push({ tags: ['spell'], value: 0.25 });
                    }
                }
            }
        }
        // NOTE: an upgrade's `statModifiers` are folded in by
        // collectShopStatModifiers, which applies the same target/profile filter
        // ArmyShopSystem uses when it bakes the `.add` half into the components.
    }

    /**
     * The `statModifiers` pct shorthand from everything the shop grants:
     * upgrades (target-filtered), unit techs, unit-modifier cards, equipped items.
     * ArmyShopSystem owns the resolution (affix rolls, target matching); we only
     * translate the resulting field map into tagged modifiers.
     */
    collectShopStatModifiers(entityId, modifiers) {
        const shop = this.game.armyShopSystem;
        if (!shop?.getEntityGrants) return;

        const grants = shop.getEntityGrants(entityId);
        if (!grants) return;

        this._translateStatMods(grants.statModifiers, modifiers);
        this._pushModifierList(grants.damageModifiers, modifiers, 'damage');
        this._pushModifierList(grants.speedModifiers, modifiers, 'speed');
        this._pushModifierList(grants.critModifiers, modifiers, 'crit');
    }

    /**
     * Commander/leader bonuses (LeaderSystem bakes the `.add` half at spawn).
     */
    collectLeaderModifiers(entityId, modifiers) {
        const leaders = this.game.leaderSystem;
        if (!leaders?.getEntityGrants) return;

        const grants = leaders.getEntityGrants(entityId);
        if (!grants) return;

        this._translateStatMods(grants.statModifiers, modifiers);
        this._pushModifierList(grants.damageModifiers, modifiers, 'damage');
        this._pushModifierList(grants.speedModifiers, modifiers, 'speed');
        this._pushModifierList(grants.critModifiers, modifiers, 'crit');
    }

    /**
     * Active buffs. Supports the tagged arrays and the legacy scalar multipliers.
     */
    collectBuffModifiers(entityId, modifiers) {
        const buffs = this.game.buffEffectsSystem?.getBuffs(entityId) || [];
        for (const buff of buffs) {
            this._collectSingleBuffModifiers(buff, modifiers);
        }
    }

    _collectSingleBuffModifiers(buff, modifiers) {
        const buffTypeDef = this.getBuffTypeDef(buff.buffType);
        if (!buffTypeDef) return;

        const stacks = (buffTypeDef.stackable && buff.stacks > 1) ? buff.stacks : 1;
        const scale = (mod) => {
            if (stacks === 1) return mod.value;
            return mod.valuePerStack != null ? mod.valuePerStack * stacks : mod.value * stacks;
        };

        this._pushModifierList(buffTypeDef.damageModifiers, modifiers, 'damage', scale);
        this._pushModifierList(buffTypeDef.speedModifiers, modifiers, 'speed', scale);
        this._pushModifierList(buffTypeDef.critModifiers, modifiers, 'crit', scale);

        // Legacy: scalar damageMultiplier -> a tagless "more" damage modifier.
        // Skipped when the buff already speaks the tagged language.
        if (!buffTypeDef.damageModifiers
            && buffTypeDef.damageMultiplier && buffTypeDef.damageMultiplier !== 1) {
            let multiplier = buffTypeDef.damageMultiplier;
            if (buffTypeDef.stackable && buffTypeDef.damagePerStack && buff.stacks > 1) {
                multiplier = 1 + (buffTypeDef.damagePerStack * buff.stacks);
            }
            modifiers.damage.more.push({ tags: [], value: multiplier - 1 });
        }

        // Scalar attackSpeedMultiplier -> a "more" speed modifier tagged 'attack'.
        // Haste, Rage, RapidFire, Slowed, Crippled and the hard-CC stuns all ride
        // this path. This system is the SINGLE owner of attack speed: it is what
        // makes a haste buff speed up an attack ABILITY and not just the basic
        // attack. (BuffEffectsSystem used to multiply combat.attackSpeed in place;
        // it no longer does, or this would count twice.)
        if (!buffTypeDef.speedModifiers) {
            let atkMult = buffTypeDef.attackSpeedMultiplier;
            if (buffTypeDef.attackDisabled) atkMult = 0;
            if (atkMult != null && atkMult !== 1) {
                modifiers.speed.more.push({ tags: ['attack'], value: atkMult - 1 });
            }

            const castMult = buffTypeDef.castSpeedMultiplier;
            if (castMult != null && castMult !== 1) {
                modifiers.speed.more.push({ tags: ['spell'], value: castMult - 1 });
            }
        }
    }

    // =========================================================================
    // TRANSLATION
    // =========================================================================

    /**
     * Push a `[{ type, tags, value, stat? }]` list onto the right bucket.
     * @param {string} defaultStat - 'damage' or 'speed'; entries may override
     *                               with their own `stat` field (unit passives
     *                               share one list for both).
     */
    _pushModifierList(list, modifiers, defaultStat = 'damage', scale = null) {
        if (!Array.isArray(list)) return;
        for (const mod of list) {
            const bucket = modifiers[mod.stat || defaultStat];
            if (!bucket) continue;
            const value = scale ? scale(mod) : mod.value;
            if (mod.type === 'increased') {
                bucket.increased.push({ tags: mod.tags || [], value });
            } else if (mod.type === 'more') {
                bucket.more.push({ tags: mod.tags || [], value });
            }
        }
    }

    /**
     * Translate the `statModifiers` pct shorthand into tagged "increased"
     * modifiers. The `.add` half is ignored here — it belongs on the combat
     * component (weapon base), and ArmyShopSystem/LeaderSystem put it there.
     */
    _translateStatMods(mods, modifiers) {
        if (!mods) return;
        for (const [field, spec] of Object.entries(mods)) {
            const pct = spec?.pct;
            if (!pct) continue;

            const damageTags = StatAggregationSystem.DAMAGE_PCT_FIELDS[field];
            if (damageTags) {
                modifiers.damage.increased.push({ tags: damageTags, value: pct });
                continue;
            }
            const speedTags = StatAggregationSystem.SPEED_PCT_FIELDS[field];
            if (speedTags) {
                modifiers.speed.increased.push({ tags: speedTags, value: pct });
                continue;
            }
            const critTags = StatAggregationSystem.CRIT_PCT_FIELDS[field];
            if (critTags) {
                modifiers.crit.increased.push({ tags: critTags, value: pct });
            }
        }
    }

    // =========================================================================
    // FILTERING
    // =========================================================================

    /**
     * Filter a modifier bucket by the tags on this damage/speed instance.
     * @returns {{ increased: number, more: number[] }}
     */
    filterModifiersByTags(bucket, tags) {
        const tagSet = new Set(tags);

        let totalIncreased = 0;
        for (const mod of bucket.increased) {
            if (this.modifierApplies(mod.tags, tagSet)) {
                totalIncreased += mod.value;
            }
        }

        const applicableMore = [];
        for (const mod of bucket.more) {
            if (this.modifierApplies(mod.tags, tagSet)) {
                applicableMore.push(mod.value);
            }
        }

        return {
            increased: totalIncreased,  // summed:  0.25 + 0.30 -> ×1.55
            more: applicableMore        // separate: [0.2, 0.3] -> ×1.2 ×1.3
        };
    }

    /**
     * A modifier applies when EVERY tag it names is on the instance.
     * No tags = global modifier ("increased Damage" hits attacks and spells).
     * "increased Fire Damage" = tags ['fire'] and hits an attack or a spell,
     * as long as that hit is fire.
     */
    modifierApplies(modifierTags, tagSet) {
        if (!modifierTags || modifierTags.length === 0) return true;
        for (const tag of modifierTags) {
            if (!tagSet.has(tag)) return false;
        }
        return true;
    }

    /**
     * Get buff type definition by numeric index
     */
    getBuffTypeDef(buffTypeIndex) {
        if (buffTypeIndex < 0 || buffTypeIndex >= this.buffTypeKeys.length) return null;
        const buffTypeKey = this.buffTypeKeys[buffTypeIndex];
        return this.buffTypes[buffTypeKey];
    }

    // =========================================================================
    // DEFENSIVE STATS (unchanged)
    // =========================================================================

    getAggregatedDefensiveStats(entityId) {
        const combat = this.game.getComponent(entityId, 'combat');
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const unitType = this.game.getUnitTypeDef( unitTypeComp);

        const stats = {
            armor: combat?.armor || 0,
            fireResistance: combat?.fireResistance || 0,
            coldResistance: combat?.coldResistance || 0,
            lightningResistance: combat?.lightningResistance || 0,
            poisonResistance: combat?.poisonResistance || 0,
            accuracy: combat?.accuracy ?? unitType?.accuracy ?? 100,
            evasion: combat?.evasion ?? unitType?.evasion ?? 0,
            blockChance: combat?.blockChance ?? unitType?.blockChance ?? 0,
            criticalChance: combat?.criticalChance ?? unitType?.criticalChance ?? 0,
            criticalMultiplier: combat?.criticalMultiplier ?? unitType?.criticalMultiplier ?? 1.5
        };

        // Apply buff modifiers
        this.applyDefensiveBuffModifiers(entityId, stats);

        return stats;
    }

    applyDefensiveBuffModifiers(entityId, stats) {
        // Multi-buff: apply defensive modifiers from every active buff.
        const buffs = this.game.buffEffectsSystem?.getBuffs(entityId) || [];
        for (const buff of buffs) {
            this._applySingleDefensiveBuff(buff, stats);
        }
    }

    _applySingleDefensiveBuff(buff, stats) {
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

    // =========================================================================
    // CACHE
    // =========================================================================

    /**
     * Drop cached static modifiers. Call whenever the shop changes what an
     * entity owns (upgrade bought, item equipped, tech granted, unit respawned).
     * Omit entityId to clear everything.
     */
    invalidateModifierCache(entityId = null) {
        if (entityId == null) this._staticCache.clear();
        else this._staticCache.delete(entityId);
    }

    onPlacementPhaseStart() {
        this._staticCache.clear();
    }

    onBattleEnd() {
        this._staticCache.clear();
    }

    entityDestroyed(entityId) {
        this._staticCache.delete(entityId);
    }

    destroy() {
        this._staticCache.clear();
    }
}
