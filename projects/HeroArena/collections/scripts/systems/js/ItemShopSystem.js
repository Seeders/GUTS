// Round-start item shop. Replaces LootDropSystem's auto-drop.
//
// Per-round flow (driven by AutobattlerRoundSystem):
//   1. openShopForRound()   — generates each player's shop offers
//   2. submitBuyShopItem    — player spends 3g, adds item to inventory (stacks on match)
//   3. submitRerollShop     — player spends 1g, rerolls all unbought offers
//   4. submitUpgradeShop    — player spends current upgrade cost, +1 shopLevel
//   5. submitAffixChoice    — picks one of 3 affix sets after an item hits lvl 3/6
//   6. closeShop()          — at battle start: tally leftover gold (1-2g → discount carry, 3+ lost)
//
// Item stacking: buying a baseType the player already owns increments that item's
// itemLevel instead of adding a duplicate. Crossing levels 3, 6, or 9 triggers a
// pending affix-choice (lvl 9 is auto-applied for the legendary affix).
class ItemShopSystem extends GUTS.BaseSystem {

    static services = [
        'openShopForRound',
        'closeShop',
        'buyShopItem',
        'rerollShop',
        'upgradeShop',
        'sellInventoryItem',
        'applyAffixChoice',
        'requestIdentify',
        'requestAbilityChoice',
        'applyAbilityChoice',
        'getShopUpgradeCost'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'generateItem',
        'sendToPlayer',
        'broadcastToRoom'
    ];

    static BUY_COST    = 3;
    static SELL_VALUE  = 1;
    static REROLL_COST = 1;
    static MAX_SHOP_LEVEL = 5;
    static MIN_UPGRADE_COST = 5;

    // shopLevel → number of items shown in the shop and max base tier offered
    static SHOP_TIER_TABLE = [
        { level: 1, itemCount: 3, maxBaseTier: 1 },
        { level: 2, itemCount: 4, maxBaseTier: 2 },
        { level: 3, itemCount: 5, maxBaseTier: 3 },
        { level: 4, itemCount: 6, maxBaseTier: 4 },
        { level: 5, itemCount: 7, maxBaseTier: 4 }
    ];

    // Item-rarity thresholds keyed by itemLevel
    static RARITY_BY_LEVEL = [
        { minLevel: 9, rarity: 'legendary' },
        { minLevel: 6, rarity: 'rare'      },
        { minLevel: 3, rarity: 'magic'     },
        { minLevel: 1, rarity: 'normal'    }
    ];

    constructor(game) {
        super(game);
        this.game.itemShopSystem = this;
    }

    // ─── Public services ────────────────────────────────────────────────────────

    // Called by AutobattlerRoundSystem.startPrep().
    openShopForRound() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            this._rollShopOffers(stats);
            this._dispatchToPlayer(stats, 'SHOP_OPENED', 'onShopOpened', {
                round: this.game.state.round,
                offers: stats.shopOffers,
                bought: stats.shopBought,
                shopLevel: stats.shopLevel,
                shopUpgrades: stats.shopUpgrades,
                upgradeCost: this.getShopUpgradeCost(stats),
                pendingAffixChoice: stats.pendingAffixChoice,
                pendingAbilityChoice: stats.pendingAbilityChoice,
                gold: stats.gold,
                inventory: stats.inventory
            });
        }
    }

    // Called by ServerBattlePhaseSystem.startBattle (before combat begins).
    // Tallies leftover gold and accrues 1-2g discount; anything 3+ is lost.
    closeShop() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            const leftover = stats.gold || 0;
            if (leftover === 1 || leftover === 2) {
                stats.shopDiscount = (stats.shopDiscount || 0) + leftover;
            }
            // All leftover gold zeros out — discount carries the 1-2g forward.
            stats.gold = 0;
            stats.shopOffers = [];
            stats.shopBought = [];
        }
    }

    // Buy the item at slotIdx. Costs 3g. Marks the slot bought (reroll won't re-offer).
    // If the player already owns an item of the same baseType, that item is upgraded
    // instead of adding a duplicate.
    // NOTE: name is intentionally bare (no 'submit' prefix) so it doesn't collide
    // with ClientNetworkSystem.submitBuyShopItem (the network sender).
    buyShopItem(numericPlayerId, slotIdx) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (stats.pendingAffixChoice)   return { success: false, reason: 'pending_affix_choice' };
        if (stats.pendingAbilityChoice) return { success: false, reason: 'pending_ability_choice' };

        const offer = stats.shopOffers?.[slotIdx];
        if (!offer) return { success: false, reason: 'invalid_slot' };
        if (stats.shopBought?.[slotIdx]) return { success: false, reason: 'already_bought' };
        if ((stats.gold || 0) < ItemShopSystem.BUY_COST) return { success: false, reason: 'insufficient_gold' };

        stats.gold -= ItemShopSystem.BUY_COST;
        stats.shopBought[slotIdx] = true;

        const result = this._addItemToInventory(stats, offer);
        this._broadcastShopUpdate(stats);
        return { success: true, ...result };
    }

    // Sell an inventory item back to the shop for SELL_VALUE gold. Only items
    // in the inventory can be sold — equipped items must be unequipped first.
    sellInventoryItem(numericPlayerId, itemId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (stats.pendingAffixChoice)   return { success: false, reason: 'pending_affix_choice' };
        if (stats.pendingAbilityChoice) return { success: false, reason: 'pending_ability_choice' };
        const idx = (stats.inventory || []).findIndex(it => it?.id === itemId);
        if (idx < 0) return { success: false, reason: 'not_in_inventory' };

        stats.inventory.splice(idx, 1);
        stats.gold = (stats.gold || 0) + ItemShopSystem.SELL_VALUE;
        this._broadcastShopUpdate(stats);
        return { success: true, refund: ItemShopSystem.SELL_VALUE };
    }

    // Reroll the entire shop, including slots the player already bought from.
    // Bought flags reset to false so every slot becomes purchasable again. Costs 1g.
    rerollShop(numericPlayerId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (stats.pendingAffixChoice)   return { success: false, reason: 'pending_affix_choice' };
        if (stats.pendingAbilityChoice) return { success: false, reason: 'pending_ability_choice' };
        if ((stats.gold || 0) < ItemShopSystem.REROLL_COST) return { success: false, reason: 'insufficient_gold' };

        stats.gold -= ItemShopSystem.REROLL_COST;
        this._rollShopOffers(stats);
        this._broadcastShopUpdate(stats);
        return { success: true };
    }

    // Upgrade shop one level. Costs getShopUpgradeCost(stats) (round-dependent).
    upgradeShop(numericPlayerId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (stats.pendingAffixChoice)   return { success: false, reason: 'pending_affix_choice' };
        if (stats.pendingAbilityChoice) return { success: false, reason: 'pending_ability_choice' };
        if ((stats.shopUpgrades || 0) >= ItemShopSystem.MAX_SHOP_LEVEL - 1) {
            return { success: false, reason: 'max_level' };
        }

        const cost = this.getShopUpgradeCost(stats);
        if ((stats.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };

        stats.gold -= cost;
        stats.shopDiscount = 0;            // discount is fully consumed on use
        stats.shopUpgrades = (stats.shopUpgrades || 0) + 1;
        stats.shopLevel    = (stats.shopUpgrades || 0) + 1;
        // Reset the per-round decay so the NEXT upgrade starts at 20g again.
        stats.shopLastUpgradeRound = this.game.state.round || 1;

        // Expand current offers to match the new item count (don't reroll existing slots)
        this._extendOffersToShopLevel(stats);
        this._broadcastShopUpdate(stats);
        return { success: true };
    }

    // Player chose one of the 3 affix-set options for a pending upgrade.
    // After applying, we automatically chain into the next identification tier
    // so a player who skipped earlier tiers (e.g. went lvl 2 → 6 before identifying)
    // gets the lvl 3 choice followed by the lvl 6 choice back-to-back.
    applyAffixChoice(numericPlayerId, choiceIdx) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        const pending = stats.pendingAffixChoice;
        if (!pending) return { success: false, reason: 'no_pending_choice' };
        const chosenSet = pending.options?.[choiceIdx];
        if (!chosenSet) return { success: false, reason: 'invalid_choice' };

        const found = this._findItemById(stats, pending.itemId);
        if (!found) {
            stats.pendingAffixChoice = null;
            return { success: false, reason: 'item_missing' };
        }
        const item = found.item;
        item.affixes = chosenSet.map(a => ({ ...a }));
        this._applyRarityAndName(item);
        stats.pendingAffixChoice = null;
        // Chain to the next identification tier if the item still needs more.
        this._advanceIdentification(stats, item);
        this._refreshOwnerStats(found);
        this._broadcastShopUpdate(stats);
        return { success: true };
    }

    // Player clicked "Identify" on an unidentified item in the details panel.
    // Kicks off the identification chain — either rolls the next choice or
    // auto-applies the legendary affix.
    requestIdentify(numericPlayerId, itemId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (stats.pendingAffixChoice)   return { success: false, reason: 'pending_affix_choice' };
        if (stats.pendingAbilityChoice) return { success: false, reason: 'pending_ability_choice' };

        const found = this._findItemById(stats, itemId);
        if (!found) return { success: false, reason: 'item_missing' };
        if (!this._needsIdentification(found.item)) {
            return { success: false, reason: 'already_identified' };
        }

        this._advanceIdentification(stats, found.item);
        this._refreshOwnerStats(found);
        this._broadcastShopUpdate(stats);
        return { success: true };
    }

    // Player clicked "Select Ability" on an item. Surfaces the 3 candidate
    // abilities (from the base JSON's `abilities` array) so the client modal
    // can prompt the player to pick one.
    requestAbilityChoice(numericPlayerId, itemId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (stats.pendingAffixChoice)   return { success: false, reason: 'pending_affix_choice' };
        if (stats.pendingAbilityChoice) return { success: false, reason: 'pending_ability_choice' };

        const found = this._findItemById(stats, itemId);
        if (!found) return { success: false, reason: 'item_missing' };
        if (found.item.chosenAbilityId) return { success: false, reason: 'already_chosen' };

        const options = this._abilityOptionsForItem(found.item);
        if (!options.length) return { success: false, reason: 'no_ability_options' };

        stats.pendingAbilityChoice = {
            itemId: found.item.id,
            baseType: found.item.baseType,
            options
        };
        this._broadcastShopUpdate(stats);
        return { success: true };
    }

    // Player chose one of the 3 abilities offered for an item. Records it on
    // the item, live-registers the ability on the owning hero if equipped.
    applyAbilityChoice(numericPlayerId, choiceIdx) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        const pending = stats.pendingAbilityChoice;
        if (!pending) return { success: false, reason: 'no_pending_choice' };
        const chosen = pending.options?.[choiceIdx];
        if (!chosen) return { success: false, reason: 'invalid_choice' };

        const found = this._findItemById(stats, pending.itemId);
        if (!found) {
            stats.pendingAbilityChoice = null;
            return { success: false, reason: 'item_missing' };
        }
        found.item.chosenAbilityId = chosen;
        stats.pendingAbilityChoice = null;

        // If the item is equipped, register the ability on the hero now so it
        // can fire this round.
        if (found.heroEntityId != null && this.game.abilitySystem) {
            const existing = this.game.abilitySystem.entityAbilities?.get(found.heroEntityId) || [];
            const alreadyHas = existing.some(a => a.id === chosen);
            if (!alreadyHas) {
                this.game.abilitySystem.addAbilitiesToUnit(found.heroEntityId, [chosen]);
            }
        }
        this._refreshOwnerStats(found);
        this._broadcastShopUpdate(stats);
        return { success: true };
    }

    // Looks up the base for an item and returns its `abilities` array (or [])
    _abilityOptionsForItem(item) {
        const collections = this.collections || {};
        const baseDicts = [
            collections.weaponBases,
            collections.armorBases,
            collections.charmBases,
            collections.offhandBases
        ];
        for (const dict of baseDicts) {
            const base = dict?.[item.baseType];
            if (base?.abilities && Array.isArray(base.abilities)) return base.abilities;
        }
        return [];
    }

    // Advance an item one identification tier: roll the next affix-choice
    // (lvl 3 → 2 affixes, lvl 6 → 4 more affixes), or auto-apply the legendary
    // affix at lvl 9+ once the lower tiers are done. Idempotent — chaining
    // through applyAffixChoice's repeated call eventually reaches the no-op state.
    _advanceIdentification(stats, item) {
        const level = item.itemLevel || 1;
        const have = (item.affixes || []).length;

        // Lvl 3 tier: needs 2 affixes
        if (have < 2 && level >= 3) {
            const choice = this._rollAffixChoice(item, [], 2);
            if (choice) {
                stats.pendingAffixChoice = choice;
                return;
            }
            // Pool exhausted for this item — fall through to lvl 9 / done
        }
        // Lvl 6 tier: needs 6 affixes total (existing 2 + 4 new)
        if (have < 6 && level >= 6) {
            const existing = (item.affixes || []).map(a => ({ ...a }));
            const choice = this._rollAffixChoice(item, existing, 6 - existing.length);
            if (choice) {
                stats.pendingAffixChoice = choice;
                return;
            }
            // Pool exhausted — item is as identified as it can be at this tier
        }
        // Lvl 9 tier: auto-apply legendary affix (no choice required)
        if (level >= 9 && !(item.affixes || []).some(a => a.isLegendary)) {
            this._applyLegendaryAffix(item);
            this._applyRarityAndName(item);
            return;
        }
        // Fully identified (or pool exhausted) — leave pendingAffixChoice as-is (null)
    }

    // Round-dependent upgrade cost. Base 20g - (round-1), min MIN_UPGRADE_COST,
    // further reduced by any accumulated shopDiscount.
    // Upgrade cost starts at 20g and decreases by 1g per round since the last
    // upgrade (or since round 1 for the first upgrade). Resets to 20g whenever
    // an upgrade is purchased. Bounded by MIN_UPGRADE_COST, further reduced by
    // any accumulated shopDiscount carryover.
    getShopUpgradeCost(stats) {
        const round = this.game.state.round || 1;
        const lastUpgrade = stats?.shopLastUpgradeRound || 1;
        const roundsSinceLastUpgrade = Math.max(0, round - lastUpgrade);
        const base  = Math.max(ItemShopSystem.MIN_UPGRADE_COST, 20 - roundsSinceLastUpgrade);
        const discounted = Math.max(0, base - (stats?.shopDiscount || 0));
        return discounted;
    }

    // ─── Private: shop generation ──────────────────────────────────────────────

    _rollShopOffers(stats, keepBought = false) {
        const tier = this._tierTableFor(stats.shopLevel || 1);
        const count = tier.itemCount;
        const offers = [];
        const bought = [];
        for (let i = 0; i < count; i++) {
            if (keepBought && stats.shopBought?.[i]) {
                offers.push(stats.shopOffers[i]);
                bought.push(true);
            } else {
                offers.push(this._generateShopOffer(tier.maxBaseTier));
                bought.push(false);
            }
        }
        stats.shopOffers = offers;
        stats.shopBought = bought;
    }

    _extendOffersToShopLevel(stats) {
        const tier = this._tierTableFor(stats.shopLevel || 1);
        const targetCount = tier.itemCount;
        while ((stats.shopOffers?.length || 0) < targetCount) {
            stats.shopOffers.push(this._generateShopOffer(tier.maxBaseTier));
            stats.shopBought.push(false);
        }
    }

    // Picks a random itemType + a random base of tier ≤ maxBaseTier, then generates
    // a white-rarity item from that base. Item types: weapon / bodyArmor / charm / offhand.
    _generateShopOffer(maxBaseTier) {
        const itemTypes = ['weapon', 'bodyArmor', 'charm', 'offhand'];
        const itemType  = itemTypes[Math.floor(Math.random() * itemTypes.length)];

        const itemGen = this.game.itemGeneratorSystem;
        if (!itemGen) return null;

        const collections = this.collections || {};
        const basePool = this._basePoolForType(itemType, collections)
            .filter(b => (b.tier ?? 1) <= maxBaseTier);
        if (basePool.length === 0) return null;
        const base = basePool[Math.floor(Math.random() * basePool.length)];

        // generateBaseWeapon handles weapons cleanly; build the others manually.
        if (itemType === 'weapon') {
            const w = itemGen.generateBaseWeapon(base.id);
            if (w) w.itemLevel = 1;
            return w;
        }
        return this._buildBaseItem(itemType, base);
    }

    _basePoolForType(itemType, collections) {
        switch (itemType) {
            case 'weapon':    return Object.values(collections.weaponBases  || {});
            case 'bodyArmor': return Object.values(collections.armorBases   || {});
            case 'charm':     return Object.values(collections.charmBases   || {});
            case 'offhand':   return Object.values(collections.offhandBases || {});
            default: return [];
        }
    }

    _buildBaseItem(itemType, base) {
        const item = {
            id:        `item_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
            itemType,
            baseType:  base.id,
            baseName:  base.name,
            rarity:    'normal',
            name:      base.name,
            affixes:   [],
            baseValue: base.baseArmor || 0,
            itemLevel: 1,
            // chosenAbilityId is the ability the player picked from this base's 3
            // candidate abilities. Stays null until the player taps "Select Ability"
            // on the item details panel.
            chosenAbilityId: null
        };
        if (itemType === 'offhand') {
            item.offhandType = base.offhandType;
        }
        return item;
    }

    // ─── Private: inventory + stacking ─────────────────────────────────────────

    _addItemToInventory(stats, item) {
        if (!Array.isArray(stats.inventory)) stats.inventory = [];

        // Search across BOTH inventory and equipped gear slots so a duplicate
        // upgrades whichever copy the player already has.
        const found = this._findItemByBaseType(stats, item.baseType);
        if (found) {
            const existing = found.item;
            const newLevel = (existing.itemLevel || 1) + 1;
            existing.itemLevel = newLevel;
            this._handleLevelUp(stats, existing, newLevel);
            this._refreshOwnerStats(found);
            return { stacked: true, itemId: existing.id, itemLevel: newLevel };
        }

        // First copy of this base — start at level 1
        item.itemLevel = item.itemLevel || 1;
        item.rarity    = 'normal';
        stats.inventory.push(item);
        return { stacked: false, itemId: item.id, itemLevel: item.itemLevel };
    }

    // Locate an item by baseType across inventory and all of this player's hero
    // equipment slots. Returns { item, location, heroEntityId } or null.
    _findItemByBaseType(stats, baseType) {
        const invItem = (stats.inventory || []).find(it => it.baseType === baseType);
        if (invItem) return { item: invItem, location: 'inventory', heroEntityId: null };
        return this._findEquippedItem(stats, (item) => item?.baseType === baseType);
    }

    _findItemById(stats, itemId) {
        const invItem = (stats.inventory || []).find(it => it.id === itemId);
        if (invItem) return { item: invItem, location: 'inventory', heroEntityId: null };
        return this._findEquippedItem(stats, (item) => item?.id === itemId);
    }

    _findEquippedItem(stats, predicate) {
        const heroEntities = this.game.getEntitiesWith('heroEquipment') || [];
        const gearSlots = ['mainWeapon', 'offhand', 'bodyArmor', 'charm'];
        for (const eid of heroEntities) {
            const rosterInfo = this.game.getComponent(eid, 'heroRosterInfo');
            if (!rosterInfo || rosterInfo.playerId !== stats.playerId) continue;
            const equip = this.game.getComponent(eid, 'heroEquipment');
            if (!equip) continue;
            for (const slot of gearSlots) {
                if (predicate(equip[slot])) {
                    return { item: equip[slot], location: slot, heroEntityId: eid };
                }
            }
        }
        return null;
    }

    // After mutating an item, recompute hero stats and sync equipment back to
    // the roster so the change survives the despawn/respawn cycle each round.
    _refreshOwnerStats(found) {
        if (found?.heroEntityId == null) return;
        const heroStat = this.game.heroStatSystem;
        if (!heroStat) return;
        heroStat.recalculateHeroStats(found.heroEntityId);
        // _syncToRoster is "private by convention" — calling it directly is the
        // cleanest way to persist live heroEquipment mutations back to the roster.
        if (typeof heroStat._syncToRoster === 'function') {
            heroStat._syncToRoster(found.heroEntityId);
        }
    }

    // Called whenever an item's itemLevel changes. Rarity always reflects the
    // current level (lvl 3+ shows magic, etc.) but new affixes do NOT roll
    // automatically — the player clicks "Identify" from the item details panel
    // when they're ready, avoiding modal collisions during shop browsing.
    _handleLevelUp(stats, item, newLevel) {
        this._applyRarityAndName(item);
    }

    // True when the item has reached an identify threshold but doesn't yet
    // have the full affix count for its current level.
    _needsIdentification(item) {
        const level = item.itemLevel || 1;
        const have = (item.affixes || []).length;
        if (level >= 9) return have < 7;
        if (level >= 6) return have < 6;
        if (level >= 3) return have < 2;
        return false;
    }

    // Rolls 3 distinct option sets of `newCount` random affixes each, prepended
    // with the existing affixes the player already chose. Returns the pending
    // payload, or null if the affix pool can't add ANY new affixes (so the
    // identify chain can stop instead of looping forever on an empty pool).
    _rollAffixChoice(item, existingAffixes, newCount) {
        const itemGen = this.game.itemGeneratorSystem;
        if (!itemGen) return null;

        const pool = this._affixPoolForItem(item);
        if (pool.length === 0) return null;

        // How many affixes are actually still available (not already on the item)?
        const usedIds = new Set(existingAffixes.map(a => a.id));
        const availableCount = pool.filter(a => !usedIds.has(a.id)).length;
        if (availableCount === 0) return null;          // pool exhausted

        // Cap requested newCount to what's actually available; this also keeps
        // options consistent when the pool is smaller than the requested tier.
        const effectiveNewCount = Math.min(newCount, availableCount);

        const options = [];
        const seenSignatures = new Set();
        let attempts = 0;
        while (options.length < 3 && attempts < 30) {
            attempts++;
            const picked = this._pickRandomAffixes(pool, effectiveNewCount, existingAffixes);
            const sig = picked.map(a => a.id).sort().join('|');
            if (seenSignatures.has(sig)) continue;
            seenSignatures.add(sig);
            options.push([...existingAffixes, ...picked]);
        }
        // Defensive: if we couldn't get 3 distinct, pad with whatever we have
        while (options.length < 3 && options.length > 0) options.push([...options[0]]);

        return {
            itemId: item.id,
            baseType: item.baseType,
            newLevel: item.itemLevel,
            options
        };
    }

    // Pool of affixes that can roll on this item, filtered by itemType.
    _affixPoolForItem(item) {
        const all = Object.values(this.collections?.itemAffixes || {});
        // itemType can come back as a numeric enum index after hero respawn (the
        // heroEquipment component runs through ComponentGenerator.deepMerge which
        // auto-converts 'weapon' → 0 via the data/enums/itemType.json enum).
        // Normalize back to the string form before filtering.
        const itemType = this._normalizeItemType(item.itemType);
        const offhandType = this._normalizeOffhandType(item.offhandType);
        return all.filter(a => {
            if ((a.affixGroup || 'item') !== 'item') return false;
            if (!Array.isArray(a.itemTypes)) return false;
            if (itemType === 'offhand') {
                return a.itemTypes.includes(`offhand-${offhandType}`);
            }
            return a.itemTypes.includes(itemType);
        });
    }

    _normalizeItemType(value) {
        if (typeof value === 'string') return value;
        if (typeof value === 'number') {
            return this.collections?.enums?.itemType?.enum?.[value] || null;
        }
        return null;
    }

    _normalizeOffhandType(value) {
        if (typeof value === 'string') return value;
        if (typeof value === 'number') {
            return this.collections?.enums?.offhandSubtype?.enum?.[value] || null;
        }
        return null;
    }

    // Picks `count` distinct affixes from the pool, excluding any already-used affix ids.
    _pickRandomAffixes(pool, count, existingAffixes) {
        const usedIds = new Set((existingAffixes || []).map(a => a.id));
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        const picked = [];
        for (const a of shuffled) {
            if (picked.length >= count) break;
            if (usedIds.has(a.id)) continue;
            usedIds.add(a.id);
            picked.push({
                id:       a.id,
                label:    a.label,
                stat:     a.stat,
                value:    Math.round(a.min + Math.random() * (a.max - a.min)),
                isPrefix: a.isPrefix
            });
        }
        return picked;
    }

    // Pulls the per-base legendary affix from the base JSON if present.
    // Falls back to a strong rolled affix from the item's pool.
    _applyLegendaryAffix(item) {
        const baseCollections = this.collections || {};
        const baseDicts = [
            baseCollections.weaponBases,
            baseCollections.armorBases,
            baseCollections.charmBases,
            baseCollections.offhandBases
        ];
        let base = null;
        for (const dict of baseDicts) {
            if (dict && dict[item.baseType]) { base = dict[item.baseType]; break; }
        }
        const legendaryAffix = base?.legendaryAffix
            ? { ...base.legendaryAffix }
            : this._fallbackLegendaryAffix(item);
        if (!legendaryAffix) return;
        // Mark + dedupe in case the same id somehow already exists
        legendaryAffix.isLegendary = true;
        item.affixes = (item.affixes || []).filter(a => !a.isLegendary);
        item.affixes.push(legendaryAffix);
    }

    _fallbackLegendaryAffix(item) {
        const pool = this._affixPoolForItem(item).filter(a => a.isPrefix);
        if (pool.length === 0) return null;
        const a = pool[Math.floor(Math.random() * pool.length)];
        return {
            id:       `legendary_${item.baseType}`,
            label:    'Legendary',
            stat:     a.stat,
            value:    a.max * 2,
            isPrefix: true
        };
    }

    _applyRarityAndName(item) {
        item.rarity = this._rarityForLevel(item.itemLevel || 1);
        const prefix = (item.affixes || []).find(a => a.isPrefix);
        const suffix = (item.affixes || []).find(a => !a.isPrefix);
        let name = item.baseName;
        if (prefix) name = `${prefix.label} ${name}`;
        if (suffix) name = `${name} ${suffix.label}`;
        if (item.rarity === 'legendary') name = `${name} (Legendary)`;
        item.name = name.trim();
    }

    _rarityForLevel(level) {
        for (const row of ItemShopSystem.RARITY_BY_LEVEL) {
            if (level >= row.minLevel) return row.rarity;
        }
        return 'normal';
    }

    _tierTableFor(shopLevel) {
        const clamped = Math.max(1, Math.min(ItemShopSystem.MAX_SHOP_LEVEL, shopLevel));
        return ItemShopSystem.SHOP_TIER_TABLE.find(t => t.level === clamped)
            || ItemShopSystem.SHOP_TIER_TABLE[0];
    }

    _getStats(numericPlayerId) {
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.playerId === numericPlayerId) return stats;
        }
        return null;
    }

    _broadcastShopUpdate(stats) {
        this._dispatchToPlayer(stats, 'SHOP_UPDATE', 'onShopUpdate', {
            offers: stats.shopOffers,
            bought: stats.shopBought,
            shopLevel: stats.shopLevel,
            shopUpgrades: stats.shopUpgrades,
            upgradeCost: this.getShopUpgradeCost(stats),
            pendingAffixChoice: stats.pendingAffixChoice,
            pendingAbilityChoice: stats.pendingAbilityChoice,
            gold: stats.gold,
            inventory: stats.inventory
        });
    }

    // Sends a network event for multiplayer + fires the local event so in-process
    // listeners (e.g. PlacementUISystem in local mode) receive it too.
    _dispatchToPlayer(stats, networkEvent, localEvent, payload) {
        const fullPayload = { ...payload, targetPlayerId: stats.playerId };
        this.call.sendToPlayer(stats.playerId, networkEvent, fullPayload);
        this.game.triggerEvent(localEvent, fullPayload);
    }
}
