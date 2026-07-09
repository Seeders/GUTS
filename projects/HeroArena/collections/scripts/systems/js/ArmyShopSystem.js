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
        'buySquadLevel',
        'buyTierUnlock',
        'buyUpgradeNode',
        'buyDeploySlot',
        'pickReinforcement',
        'skipReinforcement',
        'getShopStateForPlayer',
        'getEligibleItems',
        'applyArmyUpgrades',
        'applyArmyAbilities',
        'grantSingleTargetAbility',
        'equipSquadItem',
        'unequipSquadItem',
        'takeLoan',
        'buyEliteRecruit',
        'getEconomyEffects',
        'sellUnit'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'broadcastToRoom',
        'spawnPurchasedUnit',
        'respawnRosterEntry',
        'addAbilitiesToUnit',
        'townhallLevel',
        'getOwnedBuildingIds',
        'getOwnedBuildingArchetypes',
        'upgradeTownHall',
        'placeBuildingAuto',
        'getAIPlayerIds',
        'removeRosterEntry',
        'getLeaderDef',
        'rollCampaignRewards'
    ];

    static OFFER_COUNT = 5;
    static BASE_DEPLOY_SLOTS = 2;       // Mechabellum: 2 new squads per round...
    static EXTRA_DEPLOY_COST = 100;     // ...unless you buy extra recruitment (cost doubles)
    static LOAN_GOLD  = 200;            // Loan: +200 supply now (Mechabellum)...
    static LOAN_REPAY = 300;            // ...−300 supply next round (Mechabellum)
    static ELITE_RECRUIT_COST = 100;    // Elite Recruitment: one-time per-round purchase (Mechabellum 100 supply); recruits then arrive Lv2
    static REROLL_BASE_COST = 25;    // escalates +REROLL_STEP per reroll within a round
    static REROLL_STEP = 25;
    static SELL_REFUND_PCT = 0.5;    // base fraction of a unit's shop cost refunded on sell (ratio — unscaled)
    static SKIP_REINFORCEMENT_GOLD = 50;   // Mechabellum: skip the round's card for +50 supply
    static AI_SKIP_SCORE = 40;       // AI skips when its best card scores below this (all cards weak)

    // Raw economy runs on Mechabellum supply numbers (units 100/200/300/400,
    // income 200×round). Content data (upgrade/ability/tech `value`s) was authored
    // on the old ~14.3-supply-per-gold gold scale, so it is multiplied back up to
    // supply by this one factor — keeping every content price in step with income.
    static SUPPLY_PER_GOLD = 100 / 7;
    // A unit/upgrade/ability's raw `value` is divided by this content-tuning knob…
    static SHOP_COST_DIVISOR = 5;

    // …then scaled to raw Mechabellum supply. Convert a raw `value` into a price.
    static shopCost(rawValue) {
        return Math.max(1, Math.ceil(
            (rawValue || 0) / ArmyShopSystem.SHOP_COST_DIVISOR * ArmyShopSystem.SUPPLY_PER_GOLD));
    }

    // Base supply cost of a unit tech (JSON `cost` is gold-scale content → supply),
    // snapped to a clean multiple of 50 like Mechabellum's tech prices (min 50).
    static techBaseCost(rawCost) {
        const supply = (rawCost || 10) * ArmyShopSystem.SUPPLY_PER_GOLD;
        return Math.max(50, Math.round(supply / 50) * 50);
    }

    // ─── Unit tiers (Mechabellum model) ─────────────────────────────────────────
    // Units never offered in the shop (workers, summons, transforms).
    static UNIT_EXCLUDE = new Set(['peasant', '4_archmage', 'sentry']);
    // Off-prefix tier-1s (the skeleton swarm) and tier-2s (air chaff).
    static T1_UNIT_SET = new Set(['0_skeleton']);
    static T2_UNIT_SET = new Set(['fairy']);
    // Tier-3 "heavies": strong specialists above the tier-2 roster.
    static T3_UNIT_SET = new Set(['0_golemStone', '0_golemFire', '0_golemIce', 'ballista']);
    // Tier-4 "giants": the Mechabellum Fortress/Overlord analogues.
    static T4_UNIT_SET = new Set(['dragon_red', '4_ancientTreant', 'dragon_red_flying']);
    // Valid tiered units that are never OFFERED for unlock/purchase directly
    // (gained through techs — the dragon's Take Flight transform).
    static NOT_OFFERED = new Set(['dragon_red_flying']);

    // Tier of a unit id: 1-4, or null (= not shop-offerable).
    static unitTier(id) {
        if (ArmyShopSystem.UNIT_EXCLUDE.has(id)) return null;
        if (ArmyShopSystem.T4_UNIT_SET.has(id)) return 4;
        if (ArmyShopSystem.T3_UNIT_SET.has(id)) return 3;
        if (ArmyShopSystem.T2_UNIT_SET.has(id)) return 2;
        if (ArmyShopSystem.T1_UNIT_SET.has(id)) return 1;
        if (/^1_/.test(id)) return 1;
        if (/^2_/.test(id)) return 2;
        return null;
    }

    // Tech escalation (Mechabellum): every tech bought on a unit raises that
    // unit's OTHER techs by +200 supply, hard-capped at +1000 supply.
    static TECH_ESCALATION_STEP = 200;
    static TECH_ESCALATION_CAP  = 1000;

    static techEscalation(ownedCount) {
        return Math.min(ArmyShopSystem.TECH_ESCALATION_CAP,
            ArmyShopSystem.TECH_ESCALATION_STEP * (ownedCount || 0));
    }

    // Squad prices by tier (supply): 100 / 200 / 400 / 800.
    static TIER_PRICE = { 1: 100, 2: 200, 3: 400, 4: 800 };
    // One-time unlock costs: T1 free, then 50 / 200 / 350 supply.
    static TIER_UNLOCK_COST = { 2: 50, 3: 200, 4: 350 };

    // Shop price of a unit: tier-based (Mechabellum numbers) when tiered,
    // else derived from its raw value.
    static unitPrice(id, def) {
        const tier = ArmyShopSystem.unitTier(id);
        if (tier && ArmyShopSystem.TIER_PRICE[tier]) return ArmyShopSystem.TIER_PRICE[tier];
        return ArmyShopSystem.shopCost(def?.value);
    }

    // Archetypes a unit belongs to (str/dex/int), from its id prefix letters.
    static unitArchetypes(id) {
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
        const campaign = this.game.campaignRunSystem?.isCampaignMode?.();
        const round = this.game.state.round || 1;
        // Mechabellum: round 1 is the starting deployment (openings only) — the
        // 1-of-N reinforcement cards begin round 2.
        const offerReinforcements = round >= 2;
        let sharedCards = null;   // rolled once, offered to all players identically
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            stats.rerollCount = 0;
            // Fresh recruitment allowance each round (menu buys only — free
            // units from cards/perks never consume slots).
            stats.deploysUsed = 0;
            stats.extraDeploySlots = 0;
            // Per-round Town Hall economy actions reset each round.
            stats.loanTakenThisRound = false;
            stats.eliteRecruit = false;
            stats.unlockedThisRound = false;   // one unit unlock per round
            if (campaign) {
                // Campaign: no AI economy, no random reinforcements — the run
                // system rolls the player's post-victory reward instead.
                if (stats.playerId === 0) {
                    this._applyLeaderRoundPerks(stats);
                    stats.currentOffers = [];
                    this.call.rollCampaignRewards?.(stats);
                    this._broadcastShop(stats);
                    this._notifyReinforcement(stats);
                }
                continue;
            }
            this._applyLeaderRoundPerks(stats);
            stats.currentOffers = this._buildOffers(stats);
            // The round's one random decision: pick 1 of 3 reinforcement cards.
            // Mechabellum: the SAME card set is offered to every player, so the
            // pick is a mind game — you know what your opponent was offered. No
            // cards round 1 (opening deployment only).
            if (offerReinforcements) {
                if (!sharedCards) sharedCards = this._rollSharedReinforcements();
                stats.pendingReinforcement = this._pendingCardsForPlayer(stats, sharedCards);
            } else {
                stats.pendingReinforcement = null;
            }
            this._broadcastShop(stats);
            this._notifyReinforcement(stats);
        }
        if (campaign) return;
        this._aiAutoPick();
        this._aiAutoBuy();
    }

    // ─── Leader round perks (Mechabellum starting specialists) ──────────────────

    // Free specialist units: Marksman Specialist's L3 Crossbowman (round 2),
    // Golem Specialist's L2 Stone Golem (round 4). Granted once, tracked on
    // stats.leaderPerks; the unit is a normal roster squad from then on.
    _applyLeaderRoundPerks(stats) {
        const def = this.call.getLeaderDef?.(stats.leaderId);
        if (!def) return;
        const round = this.game.state.round || 1;
        if (!stats.leaderPerks) stats.leaderPerks = {};

        const grants = [];
        // Drafted commander's two random tier-1 starting squads (granted once, round 1).
        if (round <= 1 && !stats.leaderPerks.startingSquads && (stats.pendingStartingSquads || []).length) {
            stats.leaderPerks.startingSquads = true;
            for (const unitId of stats.pendingStartingSquads) grants.push({ unitId, level: 1 });
            stats.pendingStartingSquads = null;
        }
        if (def.id === 'sniper' && round >= 2 && !stats.leaderPerks.sniper) {
            stats.leaderPerks.sniper = true;
            grants.push({ unitId: '2_sd_crossbowman', level: 3 });
        }
        if (def.id === 'golem' && round >= 4 && !stats.leaderPerks.golem) {
            stats.leaderPerks.golem = true;
            grants.push({ unitId: '0_golemStone', level: 2 });
        }
        for (const g of grants) {
            if (!Array.isArray(stats.tierUnlocks)) stats.tierUnlocks = [];
            if (!stats.tierUnlocks.includes(g.unitId)) stats.tierUnlocks.push(g.unitId);
            this._addUnitToArmy(stats, g.unitId);
            const entry = stats.heroRoster[stats.heroRoster.length - 1];
            if (entry && g.level > 1) {
                entry.paidLevels = g.level - 1;
                entry.level = g.level;
                this.call.respawnRosterEntry?.(stats.playerId, stats.heroRoster.length - 1);
            }
        }
    }

    // ─── Reinforcement cards (the round's 1-of-3 pick) ──────────────────────────
    //
    // Mechabellum model: one card set is rolled per round and shown to EVERY
    // player. Cards always name specifics ("Elite Archer", "Necromancer
    // Contract") — never "a random unit" — and the pool shifts with the round:
    // tempo recruits early, unlocks and elites mid-game, heavies/giants and
    // battle skills late. An offer never holds two cards of the same category,
    // so raw gold can't compete against more gold.

    static REINFORCEMENT_COUNT = 3;

    // Mechabellum charges supply for most cards (only free units/unlocks and pure
    // economy cards are free). Modifications scale with the modified unit's tier;
    // items, specialist utilities and combat skills carry an explicit JSON `cost`.
    static MOD_COST_BY_TIER = { 1: 0, 2: 50, 3: 100, 4: 200 };

    _cardCost(def) {
        if (!def) return 0;
        if (def.kind === 'unitModifier') {
            const tier = ArmyShopSystem.unitTier(def.unitId) || 1;
            return ArmyShopSystem.MOD_COST_BY_TIER[tier] || 0;
        }
        return def.cost || 0;   // skills / items / specialist utilities (JSON cost)
    }

    // Emoji for dynamically generated unit cards (unit defs carry sprite ids,
    // but the card UI renders icons as text).
    static CARD_ICONS = { recruits: '🪖', elite: '⭐', veteran: '⚔️', deploy: '🗿', contract: '📜' };

    // The round's candidate cards: static JSON cards (gold / growth / skills,
    // windowed by minRound/maxRound) + generated specific-unit cards.
    _reinforcementPool(round) {
        const rng = this.game.rng.strand('shop');
        const units = this.collections.units || {};
        // n distinct random units — each dynamic slot contributes a couple of
        // candidates so the pool can always fill a 3-card offer (round 1 has
        // few static cards).
        const pickSome = (arr, n) => {
            const copy = arr.slice(), out = [];
            while (out.length < n && copy.length) {
                out.push(copy.splice(Math.floor(rng.next() * copy.length), 1)[0]);
            }
            return out;
        };
        const tiered = (t) => Object.keys(units).filter(id =>
            ArmyShopSystem.unitTier(id) === t && !ArmyShopSystem.NOT_OFFERED.has(id));
        // Unit titles carry tier/stat suffixes ("Necromancer (2) [I]") — strip
        // them so card text reads clean.
        const name = (id) => (units[id]?.title || id).replace(/\s*\(\d+\)\s*(\[[A-Z]+\])?\s*$/, '');
        const icons = ArmyShopSystem.CARD_ICONS;

        // Mechabellum keeps shared offers RELEVANT (patch 0.7.44: "units
        // already on the field will not appear as free unit cards"). Offers
        // are shared, so filter against BOTH teams' state:
        //  • contracts never name a line either side already unlocked;
        //  • free-squad cards prefer units neither side fields (falling back
        //    to the full tier if the roster is too small to filter).
        const allStats = [];
        for (const eid of this.call.getPlayerEntities()) {
            const s = this.game.getComponent(eid, 'playerStats');
            if (s) allStats.push(s);
        }
        const unlockedByAnyone = new Set(allStats.flatMap(s => s.tierUnlocks || []));
        const fieldedByAnyone = new Set(allStats.flatMap(s =>
            (s.heroRoster || []).map(e => this._resolveSpawnType(e))));
        // A prefix modifier already applied to a unit type is a DEAD card (re-picking
        // does nothing), so never offer it again. Keyed `modId:unitId`, same as the
        // generated card id, filtered against every player (offers are shared).
        const modOwnedByAnyone = new Set(allStats.flatMap(s =>
            Object.entries(s.unitModifiers || {}).flatMap(([uid, mods]) =>
                (mods || []).map(m => `${m.modId}:${uid}`))));
        const notFielded = (arr) => {
            const fresh = arr.filter(id => !fieldedByAnyone.has(id));
            return fresh.length ? fresh : arr;
        };
        const notUnlocked = (arr) => arr.filter(id => !unlockedByAnyone.has(id));

        const pool = [];
        const add = (id, category, weight, def) => pool.push({ id, category, weight, def });

        for (const [id, def] of Object.entries(this.collections.reinforcementCards || {})) {
            if ((def.minRound || 1) > round) continue;
            if (def.maxRound && round > def.maxRound) continue;
            // Prefix modifiers are TEMPLATES — expanded into specific named cards below.
            if (def.kind === 'unitModifier') continue;
            add(id, def.category || 'growth', def.weight || 1, def);
        }

        // Prefix modifiers (Mechabellum "Longshot Overlord"): each prefix template
        // generates specific, NAMED cards bound to a unit type. Any eligible unit
        // can appear — NOT gated by unlock/field state: picking "Longshot Ballista"
        // permanently enchants that type and incentivizes unlocking it. A few random
        // units per template each round keeps the offer varied without flooding it.
        const modUnits = Object.keys(units).filter(id =>
            ArmyShopSystem.unitTier(id) != null && !ArmyShopSystem.NOT_OFFERED.has(id));
        for (const tmpl of Object.values(this.collections.reinforcementCards || {})) {
            if (tmpl.kind !== 'unitModifier' || (tmpl.minRound || 1) > round) continue;
            const eligible = modUnits.filter(u => this._modifierEligible(tmpl, u)
                && !modOwnedByAnyone.has(`${tmpl.modId}:${u}`));
            for (const u of pickSome(eligible, 2)) {
                add(`mod:${tmpl.modId}:${u}`, 'modifier', tmpl.weight || 1, {
                    ...tmpl,
                    unitId: u,
                    title: `${tmpl.prefix} ${name(u)}`,
                    description: `${name(u)}: ${tmpl.description}`
                });
            }
        }

        const t1 = tiered(1), t2 = tiered(2), t3 = tiered(3), t4 = tiered(4);

        // Free squads of a SPECIFIC tier-1 line — the early tempo card.
        for (const u of pickSome(notFielded(t1), 2)) {
            add(`recruits:${u}`, 'unit', 3, {
                kind: 'freeSpecificUnits', unitId: u, count: 2, icon: icons.recruits,
                title: `${name(u)} Recruits`,
                description: `Two free ${name(u)} squads join your army`
            });
        }
        // A pre-leveled specific tier-1 squad (Mechabellum's "Elite Mustang").
        if (round >= 3) {
            for (const u of pickSome(notFielded(t1), 2)) {
                add(`elite:${u}`, 'unit', 2, {
                    kind: 'specificUnit', unitId: u, level: 3, icon: icons.elite,
                    title: `Elite ${name(u)}`,
                    description: `A free ${name(u)} squad at level 3`
                });
            }
        }
        // A specific tier-2 squad, unlocked and pre-leveled.
        if (round >= 5) {
            for (const u of pickSome(notFielded(t2), 2)) {
                add(`veteran:${u}`, 'unit', 2, {
                    kind: 'specificUnit', unitId: u, level: 2, icon: icons.veteran,
                    title: `Veteran ${name(u)}`,
                    description: `A free level-2 ${name(u)} squad — line unlocked`
                });
            }
        }
        // A free specific heavy squad for the late game.
        if (round >= 7) {
            for (const u of pickSome(notFielded(t3), 1)) {
                add(`deploy:${u}`, 'unit', 1, {
                    kind: 'specificUnit', unitId: u, level: 1, icon: icons.deploy,
                    title: `${name(u)} Deployment`,
                    description: `A free ${name(u)} squad — line unlocked`
                });
            }
        }
        // Contracts: free unlock of a SPECIFIC higher-tier line (no squad).
        const contract = (u, weight) => add(`contract:${u}`, 'unlock', weight, {
            kind: 'unlockUnit', unitId: u, icon: icons.contract,
            title: `${name(u)} Contract`,
            description: `Unlocks the ${name(u)} line for free`
        });
        if (round >= 2) for (const u of pickSome(notUnlocked(t2), 2)) contract(u, 2);
        if (round >= 6) for (const u of pickSome(notUnlocked(t3), 2)) contract(u, 2);
        if (round >= 8) for (const u of pickSome(notUnlocked(t4), 1)) contract(u, 1);
        return pool;
    }

    // Roll the round's shared card set: weighted draws without replacement,
    // one card per category (relaxed only if the pool runs dry) and never two
    // cards about the same unit.
    _rollSharedReinforcements() {
        const round = this.game.state.round || 1;
        const rng = this.game.rng.strand('shop');
        const remaining = this._reinforcementPool(round);
        const options = [], defs = [];
        const usedCategories = new Set(), usedUnits = new Set();

        while (options.length < ArmyShopSystem.REINFORCEMENT_COUNT && remaining.length) {
            let candidates = remaining.filter(c =>
                !usedCategories.has(c.category) && !(c.def.unitId && usedUnits.has(c.def.unitId)));
            if (!candidates.length) {
                candidates = remaining.filter(c => !(c.def.unitId && usedUnits.has(c.def.unitId)));
            }
            if (!candidates.length) candidates = remaining;

            const total = candidates.reduce((s, c) => s + c.weight, 0);
            let r = rng.next() * total;
            let pick = candidates[candidates.length - 1];
            for (const c of candidates) { r -= c.weight; if (r <= 0) { pick = c; break; } }

            remaining.splice(remaining.indexOf(pick), 1);
            usedCategories.add(pick.category);
            if (pick.def.unitId) usedUnits.add(pick.def.unitId);
            options.push({
                id: pick.id,
                title: pick.def.title,
                icon: pick.def.icon || '🎁',
                description: pick.def.description || '',
                cost: this._cardCost(pick.def)
            });
            defs.push(pick.def);
        }
        return { options, defs };
    }

    // Per-player view of the shared card set: drop unlock cards for lines this
    // player already owns (a redundant unlock does nothing). The shared roll only
    // filters units unlocked by SOME player; this makes it authoritative per player.
    _pendingCardsForPlayer(stats, sharedCards) {
        const owned = new Set(stats.tierUnlocks || []);
        const options = [], defs = [];
        sharedCards.options.forEach((o, i) => {
            const d = sharedCards.defs[i];
            if (d?.kind === 'unlockUnit' && owned.has(d.unitId)) return;   // already unlocked (dead card)
            options.push({ ...o });
            defs.push(d);
        });
        return options.length ? { options, defs, picked: false } : null;
    }

    _notifyReinforcement(stats) {
        if (!stats.pendingReinforcement) return;
        const payload = { playerId: stats.playerId, options: stats.pendingReinforcement.options };
        this.call.broadcastToRoom(null, 'REINFORCEMENT_START', payload);
        this.game.triggerEvent('onReinforcementStart', payload);
    }

    pickReinforcement(numericPlayerId, optionIndex) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        const pending = stats.pendingReinforcement;
        if (!pending || pending.picked) return { success: false, reason: 'no_pending' };
        const option = pending.options?.[optionIndex];
        if (!option) return { success: false, reason: 'bad_option' };

        const def = this.collections.reinforcementCards?.[option.id]
            || pending.defs?.[optionIndex];
        if (!def) return { success: false, reason: 'no_card' };

        // Mechabellum: only free units/unlocks and pure economy cards are free;
        // modifications, items, specialist utilities and combat skills charge supply.
        // Pay it up front or the pick is refused.
        const cost = this._cardCost(def);
        if (cost > 0 && (stats.gold || 0) < cost) {
            return { success: false, reason: 'insufficient_gold' };
        }

        pending.picked = true;
        if (cost > 0) stats.gold -= cost;

        // Squad-item cards go into the commander's inventory — held until the
        // player chooses to equip one on a squad (equipSquadItem). The AI has no
        // inventory UI, so it equips immediately onto its best squad if it fields
        // one, else banks the item too.
        if (def.kind === 'squadItem') {
            if (!Array.isArray(stats.itemInventory)) stats.itemInventory = [];
            const aiIds = this.call.getAIPlayerIds?.() || [];
            if (aiIds.includes(numericPlayerId) && (stats.heroRoster || []).length) {
                this._autoEquipItem(stats, def.itemId);
            } else {
                stats.itemInventory.push(def.itemId);
            }
            this._broadcastShop(stats);
            return { success: true, card: option.id, state: this.getShopStateForPlayer(numericPlayerId) };
        }

        this._applyReinforcement(stats, def);
        this._broadcastShop(stats);
        return { success: true, card: option.id, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // Skip this round's reinforcement card for +50 supply (Mechabellum). Marks the
    // pick done so the round proceeds, and banks the supply immediately.
    skipReinforcement(numericPlayerId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        const pending = stats.pendingReinforcement;
        if (!pending || pending.picked) return { success: false, reason: 'no_pending' };
        pending.picked = true;
        const gold = ArmyShopSystem.SKIP_REINFORCEMENT_GOLD;
        stats.gold = (stats.gold || 0) + gold;
        this._broadcastShop(stats);
        return { success: true, skipped: true, gold, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // Equip an inventory item onto one roster entry (Mechabellum device on a
    // squad). Consumes one copy from stats.itemInventory, records it on the entry
    // (entry.items — travels with that squad instance), and applies its effects to
    // the live squad now + on every respawn (applyArmyUpgrades). rosterIndex < 0
    // cancels target selection, leaving the item in the inventory.
    equipSquadItem(numericPlayerId, itemId, rosterIndex) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        if (rosterIndex == null || rosterIndex < 0) {
            return { success: true, cancelled: true, state: this.getShopStateForPlayer(numericPlayerId) };
        }
        const inv = stats.itemInventory || [];
        const invIdx = inv.indexOf(itemId);
        if (invIdx === -1) return { success: false, reason: 'not_in_inventory' };
        const entry = stats.heroRoster?.[rosterIndex];
        if (!entry) return { success: false, reason: 'bad_target' };
        const item = this.collections.squadItems?.[itemId];
        if (!item) return { success: false, reason: 'no_item' };

        inv.splice(invIdx, 1);
        if (!Array.isArray(entry.items)) entry.items = [];
        entry.items.push(itemId);
        this._applyItemToLiveSquad(stats, rosterIndex, item);
        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // Unequip an item from a squad back into the commander inventory. The squad
    // respawns clean so the item's stat mods drop off (applyArmyUpgrades rebuilds
    // from the remaining items). Placement phase only.
    unequipSquadItem(numericPlayerId, rosterIndex, itemId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        const entry = stats.heroRoster?.[rosterIndex];
        if (!entry) return { success: false, reason: 'bad_target' };
        const i = (entry.items || []).indexOf(itemId);
        if (i === -1) return { success: false, reason: 'not_equipped' };
        entry.items.splice(i, 1);
        if (!Array.isArray(stats.itemInventory)) stats.itemInventory = [];
        stats.itemInventory.push(itemId);
        this.call.respawnRosterEntry?.(stats.playerId, rosterIndex);   // rebuild → mods drop
        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // AI: equip an item on its highest-level (most valuable) squad.
    _autoEquipItem(stats, itemId) {
        const roster = stats.heroRoster || [];
        const item = this.collections.squadItems?.[itemId];
        if (!roster.length || !item) return;
        let best = 0, bestLv = -1;
        roster.forEach((e, i) => { const lv = e.level || 1; if (lv > bestLv) { bestLv = lv; best = i; } });
        if (!Array.isArray(roster[best].items)) roster[best].items = [];
        roster[best].items.push(itemId);
        this._applyItemToLiveSquad(stats, best, item);
    }

    // Apply an item's effects to the live units at one roster index.
    _applyItemToLiveSquad(stats, rosterIndex, item) {
        for (const eid of (this.game.getEntitiesWith?.('heroRosterInfo') || [])) {
            const info = this.game.getComponent(eid, 'heroRosterInfo');
            if (!info || info.playerId !== stats.playerId || info.rosterIndex !== rosterIndex) continue;
            if (item.statModifiers) this._applyStatMods(
                this.game.getComponent(eid, 'combat'),
                this.game.getComponent(eid, 'health'),
                item.statModifiers);
            if (item.grantAntiAir) info.canTargetAir = true;
            if (item.grantBuff) this._grantPermanentBuff(eid, item.grantBuff);
        }
        if (item.unlockAbility) this._reapplyAbilitiesForPlayer(stats, rosterIndex);
    }

    _applyReinforcement(stats, def) {
        switch (def.kind) {
            case 'gold': {
                stats.gold = (stats.gold || 0) + (def.amount || 10);
                break;
            }
            case 'freeSpecificUnits': {
                for (let i = 0; i < (def.count || 1); i++) {
                    this._addUnitToArmy(stats, def.unitId);
                }
                break;
            }
            case 'unlockUnit': {
                if (!Array.isArray(stats.tierUnlocks)) stats.tierUnlocks = [];
                if (!stats.tierUnlocks.includes(def.unitId)) stats.tierUnlocks.push(def.unitId);
                break;
            }
            case 'techDiscount': {
                stats.techDiscount = def.pct || 0.5;
                break;
            }
            case 'freeLevel': {
                const maxLevel = this.game.heroExperienceSystem?.constructor?.MAX_LEVEL || 9;
                const roster = stats.heroRoster || [];
                let best = -1, bestLevel = Infinity;
                for (let i = 0; i < roster.length; i++) {
                    const level = roster[i]?.level || 1;
                    if (level < maxLevel && level < bestLevel) { bestLevel = level; best = i; }
                }
                if (best >= 0) {
                    roster[best].level = (roster[best].level || 1) + 1;
                    roster[best].xp = 0;
                    this.call.respawnRosterEntry?.(stats.playerId, best);
                }
                break;
            }
            case 'specificUnit': {
                // A specific squad, optionally pre-leveled, its line unlocked
                // (elite/veteran/deployment cards + campaign rewards).
                const maxLevel = this.game.heroExperienceSystem?.constructor?.MAX_LEVEL || 9;
                if (!Array.isArray(stats.tierUnlocks)) stats.tierUnlocks = [];
                if (!stats.tierUnlocks.includes(def.unitId)) stats.tierUnlocks.push(def.unitId);
                this._addUnitToArmy(stats, def.unitId);
                const entry = stats.heroRoster[stats.heroRoster.length - 1];
                if (entry && (def.level || 1) > 1) {
                    entry.paidLevels = Math.min(maxLevel, def.level) - 1;
                    entry.level = Math.min(maxLevel, def.level);
                    this.call.respawnRosterEntry?.(stats.playerId, stats.heroRoster.length - 1);
                }
                break;
            }
            case 'unitTechGrant': {
                // Campaign reward: a free tech for a fielded unit type.
                if (!stats.unitTechs) stats.unitTechs = {};
                const owned = stats.unitTechs[def.unitId] || [];
                if (!owned.includes(def.techId)) {
                    stats.unitTechs[def.unitId] = [...owned, def.techId];
                    const techDef = (this.collections.unitTechs?.[def.unitId]?.techs || [])
                        .find(t => t.id === def.techId);
                    if (techDef?.statModifiers) this._applyTechToLiveUnits(stats, def.unitId, techDef);
                    if (techDef?.unlockAbility) this._reapplyAbilitiesForUnitType(stats, def.unitId);
                    if (techDef?.grantAntiAir) this._applyAntiAirToLiveUnits(stats, def.unitId);
                    if (techDef?.grantBuff) this._applyBuffToLiveUnits(stats, def.unitId, techDef.grantBuff);
                }
                break;
            }
            case 'skillCharge': {
                if (!Array.isArray(stats.skillCharges)) stats.skillCharges = [];
                if (stats.skillCharges.length < 2) stats.skillCharges.push(def.skill);
                break;
            }
            case 'income': {
                // Economy card (Mechabellum "Super Supply Enhancement"): permanent
                // +gold every round from now on. Paid in grantRoundIncome; stacks.
                // Amount is authored on the supply scale (like the rest of the economy).
                stats.bonusIncome = (stats.bonusIncome || 0) + (def.amount || 50);
                break;
            }
            case 'unitModifier': {
                // Card-exclusive prefix mod (Mechabellum's "Fortified Overlord",
                // "Longshot Marksman", ...): a TRADEOFF stat package bound to one
                // unit TYPE. It PERMANENTLY enchants that type — a standing trade of
                // the shop unit for its modified version. Applies to any live units
                // now AND every future purchase (applyArmyUpgrades re-applies at each
                // spawn), whether or not the type is currently fielded or unlocked.
                // Mods are stored inline (not by id) so the ledger is self-contained.
                const unitId = def.unitId;
                if (!unitId) break;
                if (!stats.unitModifiers) stats.unitModifiers = {};
                const owned = stats.unitModifiers[unitId] || [];
                stats.unitModifiers[unitId] = [...owned, {
                    modId: def.modId || def.title,
                    prefix: def.prefix || def.title,
                    statModifiers: def.statModifiers || {}
                }];
                if (def.statModifiers) this._applyStatModsToLiveUnits(stats, unitId, def.statModifiers);
                // Cost tradeoff (Mechabellum "Mass Produced": cheaper to recruit).
                if (def.costDelta) {
                    // costDelta is authored on the supply scale (Mechabellum Mass
                    // Produced = −100), applied directly.
                    if (!stats.unitCostMods) stats.unitCostMods = {};
                    stats.unitCostMods[unitId] = (stats.unitCostMods[unitId] || 0) + def.costDelta;
                }
                break;
            }
        }
    }

    // Recruitment price of a unit TYPE for THIS player, including card-exclusive
    // cost modifiers (Mechabellum "Mass Produced" cuts recruit cost). Floors at 1g.
    // Promotion and refund prices intentionally stay on the base unitPrice — cost
    // mods touch recruitment only.
    unitBuyCost(stats, id, def) {
        const base = ArmyShopSystem.unitPrice(id, def || this.collections.units?.[id]);
        return Math.max(1, base + (stats?.unitCostMods?.[id] || 0));
    }

    // With Elite Recruitment active, recruits arrive at level 2, so the shop price
    // is the recruit cost plus one rank-up (Mechabellum: a rank = 50% of base).
    // Pricier/higher-tier units therefore cost proportionally more. Applied only at
    // the recruit surfaces (buy + display), never to refunds/promotions.
    eliteAdjustedCost(base, elite) {
        return elite ? base + Math.ceil(base / 2) : base;
    }

    // A unit type's weapon types, always as an array (defs store a string or list).
    _unitWeaponTypes(unitId) {
        const w = this.collections.units?.[unitId]?.weaponType;
        return Array.isArray(w) ? w : (w ? [w] : []);
    }

    // Can a modifier card be applied to this unit type? Mechabellum curates
    // eligibility per prefix (Longshot only fits ranged units, only some units
    // can be Mass Produced, ...):
    //  • appliesTo      — explicit unit-id allow-list (wins outright when present)
    //  • appliesToTiers — tier allow-list (1-4)          } ANDed together
    //  • appliesToWeapons — weaponType allow-list         } when both present
    //  • none of these  — unrestricted (any fielded unit)
    _modifierEligible(card, unitId) {
        if (Array.isArray(card.appliesTo) && card.appliesTo.length) {
            return card.appliesTo.includes(unitId);
        }
        if (Array.isArray(card.appliesToTiers) && card.appliesToTiers.length
            && !card.appliesToTiers.includes(ArmyShopSystem.unitTier(unitId))) {
            return false;
        }
        if (Array.isArray(card.appliesToWeapons) && card.appliesToWeapons.length
            && !this._unitWeaponTypes(unitId).some(w => card.appliesToWeapons.includes(w))) {
            return false;
        }
        return true;
    }

    // Apply an arbitrary statModifiers block to all live units of a type (used by
    // unit-modifier cards; mirrors _applyTechToLiveUnits but with inline mods).
    _applyStatModsToLiveUnits(stats, unitId, mods) {
        for (const eid of (this.game.getEntitiesWith?.('heroRosterInfo') || [])) {
            const info = this.game.getComponent(eid, 'heroRosterInfo');
            if (!info || info.playerId !== stats.playerId) continue;
            const entry = stats.heroRoster?.[info.rosterIndex];
            if (!entry || this._resolveSpawnType(entry) !== unitId) continue;
            this._applyStatMods(
                this.game.getComponent(eid, 'combat'),
                this.game.getComponent(eid, 'health'),
                mods
            );
        }
    }

    // ─── AI strategy (per-commander profiles, aiConfig/strategies.json) ─────────
    //
    // Each AI opens with a strategy picked from its leader's list (seeded 'ai'
    // strand, stored on stats.aiStrategy for the whole match). The profile
    // drives unit buy priorities, unlock savings, tech/promotion appetite and
    // reinforcement-card scoring. One adaptation overrides the plan: if the
    // enemy fields flyers and the plan can't shoot up, the AI pivots to
    // anti-air units and techs.

    _aiStrategy(stats) {
        const cfg = this.collections.aiConfig?.strategies;
        if (!cfg?.templates) return null;
        if (!stats.aiStrategy || !cfg.templates[stats.aiStrategy]) {
            const leaderId = this.call.getLeaderDef?.(stats.leaderId)?.id;
            const list = (cfg.leaders?.[leaderId] || Object.keys(cfg.templates))
                .filter(id => cfg.templates[id]);
            if (!list.length) return null;
            const rng = this.game.rng.strand('ai');
            stats.aiStrategy = list[Math.floor(rng.next() * list.length)];
        }
        return cfg.templates[stats.aiStrategy];
    }

    // Does any opposing roster field a flying unit?
    _aiEnemyFieldsAir(stats) {
        for (const eid of this.call.getPlayerEntities()) {
            const other = this.game.getComponent(eid, 'playerStats');
            if (!other || other.team === stats.team) continue;
            for (const e of (other.heroRoster || [])) {
                if (this.collections.units?.[this._resolveSpawnType(e)]?.isFlying) return true;
            }
        }
        return false;
    }

    // The strategy's unit priority list, with the anti-air pivot applied.
    _aiUnitPlan(stats, strat) {
        let plan = (strat?.units || []).filter(id => this.collections.units?.[id]);
        if (!plan.length) plan = this._candidateUnitIds(stats);
        if (this._aiEnemyFieldsAir(stats)) {
            const hitsAir = (id) => {
                const def = this.collections.units?.[id];
                return def?.canTargetAir || def?.isFlying;
            };
            if (!plan.slice(0, 3).some(hitsAir)) {
                const aa = this._candidateUnitIds(stats).filter(hitsAir);
                plan = [...aa.slice(0, 2), ...plan];
            }
        }
        return plan;
    }

    // AI card pick: score each option against the strategy instead of rolling
    // dice — free/unlock cards for plan units beat generic economy.
    _aiAutoPick() {
        for (const pid of (this.call.getAIPlayerIds?.() || [])) {
            const stats = this._getStats(pid);
            if (!stats?.pendingReinforcement || stats.pendingReinforcement.picked) continue;
            const pending = stats.pendingReinforcement;
            const strat = this._aiStrategy(stats);
            const rng = this.game.rng.strand('ai');
            let best = 0, bestScore = -Infinity;
            pending.options.forEach((opt, i) => {
                const def = this.collections.reinforcementCards?.[opt.id] || pending.defs?.[i] || {};
                const score = this._aiScoreCard(stats, strat, def) + rng.next();  // rng breaks ties
                if (score > bestScore) { bestScore = score; best = i; }
            });
            // Mechabellum: take +50 supply instead when every offered card is weak,
            // or when the best pick can't be afforded (paid combat-skill cards).
            if (bestScore < ArmyShopSystem.AI_SKIP_SCORE) this.skipReinforcement(pid);
            else if (!this.pickReinforcement(pid, best)?.success) this.skipReinforcement(pid);
        }
    }

    _aiScoreCard(stats, strat, def) {
        const planIdx = (id) => {
            const idx = (strat?.units || []).indexOf(id);
            return idx < 0 ? null : idx;
        };
        switch (def.kind) {
            case 'freeSpecificUnits':
            case 'specificUnit': {
                const idx = planIdx(def.unitId);
                return idx != null ? 100 - idx * 8 : 45;
            }
            case 'unlockUnit': {
                if ((stats.tierUnlocks || []).includes(def.unitId)) return 5;   // dead card
                const inPlan = planIdx(def.unitId) != null
                    || (strat?.unlockPlan || []).includes(def.unitId);
                return inPlan ? 95 : 30;
            }
            case 'unitModifier': {
                // A prefix enchant is worth it only on a unit the AI actually uses.
                // Best on a core plan unit; decent on a fielded off-plan unit; a near
                // dead pick if it names a unit the AI neither plans nor fields.
                const idx = planIdx(def.unitId);
                const fields = (stats.heroRoster || []).some(e => this._resolveSpawnType(e) === def.unitId);
                if (idx == null && !fields) return 12;
                return 55 - (idx || 0) * 6;
            }
            case 'gold':         return 50;
            // Recurring income compounds — value it high early, less so late.
            case 'income':       return 60 - Math.min(40, ((this.game.state.round || 1) - 1) * 6);
            case 'squadItem':    return (stats.heroRoster || []).length ? 42 : 8;
            case 'freeLevel':    return 40 + Math.min(20, (stats.heroRoster || []).length * 3);
            case 'techDiscount': return 45;
            // The AI has no way to CAST commander skills mid-battle — a
            // charge is a dead pick for it.
            case 'skillCharge':  return 10;
            default:             return 30;
        }
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
        const allowedDeploys = ArmyShopSystem.BASE_DEPLOY_SLOTS + (stats.extraDeploySlots || 0);
        if ((stats.deploysUsed || 0) >= allowedDeploys) {
            return { success: false, reason: 'no_deploy_slots' };
        }

        // Elite Recruitment (Town Hall, per round): once purchased it stays active
        // for the round and every recruit arrives at level 2 for +50% of its price
        // (Mechabellum's rank-up = 50% of base). Shop prices already show the bump.
        const elite = !!stats.eliteRecruit;
        const cost = this.eliteAdjustedCost(this.unitBuyCost(stats, unitTypeId, def), elite);
        if ((stats.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };

        stats.gold -= cost;
        stats.deploysUsed = (stats.deploysUsed || 0) + 1;
        this._addUnitToArmy(stats, unitTypeId);
        if (elite) {
            const idx = stats.heroRoster.length - 1;
            const entry = stats.heroRoster[idx];
            if (entry) {
                entry.level = 2;
                entry.paidLevels = 1;
                this.call.respawnRosterEntry?.(stats.playerId, idx);
            }
        }
        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // ─── Town Hall economy actions (per-round Command Center options) ───────────

    // Loan (Mechabellum): +14g now, −21g next round income (200 supply now, 300
    // back at our ~14g/200-supply scale). Once per round; the debt is applied in
    // AutobattlerEconomySystem.grantRoundIncome and cleared there.
    takeLoan(numericPlayerId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        if (stats.loanTakenThisRound) return { success: false, reason: 'already_loaned' };
        stats.loanTakenThisRound = true;
        stats.gold = (stats.gold || 0) + ArmyShopSystem.LOAN_GOLD;
        stats.loanDebt = (stats.loanDebt || 0) + ArmyShopSystem.LOAN_REPAY;
        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // Buy Elite Recruitment (Mechabellum): a one-time per-round purchase — not a
    // toggle. Once bought it stays active until the round ends and cannot be turned
    // off; every recruit then arrives at level 2. Resets each round.
    buyEliteRecruit(numericPlayerId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        if (stats.eliteRecruit) return { success: false, reason: 'already_owned' };
        const cost = ArmyShopSystem.ELITE_RECRUIT_COST;
        if ((stats.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };
        stats.gold -= cost;
        stats.eliteRecruit = true;
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

        const techDef = this._unitTechsFor(stats, unitId).find(t => t.id === techId);
        if (!techDef) return { success: false, reason: 'no_tech' };

        if (!stats.unitTechs) stats.unitTechs = {};
        const owned = stats.unitTechs[unitId] || [];
        if (owned.includes(techId)) return { success: false, reason: 'already_owned' };

        // Techs require owning at least one unit of the type (you tech what you field)
        const ownsType = (stats.heroRoster || []).some(e => this._resolveSpawnType(e) === unitId);
        if (!ownsType) return { success: false, reason: 'no_unit_of_type' };

        // Mechabellum escalation: prior techs on this unit inflate the price...
        let cost = ArmyShopSystem.techBaseCost(techDef.cost) + ArmyShopSystem.techEscalation(owned.length);
        // ...then Field Manual reinforcement: next tech at a discount (consumed on buy)
        if (stats.techDiscount) cost = Math.max(1, Math.ceil(cost * (1 - stats.techDiscount)));
        if ((stats.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };

        stats.gold -= cost;
        if (stats.techDiscount) stats.techDiscount = 0;
        stats.unitTechs[unitId] = [...owned, techId];

        if (techDef.statModifiers) {
            this._applyTechToLiveUnits(stats, unitId, techDef);
        }
        if (techDef.unlockAbility) {
            this._reapplyAbilitiesForUnitType(stats, unitId);
        }
        if (techDef.grantAntiAir) this._applyAntiAirToLiveUnits(stats, unitId);
        if (techDef.grantBuff) this._applyBuffToLiveUnits(stats, unitId, techDef.grantBuff);
        if (techDef.transformUnit) this._transformUnitType(stats, unitId, techDef.transformUnit, techDef);
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

    // ─── Squad level-ups (grow taller instead of wider) ─────────────────────────

    // ─── Command-building upgrade trees (Mechabellum global tech) ────────────────

    // Buy a node from an owned building's upgrade tree. Prereqs must be owned;
    // the effect applies to every matching live unit now and at each respawn
    // (applyArmyUpgrades reads stats.ownedUpgrades).
    buyUpgradeNode(numericPlayerId, upgradeId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        const def = this.collections.upgrades?.[upgradeId];
        if (!def) return { success: false, reason: 'no_upgrade' };
        if ((stats.ownedUpgrades || []).includes(upgradeId)) {
            return { success: false, reason: 'already_owned' };
        }

        // Locate the tree node: the tree must belong to a building this player
        // fields (Town Hall or their production building), and prereqs owned.
        const ownedBuildings = new Set((stats.buildings || []).map(b => b.buildingId));
        let node = null;
        for (const bId of ownedBuildings) {
            const tree = this._treeFor(stats, bId);
            if (!tree) continue;
            for (const branch of (tree.branches || [])) {
                const n = (branch.nodes || []).find(n2 => n2.upgrade === upgradeId);
                if (n) { node = n; break; }
            }
            if (node) break;
        }
        if (!node) return { success: false, reason: 'no_building_tree' };
        const owned = new Set(stats.ownedUpgrades || []);
        if (!(node.requires || []).every(r => owned.has(r))) {
            return { success: false, reason: 'prereq_missing' };
        }

        const cost = ArmyShopSystem.shopCost(def.value);
        if ((stats.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };
        stats.gold -= cost;
        if (!Array.isArray(stats.ownedUpgrades)) stats.ownedUpgrades = [];
        stats.ownedUpgrades.push(upgradeId);

        // Apply to live matching units immediately.
        if (def.statModifiers) {
            for (const eid of this.game.getEntitiesWith('heroRosterInfo')) {
                if (this.game.entityAlive?.[eid] !== 1) continue;
                const info = this.game.getComponent(eid, 'heroRosterInfo');
                if (info?.playerId !== numericPlayerId) continue;
                const entry = stats.heroRoster?.[info.rosterIndex];
                if (!entry) continue;
                if (!this.matchesCombo(this._profileForEntry(entry), def.target || {})) continue;
                this._applyStatMods(
                    this.game.getComponent(eid, 'combat'),
                    this.game.getComponent(eid, 'health'),
                    def.statModifiers);
            }
        }
        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // Extra recruitment (Mechabellum side-building): +1 deploy slot this round,
    // price doubling per extra bought (7g, 14g, 28g...).
    buyDeploySlot(numericPlayerId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        const extras = stats.extraDeploySlots || 0;
        const cost = ArmyShopSystem.EXTRA_DEPLOY_COST * Math.pow(2, extras);
        if ((stats.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };
        stats.gold -= cost;
        stats.extraDeploySlots = extras + 1;
        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // ─── Tier unlocks (Mechabellum: pay once, buy forever) ──────────────────────

    // All shop-offerable units the player has NOT unlocked yet, with their
    // one-time unlock price (T1 unlock is free). Every tier is unlockable.
    _lockedUnits(stats) {
        const unlocked = new Set(stats.tierUnlocks || []);
        const out = [];
        for (const [id, def] of Object.entries(this.collections.units || {})) {
            const tier = ArmyShopSystem.unitTier(id);
            if (!tier || unlocked.has(id)) continue;
            if (ArmyShopSystem.NOT_OFFERED.has(id)) continue;
            out.push({
                id, tier,
                title: def.title || id,
                icon: def.icon || null,
                cost: ArmyShopSystem.unitPrice(id, def),
                unlockCost: ArmyShopSystem.TIER_UNLOCK_COST[tier] || 0
            });
        }
        out.sort((a, b) => a.tier - b.tier || a.title.localeCompare(b.title));
        return out;
    }

    buyTierUnlock(numericPlayerId, unitId) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        const tier = ArmyShopSystem.unitTier(unitId);
        if (!tier) return { success: false, reason: 'not_unlockable' };
        if ((stats.tierUnlocks || []).includes(unitId)) return { success: false, reason: 'already_unlocked' };
        // One unit unlock per round (buys only — reinforcement cards don't count).
        if (stats.unlockedThisRound) return { success: false, reason: 'unlock_used' };
        let cost = ArmyShopSystem.TIER_UNLOCK_COST[tier] || 0;
        // Giant Specialist: heavies and giants unlock for free
        const leaderId = this.call.getLeaderDef?.(stats.leaderId)?.id;
        if (tier >= 3 && leaderId === 'giant') cost = 0;
        // Aerial Specialist: flying units unlock for free
        if (leaderId === 'aerial' && this.collections.units?.[unitId]?.isFlying) cost = 0;
        if ((stats.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };
        stats.gold -= cost;
        if (!Array.isArray(stats.tierUnlocks)) stats.tierUnlocks = [];
        stats.tierUnlocks.push(unitId);
        stats.unlockedThisRound = true;
        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // Cost of the squad's next rank: unit shop price × current level — HALVED
    // when the squad's combat-XP bar is full (Mechabellum: a full bar earns the
    // right to promote at half price, never a free level). Ranks are worth it:
    // each level MULTIPLIES the unit's HP and damage by its level.
    squadLevelCost(entry) {
        const def = this.collections.units?.[this._resolveSpawnType(entry)] || {};
        // Mechabellum: promotion always costs 50% of the unit's BASE
        // recruitment price — flat, regardless of current level.
        const base = ArmyShopSystem.unitPrice(this._resolveSpawnType(entry), def);
        return Math.max(1, Math.ceil(base / 2));
    }

    buySquadLevel(numericPlayerId, rosterIndex) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        const entry = stats.heroRoster?.[rosterIndex];
        if (!entry) return { success: false, reason: 'bad_index' };

        const maxLevel = this.game.heroExperienceSystem?.constructor?.MAX_LEVEL || 9;
        if ((entry.level || 1) >= maxLevel) return { success: false, reason: 'max_level' };

        // Mechabellum: a squad can only be promoted once its XP bar is FULL —
        // levels can never simply be purchased early.
        if (!this.game.heroExperienceSystem?.isLevelReady?.(entry)) {
            return { success: false, reason: 'xp_not_ready' };
        }

        const cost = this.squadLevelCost(entry);
        if ((stats.gold || 0) < cost) return { success: false, reason: 'insufficient_gold' };

        stats.gold -= cost;
        entry.level = (entry.level || 1) + 1;
        entry.xp = 0;   // the bar (full or not) resets on promotion

        // Rebuild the live unit so level scaling + techs + upgrades re-apply
        // cleanly (position and HP% are preserved by replaceUnit).
        this.call.respawnRosterEntry?.(numericPlayerId, rosterIndex);

        this._broadcastShop(stats);
        return { success: true, level: entry.level, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // AI: promote ONE squad whose XP bar is full (buySquadLevel rejects any
    // other — the old lowest-level pick usually wasn't ready and never fired).
    // Plan-core squads first, then the most expensive (levels multiply stats,
    // so ranks on big units buy the most power).
    _aiBuyOneLevel(stats, pid, strat = null) {
        const hx = this.game.heroExperienceSystem;
        const maxLevel = hx?.constructor?.MAX_LEVEL || 9;
        const roster = stats.heroRoster || [];
        const planPos = (id) => {
            const idx = (strat?.units || []).indexOf(id);
            return idx < 0 ? 99 : idx;
        };
        const ready = [];
        for (let i = 0; i < roster.length; i++) {
            const entry = roster[i];
            if (!entry || (entry.level || 1) >= maxLevel) continue;
            if (!hx?.isLevelReady?.(entry)) continue;
            const type = this._resolveSpawnType(entry);
            ready.push({
                i,
                pos: planPos(type),
                price: ArmyShopSystem.unitPrice(type, this.collections.units?.[type])
            });
        }
        ready.sort((a, b) => (a.pos - b.pos) || (b.price - a.price));
        for (const r of ready) {
            const cost = this.squadLevelCost(roster[r.i]);
            if ((stats.gold || 0) < cost + 100) continue;   // keep a squad's worth banked
            if (this.buySquadLevel(pid, r.i)?.success) return true;
        }
        return false;
    }

    // AI: buy one building-tree upgrade node it can actually use — economy
    // nodes compound (favored early), combat nodes only when fielded units
    // match the upgrade's target combo (more matching squads = better buy).
    _aiBuyOneUpgradeNode(stats, pid) {
        const ownedBuildings = new Set((stats.buildings || []).map(b => b.buildingId));
        const owned = new Set(stats.ownedUpgrades || []);
        const profiles = this.ownedUnitProfiles(stats);
        const round = this.game.state.round || 1;

        const candidates = [];
        for (const tree of Object.values(this.collections.upgradeTrees || {})) {
            if (!ownedBuildings.has(tree.building)) continue;
            for (const branch of (tree.branches || [])) {
                for (const node of (branch.nodes || [])) {
                    if (owned.has(node.upgrade)) continue;
                    if (!(node.requires || []).every(r => owned.has(r))) continue;
                    const def = this.collections.upgrades?.[node.upgrade];
                    if (!def) continue;
                    const isEco = !!def.economy;
                    const matches = isEco ? 0
                        : profiles.filter(p => this.matchesCombo(p, def.target || {})).length;
                    if (!isEco && def.target && matches === 0) continue;   // useless for this army
                    candidates.push({
                        id: node.upgrade,
                        cost: ArmyShopSystem.shopCost(def.value),
                        score: (isEco ? (round <= 4 ? 100 : 25) : 50 + matches * 12)
                    });
                }
            }
        }
        candidates.sort((a, b) => (b.score - b.cost) - (a.score - a.cost));
        for (const c of candidates) {
            if ((stats.gold || 0) < c.cost + 100) continue;
            if (this.buyUpgradeNode(pid, c.id)?.success) return true;
        }
        return false;
    }

    // AI: unlock the cheapest locked unit when it can afford unlock + squad.
    _aiBuyOneUnlock(stats, pid) {
        const locked = this._lockedUnits(stats);
        if (!locked.length) return false;
        const pick = locked[0]; // lowest tier first
        if ((stats.gold || 0) < pick.unlockCost + pick.cost) return false;
        return !!this.buyTierUnlock(pid, pick.id)?.success;
    }

    // AI: buy one affordable un-owned tech — most-fielded plan units first,
    // and anti-air techs jump the queue when the enemy flies.
    _aiBuyOneTech(stats, pid, strat = null) {
        const counts = {};
        for (const e of (stats.heroRoster || [])) {
            const t = this._resolveSpawnType(e);
            counts[t] = (counts[t] || 0) + 1;
        }
        const planPos = (id) => {
            const idx = (strat?.units || []).indexOf(id);
            return idx < 0 ? 99 : idx;
        };
        const fielded = Object.keys(counts)
            .sort((a, b) => (counts[b] - counts[a]) || (planPos(a) - planPos(b)));
        const enemyAir = this._aiEnemyFieldsAir(stats);
        for (const unitId of fielded) {
            const owned = new Set(stats.unitTechs?.[unitId] || []);
            const techs = this._unitTechsFor(stats, unitId)
                .filter(t => !owned.has(t.id));
            const ordered = enemyAir
                ? [...techs.filter(t => t.grantAntiAir), ...techs.filter(t => !t.grantAntiAir)]
                : techs;
            for (const t of ordered) {
                const cost = ArmyShopSystem.techBaseCost(t.cost) + ArmyShopSystem.techEscalation(owned.size);
                if ((stats.gold || 0) < cost) continue;
                if (this.buyUnitTech(pid, unitId, t.id)?.success) return true;
            }
        }
        return false;
    }

    // Transform tech (dragon's Take Flight): every squad of the type becomes
    // the target type — owned techs carry over (shared ids), live units are
    // replaced in place with the takeoff animation.
    _transformUnitType(stats, fromId, toId, techDef) {
        // Carry owned techs to the new type's ledger (shared tech ids apply).
        const owned = (stats.unitTechs?.[fromId] || []).filter(id => id !== techDef.id);
        if (!stats.unitTechs) stats.unitTechs = {};
        stats.unitTechs[toId] = [...new Set([...(stats.unitTechs[toId] || []), ...owned])];
        if (!Array.isArray(stats.tierUnlocks)) stats.tierUnlocks = [];
        if (!stats.tierUnlocks.includes(toId)) stats.tierUnlocks.push(toId);

        for (let idx = 0; idx < (stats.heroRoster || []).length; idx++) {
            const entry = stats.heroRoster[idx];
            if (this._resolveSpawnType(entry) !== fromId) continue;
            entry.spawnType = toId;
            this.call.respawnRosterEntry?.(stats.playerId, idx, 'takeoff');
        }
    }

    // Anti-air tech: flag every live unit of the type (finders check the
    // heroRosterInfo flag alongside the def's canTargetAir).
    _applyAntiAirToLiveUnits(stats, unitId) {
        for (const eid of this.game.getEntitiesWith('heroRosterInfo')) {
            if (this.game.entityAlive?.[eid] !== 1) continue;
            const info = this.game.getComponent(eid, 'heroRosterInfo');
            if (info?.playerId !== stats.playerId) continue;
            const entry = stats.heroRoster?.[info.rosterIndex];
            if (!entry || this._resolveSpawnType(entry) !== unitId) continue;
            info.canTargetAir = true;
        }
    }

    // Permanent weapon-buff techs (e.g. poisoned_weapon): stamp the buff on a unit.
    _grantPermanentBuff(entityId, buffName) {
        const buffType = this.enums.buffTypes?.[buffName];
        if (buffType == null) return;
        if (this.game.buffEffectsSystem?.hasBuff(entityId, buffType)) return;
        this.game.buffEffectsSystem?.applyBuff(entityId, {
            buffType,
            endTime: (this.game.state.now || 0) + 1e9,   // effectively permanent
            appliedTime: this.game.state.now || 0,
            stacks: 1
        });
    }

    _applyBuffToLiveUnits(stats, unitId, buffName) {
        for (const eid of this.game.getEntitiesWith('heroRosterInfo')) {
            if (this.game.entityAlive?.[eid] !== 1) continue;
            const info = this.game.getComponent(eid, 'heroRosterInfo');
            if (info?.playerId !== stats.playerId) continue;
            const entry = stats.heroRoster?.[info.rosterIndex];
            if (!entry || this._resolveSpawnType(entry) !== unitId) continue;
            this._grantPermanentBuff(eid, buffName);
        }
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
        const base = ArmyShopSystem.REROLL_BASE_COST + ArmyShopSystem.REROLL_STEP * (stats?.rerollCount || 0);
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
        // Content values above are gold-scale; scale the gold-denominated ones to
        // raw Mechabellum supply (sellRefundPct stays a ratio). interestPer is a
        // banked-supply threshold, so it scales up too.
        const F = ArmyShopSystem.SUPPLY_PER_GOLD;
        eff.interestPer     = Math.round(eff.interestPer   * F);
        eff.interestCap     = Math.round(eff.interestCap   * F);
        eff.winStreakGold   = Math.round(eff.winStreakGold  * F);
        eff.lossStreakGold  = Math.round(eff.lossStreakGold * F);
        eff.flatIncome      = Math.round(eff.flatIncome     * F);
        eff.rerollDiscount  = Math.round(eff.rerollDiscount * F);
        eff.mineIncomeBonus = Math.round(eff.mineIncomeBonus * F);
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
        if (entry.lastPosition && !this.game.campaignRunSystem?.isCampaignMode?.()) {
            return { success: false, reason: 'deployment_locked' };
        }

        if (!entry.lastPosition) stats.deploysUsed = Math.max(0, (stats.deploysUsed || 0) - 1);
        const def = this.collections.units?.[this._resolveSpawnType(entry)] || {};
        const pct = ArmyShopSystem.SELL_REFUND_PCT + (this.getEconomyEffects(stats).sellRefundPct || 0);
        const refund = Math.floor(this.unitBuyCost(stats, this._resolveSpawnType(entry), def) * pct);

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
                const cost = this.eliteAdjustedCost(this.unitBuyCost(stats, id, def), !!stats.eliteRecruit);
                return { id, title: def.title || id, cost, icon: def.icon || null };
            }),
            rerollCost: this.getRerollCost(stats),
            gold:       stats.gold || 0,
            // For the building upgrade-tree modal: which tree nodes are already bought.
            ownedUpgrades: [...(stats.ownedUpgrades || [])],
            // Per-unit techs owned: { unitId: [techId, ...] } (tech defs come from collections)
            unitTechs: JSON.parse(JSON.stringify(stats.unitTechs || {})),
            // Card-exclusive prefix mods owned: { unitId: [{ modId, prefix, statModifiers }, ...] }
            unitModifiers: JSON.parse(JSON.stringify(stats.unitModifiers || {})),
            // Commander inventory: held squad-items not yet equipped (ids).
            itemInventory: [...(stats.itemInventory || [])],
            // Which unit types the player currently fields (tech gating in the UI)
            ownedUnitTypes: [...new Set((stats.heroRoster || []).map(e => this._resolveSpawnType(e)))],
            // This round's 1-of-3 reinforcement pick (null once picked)
            pendingReinforcement: stats.pendingReinforcement && !stats.pendingReinforcement.picked
                ? { options: stats.pendingReinforcement.options } : null,
            locked: this._lockedUnits(stats),
            unlockedThisRound: !!stats.unlockedThisRound,   // one unit unlock per round
            techDiscount: stats.techDiscount || 0,
            deploysUsed: stats.deploysUsed || 0,
            deploySlots: ArmyShopSystem.BASE_DEPLOY_SLOTS + (stats.extraDeploySlots || 0),
            nextSlotCost: ArmyShopSystem.EXTRA_DEPLOY_COST * Math.pow(2, stats.extraDeploySlots || 0),
            skillCharges: [...(stats.skillCharges || [])],
            // Town Hall economy actions (per round)
            eliteRecruit: !!stats.eliteRecruit,
            eliteRecruitCost: ArmyShopSystem.ELITE_RECRUIT_COST,
            loanTaken: !!stats.loanTakenThisRound,
            loanDebt: stats.loanDebt || 0,
            loanGold: ArmyShopSystem.LOAN_GOLD,
            loanRepay: ArmyShopSystem.LOAN_REPAY
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

    // ─── Deck (loadout) awareness ────────────────────────────────────────────────
    // A match may run under a player-chosen DECK (stats.deck) that restricts which
    // units are unlockable, which abilities each unit can tech, which building
    // upgrades exist, and which commanders are banned. A null deck ⇒ no restriction
    // (full global collections — the pre-deck behavior), so decks never regress.

    _deckFor(stats) { return stats?.deck || null; }

    // Stat/weapon profile for a unit TYPE id (deck ability-requirement checks).
    _profileForUnitId(unitId) {
        const def = this.collections.units?.[unitId] || {};
        return {
            str: def.strength || 0, dex: def.dexterity || 0, int: def.intelligence || 0,
            weaponType: def.weaponType || 'none', level: 1
        };
    }

    // Effective per-unit tech list. With a deck, techs are GENERATED from the
    // abilities the deck assigned to this unit (each ability → an unlockAbility
    // tech), kept only while the unit still qualifies (str/dex/int/weapon). With no
    // deck, the unit's authored collections.unitTechs list.
    _unitTechsFor(stats, unitId) {
        const deck = this._deckFor(stats);
        const defaults = this.collections.unitTechs?.[unitId]?.techs || [];
        if (!deck) return defaults;
        const entry = (deck.units || []).find(u => u.unitId === unitId);
        if (!entry) return defaults;   // unit not customized ⇒ its default techs
        const profile = this._profileForUnitId(unitId);
        // Innate techs (unit transforms like the dragon's Take Flight) are NOT part of
        // the deck's customizable slots and are never in the shared pool — they always
        // stay on their unit.
        const out = defaults.filter(t => t.transformUnit);
        // The deck defines this unit's customizable techs from the assigned pool entries.
        // Each pool entry carries a full tech payload (ability unlock, stat mods,
        // grantBuff, onDeath*, ...); the pool id is the stable tech id.
        for (const poolId of (entry.abilities || [])) {
            const p = this.collections.abilityPool?.[poolId];
            if (!p || !p.tech) continue;
            if (!this.isEligible([profile], p.requirements)) continue;
            out.push({ ...p.tech, id: p.id });
        }
        return out;
    }

    // Effective building tech tree. With a deck, each branch's nodes are filtered to
    // the upgrades the deck chose for that building. No deck ⇒ the raw tree.
    _treeFor(stats, buildingId) {
        const tree = this.collections.upgradeTrees?.[buildingId];
        if (!tree) return null;
        const deck = this._deckFor(stats);
        if (!deck) return tree;
        const b = (deck.buildings || []).find(x => x.buildingId === buildingId);
        if (!b) return { ...tree, branches: [] };
        const allow = new Set(b.upgrades || []);
        const branches = (tree.branches || []).map(br => ({
            ...br, nodes: (br.nodes || []).filter(n => allow.has(n.upgrade))
        }));
        return { ...tree, branches };
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

    // Units the player can buy: ONLY the ones explicitly unlocked on
    // stats.tierUnlocks — nothing is free by tier. The commander's two starting
    // squads seed the list (granted round 1); every other unit (T1 included) must
    // be unlocked, one per round, via buyTierUnlock or a reinforcement card.
    _candidateUnitIds(stats) {
        const unlocked = new Set(stats.tierUnlocks || []);
        const units = this.collections.units || {};
        const out = [];
        for (const id of Object.keys(units)) {
            if (ArmyShopSystem.unitTier(id) == null) continue;
            if (unlocked.has(id)) out.push(id);
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
        for (const t of this._unitTechsFor(stats, spawnType)) {
            if (!ownedTechs.has(t.id)) continue;
            if (t.statModifiers) this._applyStatMods(combat, health, t.statModifiers);
            if (t.grantAntiAir) info.canTargetAir = true;
            if (t.grantBuff) this._grantPermanentBuff(entityId, t.grantBuff);
        }
        // Card-exclusive prefix modifiers: re-apply each owned mod's stat package.
        for (const m of (stats.unitModifiers?.[spawnType] || [])) {
            if (m.statModifiers) this._applyStatMods(combat, health, m.statModifiers);
        }
        // Squad items: per-entry equipment re-applies to THIS squad on respawn.
        for (const itemId of (entry.items || [])) {
            const item = this.collections.squadItems?.[itemId];
            if (!item) continue;
            if (item.statModifiers) this._applyStatMods(combat, health, item.statModifiers);
            if (item.grantAntiAir) info.canTargetAir = true;
            if (item.grantBuff) this._grantPermanentBuff(entityId, item.grantBuff);
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
            const next = base + (spec.add || 0) + base * (spec.pct || 0);
            // combat is a schema-guarded proxy — skip fields it doesn't define.
            try { combat[field] = next; } catch (e) { /* not a combat stat */ }
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
        for (const t of this._unitTechsFor(stats, spawnType)) {
            if (t.unlockAbility && ownedTechs.has(t.id)) ids.add(t.unlockAbility);
        }
        // Squad items on this entry can grant an ability too.
        for (const itemId of (entry.items || [])) {
            const it = this.collections.squadItems?.[itemId];
            if (it?.unlockAbility) ids.add(it.unlockAbility);
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
    // sides of headless simulations). Strategy-driven: buys follow the profile's
    // unit priorities and unlock plan; tech/promotion spending fires at the
    // profile's appetite ('ai' strand — server-side, deterministic per seed).
    // Falls back to the legacy greedy pass when no strategies are configured.
    _aiAutoBuy() {
        for (const pid of (this.call.getAIPlayerIds?.() || [])) {
            const stats = this._getStats(pid);
            if (!stats) continue;
            const strat = this._aiStrategy(stats);
            const rng = this.game.rng.strand('ai');

            const buyOneOffer = () => {
                const idx = (stats.currentOffers || []).findIndex(
                    o => !o.consumed && (stats.gold || 0) >= o.cost
                        // AI can't choose a target, so skip single-target abilities.
                        && !(o.kind === 'ability' && o.grantMode === 'single')
                );
                if (idx < 0) return false;
                return !!this.buyOffer(pid, idx)?.success;
            };

            // Buy ONE plan unit: weighted toward the front of the priority list
            // so the army is mostly core units with support mixed in.
            const buyOnePlanUnit = (plan) => {
                const buyable = plan.filter(id =>
                    this._candidateUnitIds(stats).includes(id)
                    && (stats.gold || 0) >= this.unitBuyCost(stats, id, this.collections.units?.[id]));
                if (!buyable.length) return false;
                const weights = buyable.map(id => {
                    const idx = plan.indexOf(id);
                    return (plan.length - idx) ** 2;
                });
                const total = weights.reduce((s, w) => s + w, 0);
                let r = rng.next() * total, pick = buyable[0];
                for (let i = 0; i < buyable.length; i++) {
                    r -= weights[i];
                    if (r <= 0) { pick = buyable[i]; break; }
                }
                return !!this.buyUnlockedUnit(pid, pick)?.success;
            };

            // Next unlock on the strategy's plan, bought only with the squad
            // price in hand too (unlock it AND field it the same round). One unlock
            // per round — core plan units first, then the unlock plan; every tier
            // (T1 included) now has to be unlocked.
            const buyPlannedUnlock = () => {
                if (stats.unlockedThisRound) return false;
                const wanted = [...(strat?.units || []), ...(strat?.unlockPlan || [])];
                const next = wanted.find(id =>
                    this.collections.units?.[id]
                    && ArmyShopSystem.unitTier(id) != null
                    && !(stats.tierUnlocks || []).includes(id));
                if (!next) return false;
                const tier = ArmyShopSystem.unitTier(next);
                let cost = ArmyShopSystem.TIER_UNLOCK_COST[tier] || 0;
                const leaderId = this.call.getLeaderDef?.(stats.leaderId)?.id;
                if (tier >= 3 && leaderId === 'giant') cost = 0;
                if (leaderId === 'aerial' && this.collections.units?.[next]?.isFlying) cost = 0;
                const squadPrice = ArmyShopSystem.unitPrice(next, this.collections.units?.[next]);
                if ((stats.gold || 0) < cost + squadPrice) return false;
                return !!this.buyTierUnlock(pid, next)?.success;
            };

            let guard = 0, progress = true;
            while (progress && guard++ < 80) {
                progress = false;
                const plan = this._aiUnitPlan(stats, strat);

                if (strat && buyPlannedUnlock()) progress = true;
                if (buyOnePlanUnit(plan)) progress = true;

                // Wide strategies buy extra recruitment when flush enough to
                // also fill the new slot.
                if (strat?.wide) {
                    const slotCost = ArmyShopSystem.EXTRA_DEPLOY_COST
                        * Math.pow(2, stats.extraDeploySlots || 0);
                    const allowed = ArmyShopSystem.BASE_DEPLOY_SLOTS + (stats.extraDeploySlots || 0);
                    if ((stats.deploysUsed || 0) >= allowed
                        && (stats.gold || 0) >= slotCost + 100) {
                        if (this.buyDeploySlot(pid)?.success) progress = true;
                    }
                }

                // Techs / promotions / building upgrades at the strategy's
                // appetite (legacy: always).
                if ((strat ? rng.next() < (strat.techAffinity ?? 0.4) : true)
                    && this._aiBuyOneTech(stats, pid, strat)) progress = true;
                if ((strat ? rng.next() < (strat.levelAffinity ?? 0.4) : true)
                    && this._aiBuyOneLevel(stats, pid, strat)) progress = true;
                if (rng.next() < (strat?.upgradeAffinity ?? 0.35)
                    && this._aiBuyOneUpgradeNode(stats, pid)) progress = true;

                // Legacy fallback keeps unlocking cheapest-first without a plan.
                if (!strat && this._aiBuyOneUnlock(stats, pid)) progress = true;
                if (buyOneOffer()) progress = true;
            }
        }
    }
}
