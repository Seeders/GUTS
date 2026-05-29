// Recalculates a hero entity's combat and health stats from:
//   1. Base class stats (from unitType definition)
//   2. Gear item affixes  (mainWeapon, offhand, bodyArmor, charm)
//
// All mutation methods (equipGearItem / unequipGearItem) automatically sync the
// change to the persistent heroRoster entry on playerStats so equipment survives
// between rounds.
class HeroStatSystem extends GUTS.BaseSystem {

    static services = [
        'recalculateHeroStats',
        'equipGearItem',
        'unequipGearItem',
        'getHeroEquipmentSummary'
    ];

    static serviceDependencies = [
        'getPlayerEntities'
    ];

    static GEAR_SLOTS = ['mainWeapon', 'offhand', 'bodyArmor', 'charm'];

    // Each gear slot only accepts items of a matching itemType.
    static SLOT_ITEM_TYPE = {
        mainWeapon: 'weapon',
        offhand:    'offhand',
        bodyArmor:  'bodyArmor',
        charm:      'charm'
    };

    // Returns the canonical string itemType for an item, regardless of whether
    // the item's `itemType` field is stored as a string ('offhand') or as a
    // numeric enum index (1). The conversion to numeric happens when an item
    // round-trips through heroEquipment's deepMerge (data/enums/itemType.json),
    // so a displaced inventory item often carries a numeric itemType.
    static itemTypeString(item, game) {
        const v = item?.itemType;
        if (typeof v === 'string') return v;
        if (typeof v === 'number') {
            const enumDef = game?.getCollections?.()?.enums?.itemType;
            if (enumDef && Array.isArray(enumDef.enum)) return enumDef.enum[v] || null;
        }
        return null;
    }

    static STAT_MAP = {
        // ── Weapon / offhand ────────────────────────────────────────────────
        flatDamage:           { component: 'combat', field: 'damage',               type: 'flat'    },
        percentDamage:        { component: 'combat', field: 'damage',               type: 'percent' },
        percentAttackSpeed:   { component: 'combat', field: 'attackSpeed',          type: 'percent' },
        critChance:           { component: 'combat', field: 'criticalChance',       type: 'flat'    },
        fireDamage:           { component: 'combat', field: 'fireDamage',           type: 'flat'    },
        coldDamage:           { component: 'combat', field: 'coldDamage',           type: 'flat'    },
        lifeLeech:            { component: 'combat', field: 'lifeLeech',            type: 'flat'    },
        // ── Armor / charm / offhand ─────────────────────────────────────────
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

    // Items get stronger as the player buys duplicates (see ItemShopSystem._addItemToInventory).
    // Per-level multiplier applies to: weapon damage, armor / shield baseValue, and the damage
    // of any ability granted by that item (via BaseAbility.sourceItemLevel).
    //   L1 = 1.00, L3 = 1.30, L6 = 1.75, L9 = 2.20
    static LEVEL_SCALING_PER_LEVEL = 0.15;
    static itemLevelMultiplier(itemLevel) {
        const lvl = Math.max(1, itemLevel || 1);
        return 1 + (lvl - 1) * HeroStatSystem.LEVEL_SCALING_PER_LEVEL;
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
        // Weapon damage scales with itemLevel: a level-3 sword hits harder than a level-1 one.
        const weaponBaseDamage = (weapon?.baseValue || 0)
            * HeroStatSystem.itemLevelMultiplier(weapon?.itemLevel);

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
        // Base armor: sum scaled baseValue from body armor and shield-type offhands
        // (charms are utility slots and don't carry baseValue; orbs/quivers/tomes also 0).
        const baseArmor =
            (heroEquipment?.bodyArmor?.baseValue || 0) * HeroStatSystem.itemLevelMultiplier(heroEquipment?.bodyArmor?.itemLevel) +
            (heroEquipment?.offhand?.baseValue   || 0) * HeroStatSystem.itemLevelMultiplier(heroEquipment?.offhand?.itemLevel);
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

    // Equip a gear item (mainWeapon / offhand / bodyArmor / charm).
    // Enforces 2H weapon constraint: equipping a 2H main weapon removes the offhand;
    // equipping an offhand while a 2H is in mainWeapon is blocked (returns null).
    // Returns the displaced item so the caller can return it to inventory.
    equipGearItem(heroEntityId, slot, item) {
        if (!HeroStatSystem.GEAR_SLOTS.includes(slot)) return null;

        // Reject items whose itemType doesn't match this slot (e.g. body armor into offhand).
        // Normalize because itemType may be a numeric enum index after deepMerge.
        const expectedType = HeroStatSystem.SLOT_ITEM_TYPE[slot];
        const itemType = HeroStatSystem.itemTypeString(item, this.game);
        if (itemType && expectedType && itemType !== expectedType) {
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
        this._reregisterGearAbilities(heroEntityId);
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
        this._reregisterGearAbilities(heroEntityId);
        return item;
    }

    // AbilitySystem.addAbilitiesToUnit REPLACES the entity's ability list, so any
    // live equip/unequip mid-prep must pass the FULL list of currently-equipped
    // gear abilities — otherwise prior abilities get silently wiped.
    _reregisterGearAbilities(heroEntityId) {
        const abilitySystem = this.game.abilitySystem;
        if (!abilitySystem) return;
        const heroEquipment = this.game.getComponent(heroEntityId, 'heroEquipment');
        if (!heroEquipment) return;
        // Pass each ability with its source item's level so damage can scale.
        // addAbilitiesToUnit accepts either bare IDs (legacy) or {id, itemLevel} pairs.
        const abilityRegistrations = HeroStatSystem.GEAR_SLOTS
            .map(slot => {
                const item = heroEquipment[slot];
                if (!item?.chosenAbilityId) return null;
                return { id: item.chosenAbilityId, itemLevel: item.itemLevel || 1 };
            })
            .filter(Boolean);
        if (abilityRegistrations.length > 0) {
            abilitySystem.addAbilitiesToUnit(heroEntityId, abilityRegistrations);
        } else {
            // addAbilitiesToUnit skips an empty list, so clear directly to avoid
            // leaving stale ability instances on a fully-unequipped hero.
            abilitySystem.entityAbilities?.set(heroEntityId, []);
        }
    }

    getHeroEquipmentSummary(heroEntityId) {
        const heroEquipment  = this.game.getComponent(heroEntityId, 'heroEquipment');
        const rosterInfo     = this.game.getComponent(heroEntityId, 'heroRosterInfo');
        const level          = rosterInfo?.level || 1;
        return {
            mainWeapon: heroEquipment?.mainWeapon || null,
            offhand:    heroEquipment?.offhand    || null,
            bodyArmor:  heroEquipment?.bodyArmor  || null,
            charm:      heroEquipment?.charm      || null,
            level
        };
    }

    // ─── Event hooks ─────────────────────────────────────────────────────────

    onPlacementPhaseStart() {
        const entities = this.game.getEntitiesWith('heroEquipment');
        for (const entityId of entities) {
            this.recalculateHeroStats(entityId);
        }
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    // Collects every item that contributes affixes — just the 4 gear pieces.
    _collectAllItems(heroEquipment) {
        if (!heroEquipment) return [];
        return [
            heroEquipment.mainWeapon,
            heroEquipment.offhand,
            heroEquipment.bodyArmor,
            heroEquipment.charm
        ].filter(Boolean);
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

    _emptyEquipment() {
        return {
            mainWeapon: null,
            offhand:    null,
            bodyArmor:  null,
            charm:      null
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
