// Drives the HeroArena round loop (Mechabellum-style):
//   leaderSelect → prep (buy + place) → battle → resolve → prep → ...
//
// Scoring: each player has Commander HP. After every battle, each side takes
// damage equal to the total value of the ENEMY's surviving units. First
// commander at 0 HP loses. Deployment is permanent: once a unit has fought a
// battle it respawns at its saved position every round and can no longer be
// repositioned or sold. Battles are fully automatic — every squad attack-moves
// on the enemy base at battle start (no player orders).
//
// Server is authoritative; clients receive phase change broadcasts via ClientNetworkSystem.
class AutobattlerRoundSystem extends GUTS.BaseSystem {

    static services = [
        'startLeaderSelect',
        'confirmLeaderSelection',
        'startPrep',
        'getAIPlayerIds'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'broadcastToRoom',
        'sendToPlayer',
        'broadcastGameEnd',
        'spawnHeroesForRound',
        'despawnBattleHeroes',
        'grantRoundIncome',
        'spawnCommandBuildings',
        'applySplashDamage',
        'createUnit',
        'applyLevelScaling',
        'applyArmyUpgrades',
        'applyArmyAbilities',
        'selectLeader',
        'generateOffersForRound',
        'processSpecializations',
        'syncEntitiesToClients',
        'autoSpawnTownHalls',
        'autoSpawnStartingSentries',
        'cullDestroyedBuildings',
        'townhallLevel',
        'getPlacementsForSide',
        'applySquadTargetPosition',
        'applyUnitTargetPosition',
        'scheduleAction',
        'reapplyStandingOrders',
        'autoSpawnGoldMines',
        'resolveGoldMineCaptures',
        'getGoldMinePositions',
        'moveHero',
        'getStartingLocationsFromLevel',
        'tileToWorld',
        'getOwnedBuildingIds'
    ];

    // Commander HP: each surviving enemy unit deals its deployment supply cost as
    // damage after every battle. First commander at 0 loses. Sized in raw
    // Mechabellum supply — starting tower HP there runs ~4100-5000 (base +
    // specialist + unit set); our median sits ~3500. Each leader overrides it via
    // LEADERS[].hp — strong perks bring less HP, weak ones more (3000-4000).
    static COMMANDER_HP = 3500;

    // AI prep-phase formation for NEWLY BOUGHT units (veterans hold their spots).
    static FORM_SPACING = 48;        // gap between units along a row
    static FORM_ROW_SPACING = 48;    // gap between rows
    static FORM_FORWARD_OFFSET = 260; // distance the formation anchor sits ahead of base

    // Leader options come straight from LeaderSystem.LEADERS (the Mechabellum
    // starting specialists) — single source of truth for labels AND effects.
    static get LEADERS() {
        return GUTS.LeaderSystem?.LEADERS || [];
    }

    constructor(game) {
        super(game);
        this.game.autobattlerRoundSystem = this;
        this.pendingLeaderSelections = {}; // { numericPlayerId: leaderId }
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────────────

    // Kicks off the match flow. In LOCAL games we start immediately (single
    // instance, listeners already wired). In ONLINE games the server waits for a
    // PLAYER_LOADED handshake from every client (ServerNetworkSystem) before
    // calling startLeaderSelect — otherwise the LEADER_SELECT_START broadcast can
    // fire before clients have registered their listeners and is missed.
    onGameStarted() {
        if (this.game.state?.isLocalGame) {
            this.startLeaderSelect();
        }
    }

    // ─── Server-side: round loop entry points ──────────────────────────────────

    startLeaderSelect() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        // Seed the AI-selection strand from the game seed so local and headless runs
        // are reproducible for a given seed (server-side only, no lockstep impact).
        this.game.rng.strand('ai').reseed(GUTS.SeededRandom.combineSeed(
            this.game.state.gameSeed || 1,
            GUTS.SeededRandom.hashString('ai')
        ));
        this.pendingLeaderSelections = {};
        this.game.state.phase = this.enums.gamePhase.leaderSelect;

        // Draft: each player is offered 3 random commanders (not all 9), and each
        // commander comes with 2 random tier-1 starting squads shown on its card.
        // The draft is stored per player so confirm can grant the chosen squads.
        const draftRng = this.game.rng.strand('leaderDraft');
        draftRng.reseed(GUTS.SeededRandom.combineSeed(
            this.game.state.gameSeed || 1,
            GUTS.SeededRandom.hashString('leaderDraft')
        ));
        const draftsByPlayer = {};
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            // Seed the player's chosen deck (loadout) for the whole match. Null ⇒ no
            // deck ⇒ full global content (pre-deck behavior). Read here because
            // skirmishConfig is set by now and every downstream reader runs after.
            stats.deck = this.game.state.skirmishConfig?.decks?.[stats.playerId] || null;
            const draft = this._rollLeaderDraft(draftRng, stats);
            stats.leaderDraft = draft;
            draftsByPlayer[stats.playerId] = draft;
        }

        const payload = { draftsByPlayer };
        this.call.broadcastToRoom(null, 'LEADER_SELECT_START', payload);
        // Direct trigger for same-instance delivery (local mode + server-side in multiplayer)
        this.game.triggerEvent('onLeaderSelectStart', payload);
        // AI picks go through the deterministic game-time scheduler, NOT
        // setTimeout: the headless run loop is a tight await chain that starves
        // wall-clock timers, and game-time delays keep replays deterministic.
        for (const pid of this.getAIPlayerIds()) {
            const draft = draftsByPlayer[pid] || [];
            // Forced pick only honored if it survived the deck's ban filter (in the draft).
            const forced = this.game.state.skirmishConfig?.leaders?.[pid];
            const pick = (forced && draft.find(d => d.id === forced) && forced)
                || draft[Math.floor(this.game.rng.strand('ai').next() * draft.length)]?.id
                || draft[0]?.id
                || AutobattlerRoundSystem.LEADERS[0]?.id;
            this.call.scheduleAction(() => this.confirmLeaderSelection(pid, pick), 0.1, null);
        }
    }

    // Roll a 4-commander draft: 4 distinct random leaders, each carrying 2 random
    // tier-1 starting squads. Deterministic given the strand's seed. The player's
    // deck (if any) bans commanders from the pool (units are never restricted).
    _rollLeaderDraft(rng, stats = null) {
        const banned = new Set(stats?.deck?.bannedCommanders || []);
        const pool = AutobattlerRoundSystem.LEADERS.filter(l => !banned.has(l.id));
        const units = this.collections.units || {};
        const t1 = Object.keys(units).filter(id =>
            GUTS.ArmyShopSystem.unitTier(id) === 1 && !GUTS.ArmyShopSystem.NOT_OFFERED?.has?.(id));
        const draft = [];
        for (let i = 0; i < 4 && pool.length; i++) {
            const l = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
            const squads = [], sp = t1.slice();
            for (let j = 0; j < 2 && sp.length; j++) {
                squads.push(sp.splice(Math.floor(rng.next() * sp.length), 1)[0]);
            }
            draft.push({ id: l.id, label: l.label, bonus: l.bonus, hp: l.hp, startingSquads: squads });
        }
        return draft;
    }

    // Numeric player ids controlled by the built-in AI.
    // Online: none. Local skirmish: the opponent (1). Headless simulation: both.
    getAIPlayerIds() {
        if (!this.game.state?.isLocalGame) return [];
        if (this.game.state.isHeadlessSimulation) return [0, 1];
        return [1];
    }

    _teamOf(numericPlayerId) {
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats?.playerId === numericPlayerId) return stats.team;
        }
        return null;
    }

    // Receives a leader selection from a player. Called by ServerNetworkSystem.
    confirmLeaderSelection(numericPlayerId, leaderId) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return { success: false };
        if (this.game.state.phase !== this.enums.gamePhase.leaderSelect) {
            return { success: false, reason: 'wrong_phase' };
        }
        const leaderDef = AutobattlerRoundSystem.LEADERS.find(l => l.id === leaderId);
        if (!leaderDef) return { success: false, reason: 'invalid_leader' };
        // Reject a commander the player's deck bans.
        for (const eid of this.call.getPlayerEntities()) {
            const st = this.game.getComponent(eid, 'playerStats');
            if (st?.playerId !== numericPlayerId) continue;
            if ((st.deck?.bannedCommanders || []).includes(leaderId)) {
                return { success: false, reason: 'commander_banned' };
            }
            break;
        }

        this.pendingLeaderSelections[numericPlayerId] = leaderId;
        this.call.selectLeader(numericPlayerId, leaderId);

        // Queue the chosen commander's two starting squads (granted round 1 in
        // ArmyShopSystem._applyLeaderRoundPerks). Only the drafted pick carries them.
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats?.playerId !== numericPlayerId) continue;
            const entry = (stats.leaderDraft || []).find(d => d.id === leaderId);
            stats.pendingStartingSquads = entry?.startingSquads ? [...entry.startingSquads] : [];
            break;
        }

        if (Object.keys(this.pendingLeaderSelections).length >= 2) {
            // Initialize commander HP for both players — per-leader (Mechabellum:
            // specialist HP compensates perk strength) — then straight to prep
            // (the building pick is gone — units gate on tier unlocks instead).
            for (const entityId of this.call.getPlayerEntities()) {
                const stats = this.game.getComponent(entityId, 'playerStats');
                if (!stats) continue;
                const leaderDef = AutobattlerRoundSystem.LEADERS.find(l => l.id === stats.leaderId);
                const hp = leaderDef?.hp || AutobattlerRoundSystem.COMMANDER_HP;
                stats.commanderHP = hp;
                stats.commanderMaxHP = hp;
            }
            // Campaign: the run system owns the flow from here (map screen,
            // node entry, resume) — no immediate prep.
            if (this.game.campaignRunSystem?.isCampaignMode?.()) {
                this.game.campaignRunSystem.onLeadersReady();
            } else {
                this.startPrep();
            }
        }
        return { success: true };
    }

    startPrep() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        this.call.grantRoundIncome();
        this.game.state.phase = this.enums.gamePhase.placement;
        // Command buildings: Town Hall + the production slot (a Cottage until the
        // player converts it), one per flank. Respawns any that fell last battle
        // (fresh HP each round), as whatever the slot currently holds.
        this.call.spawnCommandBuildings?.();
        // Respawn the persistent army: every purchased squad returns at its saved
        // battle position (deployment is permanent — Mechabellum-style).
        this.call.spawnHeroesForRound();
        // Roll this round's shop state (after the army has spawned so a buy can
        // spawn the new unit incrementally without double-spawning the roster).
        this.call.generateOffersForRound();
        // AI players form up their NEWLY BOUGHT units ahead of their base
        // (veterans hold their saved positions). Runs before the sync so clients
        // receive the arranged positions.
        if (!this.game.campaignRunSystem?.isCampaignMode?.()) this._repositionAIArmies();
        // Replicate the freshly-spawned army to clients (multiplayer) so they render
        // and can position units this prep. No-op in local.
        this.call.syncEntitiesToClients?.();
        this.call.broadcastToRoom(null, 'PREP_PHASE_START', {
            round: this.game.state.round
        });
        this.game.triggerEvent('onPlacementPhaseStart');

        // AI prep is already done (auto-buy ran inside generateOffersForRound):
        // ready up shortly after on the deterministic game clock. In local games
        // the battle still waits for the human player's ready.
        for (const pid of this.getAIPlayerIds()) {
            const team = this._teamOf(pid);
            if (team == null) continue;
            this.call.scheduleAction(() => {
                if (this.game.state.phase !== this.enums.gamePhase.placement) return;
                this.game.call('handleReadyForBattle',
                    { playerId: pid, numericPlayerId: pid, data: { team } }, null);
            }, 0.5, null);
        }
    }

    // ─── Server-side: round resolution ─────────────────────────────────────────

    // Called by ServerBattlePhaseSystem after battle ends with survivor data.
    resolveRound(survivingUnitsByTeam) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;

        const leftSurvivors = survivingUnitsByTeam[this.enums.team.left] || [];
        const rightSurvivors = survivingUnitsByTeam[this.enums.team.right] || [];

        let winningTeam = null;
        if (leftSurvivors.length > 0 && rightSurvivors.length === 0) {
            winningTeam = this.enums.team.left;
        } else if (rightSurvivors.length > 0 && leftSurvivors.length === 0) {
            winningTeam = this.enums.team.right;
        }

        // Commander damage: each side takes the total VALUE of the enemy's
        // survivors (a timeout hurts both; a wipe hurts only the loser).
        const damageToTeam = {};
        damageToTeam[this.enums.team.left] = this._survivorDamage(rightSurvivors);
        damageToTeam[this.enums.team.right] = this._survivorDamage(leftSurvivors);

        // Campaign: only the PLAYER's run HP matters — the enemy shell's
        // commander is meaningless and must never decide anything.
        const campaign = this.game.campaignRunSystem?.isCampaignMode?.();
        if (campaign) {
            const enemyStats = (() => {
                for (const eid of this.call.getPlayerEntities()) {
                    const st = this.game.getComponent(eid, 'playerStats');
                    if (st && st.playerId !== 0) return st;
                }
                return null;
            })();
            if (enemyStats) damageToTeam[enemyStats.team] = 0;
        }

        // Compute (but DON'T apply yet) each side's commander damage: the HP
        // pool drains visually as the orbs land, so the real subtraction
        // happens when the volley finishes (end of the hold below) — the bar
        // never snaps down and refills.
        const hpReport = [];
        const pendingDamage = [];
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            const dmg = damageToTeam[stats.team] || 0;
            const hpAfter = Math.max(0,
                (stats.commanderHP ?? AutobattlerRoundSystem.COMMANDER_HP) - dmg);
            pendingDamage.push({ stats, hpAfter });
            hpReport.push({ playerId: stats.playerId, team: stats.team,
                damage: dmg, commanderHP: hpAfter });
        }
        const applyCommanderDamage = () => {
            for (const p of pendingDamage) p.stats.commanderHP = p.hpAfter;
        };

        // Per-survivor orb data for the client damage-orb effect (Mechabellum):
        // each surviving squad member launches an orb from its battlefield
        // position at the victim's commander HP bar. Integer damages sum
        // exactly to the report's damage, so the bar drain matches orb-by-orb.
        const orbs = [];
        const addOrbs = (survivors, victimTeam) => {
            if (!(damageToTeam[victimTeam] > 0)) return;   // campaign zeroes the enemy side
            let acc = 0, given = 0;
            for (const { eid, raw } of this._survivorDamageBreakdown(survivors)) {
                acc += raw;
                const dmg = Math.round(acc) - given;
                given += dmg;
                const pos = this.game.getComponent(eid, 'transform')?.position;
                if (!pos || dmg <= 0) continue;
                orbs.push({ x: pos.x, y: pos.y || 0, z: pos.z, damage: dmg, victimTeam });
            }
        };
        addOrbs(rightSurvivors, this.enums.team.left);
        addOrbs(leftSurvivors, this.enums.team.right);

        const roundResult = { round: this.game.state.round, winningTeam, report: hpReport, orbs };
        this.call.broadcastToRoom(null, 'ROUND_RESULT', roundResult);
        this.game.triggerEvent('onRoundResult', roundResult);

        if (campaign) {
            // Campaign node resolution: hand the result to the run system
            // (map return / reward / replay / run end). Skip streaks, the
            // dual-commander game-over check, and the skirmish round loop.
            // No orb hold here — damage lands immediately.
            applyCommanderDamage();
            this.call.despawnBattleHeroes();
            const playerTeam = (() => {
                for (const eid of this.call.getPlayerEntities()) {
                    const st = this.game.getComponent(eid, 'playerStats');
                    if (st && st.playerId === 0) return st.team;
                }
                return this.enums.team.left;
            })();
            this.game.campaignRunSystem.onNodeResolved(winningTeam === playerTeam);
            return;
        }

        // Update win/loss streaks (leader bonuses key off these).
        this._updateStreaks(winningTeam);

        // Hold the battlefield for a beat so the client damage-orb effect can
        // play over the surviving armies, then resolve the round for real.
        const holdSecs = orbs.length ? 2.5 : 0.5;
        this.call.scheduleAction(() => {
            // The battlefield stayed frozen (battleIntermission) with the
            // battle-end guard held through the hold; prep re-opens normally.
            this.game.state.battleIntermission = false;

            // The orb volley has landed: NOW the commander damage is real.
            applyCommanderDamage();

            // Check game over (a commander at 0 HP)
            if (this._checkGameOver()) return;

            // Despawn this round's entities before next round
            this.call.despawnBattleHeroes();

            // Advance round counter
            this.game.state.round += 1;
            this.startPrep();
        }, holdSecs, null);
    }

    // Survivor damage scale. Mechabellum-exact is 1.0 (survivors deal their
    // deployment cost) — but Mechabellum's pacing relies on close 1v1s where
    // only a fraction of an army survives a round. Against our AI, one-sided
    // rounds leave the WHOLE army standing every round, and cumulative-army
    // damage grows quadratically (dead by round 4). Half cost restores the
    // intended pacing: total stomps end ~round 5-6, close games 10-14.
    static SURVIVOR_DAMAGE_SCALE = 0.5;

    // Commander damage carried by each surviving unit: its squad's DEPLOYMENT
    // price (scaled), split across members — no level/rank multiplier, and
    // giants deal slightly less than cost (Mechabellum: 400-supply Fortress
    // deals 350 → ×0.875 on tiers 3-4).
    _survivorDamageBreakdown(survivorIds) {
        const Shop = this.game.armyShopSystem?.constructor;
        const scale = AutobattlerRoundSystem.SURVIVOR_DAMAGE_SCALE;
        const out = [];
        for (const eid of survivorIds) {
            const unitTypeComp = this.game.getComponent(eid, 'unitType');
            const def = this.game.getUnitTypeDef?.(unitTypeComp);
            const squadPrice = Shop?.unitPrice
                ? Shop.unitPrice(def?.id, def)
                : (Shop?.shopCost ? Shop.shopCost(def?.value || 25)
                    : Math.max(1, Math.ceil((def?.value || 25) / 5 * (100 / 7)))); // supply scale
            const members = Math.max(1, (def?.squadWidth || 1) * (def?.squadHeight || 1));
            const giantFactor = (Shop?.unitTier?.(def?.id) >= 3) ? 0.875 : 1;
            out.push({ eid, raw: (squadPrice / members) * giantFactor * scale });   // each member carries its share
        }
        return out;
    }

    _survivorDamage(survivorIds) {
        return Math.round(this._survivorDamageBreakdown(survivorIds)
            .reduce((s, u) => s + u.raw, 0));
    }

    // Battles are fully automatic (no player orders): at battle start EVERY
    // squad on BOTH teams gets a single attack-move at the enemy's base. Units
    // engage whatever they meet on the way; tactics live in deployment.
    onBattleStart() {
        // NOTE: no server/local gate — battle orders and ability lists are
        // deterministic sim state that multiplayer clients must apply too.
        const teams = [this.enums.team.left, this.enums.team.right];
        for (const team of teams) {
            this._issueBattleOrders(team);
        }
        this._nextRetargetAt = (this.game.state.now || 0) + AutobattlerRoundSystem.RETARGET_INTERVAL;

        // Rebuild every roster unit's ability list from owned techs. Spawn-time
        // def abilities can land AFTER the prep-phase rebuild (post-creation
        // setup is async), which silently gave respawned units their full def
        // ability list for free — making ability techs look like they did
        // nothing. By battle start all setup is done, so this pass is final.
        for (const eid of this.game.getEntitiesWith('heroRosterInfo')) {
            if (this.game.entityAlive?.[eid] !== 1) continue;
            this.call.applyArmyAbilities?.(eid);
        }
    }

    // March flow: each squad advances on its nearest living enemy PRESENCE —
    // units and structures compete on pure distance — fighting whatever enters
    // vision along the way (the order tree yields to combat). Units count as
    // march objectives so a fast flyer with an empty vision bubble turns
    // toward the closest enemy squad instead of beelining across the map to a
    // building; structures still get attacked when they're the nearest thing
    // left standing.
    static RETARGET_INTERVAL = 2;

    update() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        if (this.game.state.phase !== this.enums.gamePhase.battle) return;
        const now = this.game.state.now || 0;
        if (now < (this._nextRetargetAt || 0)) return;
        this._nextRetargetAt = now + AutobattlerRoundSystem.RETARGET_INTERVAL;

        for (const team of [this.enums.team.left, this.enums.team.right]) {
            // Nearest enemy presence wins — units and buildings on equal
            // footing, matching in-vision combat targeting.
            const targets = this._livingEnemyBuildingPositions(team)
                .concat(this._livingEnemyUnitPositions(team));
            if (targets.length === 0) continue;
            for (const s of this._movableSquadsForTeam(team)) {
                const anchor = s.pos;
                let best = null, bestD = Infinity;
                for (const t of targets) {
                    // Never march at something the squad can't attack — a
                    // ground-only squad chasing a fairy just stands under it.
                    if (t.isFlying && !s.canHitAir) continue;
                    const d = (t.x - anchor.x) ** 2 + (t.z - anchor.z) ** 2;
                    if (d < bestD) { bestD = d; best = t; }
                }
                if (best) {
                    this.call.applySquadTargetPosition(s.placementId,
                        { x: best.x, z: best.z }, { isMoveOrder: true }, now);
                }
            }
            // Summons (raised/reassembled skeletons, wolves, …) belong to no
            // placement, so the squad loop above never reaches them — without
            // their own march order they idle once nearby enemies are dead.
            for (const eid of this._movableSummonsForTeam(team)) {
                const anchor = this.game.getComponent(eid, 'transform')?.position;
                if (!anchor) continue;
                const summonHitsAir = this._canHitAir(eid);
                let best = null, bestD = Infinity;
                for (const t of targets) {
                    if (t.isFlying && !summonHitsAir) continue;
                    const d = (t.x - anchor.x) ** 2 + (t.z - anchor.z) ** 2;
                    if (d < bestD) { bestD = d; best = t; }
                }
                if (best) {
                    this.call.applyUnitTargetPosition(eid,
                        { x: best.x, z: best.z }, { isMoveOrder: true }, now);
                }
            }
        }
    }

    // Living, mobile summons on `team` (no placement — see retarget loop).
    _movableSummonsForTeam(team) {
        const out = [];
        for (const eid of this.game.getEntitiesWith('summoned')) {
            if (this.game.entityAlive?.[eid] !== 1) continue;
            const t = this.game.getComponent(eid, 'team');
            if (!t || t.team !== team) continue;
            if (this.game.getComponent(eid, 'buildingOwner')) continue;
            const hp = this.game.getComponent(eid, 'health');
            if (!hp || hp.current <= 0) continue;
            const ds = this.game.getComponent(eid, 'deathState');
            if (ds && ds.state !== this.enums.deathState.alive) continue;
            out.push(eid);
        }
        out.sort((a, b) => a - b);
        return out;
    }

    // On-death unit-tech mechanics (Mechabellum-style). Rules:
    //   - Reassemble (once): first death rebuilds the skeleton at its corpse
    //     (the corpse is consumed by the rebuild — no explode, no raise).
    //   - Bone Blast: fires on a REAL death only (i.e. when no reassemble is
    //     available/left), and the blast leaves NO corpse behind.
    //   - Necromancer-raised skeletons obey the same rules via their owning
    //     player's techs; the reassembled/raised copies are per-battle summons.
    onUnitKilled(entityId) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        if (this.game.state.phase !== this.enums.gamePhase.battle) return;

        const def = this.game.getUnitTypeDef(this.game.getComponent(entityId, 'unitType'));
        if (!def?.id) return;
        const team = this.game.getComponent(entityId, 'team')?.team;
        if (team == null) return;
        const stats = this._statsByTeam(team);
        if (!stats) return;
        const ownedTechs = stats.unitTechs?.[def.id];
        if (!ownedTechs?.length) return;
        // Deck-aware: the effective tech list may be customized by the player's deck.
        const catalog = this.game.armyShopSystem?._unitTechsFor
            ? this.game.armyShopSystem._unitTechsFor(stats, def.id)
            : (this.collections.unitTechs?.[def.id]?.abilityPool || [])
                .map(id => this.collections.abilityPool?.[id]).filter(Boolean)
                .map(p => { const { requirements, innate, ...t } = p; return { ...t, id: p.id }; });
        const techs = catalog.filter(t => ownedTechs.includes(t.id));
        const pos = this.game.getComponent(entityId, 'transform')?.position;
        if (!pos) return;

        const info = this.game.getComponent(entityId, 'heroRosterInfo');
        const summoned = this.game.getComponent(entityId, 'summoned');
        const alreadyReassembled = !!(info?.reassembled || summoned?.reassembled);

        const reassembleTech = techs.find(t => t.onDeathReassemble);
        const explodeTech = techs.find(t => t.onDeathExplode);
        const at = { x: pos.x, y: pos.y, z: pos.z };

        if (reassembleTech && !alreadyReassembled) {
            // First death: rebuild — corpse is consumed by the rebuild.
            const level = info?.level || 1;
            const rosterIndex = info?.rosterIndex;
            this.game.schedulingSystem?.scheduleAction(() => {
                if (this.game.state.phase !== this.enums.gamePhase.battle) return;
                this._removeCorpse(entityId);
                this._reassembleUnit(stats, rosterIndex, def.id, level, at);
            }, 2.5, entityId);
            return;
        }

        if (explodeTech) {
            // Real death: detonate, and the blast leaves no corpse.
            this.call.applySplashDamage(entityId, at,
                explodeTech.onDeathExplode.damage || 45,
                this.enums.element.fire,
                explodeTech.onDeathExplode.radius || 70,
                { allowFriendlyFire: false });
            this.game.schedulingSystem?.scheduleAction(() => {
                this._removeCorpse(entityId);
            }, 2, entityId);
        }
    }

    // Destroy a dead unit's remains once the death pipeline has produced them
    // (deathState reaches corpse ~death-animation time after onUnitKilled).
    _removeCorpse(entityId) {
        const ds = this.game.getComponent(entityId, 'deathState');
        if (!ds || ds.state === this.enums.deathState.alive) return;
        try { this.game.destroyEntity(entityId); } catch (_) {}
    }

    _statsByTeam(team) {
        for (const eid of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(eid, 'playerStats');
            if (stats?.team === team) return stats;
        }
        return null;
    }

    _statsByPlayerId(numericPlayerId) {
        for (const eid of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(eid, 'playerStats');
            if (stats?.playerId === numericPlayerId) return stats;
        }
        return null;
    }

    _rosterSpawnType(entry) {
        return entry.spawnType
            || this.game.heroRosterSystem?.constructor?.CLASS_SPAWN_MAP?.[entry.heroClass]
            || entry.heroClass;
    }

    // Rebuild one squad member at its corpse position. The respawn is tagged
    // `summoned` (auto-cleaned at round end) with reassembled=true (once only).
    _reassembleUnit(stats, rosterIndex, spawnType, level, at) {
        const enums = this.game.getEnums();
        const collectionIndex = enums.objectTypeDefinitions?.units ?? -1;
        const typeIndex = enums.units?.[spawnType] ?? -1;
        if (typeIndex < 0) return;
        const newId = this.call.createUnit(collectionIndex, typeIndex,
            { position: { x: at.x, y: at.y, z: at.z } }, stats.team);
        if (newId == null) return;
        if (rosterIndex != null) {
            this.game.addComponent(newId, 'heroRosterInfo', {
                playerId: stats.playerId, rosterIndex, level, reassembled: true
            });
            // Level scaling + owned techs/upgrades apply like any respawn.
            this.call.applyLevelScaling?.(newId);
            this.call.applyArmyUpgrades?.(newId);
            this.call.applyArmyAbilities?.(newId);
        }
        this.game.addComponent(newId, 'summoned', { ownerId: newId, reassembled: true });
    }

    // Positions of living enemy army units (the hunt, once buildings are gone).    // Positions of living enemy army units (the hunt, once buildings are gone).
    _livingEnemyUnitPositions(team) {
        const out = [];
        for (const eid of this.game.getEntitiesWith('heroRosterInfo')) {
            if (this.game.entityAlive?.[eid] !== 1) continue;
            const t = this.game.getComponent(eid, 'team');
            if (!t || t.team === team) continue;
            if (t.team !== this.enums.team.left && t.team !== this.enums.team.right) continue;
            const hp = this.game.getComponent(eid, 'health');
            if (!hp || hp.current <= 0) continue;
            const ds = this.game.getComponent(eid, 'deathState');
            if (ds && ds.state !== this.enums.deathState.alive) continue;
            const pos = this.game.getComponent(eid, 'transform')?.position;
            if (!pos) continue;
            const def = this.game.getUnitTypeDef(this.game.getComponent(eid, 'unitType'));
            out.push({ x: pos.x, z: pos.z, isFlying: !!def?.isFlying });
        }
        return out;
    }

    // Whether this unit can attack flying targets: def flags, or the
    // tech-granted heroRosterInfo.canTargetAir (Skyward Pikes etc.).
    _canHitAir(eid) {
        const def = this.game.getUnitTypeDef(this.game.getComponent(eid, 'unitType'));
        if (def?.canTargetAir || def?.isFlying) return true;
        return !!this.game.getComponent(eid, 'heroRosterInfo')?.canTargetAir;
    }

    // Positions of every living enemy BUILDING of `team` (march objectives).
    _livingEnemyBuildingPositions(team) {
        const out = [];
        for (const eid of this.game.getEntitiesWith('buildingOwner')) {
            if (this.game.entityAlive?.[eid] !== 1) continue;
            const t = this.game.getComponent(eid, 'team');
            if (!t || t.team === team) continue;
            const hp = this.game.getComponent(eid, 'health');
            if (!hp || hp.current <= 0) continue;
            const pos = this.game.getComponent(eid, 'transform')?.position;
            if (pos) out.push({ x: pos.x, z: pos.z });
        }
        return out;
    }

    _issueBattleOrders(team) {
        const now = this.game.state.now;
        const enemyBase = this._enemyBasePos(team);
        if (!enemyBase) return;

        // Enemy command buildings: each squad attack-moves at whichever one is
        // closest to where it deployed — flank deployments assault the flank
        // tower, center deployments push the nearer objective. Falls back to
        // the enemy base position if no buildings stand.
        const targets = [];
        for (const eid of this.game.getEntitiesWith('buildingOwner')) {
            if (this.game.entityAlive?.[eid] !== 1) continue;
            const t = this.game.getComponent(eid, 'team');
            if (!t || t.team === team) continue;
            const hp = this.game.getComponent(eid, 'health');
            if (!hp || hp.current <= 0) continue;
            const pos = this.game.getComponent(eid, 'transform')?.position;
            if (pos) targets.push({ x: pos.x, z: pos.z });
        }
        if (targets.length === 0) targets.push({ x: enemyBase.x, z: enemyBase.z });

        for (const s of this._movableSquadsForTeam(team)) {
            const anchor = s.pos || enemyBase;   // squad centroid from _movableSquadsForTeam
            let best = targets[0], bestD = Infinity;
            for (const t of targets) {
                const d = (t.x - anchor.x) ** 2 + (t.z - anchor.z) ** 2;
                if (d < bestD) { bestD = d; best = t; }
            }
            this.call.applySquadTargetPosition(s.placementId,
                { x: best.x, z: best.z }, { isMoveOrder: true }, now);
        }
    }

    // Own-team squads whose units can move (excludes building placements and dead
    // units). Each entry carries a living-unit count and a representative position.
    _movableSquadsForTeam(aiTeam) {
        const placements = this.call.getPlacementsForSide(aiTeam) || [];
        const squads = [];
        for (const p of placements) {
            if (p?.placementId == null) continue;
            const units = (p.squadUnits || []).filter(uid =>
                uid != null &&
                this.game.entityAlive?.[uid] === 1 &&
                !this.game.getComponent(uid, 'buildingOwner'));
            if (units.length === 0) continue;
            let sx = 0, sz = 0, n = 0;
            let canHitAir = false;
            for (const uid of units) {
                const pos = this.game.getComponent(uid, 'transform')?.position;
                if (pos) { sx += pos.x; sz += pos.z; n++; }
                if (!canHitAir && this._canHitAir(uid)) canHitAir = true;
            }
            if (n === 0) continue;
            squads.push({ placementId: p.placementId, count: units.length, pos: { x: sx / n, z: sz / n }, canHitAir });
        }
        return squads;
    }

    _nearestMine(mines, x, z) {
        let best = null, bestD = Infinity;
        for (const m of mines) {
            const d = this._dist2(m, { x, z });
            if (d < bestD) { bestD = d; best = m; }
        }
        return best;
    }

    _dist2(a, b) {
        const dx = a.x - b.x, dz = a.z - b.z;
        return dx * dx + dz * dz;
    }

    // Prep-phase positioning: each AI army forms up ahead of its Town Hall, facing
    // the enemy, with melee in the front rows and ranged behind. Deterministic and
    // uses only player-available info — the AI counterpart to the player's
    // right-click formation drag.
    _repositionAIArmies() {
        for (const pid of this.getAIPlayerIds()) {
            const team = this._teamOf(pid);
            if (team == null) continue;
            this._formUpArmy(team);
        }
    }

    _formUpArmy(aiTeam) {
        // Anchor off the level's starting locations.
        const locs = this.call.getStartingLocationsFromLevel?.();
        if (!locs || locs[aiTeam] == null) return;
        const enemyTeam = Object.keys(locs).map(Number).find(t => t !== aiTeam);
        if (enemyTeam == null) return;
        const myStart = this.call.tileToWorld(locs[aiTeam].x, locs[aiTeam].z);
        const enemyStart = this.call.tileToWorld(locs[enemyTeam].x, locs[enemyTeam].z);
        if (!myStart || !enemyStart) return;

        // Only NEWLY BOUGHT units get positioned (their roster entries have no
        // lastPosition yet). Veterans are locked to their saved battle positions —
        // deployment is permanent for the AI exactly as it is for the human.
        // Sorted melee-first (low attack range to the front); ties by id.
        const units = [];
        let lockedCount = 0;
        for (const p of (this.call.getPlacementsForSide(aiTeam) || [])) {
            for (const uid of (p?.squadUnits || [])) {
                if (uid == null || this.game.entityAlive?.[uid] !== 1) continue;
                if (this.game.getComponent(uid, 'buildingOwner')) continue;
                const info = this.game.getComponent(uid, 'heroRosterInfo');
                if (!info) continue;
                const entry = this._rosterEntryFor(aiTeam, info);
                if (entry?.lastPosition) { lockedCount++; continue; } // veteran: holds position
                const range = this.game.getComponent(uid, 'combat')?.range ?? 0;
                units.push({ uid, range });
            }
        }
        if (units.length === 0) return;
        units.sort((a, b) => (a.range - b.range) || (a.uid - b.uid));

        // Enemy direction; the front line runs perpendicular to it and units face it.
        const ex = enemyStart.x - myStart.x, ez = enemyStart.z - myStart.z;
        const elen = Math.hypot(ex, ez) || 1;
        const enemyDir = { x: ex / elen, z: ez / elen };
        const frontDir = { x: -enemyDir.z, z: enemyDir.x };
        const rotationY = Math.atan2(enemyDir.z, enemyDir.x);

        const N = units.length;
        const S = AutobattlerRoundSystem.FORM_SPACING;
        const RS = AutobattlerRoundSystem.FORM_ROW_SPACING;
        const cols = 6;

        // New units form up in rows behind the veterans' block: skip as many rows
        // as the veterans already fill so fresh squads never stack onto locked ones.
        const startRow = Math.ceil(lockedCount / cols);
        const anchor = {
            x: myStart.x + enemyDir.x * AutobattlerRoundSystem.FORM_FORWARD_OFFSET,
            z: myStart.z + enemyDir.z * AutobattlerRoundSystem.FORM_FORWARD_OFFSET
        };

        for (let i = 0; i < N; i++) {
            const row = startRow + Math.floor(i / cols);
            const col = i % cols;
            const unitsInRow = Math.min(cols, N - Math.floor(i / cols) * cols);
            const colOffset = (col - (unitsInRow - 1) / 2) * S;
            const rowOffset = row * RS;
            const x = anchor.x + frontDir.x * colOffset - enemyDir.x * rowOffset;
            const z = anchor.z + frontDir.z * colOffset - enemyDir.z * rowOffset;
            this.call.moveHero(units[i].uid, x, z, rotationY);
        }
    }

    // Roster entry for a live unit (by its heroRosterInfo), looked up via the
    // owning player's stats on the given team.
    _rosterEntryFor(team, info) {
        for (const eid of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(eid, 'playerStats');
            if (stats?.playerId === info.playerId) {
                return stats.heroRoster?.[info.rosterIndex] || null;
            }
        }
        return null;
    }

    // Enemy base position = the enemy's starting location, where their Town Hall
    // sits. We attack-move at this fixed map position rather than at any specific
    // enemy unit, so the army marches on their base (engaging whatever it meets en
    // route) instead of chasing a single target entity.
    _enemyBasePos(aiTeam) {
        const locs = this.call.getStartingLocationsFromLevel?.();
        if (!locs || locs[aiTeam] == null) return null;
        const enemyTeam = Object.keys(locs).map(Number).find(t => t !== aiTeam);
        if (enemyTeam == null || locs[enemyTeam] == null) return null;
        return this.call.tileToWorld(locs[enemyTeam].x, locs[enemyTeam].z);
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    _updateStreaks(winningTeam) {
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            if (winningTeam === null) {
                // Draw: reset both streaks
                stats.winStreak = 0;
                stats.lossStreak = 0;
            } else if (stats.team === winningTeam) {
                stats.winStreak = (stats.winStreak || 0) + 1;
                stats.lossStreak = 0;
            } else {
                stats.lossStreak = (stats.lossStreak || 0) + 1;
                stats.winStreak = 0;
            }
        }
    }

    // The match ends when a commander reaches 0 HP. If both hit 0 the same
    // round, the higher remaining HP would have won — both at exactly 0 is a
    // draw (winner null).
    _checkGameOver() {
        const playerEntities = this.call.getPlayerEntities();
        const standing = [];
        const eliminated = [];

        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            const hp = stats.commanderHP ?? AutobattlerRoundSystem.COMMANDER_HP;
            if (hp > 0) standing.push(stats.playerId);
            else eliminated.push(stats.playerId);
        }

        if (eliminated.length === 0) return false;

        const result = {
            winner: standing.length === 1 ? standing[0] : null,
            reason: 'commander_defeated',
            totalRounds: this.game.state.round
        };
        this.call.broadcastGameEnd(result);
        this.game.endGame(result);
        return true;
    }
}
