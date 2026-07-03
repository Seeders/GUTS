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
        'pickReinforcement',
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
        'respawnRosterEntry',
        'addAbilitiesToUnit',
        'townhallLevel',
        'getOwnedBuildingIds',
        'getOwnedBuildingArchetypes',
        'upgradeTownHall',
        'placeBuildingAuto',
        'getAIPlayerIds',
        'removeRosterEntry',
        'getLeaderDef'
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

    // ─── Unit tiers (Mechabellum model) ─────────────────────────────────────────
    // Units never offered in the shop (workers, summons, transforms).
    static UNIT_EXCLUDE = new Set(['peasant', '4_archmage', 'sentry', '0_skeleton']);
    // Off-prefix tier-2s (air chaff lives here).
    static T2_UNIT_SET = new Set(['fairy']);
    // Tier-3 "heavies": strong specialists above the tier-2 roster.
    static T3_UNIT_SET = new Set(['0_golemStone', '0_golemFire', '0_golemIce', 'ballista']);
    // Tier-4 "giants": the Mechabellum Fortress/Overlord analogues.
    static T4_UNIT_SET = new Set(['dragon_red', '4_ancientTreant', 'dragon_red_flying']);

    // Tier of a unit id: 1-4, or null (= not shop-offerable).
    static unitTier(id) {
        if (ArmyShopSystem.UNIT_EXCLUDE.has(id)) return null;
        if (ArmyShopSystem.T4_UNIT_SET.has(id)) return 4;
        if (ArmyShopSystem.T3_UNIT_SET.has(id)) return 3;
        if (ArmyShopSystem.T2_UNIT_SET.has(id)) return 2;
        if (/^1_/.test(id)) return 1;
        if (/^2_/.test(id)) return 2;
        return null;
    }

    // Tech escalation (Mechabellum): every tech bought on a unit raises that
    // unit's OTHER techs by +200 supply (14g), hard-capped at +1000 (70g).
    static TECH_ESCALATION_STEP = 14;
    static TECH_ESCALATION_CAP  = 70;

    static techEscalation(ownedCount) {
        return Math.min(ArmyShopSystem.TECH_ESCALATION_CAP,
            ArmyShopSystem.TECH_ESCALATION_STEP * (ownedCount || 0));
    }

    // Mechabellum pricing at our ~14.3-supply-per-gold scale.
    // Squad prices by tier (Mechabellum: 100 / 200 / 300 / 400 supply):
    static TIER_PRICE = { 1: 7, 2: 14, 3: 21, 4: 28 };
    // One-time unlock costs (Mechabellum: T1 free, then 50 / 100 / 200 supply):
    static TIER_UNLOCK_COST = { 2: 4, 3: 7, 4: 14 };

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
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            stats.rerollCount = 0;
            this._applyLeaderRoundPerks(stats);
            stats.currentOffers = this._buildOffers(stats);
            // The round's one random decision: pick 1 of 3 reinforcement cards.
            this._rollReinforcements(stats);
            this._broadcastShop(stats);
            this._notifyReinforcement(stats);
        }
        this._aiAutoPick();
        this._aiAutoBuy();
    }

    // ─── Leader round perks (Mechabellum starting specialists) ──────────────────

    // Free specialist units: Marksman Specialist's L3 Crossbowman (round 1),
    // Golem Specialist's L2 Stone Golem (round 4). Granted once, tracked on
    // stats.leaderPerks; the unit is a normal roster squad from then on.
    _applyLeaderRoundPerks(stats) {
        const def = this.call.getLeaderDef?.(stats.leaderId);
        if (!def) return;
        const round = this.game.state.round || 1;
        if (!stats.leaderPerks) stats.leaderPerks = {};

        const grants = [];
        if (def.id === 'sniper' && round >= 1 && !stats.leaderPerks.sniper) {
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

    _rollReinforcements(stats) {
        const round = this.game.state.round || 1;
        const rng = this.game.rng.strand('shop');
        const pool = Object.entries(this.collections.reinforcementCards || {})
            .filter(([, def]) => (def.minRound || 1) <= round)
            .map(([id, def]) => ({ id, def, weight: def.weight || 1 }));

        const options = [];
        const remaining = pool.slice();
        while (options.length < 3 && remaining.length > 0) {
            const total = remaining.reduce((s, c) => s + c.weight, 0);
            let r = rng.next() * total;
            let idx = 0;
            for (let i = 0; i < remaining.length; i++) {
                r -= remaining[i].weight;
                if (r <= 0) { idx = i; break; }
            }
            const pick = remaining.splice(idx, 1)[0];
            options.push({
                id: pick.id,
                title: pick.def.title,
                icon: pick.def.icon || '🎁',
                description: pick.def.description || ''
            });
        }
        stats.pendingReinforcement = options.length ? { options, picked: false } : null;
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

        const def = this.collections.reinforcementCards?.[option.id];
        if (!def) return { success: false, reason: 'no_card' };

        pending.picked = true;
        this._applyReinforcement(stats, def);
        this._broadcastShop(stats);
        return { success: true, card: option.id, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    _applyReinforcement(stats, def) {
        const rng = this.game.rng.strand('shop');
        switch (def.kind) {
            case 'gold': {
                stats.gold = (stats.gold || 0) + (def.amount || 10);
                break;
            }
            case 'freeUnits': {
                const maxLevel = this.game.heroExperienceSystem?.constructor?.MAX_LEVEL || 9;
                const t1 = this._candidateUnitIds(stats)
                    .filter(id => ArmyShopSystem.unitTier(id) === 1);
                for (let i = 0; i < (def.count || 1) && t1.length; i++) {
                    const unitId = t1[Math.floor(rng.next() * t1.length)];
                    this._addUnitToArmy(stats, unitId);
                    if (def.leveled) {
                        const entry = stats.heroRoster[stats.heroRoster.length - 1];
                        entry.level = Math.min(maxLevel, (entry.level || 1) + def.leveled);
                        this.call.respawnRosterEntry?.(stats.playerId, stats.heroRoster.length - 1);
                    }
                }
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
            case 'randomUnlock': {
                // Free unlock of a random still-locked unit of the card's tier
                // (falls back to any locked unit if that tier is exhausted)
                const locked = this._lockedUnits(stats);
                const pool = locked.filter(u => u.tier === (def.tier || 2));
                const from = pool.length ? pool : locked;
                if (from.length) {
                    const pick = from[Math.floor(rng.next() * from.length)];
                    if (!Array.isArray(stats.tierUnlocks)) stats.tierUnlocks = [];
                    stats.tierUnlocks.push(pick.id);
                }
                break;
            }
            case 'skillCharge': {
                if (!Array.isArray(stats.skillCharges)) stats.skillCharges = [];
                if (stats.skillCharges.length < 2) stats.skillCharges.push(def.skill);
                break;
            }
        }
    }

    // AI picks a random reinforcement card (deterministic 'ai' strand).
    _aiAutoPick() {
        for (const pid of (this.call.getAIPlayerIds?.() || [])) {
            const stats = this._getStats(pid);
            if (!stats?.pendingReinforcement || stats.pendingReinforcement.picked) continue;
            const n = stats.pendingReinforcement.options.length;
            const idx = Math.floor(this.game.rng.strand('ai').next() * n);
            this.pickReinforcement(pid, idx);
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
        const cost = ArmyShopSystem.unitPrice(unitTypeId, def);
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

        // Mechabellum escalation: prior techs on this unit inflate the price...
        let cost = (techDef.cost || 10) + ArmyShopSystem.techEscalation(owned.length);
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
        for (const tree of Object.values(this.collections.upgradeTrees || {})) {
            if (!ownedBuildings.has(tree.building)) continue;
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

    // ─── Tier unlocks (Mechabellum: pay once, buy forever) ──────────────────────

    // All shop-offerable units the player has NOT unlocked yet, with their
    // one-time unlock price. T1 is always unlocked.
    _lockedUnits(stats) {
        const unlocked = new Set(stats.tierUnlocks || []);
        const out = [];
        for (const [id, def] of Object.entries(this.collections.units || {})) {
            const tier = ArmyShopSystem.unitTier(id);
            if (!tier || tier === 1 || unlocked.has(id)) continue;
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
        if (!tier || tier === 1) return { success: false, reason: 'not_unlockable' };
        if ((stats.tierUnlocks || []).includes(unitId)) return { success: false, reason: 'already_unlocked' };
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
        this._broadcastShop(stats);
        return { success: true, state: this.getShopStateForPlayer(numericPlayerId) };
    }

    // Cost of the squad's next rank: unit shop price × current level — HALVED
    // when the squad's combat-XP bar is full (Mechabellum: a full bar earns the
    // right to promote at half price, never a free level). Ranks are worth it:
    // each level MULTIPLIES the unit's HP and damage by its level.
    squadLevelCost(entry) {
        const def = this.collections.units?.[this._resolveSpawnType(entry)] || {};
        const level = entry.level || 1;
        const base = ArmyShopSystem.unitPrice(this._resolveSpawnType(entry), def) * level;
        const ready = this.game.heroExperienceSystem?.isLevelReady?.(entry);
        return ready ? Math.max(1, Math.ceil(base / 2)) : base;
    }

    buySquadLevel(numericPlayerId, rosterIndex) {
        const stats = this._getStats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };
        const entry = stats.heroRoster?.[rosterIndex];
        if (!entry) return { success: false, reason: 'bad_index' };

        const maxLevel = this.game.heroExperienceSystem?.constructor?.MAX_LEVEL || 9;
        if ((entry.level || 1) >= maxLevel) return { success: false, reason: 'max_level' };

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

    // AI: level up the lowest-level squad when affordable (keeps some gold back
    // for units/techs, so only fires with a comfortable purse).
    _aiBuyOneLevel(stats, pid) {
        const roster = stats.heroRoster || [];
        let best = -1, bestLevel = Infinity;
        for (let i = 0; i < roster.length; i++) {
            const level = roster[i]?.level || 1;
            if (level < bestLevel) { bestLevel = level; best = i; }
        }
        if (best < 0) return false;
        const cost = this.squadLevelCost(roster[best]);
        if ((stats.gold || 0) < cost + 10) return false;
        return !!this.buySquadLevel(pid, best)?.success;
    }

    // AI: unlock the cheapest locked unit when it can afford unlock + squad.
    _aiBuyOneUnlock(stats, pid) {
        const locked = this._lockedUnits(stats);
        if (!locked.length) return false;
        const pick = locked[0]; // lowest tier first
        if ((stats.gold || 0) < pick.unlockCost + pick.cost) return false;
        return !!this.buyTierUnlock(pid, pick.id)?.success;
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
        const refund = Math.floor(ArmyShopSystem.unitPrice(this._resolveSpawnType(entry), def) * pct);

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
                return { id, title: def.title || id, cost: ArmyShopSystem.unitPrice(id, def), icon: def.icon || null };
            }),
            rerollCost: this.getRerollCost(stats),
            gold:       stats.gold || 0,
            // For the building upgrade-tree modal: which tree nodes are already bought.
            ownedUpgrades: [...(stats.ownedUpgrades || [])],
            // Per-unit techs owned: { unitId: [techId, ...] } (tech defs come from collections)
            unitTechs: JSON.parse(JSON.stringify(stats.unitTechs || {})),
            // Which unit types the player currently fields (tech gating in the UI)
            ownedUnitTypes: [...new Set((stats.heroRoster || []).map(e => this._resolveSpawnType(e)))],
            // This round's 1-of-3 reinforcement pick (null once picked)
            pendingReinforcement: stats.pendingReinforcement && !stats.pendingReinforcement.picked
                ? { options: stats.pendingReinforcement.options } : null,
            locked: this._lockedUnits(stats),
            techDiscount: stats.techDiscount || 0,
            skillCharges: [...(stats.skillCharges || [])]
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
            if (!ownedTechs.has(t.id)) continue;
            if (t.statModifiers) this._applyStatMods(combat, health, t.statModifiers);
            if (t.grantAntiAir) info.canTargetAir = true;
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
                    const cost = ArmyShopSystem.unitPrice(id, this.collections.units?.[id]);
                    if ((stats.gold || 0) < cost) continue;
                    if (this.buyUnlockedUnit(pid, id)?.success) progress = true;
                }
                // Then one affordable unit tech for a fielded type.
                if (this._aiBuyOneTech(stats, pid)) progress = true;
                // Then a squad level-up with a comfortable purse.
                if (this._aiBuyOneLevel(stats, pid)) progress = true;
                // Then a tier unlock when there's spare gold to also buy it.
                if (this._aiBuyOneUnlock(stats, pid)) progress = true;
                // Then one affordable shop offer with whatever's left.
                if (buyOneOffer()) progress = true;
            }
        }
    }
}
