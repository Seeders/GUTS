// Recalculates a hero entity's combat and health stats from:
//   1. Base class stats (from unitType definition)
//   2. Gear item affixes  (mainWeapon, offhand, bodyArmor, helmet)
//   3. Gem affixes        (ability gems in abilitySlots[])
//   4. Rune affixes       (runes socketed inside each gem)
//
// All mutation methods (equipGearItem, socketGem, socketRune, …) automatically
// sync the change to the persistent heroRoster entry on playerStats so equipment
// survives between rounds.
class HeroStatSystem extends GUTS.BaseSystem {

    static services = [
        'recalculateHeroStats',
        'equipGearItem',
        'unequipGearItem',
        'socketGem',
        'unsocketGem',
        'socketRune',
        'unsocketRune',
        'getHeroEquipmentSummary',
        'getUnlockedAbilitySlotCount'
    ];

    static serviceDependencies = [
        'getPlayerEntities'
    ];

    // Ability slot unlock thresholds (checked in descending order)
    static SLOT_UNLOCK = [
        { level: 7, slots: 4 },
        { level: 5, slots: 3 },
        { level: 3, slots: 2 },
        { level: 1, slots: 1 }
    ];

    static GEAR_SLOTS = ['mainWeapon', 'offhand', 'bodyArmor', 'helmet'];

    // Each gear slot only accepts items of a matching itemType.
    static SLOT_ITEM_TYPE = {
        mainWeapon: 'weapon',
        offhand:    'offhand',
        bodyArmor:  'bodyArmor',
        helmet:     'helmet'
    };

    static STAT_MAP = {
        // ── Weapon / offhand ────────────────────────────────────────────────
        flatDamage:           { component: 'combat', field: 'damage',               type: 'flat'    },
        percentDamage:        { component: 'combat', field: 'damage',               type: 'percent' },
        percentAttackSpeed:   { component: 'combat', field: 'attackSpeed',          type: 'percent' },
        critChance:           { component: 'combat', field: 'criticalChance',       type: 'flat'    },
        fireDamage:           { component: 'combat', field: 'fireDamage',           type: 'flat'    },
        coldDamage:           { component: 'combat', field: 'coldDamage',           type: 'flat'    },
        lifeLeech:            { component: 'combat', field: 'lifeLeech',            type: 'flat'    },
        // ── Armor / helmet / offhand-shield ─────────────────────────────────
        flatArmor:            { component: 'combat', field: 'armor',                type: 'flat'    },
        evasion:              { component: 'combat', field: 'evasion',              type: 'flat'    },
        fireResistance:       { component: 'combat', field: 'fireResistance',       type: 'flat'    },
        coldResistance:       { component: 'combat', field: 'coldResistance',       type: 'flat'    },
        lightningResistance:  { component: 'combat', field: 'lightningResistance',  type: 'flat'    },
        blockChance:          { component: 'combat', field: 'blockChance',          type: 'flat'    },
        // ── Health ──────────────────────────────────────────────────────────
        flatHP:               { component: 'health', field: 'max',                  type: 'flat'    },
        percentHP:            { component: 'health', field: 'max',                  type: 'percent' }
    };

    constructor(game) {
        super(game);
        this.game.heroStatSystem = this;
    }

    // ─── Public services ─────────────────────────────────────────────────────

    recalculateHeroStats(entityId) {
        const heroEquipment = this.game.getComponent(entityId, 'heroEquipment');
        const combat        = this.game.getComponent(entityId, 'combat');
        const health        = this.game.getComponent(entityId, 'health');
        if (!combat || !health) return;

        const base     = this._getBaseStats(entityId);
        const flats    = {};
        const percents = {};

        for (const item of this._collectAllItems(heroEquipment)) {
            for (const affix of (item.affixes || [])) {
                const mapping = HeroStatSystem.STAT_MAP[affix.stat];
                if (!mapping) continue;
                if (mapping.type === 'flat') {
                    flats[affix.stat] = (flats[affix.stat] || 0) + affix.value;
                } else {
                    percents[affix.stat] = (percents[affix.stat] || 0) + affix.value;
                }
            }
        }

        // Weapon drives the hero's basic attack: damage base, range, projectile,
        // attackSpeed, element. These fields are all set directly on the weapon item by
        // ItemGeneratorSystem. Older items may be missing them — fall back to the
        // weaponProfiles collection lookup via the public service.
        const weapon = heroEquipment?.mainWeapon || null;
        if (weapon && (weapon.range == null || weapon.attackSpeed == null)) {
            const profile = this.game.itemGeneratorSystem?.getWeaponProfile(weapon);
            if (profile) {
                weapon.range       = weapon.range       ?? profile.range       ?? 50;
                weapon.projectile  = weapon.projectile  ?? profile.projectile  ?? null;
                weapon.attackSpeed = weapon.attackSpeed ?? profile.attackSpeed ?? 1;
                weapon.element     = weapon.element     || profile.element     || 'physical';
            }
        }
        const weaponBaseDamage = weapon?.baseValue || 0;

        // Helper: combat.projectile is a numeric enum index, not a string.
        // Convert "arrow" → numeric index via the projectiles enum.
        // ComponentGenerator.deepMerge sometimes auto-converts nested string enums
        // to numeric indices when addComponent runs, so accept already-numeric values.
        const projectileNameToIndex = (value) => {
            if (value == null) return null;
            if (typeof value === 'number') return value; // already-converted by deepMerge
            const idx = this.enums?.projectiles?.[value];
            return (typeof idx === 'number') ? idx : null;
        };
        const elementNameToIndex = (value) => {
            if (typeof value === 'number') return value; // already-converted by deepMerge
            const idx = this.enums?.element?.[value];
            return (typeof idx === 'number') ? idx : 0;
        };

        if (!weapon) {
            // Bare-hands profile: hero walks up and punches for minimal damage
            combat.damage      = this._calc(1, flats.flatDamage || 0, percents.percentDamage || 0);
            combat.attackSpeed = this._calc(1, 0, percents.percentAttackSpeed || 0);
            combat.range       = 50;     // melee reach
            combat.projectile  = null;
            combat.element     = elementNameToIndex('physical');
        } else {
            combat.damage      = this._calc(weaponBaseDamage,        flats.flatDamage  || 0, percents.percentDamage     || 0);
            combat.attackSpeed = this._calc(weapon.attackSpeed || 1, 0,                      percents.percentAttackSpeed || 0);
            combat.range       = weapon.range ?? 50;
            combat.projectile  = projectileNameToIndex(weapon.projectile);
            combat.element     = elementNameToIndex(weapon.element || 'physical');
        }
        // Item-driven defenses: ignore unitType base armor/evasion/resistances/crit/block.
        // All defensive stats come from equipped gear affixes only.
        // Base armor: sum baseValue from body armor, helmet, and shield-type offhands
        // (orbs/quivers/tomes have baseValue: 0 so they contribute nothing).
        const baseArmor =
            (heroEquipment?.bodyArmor?.baseValue || 0) +
            (heroEquipment?.helmet?.baseValue    || 0) +
            (heroEquipment?.offhand?.baseValue   || 0);
        combat.armor               = baseArmor + (flats.flatArmor || 0);
        combat.evasion             = flats.evasion              || 0;
        combat.criticalChance      = flats.critChance           || 0;
        combat.blockChance         = flats.blockChance          || 0;
        combat.fireResistance      = flats.fireResistance       || 0;
        combat.coldResistance      = flats.coldResistance       || 0;
        combat.lightningResistance = flats.lightningResistance  || 0;

        const newMaxHP = this._calc(base.maxHP, flats.flatHP || 0, percents.percentHP || 0);
        const prevMax  = health.max || base.maxHP;
        health.max     = newMaxHP;
        health.current = Math.round(newMaxHP * (health.current / prevMax));
    }

    // Equip a gear item (mainWeapon / offhand / bodyArmor / helmet).
    // Enforces 2H weapon constraint: equipping a 2H main weapon removes the offhand;
    // equipping an offhand while a 2H is in mainWeapon is blocked (returns null).
    // Returns the displaced item so the caller can return it to inventory.
    equipGearItem(heroEntityId, slot, item) {
        if (!HeroStatSystem.GEAR_SLOTS.includes(slot)) return null;

        // Reject items whose itemType doesn't match this slot (e.g. body armor into offhand)
        const expectedType = HeroStatSystem.SLOT_ITEM_TYPE[slot];
        if (item?.itemType && expectedType && item.itemType !== expectedType) {
            return null;
        }

        let heroEquipment = this.game.getComponent(heroEntityId, 'heroEquipment');
        if (!heroEquipment) {
            this.game.addComponent(heroEntityId, 'heroEquipment', this._emptyEquipment());
            heroEquipment = this.game.getComponent(heroEntityId, 'heroEquipment');
        }

        if (slot === 'offhand' && heroEquipment.mainWeapon?.isTwoHanded) {
            return null; // blocked by 2H weapon
        }

        let displaced = null;

        // If equipping a 2H weapon, forcibly unequip offhand first (returns it to caller via extra displaced)
        if (slot === 'mainWeapon' && item?.isTwoHanded && heroEquipment.offhand) {
            // Offhand is lost — caller is responsible for returning it to inventory
            this._notifyDisplacedOffhand(heroEntityId, heroEquipment.offhand);
            heroEquipment.offhand = null;
        }

        displaced = heroEquipment[slot] || null;
        heroEquipment[slot] = item;
        this._syncToRoster(heroEntityId);
        this.recalculateHeroStats(heroEntityId);
        return displaced;
    }

    unequipGearItem(heroEntityId, slot) {
        if (!HeroStatSystem.GEAR_SLOTS.includes(slot)) return null;
        const heroEquipment = this.game.getComponent(heroEntityId, 'heroEquipment');
        if (!heroEquipment) return null;
        const item = heroEquipment[slot] || null;
        heroEquipment[slot] = null;
        this._syncToRoster(heroEntityId);
        this.recalculateHeroStats(heroEntityId);
        return item;
    }

    // Socket a gem into an ability slot (index 0–3).
    // Blocked if the slot is not yet unlocked for this hero's level.
    // Returns the displaced gem (if any).
    socketGem(heroEntityId, abilitySlotIndex, gem) {
        let heroEquipment = this.game.getComponent(heroEntityId, 'heroEquipment');
        if (!heroEquipment) {
            this.game.addComponent(heroEntityId, 'heroEquipment', this._emptyEquipment());
            heroEquipment = this.game.getComponent(heroEntityId, 'heroEquipment');
        }
        if (!Array.isArray(heroEquipment.abilitySlots)) {
            heroEquipment.abilitySlots = [null, null, null, null];
        }

        const rosterInfo     = this.game.getComponent(heroEntityId, 'heroRosterInfo');
        const unlockedSlots  = this._getUnlockedSlots(rosterInfo?.level || 1);
        if (abilitySlotIndex >= unlockedSlots) return null;

        const displaced = heroEquipment.abilitySlots[abilitySlotIndex] || null;
        heroEquipment.abilitySlots[abilitySlotIndex] = gem;
        this._syncToRoster(heroEntityId);
        this.recalculateHeroStats(heroEntityId);

        // Live-register the gem's ability so the hero can cast it this round (not just next respawn).
        // HeroRosterSystem already registers gems at spawn; this handles mid-prep socketing.
        if (gem?.abilityId && this.game.abilitySystem) {
            const existing = this.game.abilitySystem.entityAbilities?.get(heroEntityId) || [];
            const alreadyHas = existing.some(a => a.id === gem.abilityId);
            if (!alreadyHas) {
                this.game.abilitySystem.addAbilitiesToUnit(heroEntityId, [gem.abilityId]);
            }
        }

        return displaced;
    }

    unsocketGem(heroEntityId, abilitySlotIndex) {
        const heroEquipment = this.game.getComponent(heroEntityId, 'heroEquipment');
        if (!heroEquipment?.abilitySlots) return null;
        const gem = heroEquipment.abilitySlots[abilitySlotIndex] || null;
        if (gem) heroEquipment.abilitySlots[abilitySlotIndex] = null;
        this._syncToRoster(heroEntityId);
        this.recalculateHeroStats(heroEntityId);
        return gem;
    }

    // Socket a rune into slot runeSlotIndex of the gem in abilitySlotIndex.
    // Returns the displaced rune or null.
    socketRune(heroEntityId, abilitySlotIndex, runeSlotIndex, rune) {
        const heroEquipment = this.game.getComponent(heroEntityId, 'heroEquipment');
        if (!heroEquipment) return null;
        const gem = heroEquipment.abilitySlots?.[abilitySlotIndex];
        if (!gem) return null;
        if (!Array.isArray(gem.runes)) {
            gem.runes = Array(gem.runeSlots || 1).fill(null);
        }
        if (runeSlotIndex >= gem.runes.length) return null;
        const displaced = gem.runes[runeSlotIndex] || null;
        gem.runes[runeSlotIndex] = rune;
        this._syncToRoster(heroEntityId);
        this.recalculateHeroStats(heroEntityId);
        return displaced;
    }

    unsocketRune(heroEntityId, abilitySlotIndex, runeSlotIndex) {
        const heroEquipment = this.game.getComponent(heroEntityId, 'heroEquipment');
        if (!heroEquipment) return null;
        const gem = heroEquipment.abilitySlots?.[abilitySlotIndex];
        if (!gem?.runes) return null;
        const rune = gem.runes[runeSlotIndex] || null;
        if (rune) gem.runes[runeSlotIndex] = null;
        this._syncToRoster(heroEntityId);
        this.recalculateHeroStats(heroEntityId);
        return rune;
    }

    getHeroEquipmentSummary(heroEntityId) {
        const heroEquipment  = this.game.getComponent(heroEntityId, 'heroEquipment');
        const rosterInfo     = this.game.getComponent(heroEntityId, 'heroRosterInfo');
        const level          = rosterInfo?.level || 1;
        const unlockedSlots  = this._getUnlockedSlots(level);
        return {
            mainWeapon:   heroEquipment?.mainWeapon   || null,
            offhand:      heroEquipment?.offhand      || null,
            bodyArmor:    heroEquipment?.bodyArmor    || null,
            helmet:       heroEquipment?.helmet       || null,
            abilitySlots: (heroEquipment?.abilitySlots || [null, null, null, null]).slice(),
            unlockedSlots,
            level
        };
    }

    getUnlockedAbilitySlotCount(heroEntityId) {
        const rosterInfo = this.game.getComponent(heroEntityId, 'heroRosterInfo');
        return this._getUnlockedSlots(rosterInfo?.level || 1);
    }

    // ─── Event hooks ─────────────────────────────────────────────────────────

    onPlacementPhaseStart() {
        const entities = this.game.getEntitiesWith('heroEquipment');
        for (const entityId of entities) {
            this.recalculateHeroStats(entityId);
        }
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    // Collects every item that contributes affixes: gear + gems + runes inside gems
    _collectAllItems(heroEquipment) {
        if (!heroEquipment) return [];
        const items = [
            heroEquipment.mainWeapon,
            heroEquipment.offhand,
            heroEquipment.bodyArmor,
            heroEquipment.helmet
        ].filter(Boolean);

        for (const gem of (heroEquipment.abilitySlots || [])) {
            if (!gem) continue;
            items.push(gem);
            for (const rune of (gem.runes || [])) {
                if (rune) items.push(rune);
            }
        }
        return items;
    }

    // Persist current heroEquipment component back to the roster entry on playerStats.
    _syncToRoster(heroEntityId) {
        const rosterInfo    = this.game.getComponent(heroEntityId, 'heroRosterInfo');
        if (!rosterInfo) return;
        const heroEquipment = this.game.getComponent(heroEntityId, 'heroEquipment');
        if (!heroEquipment) return;

        const playerEntities = this.call.getPlayerEntities();
        for (const playerEntityId of playerEntities) {
            const stats = this.game.getComponent(playerEntityId, 'playerStats');
            if (!stats || stats.playerId !== rosterInfo.playerId) continue;
            const rosterEntry = stats.heroRoster?.[rosterInfo.rosterIndex];
            if (rosterEntry) {
                rosterEntry.equipment = JSON.parse(JSON.stringify(heroEquipment));
            }
            break;
        }
    }

    // Stub hook: called when a 2H weapon is equipped and the offhand is force-displaced.
    // A future UI system can subscribe to this to auto-return the item to inventory.
    _notifyDisplacedOffhand(heroEntityId, offhandItem) {
        this.game.triggerEvent('onOffhandDisplaced', { heroEntityId, item: offhandItem });
    }

    _getUnlockedSlots(level) {
        for (const { level: threshold, slots } of HeroStatSystem.SLOT_UNLOCK) {
            if (level >= threshold) return slots;
        }
        return 1;
    }

    _emptyEquipment() {
        return {
            mainWeapon:   null,
            offhand:      null,
            bodyArmor:    null,
            helmet:       null,
            abilitySlots: [null, null, null, null]
        };
    }

    _calc(base, flat, percentBonus) {
        return Math.round((base + flat) * (1 + percentBonus / 100));
    }

    _getBaseStats(entityId) {
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const unitTypeDef  = unitTypeComp ? this.game.getUnitTypeDef(unitTypeComp) : null;
        return {
            damage:              unitTypeDef?.damage              || 10,
            attackSpeed:         unitTypeDef?.attackSpeed         || 1,
            armor:               unitTypeDef?.armor               || 0,
            evasion:             unitTypeDef?.evasion             || 0,
            criticalChance:      unitTypeDef?.criticalChance      || 0,
            blockChance:         unitTypeDef?.blockChance         || 0,
            fireResistance:      unitTypeDef?.fireResistance      || 0,
            coldResistance:      unitTypeDef?.coldResistance      || 0,
            lightningResistance: unitTypeDef?.lightningResistance || 0,
            maxHP:               unitTypeDef?.hp                  || 100
        };
    }
}
