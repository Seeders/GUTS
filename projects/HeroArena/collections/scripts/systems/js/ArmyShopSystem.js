// Army-building autobattler shop. SERVER-AUTHORITATIVE.
//
// Each prep phase every player is offered N (=5) purchasable choices. A player can
// BUY a choice (consumes that slot) or pay gold to REROLL all choices. Offers are a
// mix of units, upgrades, and abilities; upgrades/abilities only enter the pool when
// the player owns a unit that satisfies their stat/weapon/level requirements.
//
// Buying a unit also UNLOCKS it: the player may re-buy copies any time from the
// unlocked-units panel (see buyUnlockedUnit). Purchased units join playerStats.heroRoster
// (the persistent army) and, if bought during placement, spawn immediately for the
// current round via HeroRosterSystem.spawnPurchasedUnit; they respawn every round after.
//
// Phase 1 ships units-only offers. Upgrades/abilities (and their eligibility gating via
// the matcher below) arrive in later phases but the matcher is implemented now.
class ArmyShopSystem extends GUTS.BaseSystem {

    static services = [
        'generateOffersForRound',
        'buyOffer',
        'rerollOffers',
        'buyUnlockedUnit',
        'buyUnitTech',
        'getShopStateForPlayer',
        'getEligibleItems',
        'applyArmyUpgrades',
        'applyArmyAbilities',
        'grantSingleTargetAbility',
        'getEconomyEffects',
        'sellUnit'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'broadcastToRoom',
        'spawnPurchasedUnit',
        'addAbilitiesToUnit',
        'townhallLevel',
        'getOwnedBuildingIds',
        'getOwnedBuildingArchetypes',
        'upgradeTownHall',
        'placeBuildingAuto',
        'getAIPlayerIds',
        'removeRosterEntry'
    ];

    static OFFER_COUNT = 5;
    static REROLL_BASE_COST = 2;     // escalates +1 per reroll within a round
    static SELL_REFUND_PCT = 0.5;    // base fraction of a unit's shop cost refunded on sell
    // Shop runs a small-number economy (income is 20g/round). A unit/upgrade/ability's
    // raw `value` is divided by this to get its shop price, so a few buys fit one round.
    // Tune this single knob to make the whole shop cheaper/pricier.
    static SHOP_COST_DIVISOR = 5;

    // Convert a raw `value` into a shop price (min 1g).
    static shopCost(rawValue) {
        return Math.max(1, Math.ceil((rawValue || 0) / ArmyShopSystem.SHOP_COST_DIVISOR));
    }

    // ─── Unit tier + archetype (drives building-gated offers) ───────────────────
    // Units never offered in the shop (workers, summons, transforms, unbalanced legendaries).
    static UNIT_EXCLUDE = new Set(['peasant', '4_archmage', 'sentry', 'dragon_red_flying', '0_skeleton']);
    // Tier-3 "legendary" units and the archetype building(s) that unlock them.
    static T3_UNITS = {
        dragon_red:        ['int'],   // Mage Tower
        '4_ancientTreant': ['dex'],   // Hunting Lodge
        '0_golemStone':    ['str'],   // Barracks
        '0_golemFire':     ['int'],   // Mage Tower
        '0_golemIce':      ['int'],   // Mage Tower
        ballista:          ['str']    // Barracks
    };

    // Tier of a unit id: 1, 2, 3, or null (= not shop-offerable).
    static unitTier(id) {
        if (ArmyShopSystem.UNIT_EXCLUDE.has(id)) return null;
        if (ArmyShopSystem.T3_UNITS[id]) return 3;
        if (/^1_/.test(id)) return 1;
        if (/^2_/.test(id)) return 2;
        return null;
    }

    // Archetypes a unit belongs to (str/dex/int), derived from its id prefix letters or the
    // T3 special table. Used to require the matching archetype building for higher tiers.
    static unitArchetypes(id) {
        if (ArmyShopSystem.T3_UNITS[id]) return ArmyShopSystem.T3_UNITS[id];
        const m = id.match(/^[12]_([a-z]+)_/);
        if (!m) return [];
        const map = { s: 'str', d: 'dex', i: 'int' };
        return m[1].split('').map(c => map[c]).filter(Boolean);
    }

    // Fallback class→spawnType for the 6 starter classes (roster entries also carry spawnType).
    static CLASS_SPAWN_MAP = {
        barbarian:  '1_s_barbarian',
        apprentice: '1_i_apprentice',
        archer:     '1_d_archer',
        acolyte:    '1_is_acolyte',
        soldier:    '1_sd_soldier',
        scout:      '1_di_scout'
    };

    constructor(game) {
        super(game);
        this.game.armyShopSystem = this;
    }

    // ─── Public services ──────────────────────────────────────────────────────

    // Called by AutobattlerRoundSystem.startPrep (after spawnHeroesForRound) every round.
    generateOffersForRound() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        // Reseed the shop strand per round from the game seed so offer generation
        // (and headless simulation as a whole) is reproducible for a given seed.
        // Server-authoritative: clients never run this, so it has no lockstep impact.
        this.game.rng.strand('shop').reseed(GUTS.SeededRandom.combineSeed(
            this.game.state.gameSeed || 1,
            this.game.state.round || 1,
            GUTS.SeededRandom.hashString('shop')
        ));
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            stats.rerollCount = 0;
            stats.currentOffers = this._buildOffers(stats);
            this._broadcastShop(stats);
        }
        this._aiAutoBuy();
    }

    // Buy the offer at `offerIndex`. Consumes that slot.
    buyOffer(numericPlayerId, offerIndex) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };

        const offer = stats.currentOffers?.[offerIndex];
        if (!offer || offer.consumed) return { success: false, reason: 'bad_offer' };
        if ((stats.gold || 0) < offer.cost) return { success: false, reason: 'insufficient_gold' };

        // Single-target abilities defer purchase until a target unit is chosen
        // (gold is charged on confirm — see grantSingleTargetAbility). The slot
        // is held pending so it can't be bought twice.
        if (offer.kind === 'ability' && offer.grantMode === 'single') {
            stats.pendingAbility = { abilityId: offer.id, offerIndex, cost: offer.cost };
            return {
                success: true,
                requiresTarget: true,
                pendingAbilityId: offer.id,
                state: this.getShopStateForPlayer(numericPlayerId)
            };
        }

        // Buildings auto-place near the Town Hall on purchase (no placement mode), exactly
        // like a purchased unit auto-spawns. The building is then draggable for the rest of
        // this round. Charge only after a successful placement.
        if (offer.kind === 'building') {
            const res = this.call.placeBuildingAuto?.(numericPlayerId, offer.id);
            if (!res?.success) return { success: false, reason: res?.reason || 'place_failed' };
            stats.gold -= offer.cost;
            offer.consumed = true;
            this._broadcastShop(stats);
            return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
        }

        // Town Hall upgrade — instant, in-place (no placement needed).
        if (offer.kind === 'townhall_upgrade') {
            stats.gold -= offer.cost;
            offer.consumed = true;
            const res = this.call.upgradeTownHall?.(numericPlayerId);
            if (!res?.success) {
                stats.gold += offer.cost;
                offer.consumed = false;
                return { success: false, reason: res?.reason || 'upgrade_failed' };
            }
            this._broadcastShop(stats);
            return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
        }

        stats.gold -= offer.cost;
        offer.consumed = true;

        if (offer.kind === 'unit') {
            this._addUnitToArmy(stats, offer.id);
        } else if (offer.kind === 'upgrade') {
            this._addUpgrade(stats, offer.id);
        } else if (offer.kind === 'ability') {
            this._addAbility(stats, offer.id);   // team / archetype
        }

        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // Finalize a grantMode:'single' ability purchase by assigning it to one owned unit.
    // rosterIndex < 0 (or null) cancels the pending purchase with no charge.
    grantSingleTargetAbility(numericPlayerId, shopAbilityId, rosterIndex) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        const pending = stats.pendingAbility;
        if (!pending || pending.abilityId !== shopAbilityId) {
            return { success: false, reason: 'no_pending' };
        }
        // Cancel
        if (rosterIndex == null || rosterIndex < 0) {
            stats.pendingAbility = null;
            return { success: true, cancelled: true, state: this.getShopStateForPlayer(numericPlayerId) };
        }
        const entry = stats.heroRoster?.[rosterIndex];
        if (!entry) return { success: false, reason: 'bad_target' };
        if ((stats.gold || 0) < pending.cost) return { success: false, reason: 'insufficient_gold' };

        const sdef = this.collections.shopAbilities?.[shopAbilityId];
        if (!sdef) return { success: false, reason: 'no_ability' };

        stats.gold -= pending.cost;
        const offer = stats.currentOffers?.[pending.offerIndex];
        if (offer) offer.consumed = true;
        stats.pendingAbility = null;

        if (!Array.isArray(entry.grantedAbilities)) entry.grantedAbilities = [];
        if (!entry.grantedAbilities.includes(sdef.abilityId)) entry.grantedAbilities.push(sdef.abilityId);

        // Re-apply abilities to the live unit at this roster index, if spawned.
        this._reapplyAbilitiesForPlayer(stats, rosterIndex);
        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // Re-buy a copy of an already-unlocked unit (no offer slot needed).
    buyUnlockedUnit(numericPlayerId, unitTypeId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        if (!this._candidateUnitIds(stats).includes(unitTypeId)) {
            return { success: false, reason: 'not_available' };
        }
        const def = this.collections.units?.[unitTypeId];
        if (!def) return { success: false, reason: 'no_unit' };
        const cost = ArmyShopSystem.shopCost(def.value);
        if ((stats.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };

        stats.gold -= cost;
        this._addUnitToArmy(stats, unitTypeId);
        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // ─── Unit techs (Mechabellum-style per-type technologies) ───────────────────

    // Buy a tech for a unit TYPE. Effects apply to every current and future unit
    // of that type: stat techs modify live units immediately and re-apply on each
    // respawn; ability techs activate one of the unit's predefined abilities;
    // unlock techs add a higher-tier unit to the buyable roster.
    buyUnitTech(numericPlayerId, unitId, techId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };

        const techDef = (this.collections.unitTechs?.[unitId]?.techs || []).find(t => t.id === techId);
        if (!techDef) return { success: false, reason: 'no_tech' };

        if (!stats.unitTechs) stats.unitTechs = {};
        const owned = stats.unitTechs[unitId] || [];
        if (owned.includes(techId)) return { success: false, reason: 'already_owned' };

        // Techs require owning at least one unit of the type (you tech what you field)
        const ownsType = (stats.heroRoster || []).some(e => this._resolveSpawnType(e) === unitId);
        if (!ownsType) return { success: false, reason: 'no_unit_of_type' };

        const cost = techDef.cost || 10;
        if ((stats.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };

        stats.gold -= cost;
        stats.unitTechs[unitId] = [...owned, techId];

        if (techDef.statModifiers) {
            this._applyTechToLiveUnits(stats, unitId, techDef);
        }
        if (techDef.unlockAbility) {
            this._reapplyAbilitiesForUnitType(stats, unitId);
        }
        if (techDef.unlockUnit) {
            if (!Array.isArray(stats.tierUnlocks)) stats.tierUnlocks = [];
            if (!stats.tierUnlocks.includes(techDef.unlockUnit)) {
                stats.tierUnlocks.push(techDef.unlockUnit);
            }
        }

        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // Apply one tech's stat modifiers to all live units of the type.
    _applyTechToLiveUnits(stats, unitId, techDef) {
        for (const eid of (this.game.getEntitiesWith?.('heroRosterInfo') || [])) {
            const info = this.game.getComponent(eid, 'heroRosterInfo');
            if (!info || info.playerId !== stats.playerId) continue;
            const entry = stats.heroRoster?.[info.rosterIndex];
            if (!entry || this._resolveSpawnType(entry) !== unitId) continue;
            this._applyStatMods(
                this.game.getComponent(eid, 'combat'),
                this.game.getComponent(eid, 'health'),
                techDef.statModifiers
            );
        }
    }

    // AI: buy the first affordable un-owned tech for any fielded unit type.
    _aiBuyOneTech(stats, pid) {
        const fielded = [...new Set((stats.heroRoster || [])
            .map(e => this._resolveSpawnType(e)))];
        for (const unitId of fielded) {
            const owned = new Set(stats.unitTechs?.[unitId] || []);
            for (const t of (this.collections.unitTechs?.[unitId]?.techs || [])) {
                if (owned.has(t.id)) continue;
                if ((stats.gold || 0) < (t.cost || 10)) continue;
                if (this.buyUnitTech(pid, unitId, t.id)?.success) return true;
            }
        }
        return false;
    }

    _reapplyAbilitiesForUnitType(stats, unitId) {
        for (const eid of (this.game.getEntitiesWith?.('heroRosterInfo') || [])) {
            const info = this.game.getComponent(eid, 'heroRosterInfo');
            if (!info || info.playerId !== stats.playerId) continue;
            const entry = stats.heroRoster?.[info.rosterIndex];
            if (!entry || this._resolveSpawnType(entry) !== unitId) continue;
            this.applyArmyAbilities(eid);
        }
    }

    // Spend gold to discard the current offers and roll a fresh set.
    rerollOffers(numericPlayerId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        const cost = this.getRerollCost(stats);
        if ((stats.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };

        stats.gold -= cost;
        stats.rerollCount = (stats.rerollCount || 0) + 1;
        stats.currentOffers = this._buildOffers(stats);
        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    getRerollCost(stats) {
        const base = ArmyShopSystem.REROLL_BASE_COST + (stats?.rerollCount || 0);
        const discount = this.getEconomyEffects(stats).rerollDiscount || 0;
        return Math.max(1, base - discount);
    }

    // Aggregate a player's owned economy upgrades (Town Hall tree) into a single
    // effects object consumed by the income/reroll/sell/mine systems. interestPer is
    // the threshold to earn +1 (smallest owned); the rest sum across owned upgrades.
    getEconomyEffects(stats) {
        const eff = {
            interestPer: 0, interestCap: 0, winStreakGold: 0, lossStreakGold: 0,
            flatIncome: 0, rerollDiscount: 0, sellRefundPct: 0, mineIncomeBonus: 0
        };
        for (const id of (stats?.ownedUpgrades || [])) {
            const e = this.collections.upgrades?.[id]?.economy;
            if (!e) continue;
            if (e.interestPer != null) {
                eff.interestPer = eff.interestPer ? Math.min(eff.interestPer, e.interestPer) : e.interestPer;
            }
            eff.interestCap     += e.interestCap     || 0;
            eff.winStreakGold   += e.winStreakGold   || 0;
            eff.lossStreakGold  += e.lossStreakGold  || 0;
            eff.flatIncome      += e.flatIncome      || 0;
            eff.rerollDiscount  += e.rerollDiscount  || 0;
            eff.sellRefundPct   += e.sellRefundPct   || 0;
            eff.mineIncomeBonus += e.mineIncomeBonus || 0;
        }
        return eff;
    }

    // Sell a roster unit back for a partial refund (placement phase only). Removes the
    // roster entry + despawns its live unit via HeroRosterSystem (which keeps its index
    // maps consistent); the unit stays in unlockedUnits so it can be re-bought.
    sellUnit(numericPlayerId, rosterIndex) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        const entry = stats.heroRoster?.[rosterIndex];
        if (!entry) return { success: false, reason: 'bad_index' };
        // Deployment is permanent: a unit that has fought a battle can't be sold —
        // selling is only an undo for this prep's purchases.
        if (entry.lastPosition) return { success: false, reason: 'deployment_locked' };

        const def = this.collections.units?.[this._resolveSpawnType(entry)] || {};
        const pct = ArmyShopSystem.SELL_REFUND_PCT + (this.getEconomyEffects(stats).sellRefundPct || 0);
        const refund = Math.floor(ArmyShopSystem.shopCost(def.value) * pct);

        const res = this.call.removeRosterEntry?.(numericPlayerId, rosterIndex);
        if (!res?.success) return { success: false, reason: res?.reason || 'remove_failed' };

        stats.gold = (stats.gold || 0) + refund;
        this._broadcastShop(stats);
        return { success: true, refund, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    getShopStateForPlayer(numericPlayerId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return null;
        return {
            playerId:   stats.playerId,
            offers:     stats.currentOffers || [],
            // "Your Units" panel: every unit the player can currently buy, gated by
            // their owned archetype buildings + Town Hall tier (not just previously
            // bought ones — units are no longer unlocked through the shop).
            unlocked:   this._candidateUnitIds(stats).map(id => {
                const def = this.collections.units?.[id] || {};
                return { id, title: def.title || id, cost: ArmyShopSystem.shopCost(def.value), icon: def.icon || null };
            }),
            rerollCost: this.getRerollCost(stats),
            gold:       stats.gold || 0,
            // For the building upgrade-tree modal: which tree nodes are already bought.
            ownedUpgrades: [...(stats.ownedUpgrades || [])],
            // Per-unit techs owned: { unitId: [techId, ...] } (tech defs come from collections)
            unitTechs: JSON.parse(JSON.stringify(stats.unitTechs || {})),
            // Which unit types the player currently fields (tech gating in the UI)
            ownedUnitTypes: [...new Set((stats.heroRoster || []).map(e => this._resolveSpawnType(e)))]
        };
    }

    // ─── Eligibility matcher (pure-ish; used by upgrade/ability pools + tests) ──

    // One profile per owned army unit: its stats, weapon type and level.
    ownedUnitProfiles(stats) {
        return (stats?.heroRoster || []).map(entry => {
            const spawnType = this._resolveSpawnType(entry);
            const def = this.collections.units?.[spawnType] || {};
            return {
                heroClass:  entry.heroClass,
                spawnType,
                str:        def.strength || 0,
                dex:        def.dexterity || 0,
                int:        def.intelligence || 0,
                weaponType: def.weaponType || 'none',
                level:      entry.level || this._calcLevel(entry.roundsPlayed || 0)
            };
        });
    }

    // A single requirement combo: AND across the fields it defines.
    matchesCombo(profile, combo) {
        if (!combo) return true;
        const meetsMin = (cond, val) => !cond || cond.min == null || val >= cond.min;
        if (!meetsMin(combo.str, profile.str)) return false;
        if (!meetsMin(combo.dex, profile.dex)) return false;
        if (!meetsMin(combo.int, profile.int)) return false;
        if (!meetsMin(combo.level, profile.level)) return false;
        if (Array.isArray(combo.weaponType) && combo.weaponType.length) {
            if (!combo.weaponType.includes(profile.weaponType)) return false;
        }
        return true;
    }

    // requirements is an array of combos (OR). Empty/absent ⇒ always eligible.
    isEligible(profiles, requirements) {
        if (!requirements || requirements.length === 0) return true;
        return requirements.some(combo => profiles.some(p => this.matchesCombo(p, combo)));
    }

    // Returns the upgrade/ability ids currently eligible for this player (later phases).
    getEligibleItems(numericPlayerId) {
        const stats = this._getStats(numericPlayerId);
        const profiles = this.ownedUnitProfiles(stats);
        const upgrades = Object.entries(this.collections.upgrades || {})
            .filter(([, def]) => this.isEligible(profiles, def.requirements))
            .map(([id]) => id);
        const abilities = Object.entries(this.collections.shopAbilities || {})
            .filter(([, def]) => this.isEligible(profiles, def.requirements))
            .map(([id]) => id);
        return { upgrades, abilities };
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    // Weighted pool of units + eligible per-type upgrades (+ abilities, later phase).
    // Units are weighted higher so they dominate the early offers.
    // Mechabellum redesign: the random 5-offer shop is retired. All spending is
    // deterministic — units from the roster panel, per-unit techs, squad level-ups.
    // The one random decision per round is the reinforcement card pick (phase 5),
    // which replaces this entirely. Returning [] keeps the offer plumbing alive
    // for the transition without ever presenting slot-machine offers.
    _buildOffers(stats) {
        return [];
    }

    // upgradeId -> [prerequisite upgradeIds], built once from the upgradeTrees collection.
    // Upgrades absent from every tree are unconstrained.
    _treePrereqs() {
        if (this._treePrereqCache) return this._treePrereqCache;
        const map = {};
        for (const tree of Object.values(this.collections.upgradeTrees || {})) {
            for (const branch of (tree.branches || [])) {
                for (const node of (branch.nodes || [])) {
                    if (node?.upgrade) map[node.upgrade] = node.requires || [];
                }
            }
        }
        this._treePrereqCache = map;
        return map;
    }

    // An upgrade enters the shop pool only once every prerequisite node is owned.
    // No tree entry / no prereqs → unlocked by default (preserves non-tree upgrades).
    _treeUnlocked(stats, upgradeId) {
        const prereqs = this._treePrereqs()[upgradeId];
        if (!prereqs || prereqs.length === 0) return true;
        const owned = new Set(stats.ownedUpgrades || []);
        return prereqs.every(r => owned.has(r));
    }

    // Next Town Hall tier the player can upgrade to (townHall→keep→castle), or null.
    _townhallUpgradeId(stats) {
        const chain = { townHall: 'keep', keep: 'castle' };
        for (const b of (stats.buildings || [])) {
            if (chain[b.buildingId]) return chain[b.buildingId];
        }
        return null;
    }

    // Weighted sampling without replacement (distinct by kind+id); pads with repeats
    // if the candidate set is smaller than the offer count.
    _sampleOffers(candidates, count) {
        const remaining = candidates.slice();
        const offers = [];
        const shopRng = this.game.rng.strand('shop');
        const pickWeighted = (list) => {
            const total = list.reduce((s, c) => s + (c.weight || 1), 0);
            let r = shopRng.next() * total;
            for (let i = 0; i < list.length; i++) {
                r -= (list[i].weight || 1);
                if (r <= 0) return i;
            }
            return list.length - 1;
        };
        // Distinct offers only — never pad with duplicates. Padding could offer the
        // same one-time upgrade twice (and economy upgrades stack, so a double-buy
        // would double its effect). Fewer than `count` candidates → a smaller shop.
        for (let i = 0; i < count && remaining.length; i++) {
            const idx = pickWeighted(remaining);
            const pick = remaining[idx];
            remaining.splice(idx, 1);
            offers.push(this._makeOffer(pick.kind, pick.id));
        }
        return offers;
    }

    _makeOffer(kind, id) {
        if (kind === 'upgrade') {
            const def = this.collections.upgrades?.[id] || {};
            return { kind: 'upgrade', id, title: def.title || id, cost: ArmyShopSystem.shopCost(def.value),
                     icon: def.icon || null, consumed: false };
        }
        if (kind === 'ability') {
            const def = this.collections.shopAbilities?.[id] || {};
            return { kind: 'ability', id, title: def.title || id, cost: ArmyShopSystem.shopCost(def.value),
                     icon: def.icon || null, grantMode: def.grantMode || 'archetype', consumed: false };
        }
        if (kind === 'building') {
            const def = this.collections.buildings?.[id] || {};
            return { kind: 'building', id, title: def.title || id, cost: ArmyShopSystem.shopCost(def.value),
                     icon: def.icon || null, consumed: false };
        }
        if (kind === 'townhall_upgrade') {
            const def = this.collections.buildings?.[id] || {};
            return { kind: 'townhall_upgrade', id, title: 'Upgrade to ' + (def.title || id),
                     cost: ArmyShopSystem.shopCost(def.value), icon: def.icon || null, consumed: false };
        }
        return this._makeUnitOffer(id);
    }

    // Units the player can buy (Mechabellum-style — no buildings):
    //   • Every tier-1 unit is available from round 1.
    //   • Tier-2 / tier-3 units require an explicit unlock recorded on
    //     stats.tierUnlocks (granted by unit techs / reinforcement cards in
    //     later phases).
    _candidateUnitIds(stats) {
        const unlocked = new Set(stats.tierUnlocks || []);
        const units = this.collections.units || {};
        const out = [];
        for (const id of Object.keys(units)) {
            const tier = ArmyShopSystem.unitTier(id);
            if (tier == null) continue;
            if (tier === 1 || unlocked.has(id)) out.push(id);
        }
        return out;
    }

    _makeUnitOffer(unitId) {
        const def = this.collections.units?.[unitId] || {};
        return {
            kind: 'unit',
            id: unitId,
            title: def.title || unitId,
            cost: ArmyShopSystem.shopCost(def.value),
            icon: def.icon || null,
            consumed: false
        };
    }

    _addUnitToArmy(stats, unitId) {
        if (!Array.isArray(stats.heroRoster)) stats.heroRoster = [];
        if (!Array.isArray(stats.unlockedUnits)) stats.unlockedUnits = [];
        const heroClass = this._deriveHeroClass(unitId);
        stats.heroRoster.push({ heroClass, spawnType: unitId, roundsPlayed: 0, level: 1, xp: 0 });
        const rosterIndex = stats.heroRoster.length - 1;
        if (!stats.unlockedUnits.includes(unitId)) stats.unlockedUnits.push(unitId);
        // Spawn immediately for the current prep so the player can position it now.
        if (this._inPlacement()) {
            this.call.spawnPurchasedUnit(stats.playerId, rosterIndex);
        }
    }

    // Record a per-type upgrade and apply it immediately to already-spawned matching units.
    _addUpgrade(stats, upgradeId) {
        if (!Array.isArray(stats.ownedUpgrades)) stats.ownedUpgrades = [];
        stats.ownedUpgrades.push(upgradeId);   // repeats allowed → stacks
        this._applyUpgradeToLiveUnits(stats, upgradeId);
    }

    // Apply ALL of a player's owned upgrades + unit techs to one freshly-spawned
    // entity. Called by HeroRosterSystem at spawn (entity is "clean").
    applyArmyUpgrades(entityId) {
        const info = this.game.getComponent(entityId, 'heroRosterInfo');
        if (!info) return;
        const stats = this._getStats(info.playerId);
        const entry = stats?.heroRoster?.[info.rosterIndex];
        if (!entry) return;
        const profile = this._profileForEntry(entry);
        const combat = this.game.getComponent(entityId, 'combat');
        const health = this.game.getComponent(entityId, 'health');
        for (const upgradeId of (stats.ownedUpgrades || [])) {
            const up = this.collections.upgrades?.[upgradeId];
            if (!up?.statModifiers) continue;
            if (!this.matchesCombo(profile, up.target || {})) continue;
            this._applyStatMods(combat, health, up.statModifiers);
        }
        // Unit techs: stat techs for this unit's type re-apply on every respawn.
        const spawnType = this._resolveSpawnType(entry);
        const ownedTechs = new Set(stats.unitTechs?.[spawnType] || []);
        for (const t of (this.collections.unitTechs?.[spawnType]?.techs || [])) {
            if (t.statModifiers && ownedTechs.has(t.id)) {
                this._applyStatMods(combat, health, t.statModifiers);
            }
        }
    }

    // Apply a single just-bought upgrade to this player's already-spawned matching units.
    _applyUpgradeToLiveUnits(stats, upgradeId) {
        const up = this.collections.upgrades?.[upgradeId];
        if (!up?.statModifiers) return;
        const ents = this.game.getEntitiesWith?.('heroRosterInfo') || [];
        for (const eid of ents) {
            const info = this.game.getComponent(eid, 'heroRosterInfo');
            if (!info || info.playerId !== stats.playerId) continue;
            const entry = stats.heroRoster?.[info.rosterIndex];
            if (!entry) continue;
            if (!this.matchesCombo(this._profileForEntry(entry), up.target || {})) continue;
            this._applyStatMods(
                this.game.getComponent(eid, 'combat'),
                this.game.getComponent(eid, 'health'),
                up.statModifiers
            );
        }
    }

    // statModifiers: { <field>: { add?, pct? } }. maxHP maps to the health component;
    // everything else maps to the combat component.
    _applyStatMods(combat, health, mods) {
        for (const [field, spec] of Object.entries(mods || {})) {
            if (field === 'maxHP') {
                if (!health) continue;
                const base = health.max || 0;
                let v = base + (spec.add || 0) + base * (spec.pct || 0);
                const ratio = health.max ? (health.current / health.max) : 1;
                health.max = v;
                health.current = Math.round(v * ratio);
                continue;
            }
            if (!combat) continue;
            const base = combat[field] || 0;
            combat[field] = base + (spec.add || 0) + base * (spec.pct || 0);
        }
    }

    _profileForEntry(entry) {
        const def = this.collections.units?.[this._resolveSpawnType(entry)] || {};
        return {
            str: def.strength || 0,
            dex: def.dexterity || 0,
            int: def.intelligence || 0,
            weaponType: def.weaponType || 'none',
            level: this._calcLevel(entry.roundsPlayed || 0)
        };
    }

    // ─── Abilities ──────────────────────────────────────────────────────────────

    // team / archetype ability: record it and re-grant abilities to live units now.
    _addAbility(stats, shopAbilityId) {
        const sdef = this.collections.shopAbilities?.[shopAbilityId];
        if (!sdef) return;
        if (!Array.isArray(stats.ownedAbilities)) stats.ownedAbilities = [];
        stats.ownedAbilities.push({ abilityId: shopAbilityId, grantMode: sdef.grantMode || 'archetype' });
        this._reapplyAbilitiesForPlayer(stats);
    }

    // Rebuild the ability list for one freshly-spawned entity = unit-def abilities
    // ∪ team/archetype-matched owned abilities ∪ the roster entry's single grants.
    // addAbilitiesToUnit REPLACES the list, so we always pass the full union.
    applyArmyAbilities(entityId) {
        const info = this.game.getComponent(entityId, 'heroRosterInfo');
        if (!info) return;
        const stats = this._getStats(info.playerId);
        const entry = stats?.heroRoster?.[info.rosterIndex];
        if (!entry) return;
        const profile = this._profileForEntry(entry);
        const spawnType = this._resolveSpawnType(entry);

        // Predefined unit abilities require INVESTMENT: only ability techs the
        // player has bought for this unit type are active. (UnitCreationSystem
        // grants def abilities at spawn; this rebuild replaces the whole list,
        // so an unteched unit ends up with none — by design.)
        const ids = new Set();
        const ownedTechs = new Set(stats.unitTechs?.[spawnType] || []);
        for (const t of (this.collections.unitTechs?.[spawnType]?.techs || [])) {
            if (t.unlockAbility && ownedTechs.has(t.id)) ids.add(t.unlockAbility);
        }

        for (const owned of (stats.ownedAbilities || [])) {
            const sdef = this.collections.shopAbilities?.[owned.abilityId];
            if (!sdef) continue;
            if (owned.grantMode === 'team') {
                ids.add(sdef.abilityId);
            } else if (owned.grantMode === 'archetype' && this._abilityArchetypeMatch(sdef, profile)) {
                ids.add(sdef.abilityId);
            }
        }
        for (const a of (entry.grantedAbilities || [])) ids.add(a);

        // Always call, even with an empty list — it clears the free def abilities.
        if (this.game.hasService?.('addAbilitiesToUnit')) {
            this.call.addAbilitiesToUnit(entityId,
                [...ids].map(id => ({ id, itemLevel: profile.level })));
        }
    }

    // Re-apply abilities to a player's live units (all, or just one roster index).
    _reapplyAbilitiesForPlayer(stats, onlyRosterIndex = null) {
        const ents = this.game.getEntitiesWith?.('heroRosterInfo') || [];
        for (const eid of ents) {
            const info = this.game.getComponent(eid, 'heroRosterInfo');
            if (!info || info.playerId !== stats.playerId) continue;
            if (onlyRosterIndex != null && info.rosterIndex !== onlyRosterIndex) continue;
            this.applyArmyAbilities(eid);
        }
    }

    _abilityArchetypeMatch(sdef, profile) {
        const combos = sdef.archetypeMatch || sdef.requirements;
        if (!combos || combos.length === 0) return true;
        return combos.some(combo => this.matchesCombo(profile, combo));
    }

    // Map a unit id back to a starter-class id when possible (for roster display);
    // otherwise use the unit id itself.
    _deriveHeroClass(unitId) {
        for (const [cls, sp] of Object.entries(ArmyShopSystem.CLASS_SPAWN_MAP)) {
            if (sp === unitId) return cls;
        }
        return unitId;
    }

    _resolveSpawnType(entry) {
        return ArmyShopSystem.CLASS_SPAWN_MAP[entry.heroClass] || entry.spawnType || entry.heroClass;
    }

    _calcLevel(roundsPlayed) {
        const r = Math.max(0, roundsPlayed | 0);
        return Math.max(1, Math.min(30, r + 1));
    }

    _inPlacement() {
        return this.game.state?.phase === this.enums.gamePhase.placement;
    }

    _getStats(numericPlayerId) {
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats?.playerId === numericPlayerId) return stats;
        }
        return null;
    }

    _broadcastShop(stats) {
        const state = this.getShopStateForPlayer(stats.playerId);
        // Multiplayer: broadcast to the room — each client renders only its OWN state
        // (PlacementUISystem._isMyShopState filters by playerId). We cannot use
        // sendToPlayer here because the shop is keyed by numeric playerId while the
        // network layer addresses clients by socket id.
        if (this.game.hasService?.('broadcastToRoom')) {
            this.call.broadcastToRoom(null, 'SHOP_OFFERS', state);
        }
        // Local same-instance delivery (broadcastToRoom is a no-op for this event locally).
        this.game.triggerEvent?.('onShopOffersReady', state);
    }

    // Local-game AI auto-buy for every AI-controlled player (local opponent and both
    // sides of headless simulations). Units are no longer shop offers — the army is
    // bought from the "Your Units" store (buyUnlockedUnit) — so each pass buys units
    // FIRST (the army is the priority) and then picks up one affordable shop offer
    // (upgrade / ability / economy / Town Hall). Interleaving prevents cheap offers
    // from starving unit purchases. Deterministic: candidate order, no RNG.
    _aiAutoBuy() {
        for (const pid of (this.call.getAIPlayerIds?.() || [])) {
            const stats = this._getStats(pid);
            if (!stats) continue;

            const buyOneOffer = () => {
                const idx = (stats.currentOffers || []).findIndex(
                    o => !o.consumed && (stats.gold || 0) >= o.cost
                        // AI can't choose a target, so skip single-target abilities.
                        && !(o.kind === 'ability' && o.grantMode === 'single')
                );
                if (idx < 0) return false;
                return !!this.buyOffer(pid, idx)?.success;
            };


            let guard = 0, progress = true;
            while (progress && guard++ < 80) {
                progress = false;
                // Army first: one of each affordable unit type this pass.
                for (const id of this._candidateUnitIds(stats)) {
                    const cost = ArmyShopSystem.shopCost(this.collections.units?.[id]?.value);
                    if ((stats.gold || 0) < cost) continue;
                    if (this.buyUnlockedUnit(pid, id)?.success) progress = true;
                }
                // Then one affordable unit tech for a fielded type.
                if (this._aiBuyOneTech(stats, pid)) progress = true;
                // Then one affordable shop offer with whatever's left.
                if (buyOneOffer()) progress = true;
            }
        }
    }
}
