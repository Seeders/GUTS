// Generates Path of Exile-style items with rarities and affixes.
//
// All catalog data (bases, profiles, affixes, uniques, rarities) lives in the
// data/ collections — no hardcoded tables in this file:
//   data/weaponBases, data/weaponProfiles, data/armorBases, data/charmBases,
//   data/offhandBases, data/itemAffixes, data/uniqueItems, data/itemRarities
//
// Items are plain JS objects (not ECS entities) stored on playerStats.inventory
// and heroEquipment slots.
//
// Item types: weapon, offhand, bodyArmor, charm
class ItemGeneratorSystem extends GUTS.BaseSystem {

    static services = [
        'generateItem',
        'getAffix',
        'getItemColor',
        'rollAffixesForItem',
        'getUniqueForBase',
        'buildItemName',
        'getWeaponProfile'
    ];

    constructor(game) {
        super(game);
        this.game.itemGeneratorSystem = this;
        this._nextItemId = 1;
        this._catalogReady = false;
    }

    // ─── Catalog loading ─────────────────────────────────────────────────────
    // Convert the raw `{ id: entry }` dictionaries the build emits into the
    // shapes the generator needs (arrays for picking, maps for direct lookup).

    _ensureCatalog() {
        if (this._catalogReady) return;
        const c = this.collections || {};

        this._weaponBases  = Object.values(c.weaponBases  || {});
        this._armorBases   = Object.values(c.armorBases   || {});
        this._charmBases   = Object.values(c.charmBases   || {});
        this._offhandBases = Object.values(c.offhandBases || {});
        this._uniqueItems  = Object.values(c.uniqueItems  || {});
        this._allAffixes   = Object.values(c.itemAffixes  || {});
        this._rarities     = Object.values(c.itemRarities || {})
            .slice()
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        // weaponProfiles is keyed by weapon-type id (sword, bow, ...)
        this._weaponProfiles = {};
        for (const p of Object.values(c.weaponProfiles || {})) {
            this._weaponProfiles[p.id] = p;
        }

        this._itemAffixes = this._allAffixes.filter(a => (a.affixGroup || 'item') === 'item');

        // Rarity lookup by id
        this._rarityById = {};
        for (const r of this._rarities) this._rarityById[r.id] = r;

        this._catalogReady = true;
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    // Main entry point. options: { itemType?, dropLevel?, forcedRarity?, offhandType? }
    generateItem(options = {}) {
        this._ensureCatalog();
        const itemType  = options.itemType  || 'weapon';
        const dropLevel = options.dropLevel || 1;

        switch (itemType) {
            case 'offhand':   return this._generateOffhand(dropLevel, options.forcedRarity, options.offhandType);
            case 'bodyArmor': return this._generateArmor(dropLevel, options.forcedRarity);
            case 'charm':     return this._generateCharm(dropLevel, options.forcedRarity);
            case 'weapon':    return this._generateWeapon(dropLevel, options.forcedRarity);
            default:          return this._generateWeapon(dropLevel, options.forcedRarity);
        }
    }

    getAffix(affixId) {
        this._ensureCatalog();
        return this._allAffixes.find(a => a.id === affixId) || null;
    }

    getItemColor(rarity) {
        this._ensureCatalog();
        return this._rarityById[rarity]?.color || '#ffffff';
    }

    rollAffixesForItem(itemType, rarity) {
        this._ensureCatalog();
        return this._rollAffixes(itemType, rarity);
    }

    getUniqueForBase(baseType) {
        this._ensureCatalog();
        return this._uniqueItems.find(u => u.baseType === baseType) || null;
    }

    buildItemName(baseName, affixes, rarity) {
        return this._buildName(baseName, affixes, rarity);
    }

    // Returns the combat profile (range/projectile/attackSpeed/element/category)
    // for a generated weapon item. Used by HeroStatSystem to set hero combat stats
    // when a weapon is equipped.
    getWeaponProfile(item) {
        this._ensureCatalog();
        if (!item || item.itemType !== 'weapon') return null;
        const base = this._weaponBases.find(b => b.id === item.baseType);
        const wt = base?.weaponType;
        return wt ? this._weaponProfiles[wt] || null : null;
    }

    // Builds a clean white (no-affix) weapon item from a known base id.
    // Used for class-default starting equipment so we don't have to drop loot first.
    generateBaseWeapon(baseId) {
        this._ensureCatalog();
        const base = this._weaponBases.find(b => b.id === baseId);
        if (!base) return null;
        const profile = this._weaponProfiles[base.weaponType] || {};
        return {
            id:             `item_${this._nextItemId++}`,
            itemType:       'weapon',
            baseType:       base.id,
            baseName:       base.name,
            isTwoHanded:    base.isTwoHanded,
            weaponType:     base.weaponType,
            weaponCategory: profile.weaponCategory || 'melee',
            range:          profile.range       ?? 50,
            projectile:     profile.projectile  ?? null,
            element:        profile.element     || 'physical',
            attackSpeed:    profile.attackSpeed ?? 1,
            rarity:         'normal',
            name:           base.name,
            affixes:        [],
            baseValue:      base.baseDamage,
            // chosenAbilityId is picked by the player from this base's 3 candidates
            chosenAbilityId:  null
        };
    }

    // ─── Private: item generators ────────────────────────────────────────────

    _generateWeapon(dropLevel, forcedRarity) {
        const rarity = forcedRarity || this._rollRarity(dropLevel, 'itemWeights');
        if (rarity === 'unique') return this._generateUnique('weapon');

        const base    = this._pickBase(this._weaponBases, dropLevel);
        const affixes = this._rollAffixes('weapon', rarity);
        const profile = this._weaponProfiles[base.weaponType] || {};
        return {
            id:             `item_${this._nextItemId++}`,
            itemType:       'weapon',
            baseType:       base.id,
            baseName:       base.name,
            isTwoHanded:    base.isTwoHanded,
            weaponType:     base.weaponType,
            weaponCategory: profile.weaponCategory || 'melee',
            range:          profile.range       ?? 50,
            projectile:     profile.projectile  ?? null,
            element:        profile.element     || 'physical',
            attackSpeed:    profile.attackSpeed ?? 1,
            rarity,
            name:           this._buildName(base.name, affixes, rarity),
            affixes,
            baseValue:      base.baseDamage
        };
    }

    _generateOffhand(dropLevel, forcedRarity, preferredType) {
        const rarity = forcedRarity || this._rollRarity(dropLevel, 'itemWeights');
        if (rarity === 'unique') return this._generateUnique('offhand');

        const pool = this._offhandBases;
        const eligible = preferredType
            ? pool.filter(b => b.offhandType === preferredType)
            : pool;
        const base = eligible[Math.floor(Math.random() * eligible.length)];
        const affixType = `offhand-${base.offhandType}`;
        const affixes   = this._rollAffixes(affixType, rarity);
        return {
            id:          `item_${this._nextItemId++}`,
            itemType:    'offhand',
            offhandType: base.offhandType,
            baseType:    base.id,
            baseName:    base.name,
            rarity,
            name:        this._buildName(base.name, affixes, rarity),
            affixes,
            baseValue:   base.baseArmor
        };
    }

    _generateArmor(dropLevel, forcedRarity) {
        const rarity = forcedRarity || this._rollRarity(dropLevel, 'itemWeights');
        if (rarity === 'unique') return this._generateUnique('bodyArmor');

        const base    = this._pickBase(this._armorBases, dropLevel);
        const affixes = this._rollAffixes('bodyArmor', rarity);
        return {
            id:        `item_${this._nextItemId++}`,
            itemType:  'bodyArmor',
            baseType:  base.id,
            baseName:  base.name,
            rarity,
            name:      this._buildName(base.name, affixes, rarity),
            affixes,
            baseValue: base.baseArmor
        };
    }

    _generateCharm(dropLevel, forcedRarity) {
        const rarity = forcedRarity || this._rollRarity(dropLevel, 'itemWeights');

        const base    = this._pickBase(this._charmBases, dropLevel);
        const affixes = this._rollAffixes('charm', rarity);
        return {
            id:        `item_${this._nextItemId++}`,
            itemType:  'charm',
            baseType:  base.id,
            baseName:  base.name,
            rarity,
            name:      this._buildName(base.name, affixes, rarity),
            affixes,
            baseValue: 0
        };
    }

    _generateUnique(itemType) {
        const pool = this._uniqueItems.filter(u => u.itemType === itemType);
        if (pool.length === 0) {
            // Fall back to a rare if no unique exists for this type
            return this.generateItem({ itemType, forcedRarity: 'rare' });
        }
        const template = pool[Math.floor(Math.random() * pool.length)];
        return {
            ...template,
            id:     `item_${this._nextItemId++}`,
            rarity: 'unique',
            affixes: template.affixes.map(a => ({ ...a }))
        };
    }

    // ─── Private: rarity rolling ─────────────────────────────────────────────

    // weightField is 'itemWeights' (other weight fields existed for gems/runes
    // before they were removed). Drives the per-droplevel rarity distribution.
    _rollRarity(dropLevel, weightField) {
        const weighted = [];
        let total = 0;
        for (const rarity of this._rarities) {
            const weight = this._weightForLevel(rarity[weightField], dropLevel);
            if (weight > 0) {
                weighted.push({ id: rarity.id, weight });
                total += weight;
            }
        }
        if (total === 0) return 'normal';
        let roll = Math.random() * total;
        for (const w of weighted) {
            roll -= w.weight;
            if (roll < 0) return w.id;
        }
        return weighted[weighted.length - 1].id;
    }

    _weightForLevel(tiers, dropLevel) {
        if (!Array.isArray(tiers) || tiers.length === 0) return 0;
        let chosen = tiers[0];
        for (const tier of tiers) {
            if (dropLevel >= (tier.minLevel ?? 0)) chosen = tier;
            else break;
        }
        return chosen.weight ?? 0;
    }

    // ─── Private: base selection ─────────────────────────────────────────────

    _pickBase(pool, dropLevel) {
        const maxTier  = Math.min(4, Math.floor(dropLevel / 5) + 1);
        const eligible = pool.filter(b => b.tier <= maxTier);
        return eligible[Math.floor(Math.random() * eligible.length)];
    }

    // ─── Private: affix rolling ──────────────────────────────────────────────

    _rollAffixes(itemType, rarity) {
        const rarityDef = this._rarityById[rarity] || {};
        const pool      = this._itemAffixes.filter(a => (a.itemTypes || []).includes(itemType));
        const prefixes  = pool.filter(a => a.isPrefix);
        const suffixes  = pool.filter(a => !a.isPrefix);
        return this._pickAffixes(prefixes, suffixes, rarityDef.maxPrefixes || 0, rarityDef.maxSuffixes || 0);
    }

    _pickAffixes(prefixes, suffixes, maxPrefixes, maxSuffixes) {
        const picked  = [];
        const usedIds = new Set();

        const pick = (candidates, max) => {
            const shuffled = [...candidates].sort(() => Math.random() - 0.5);
            let count = 0;
            for (const a of shuffled) {
                if (count >= max) break;
                if (usedIds.has(a.id)) continue;
                usedIds.add(a.id);
                picked.push({
                    id:       a.id,
                    label:    a.label,
                    stat:     a.stat,
                    value:    Math.round(a.min + Math.random() * (a.max - a.min)),
                    isPrefix: a.isPrefix
                });
                count++;
            }
        };

        pick(prefixes, maxPrefixes);
        pick(suffixes, maxSuffixes);
        return picked;
    }

    // ─── Private: name building ──────────────────────────────────────────────

    _buildName(baseName, affixes, rarity) {
        if (rarity === 'normal') return baseName;
        const prefix = affixes.find(a => a.isPrefix);
        const suffix = affixes.find(a => !a.isPrefix);
        let name = baseName;
        if (prefix) name = `${prefix.label} ${name}`;
        if (suffix) name = `${name} ${suffix.label}`;
        return name.trim();
    }

}
