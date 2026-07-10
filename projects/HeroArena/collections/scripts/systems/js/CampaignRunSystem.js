// Spire March — the single-player campaign run. SERVER-AUTHORITATIVE (local).
//
// A RUN is a branching map of ~12 nodes (battle / elite / shop / boss). The
// player's army is the deck: playerStats.heroRoster persists across every
// node. Commander HP persists across the WHOLE run — each battle's surviving
// enemies deal their value as damage; 0 = run over. Winning a node queues a
// 1-of-3 reward (delivered through the existing reinforcement-pick overlay at
// the next node's prep). Losing a node deals damage and the node is REPLAYED
// (same seeded encounter) while HP remains.
//
// The enemy is player 1's stats shell with no economy: each node this system
// builds its army directly (fund → buy → level → position → zero the purse),
// the exact technique proven in balance_matchups.mjs.
class CampaignRunSystem extends GUTS.BaseSystem {

    static services = [
        'isCampaignMode',
        'enterCampaignNode',
        'onLeadersReady',
        'onNodeResolved',
        'getCampaignState',
        'rollCampaignRewards',
        'shouldGrantNodeIncome',
        'saveCampaignRun',
        'loadCampaignRun',
        'clearCampaignRun'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'broadcastToRoom',
        'broadcastGameEnd',
        'buyUnlockedUnit',
        'respawnRosterEntry',
        'getHeroEntityIds',
        'getStartingLocationsFromLevel',
        'tileToWorld',
        'moveHero'
    ];

    static SAVE_KEY = 'heroarena_run_v1';
    static LAYERS = 12;             // node depth of a run (boss at the end)
    static BUDGET_BASE = 14;        // enemy gold at depth 1 ≈ the player's opening purse
    static BUDGET_PER_DEPTH = 7;    // one tier-1 squad of pressure per depth
    static ELITE_MULT = 1.5;
    static SHOP_LAYERS = [4, 8];    // 1-based layers pinned as shops
    static ELITE_CHANCE = 0.25;     // from layer 3+

    constructor(game) {
        super(game);
        this.game.campaignRunSystem = this;
        this.run = null;             // live run state (see _newRun)
        this._nodeIncomeGranted = new Set();   // nodeIds that already paid income
        this._memoryStore = {};      // headless localStorage fallback
    }

    // ─── Mode gate ───────────────────────────────────────────────────────────────

    isCampaignMode() {
        return !!this.game.state?.skirmishConfig?.campaignMode;
    }

    // ─── Run lifecycle ───────────────────────────────────────────────────────────

    // Called by AutobattlerRoundSystem.confirmLeaderSelection instead of
    // startPrep() when campaignMode. Fresh run: generate; resume: restore.
    onLeadersReady() {
        if (!this.isCampaignMode()) return;
        const resume = this.game.state.skirmishConfig?.campaignResume;
        if (resume && resume.version === 1) {
            this._restoreRun(resume);
        } else {
            this._startNewRun();
        }
        this._showMap();
    }

    _startNewRun() {
        const seed = this.game.state.gameSeed || 1;
        this.game.rng.strand('campaign').reseed(GUTS.SeededRandom.combineSeed(
            seed, GUTS.SeededRandom.hashString('campaign')));
        const stats = this._playerStats();
        if (stats) stats.gold = 0;   // runs start broke — node income is the economy
        this.run = {
            version: 1,
            seed,
            level: this.game.state.skirmishConfig?.selectedLevel || 'battleplain',
            leaderId: stats?.leaderId || null,
            commanderHP: stats?.commanderHP ?? (GUTS.AutobattlerRoundSystem?.COMMANDER_HP ?? 3500),
            depth: 0,                      // layers cleared
            currentNodeId: null,
            state: 'map',
            map: this._generateMap(),
            pendingReward: null,
            roster: [], unitTechs: {}, tierUnlocks: [],
            ownedUpgrades: [], ownedAbilities: [], skillCharges: [],
            gold: 0
        };
        this.saveCampaignRun();
    }

    _restoreRun(saved) {
        this.run = saved;
        const stats = this._playerStats();
        if (!stats) return;
        stats.commanderHP = saved.commanderHP;
        stats.gold = saved.gold || 0;
        stats.leaderId = saved.leaderId || stats.leaderId;
        stats.heroRoster = (saved.roster || []).map(e => ({ ...e }));
        stats.unitTechs = { ...(saved.unitTechs || {}) };
        stats.tierUnlocks = [...(saved.tierUnlocks || [])];
        stats.ownedUpgrades = [...(saved.ownedUpgrades || [])];
        stats.ownedAbilities = [...(saved.ownedAbilities || [])];
        stats.skillCharges = [...(saved.skillCharges || [])];
        stats.pendingReinforcement = null;
        this.run.state = 'map';
        this.run.currentNodeId = null;
    }

    // ─── Map generation (pure, seeded) ───────────────────────────────────────────

    _generateMap() {
        const rng = this.game.rng.strand('campaign');
        const L = CampaignRunSystem.LAYERS;
        const layers = [];
        for (let li = 0; li < L; li++) {
            const isBoss = li === L - 1;
            const width = isBoss ? 1 : (li === 0 ? 2 : 2 + Math.floor(rng.next() * 2));
            const layer = [];
            for (let ni = 0; ni < width; ni++) {
                let type = 'battle';
                if (isBoss) type = 'boss';
                else if (CampaignRunSystem.SHOP_LAYERS.includes(li + 1) && ni === 0) type = 'shop';
                else if (li >= 2 && rng.next() < CampaignRunSystem.ELITE_CHANCE) type = 'elite';
                layer.push({
                    id: `n${li}_${ni}`, layer: li, index: ni, type,
                    edges: [], cleared: false,
                    encounterSeed: Math.floor(rng.next() * 1e9)
                });
            }
            layers.push(layer);
        }
        // Edges: each node → 1-2 positionally nearest nodes in the next layer.
        for (let li = 0; li < L - 1; li++) {
            const cur = layers[li], next = layers[li + 1];
            for (const node of cur) {
                const rel = node.index / Math.max(1, cur.length - 1 || 1);
                const scored = next.map(n2 => ({
                    id: n2.id,
                    d: Math.abs((n2.index / Math.max(1, next.length - 1 || 1)) - rel)
                })).sort((a, b) => a.d - b.d);
                const take = Math.min(next.length, 1 + (rng.next() < 0.5 ? 1 : 0));
                node.edges = scored.slice(0, take).map(s => s.id);
            }
            // Repair: every next-layer node needs in-degree ≥ 1.
            for (const n2 of next) {
                if (!cur.some(n => n.edges.includes(n2.id))) {
                    const nearest = cur.reduce((a, b) =>
                        Math.abs(a.index - n2.index) <= Math.abs(b.index - n2.index) ? a : b);
                    nearest.edges.push(n2.id);
                }
            }
        }
        return { layers };
    }

    _findNode(nodeId) {
        for (const layer of this.run?.map?.layers || []) {
            for (const node of layer) if (node.id === nodeId) return node;
        }
        return null;
    }

    // Nodes the player may enter next: layer 0 while depth 0, else nodes
    // connected from the cleared node of the previous layer.
    _reachableNodeIds() {
        if (!this.run) return [];
        const depth = this.run.depth;
        if (depth >= CampaignRunSystem.LAYERS) return [];
        if (depth === 0) return this.run.map.layers[0].map(n => n.id);
        const prev = this.run.map.layers[depth - 1].find(n => n.cleared);
        return prev ? [...prev.edges] : this.run.map.layers[depth].map(n => n.id);
    }

    // ─── Node entry ──────────────────────────────────────────────────────────────

    enterCampaignNode(numericPlayerId, nodeId) {
        if (!this.isCampaignMode()) return { success: false, reason: 'not_campaign' };
        if (!this.run) return { success: false, reason: 'no_run' };
        if (this.game.state.phase !== this.enums.gamePhase.campaignMap) {
            return { success: false, reason: 'wrong_phase' };
        }
        if (!this._reachableNodeIds().includes(nodeId)) {
            return { success: false, reason: 'unreachable' };
        }
        const node = this._findNode(nodeId);
        if (!node) return { success: false, reason: 'no_node' };

        this.run.currentNodeId = nodeId;
        this.run.state = 'prep';
        // Depth drives income + encounter scale + shop/offer seeding.
        this.game.state.round = node.layer + 1;

        // Fresh field: clear deployment anchors are KEPT (formation carry-over)
        // but the enemy shell resets completely.
        const enemy = this._enemyStats();
        if (enemy) {
            enemy.heroRoster = [];
            enemy.unitTechs = {};
            enemy.tierUnlocks = [];
            enemy.ownedUpgrades = [];
            enemy.ownedAbilities = [];
            enemy.pendingReinforcement = null;
            enemy.gold = 0;
            enemy.commanderHP = 999999;   // meaningless in campaign; keep alive
        }

        this._saveSoon();
        this.game.autobattlerRoundSystem.startPrep();
        return { success: true, nodeId };
    }

    // Hook: runs inside startPrep's onPlacementPhaseStart trigger — build the
    // enemy army synchronously (no ticks elapse, so the AI auto-ready timer
    // scheduled by startPrep can't fire mid-construction).
    onPlacementPhaseStart() {
        if (!this.isCampaignMode() || !this.run || this.run.state !== 'prep') return;
        const node = this._findNode(this.run.currentNodeId);
        if (node) this._spawnEnemyArmy(node);
    }

    // ─── Enemy army construction ─────────────────────────────────────────────────

    _encounterRng(node) {
        const strand = this.game.rng.strand('campaignEncounter');
        strand.reseed(GUTS.SeededRandom.combineSeed(
            this.run.seed, node.encounterSeed, 7777));
        return strand;
    }

    _spawnEnemyArmy(node) {
        const enemy = this._enemyStats();
        if (!enemy || (enemy.heroRoster || []).length > 0) return;   // already built
        const rng = this._encounterRng(node);
        const encounters = this.collections.encounters || {};

        if (node.type === 'boss') {
            const bosses = Object.values(encounters).filter(e => e.kind === 'boss' && e.final);
            const boss = bosses[0] || Object.values(encounters).find(e => e.kind === 'boss');
            if (boss) this._spawnCurated(enemy, boss);
            return;
        }
        if (node.type === 'elite' && node.layer + 1 >= 8) {
            // Deep elites can be minibosses.
            const minis = Object.values(encounters).filter(e =>
                e.kind === 'boss' && !e.final && (e.minDepth || 1) <= node.layer + 1);
            if (minis.length && rng.next() < 0.5) {
                this._spawnCurated(enemy, minis[Math.floor(rng.next() * minis.length)]);
                return;
            }
        }
        this._spawnBudgeted(enemy, node, rng);
    }

    _spawnBudgeted(enemy, node, rng) {
        const depth = node.layer + 1;
        let budget = CampaignRunSystem.BUDGET_BASE + CampaignRunSystem.BUDGET_PER_DEPTH * depth;
        if (node.type === 'elite') budget = Math.round(budget * CampaignRunSystem.ELITE_MULT);
        if (node.type === 'shop') budget = Math.round(budget * 0.7);   // lighter guard fight

        const templates = Object.values(this.collections.encounters || {})
            .filter(e => e.kind === 'template' && (e.minDepth || 1) <= depth);
        const template = templates.length
            ? templates[Math.floor(rng.next() * templates.length)]
            : { weights: { '1_sd_soldier': 1 }, formation: 'line' };

        const pool = Object.entries(template.weights || {});
        const totalW = pool.reduce((s, [, w]) => s + w, 0);
        const shop = GUTS.ArmyShopSystem;

        enemy.gold = 100000;
        const bought = [];
        let guard = 0;
        while (budget > 0 && guard++ < 60) {
            let r = rng.next() * totalW, unitId = pool[0][0];
            for (const [id, w] of pool) { r -= w; if (r <= 0) { unitId = id; break; } }
            const tier = shop.unitTier(unitId);
            const price = shop.TIER_PRICE[tier] || 7;
            if (price > budget) {
                // Try the cheapest unit in the pool before giving up.
                const cheapest = pool.map(([id]) => id)
                    .sort((a, b) => (shop.TIER_PRICE[shop.unitTier(a)] || 7) - (shop.TIER_PRICE[shop.unitTier(b)] || 7))[0];
                const cPrice = shop.TIER_PRICE[shop.unitTier(cheapest)] || 7;
                if (cPrice > budget) break;
                unitId = cheapest;
            }
            if (!enemy.tierUnlocks.includes(unitId)) enemy.tierUnlocks.push(unitId);
            const res = this.call.buyUnlockedUnit(enemy.playerId, unitId);
            if (!res?.success) break;
            budget -= shop.TIER_PRICE[shop.unitTier(unitId)] || 7;
            bought.push(enemy.heroRoster.length - 1);
        }
        // Elites convert leftover budget into squad levels.
        if (node.type === 'elite') {
            let idx = 0, levelGuard = 0;
            while (budget >= 7 && bought.length && levelGuard++ < 20) {
                const rosterIndex = bought[idx % bought.length];
                const entry = enemy.heroRoster[rosterIndex];
                const def = this.collections.units?.[entry.spawnType];
                const cost = shop.unitPrice(entry.spawnType, def) * (entry.level || 1);
                if (cost > budget) break;
                budget -= cost;
                entry.paidLevels = (entry.paidLevels || 0) + 1;
                entry.level = (entry.level || 1) + 1;
                this.call.respawnRosterEntry(enemy.playerId, rosterIndex);
                idx++;
            }
        }
        enemy.gold = 0;
        this._positionEnemyArmy(enemy, template.formation || 'line');
    }

    _spawnCurated(enemy, bossDef) {
        enemy.gold = 100000;
        const anchor = this._enemyAnchor();
        (bossDef.squads || []).forEach((sq) => {
            if (!enemy.tierUnlocks.includes(sq.unit)) enemy.tierUnlocks.push(sq.unit);
            const res = this.call.buyUnlockedUnit(enemy.playerId, sq.unit);
            if (!res?.success) return;
            const idx = enemy.heroRoster.length - 1;
            const entry = enemy.heroRoster[idx];
            if ((sq.level || 1) > 1) {
                entry.paidLevels = sq.level - 1;
                entry.level = sq.level;
                this.call.respawnRosterEntry(enemy.playerId, idx);
            }
            const members = this.call.getHeroEntityIds(enemy.playerId, idx);
            members.forEach((eid, mi) => {
                this.call.moveHero(eid,
                    anchor.x + anchor.fx * (sq.row || 0) * -70 + anchor.fx * -40,
                    anchor.z + (sq.col || 0) * 70 + (mi - (members.length - 1) / 2) * 32);
            });
        });
        enemy.gold = 0;
    }

    // Anchor + facing basis for the enemy side.
    _enemyAnchor() {
        const enemy = this._enemyStats();
        const locs = this.call.getStartingLocationsFromLevel();
        const my = locs?.[enemy.team];
        const other = Object.keys(locs || {}).map(Number).find(t => t !== enemy.team);
        const a = this.call.tileToWorld(my?.x ?? 42, my?.z ?? 24);
        const b = this.call.tileToWorld(locs?.[other]?.x ?? 5, locs?.[other]?.z ?? 24);
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        // Pull the army forward from the base toward midfield.
        return {
            x: a.x + (dx / len) * 350, z: a.z + (dz / len) * 350,
            fx: dx / len, fz: dz / len
        };
    }

    _positionEnemyArmy(enemy, formation) {
        const anchor = this._enemyAnchor();
        const roster = enemy.heroRoster || [];
        // Melee-first sort: low range to the front (same idea as _formUpArmy).
        const order = roster.map((e, i) => {
            const def = this.collections.units?.[e.spawnType] || {};
            return { i, range: def.range || 1 };
        }).sort((a, b) => a.range - b.range || a.i - b.i);

        const wide = formation === 'wide';
        const perRow = wide ? 5 : 3;
        let slot = 0;
        for (const { i } of order) {
            const members = this.call.getHeroEntityIds(enemy.playerId, i);
            const row = Math.floor(slot / perRow);
            const col = slot % perRow;
            const cx = anchor.x + anchor.fx * (formation === 'back' ? -60 : 0) - anchor.fx * row * 85;
            const cz = anchor.z + (col - (perRow - 1) / 2) * (wide ? 95 : 120);
            members.forEach((eid, mi) => {
                this.call.moveHero(eid, cx, cz + (mi - (members.length - 1) / 2) * 32);
            });
            slot++;
        }
    }

    // ─── Battle resolution ───────────────────────────────────────────────────────

    // Called by AutobattlerRoundSystem.resolveRound's campaign branch AFTER the
    // player's commander damage has been applied and heroes despawned.
    onNodeResolved(won) {
        if (!this.isCampaignMode() || !this.run) return;
        const stats = this._playerStats();
        const node = this._findNode(this.run.currentNodeId);
        this._captureRunFromStats(stats);

        if (stats.commanderHP <= 0) {
            this.clearCampaignRun();
            this.call.broadcastGameEnd({
                winner: this._enemyStats()?.playerId ?? 1,
                reason: 'commander_defeated',
                totalRounds: node ? node.layer + 1 : this.run.depth
            });
            this.game.endGame?.({ winner: 1, reason: 'commander_defeated' });
            return;
        }

        if (won && node) {
            node.cleared = true;
            this.run.depth = node.layer + 1;
            if (node.type === 'boss') {
                this.clearCampaignRun();
                this.call.broadcastGameEnd({
                    winner: stats.playerId, reason: 'run_complete',
                    totalRounds: CampaignRunSystem.LAYERS
                });
                this.game.endGame?.({ winner: stats.playerId, reason: 'run_complete' });
                return;
            }
            this.run.pendingReward = { forDepth: this.run.depth };
        }
        // Loss: node stays uncleared — replay it (same encounterSeed) while HP holds.

        this.run.currentNodeId = null;
        this.run.state = 'map';
        this.saveCampaignRun();
        this._showMap();
    }

    _showMap() {
        this.game.state.phase = this.enums.gamePhase.campaignMap;
        const payload = this.getCampaignState();
        this.call.broadcastToRoom(null, 'CAMPAIGN_MAP_SHOW', payload);
        this.game.triggerEvent('onCampaignMapShow', payload);
    }

    getCampaignState() {
        const stats = this._playerStats();
        return {
            map: this.run?.map,
            depth: this.run?.depth ?? 0,
            layers: CampaignRunSystem.LAYERS,
            reachable: this._reachableNodeIds(),
            commanderHP: stats?.commanderHP ?? this.run?.commanderHP,
            maxHP: stats?.commanderMaxHP || (GUTS.AutobattlerRoundSystem?.COMMANDER_HP ?? 3500),
            gold: stats?.gold ?? 0,
            currentNodeId: this.run?.currentNodeId || null
        };
    }

    // ─── Rewards (the 1-of-3 after a win, shown at next node's prep) ─────────────

    // Called by ArmyShopSystem.generateOffersForRound in campaign mode.
    rollCampaignRewards(stats) {
        if (!this.run?.pendingReward) return;
        const depth = this.run.pendingReward.forDepth || 1;
        this.run.pendingReward = null;

        const rng = this.game.rng.strand('campaignReward');
        rng.reseed(GUTS.SeededRandom.combineSeed(this.run.seed, depth, 4242));
        const shop = GUTS.ArmyShopSystem;
        const options = [], defs = [];

        // 1. A recruit: random legal unit (T1 always; higher tiers up to depth).
        const maxTier = depth >= 9 ? 4 : depth >= 6 ? 3 : depth >= 3 ? 2 : 1;
        const unitIds = Object.keys(this.collections.units || {})
            .filter(id => {
                const t = shop.unitTier(id);
                return t && t <= maxTier;
            });
        const unitId = unitIds[Math.floor(rng.next() * unitIds.length)];
        const unitDef = this.collections.units?.[unitId];
        options.push({
            id: 'camp_unit', title: `Recruit: ${unitDef?.title || unitId}`, icon: '🪖',
            description: `A free ${unitDef?.title || unitId} squad joins the army`
        });
        defs.push({ kind: 'specificUnit', unitId, level: depth >= 8 ? 2 : 1 });

        // 2. A free tech for a fielded type (falls back to gold if none).
        const fielded = [...new Set((stats.heroRoster || []).map(e =>
            e.spawnType || e.heroClass))].filter(id => this.collections.unitTechs?.[id]);
        let techPick = null;
        if (fielded.length) {
            const uid = fielded[Math.floor(rng.next() * fielded.length)];
            const owned = new Set(stats.unitTechs?.[uid] || []);
            const open = (this.collections.unitTechs[uid].abilityPool || [])
                .map(id => this.collections.abilityPool?.[id]).filter(Boolean)
                .filter(t => !owned.has(t.id) && !t.innate);
            if (open.length) techPick = { uid, tech: open[Math.floor(rng.next() * open.length)] };
        }
        if (techPick) {
            options.push({
                id: 'camp_tech', title: `Tech: ${techPick.tech.title}`, icon: '⚙️',
                description: `${this.collections.units?.[techPick.uid]?.title || techPick.uid}: ${techPick.tech.description}`
            });
            defs.push({ kind: 'unitTechGrant', unitId: techPick.uid, techId: techPick.tech.id });
        } else {
            options.push({ id: 'camp_gold2', title: 'Supply Cache', icon: '💰',
                description: `+${10 + 2 * depth} gold` });
            defs.push({ kind: 'gold', amount: 10 + 2 * depth });
        }

        // 3. Gold or a free level.
        if (rng.next() < 0.5 && (stats.heroRoster || []).length) {
            options.push({ id: 'camp_level', title: 'Drill Sergeant', icon: '🎖️',
                description: 'Your lowest-level squad gains a free level' });
            defs.push({ kind: 'freeLevel' });
        } else {
            options.push({ id: 'camp_gold', title: 'War Chest', icon: '💰',
                description: `+${7 + 2 * depth} gold` });
            defs.push({ kind: 'gold', amount: 7 + 2 * depth });
        }

        stats.pendingReinforcement = { options, picked: false, defs };
    }

    // ─── Node income (once per node — replays can't farm) ────────────────────────

    shouldGrantNodeIncome() {
        if (!this.isCampaignMode() || !this.run?.currentNodeId) return false;
        if (this._nodeIncomeGranted.has(this.run.currentNodeId)) return false;
        this._nodeIncomeGranted.add(this.run.currentNodeId);
        return true;
    }

    // ─── Persistence ─────────────────────────────────────────────────────────────

    _storage() {
        if (typeof localStorage !== 'undefined') return localStorage;
        const mem = this._memoryStore;
        return {
            getItem: (k) => (k in mem ? mem[k] : null),
            setItem: (k, v) => { mem[k] = String(v); },
            removeItem: (k) => { delete mem[k]; }
        };
    }

    _captureRunFromStats(stats) {
        if (!this.run || !stats) return;
        this.run.commanderHP = stats.commanderHP;
        this.run.gold = stats.gold || 0;
        this.run.leaderId = stats.leaderId || this.run.leaderId;
        this.run.roster = (stats.heroRoster || []).map(e => ({ ...e }));
        this.run.unitTechs = JSON.parse(JSON.stringify(stats.unitTechs || {}));
        this.run.tierUnlocks = [...(stats.tierUnlocks || [])];
        this.run.ownedUpgrades = [...(stats.ownedUpgrades || [])];
        this.run.ownedAbilities = [...(stats.ownedAbilities || [])];
        this.run.skillCharges = [...(stats.skillCharges || [])];
    }

    saveCampaignRun() {
        if (!this.run) return;
        this._captureRunFromStats(this._playerStats());
        try {
            this._storage().setItem(CampaignRunSystem.SAVE_KEY, JSON.stringify(this.run));
        } catch (err) {
            console.warn('[CampaignRun] save failed:', err?.message);
        }
    }

    _saveSoon() { this.saveCampaignRun(); }

    loadCampaignRun() {
        try {
            const raw = this._storage().getItem(CampaignRunSystem.SAVE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }

    clearCampaignRun() {
        try { this._storage().removeItem(CampaignRunSystem.SAVE_KEY); } catch (_) {}
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    _playerStats() { return this._statsFor(s => s.playerId === 0); }
    _enemyStats() { return this._statsFor(s => s.playerId !== 0); }

    _statsFor(pred) {
        for (const eid of this.call.getPlayerEntities()) {
            const s = this.game.getComponent(eid, 'playerStats');
            if (s && pred(s)) return s;
        }
        return null;
    }
}
