// Path of Exile-style orb crafting applied to items in a player's inventory.
// All orb operations run on the SERVER; the client sends APPLY_ORB events.
//
// Orb                  Cost  Requirement   Effect
// ─────────────────────────────────────────────────────────────
// Transmutation (T)    1g    Normal only   → Magic (1-2 affixes)
// Alteration    (A)    2g    Magic only    Reroll affixes (stays Magic)
// Alchemy       (AL)   4g    Normal only   → Rare  (3-6 affixes)
// Chance        (C)    3g    Normal only   10% → Unique for this base; else unchanged
// Scouring      (S)    2g    Magic or Rare → Normal (strips all affixes)
class OrbCraftingSystem extends GUTS.BaseSystem {

    static services = [
        'applyOrb'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'rollAffixesForItem',
        'getUniqueForBase',
        'buildItemName'
    ];

    static ORBS = {
        transmutation: { cost: 1, label: 'Orb of Transmutation', requires: ['normal'],        targetRarity: 'magic'  },
        alteration:    { cost: 2, label: 'Orb of Alteration',    requires: ['magic'],          targetRarity: 'magic'  },
        alchemy:       { cost: 4, label: 'Orb of Alchemy',       requires: ['normal'],         targetRarity: 'rare'   },
        chance:        { cost: 3, label: 'Chance Orb',           requires: ['normal'],         targetRarity: 'unique' },
        scouring:      { cost: 2, label: 'Orb of Scouring',      requires: ['magic', 'rare'],  targetRarity: 'normal' },
        // Resonator: adds one rune slot to a gem (1→2 or 2→3). Cost scales with current slot count.
        resonator:     { cost: null, label: 'Resonator',         requiresItemType: 'gem',      maxRuneSlots: 3 }
    };

    static CHANCE_ORB_PROBABILITY = 0.10;

    constructor(game) {
        super(game);
        this.game.orbCraftingSystem = this;
    }

    // ─── Public service ──────────────────────────────────────────────────────

    // Apply an orb to a specific item in a player's inventory.
    // Returns { success, item, newGold, error? }
    applyOrb(numericPlayerId, inventoryIndex, orbType) {
        const orbDef = OrbCraftingSystem.ORBS[orbType];
        if (!orbDef) return { success: false, error: 'unknown_orb' };

        const { stats, entityId } = this._getPlayerStats(numericPlayerId);
        if (!stats) return { success: false, error: 'player_not_found' };

        const item = stats.inventory?.[inventoryIndex];
        if (!item) return { success: false, error: 'invalid_item' };

        // Resonator: special validation (requires gem item type, not a rarity)
        if (orbType === 'resonator') {
            if (item.itemType !== 'gem') return { success: false, error: 'requires_gem' };
            const currentSlots = item.runeSlots || 1;
            if (currentSlots >= orbDef.maxRuneSlots) return { success: false, error: 'rune_slots_maxed' };
            const resonatorCost = currentSlots === 1 ? 4 : 8;
            if ((stats.gold || 0) < resonatorCost) return { success: false, error: 'insufficient_gold' };
            stats.gold -= resonatorCost;
            const modified = this._applyResonator(this._cloneItem(item));
            stats.inventory[inventoryIndex] = modified;
            return { success: true, item: modified, newGold: stats.gold };
        }

        if (!orbDef.requires.includes(item.rarity)) {
            return { success: false, error: `requires_${orbDef.requires.join('_or_')}` };
        }

        if ((stats.gold || 0) < orbDef.cost) {
            return { success: false, error: 'insufficient_gold' };
        }

        // Deduct cost
        stats.gold -= orbDef.cost;

        // Apply the orb effect
        const modified = this._applyEffect(item, orbType, orbDef);
        stats.inventory[inventoryIndex] = modified;

        return { success: true, item: modified, newGold: stats.gold };
    }

    // ─── Orb effects ─────────────────────────────────────────────────────────

    _applyEffect(item, orbType, orbDef) {
        const clone = this._cloneItem(item);

        switch (orbType) {
            case 'transmutation': return this._applyTransmutation(clone);
            case 'alteration':    return this._applyAlteration(clone);
            case 'alchemy':       return this._applyAlchemy(clone);
            case 'chance':        return this._applyChance(clone);
            case 'scouring':      return this._applyScouring(clone);
            default:              return clone;
        }
    }

    // Normal → Magic: roll 1 prefix + 0-1 suffix (or 0-1 prefix + 1 suffix)
    _applyTransmutation(item) {
        item.affixes = this.call.rollAffixesForItem(item.itemType, 'magic');
        item.rarity  = 'magic';
        item.name    = this.call.buildItemName(item.baseName, item.affixes, 'magic');
        return item;
    }

    // Magic → Magic: reroll all affixes
    _applyAlteration(item) {
        item.affixes = this.call.rollAffixesForItem(item.itemType, 'magic');
        item.name    = this.call.buildItemName(item.baseName, item.affixes, 'magic');
        return item;
    }

    // Normal → Rare: roll 3-6 affixes
    _applyAlchemy(item) {
        item.affixes = this.call.rollAffixesForItem(item.itemType, 'rare');
        item.rarity  = 'rare';
        item.name    = this.call.buildItemName(item.baseName, item.affixes, 'rare');
        return item;
    }

    // Normal → maybe Unique (10%); otherwise unchanged
    _applyChance(item) {
        if (Math.random() > OrbCraftingSystem.CHANCE_ORB_PROBABILITY) return item;

        const uniqueTemplate = this.call.getUniqueForBase(item.baseType);
        if (!uniqueTemplate) return item; // no unique exists for this base

        return {
            ...item,
            name:    uniqueTemplate.name,
            rarity:  'unique',
            affixes: uniqueTemplate.affixes.map(a => ({ ...a }))
        };
    }

    // Gem only: adds one rune slot (1→2 or 2→3)
    _applyResonator(item) {
        const currentSlots = item.runeSlots || 1;
        item.runeSlots = Math.min(3, currentSlots + 1);
        if (!Array.isArray(item.runes)) item.runes = Array(currentSlots).fill(null);
        item.runes.push(null);
        return item;
    }

    // Magic or Rare → Normal: strip all affixes
    _applyScouring(item) {
        item.affixes = [];
        item.rarity  = 'normal';
        item.name    = item.baseName;
        return item;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    _cloneItem(item) {
        return {
            ...item,
            affixes: (item.affixes || []).map(a => ({ ...a }))
        };
    }

    _getPlayerStats(numericPlayerId) {
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.playerId === numericPlayerId) {
                return { stats, entityId };
            }
        }
        return { stats: null, entityId: null };
    }
}
