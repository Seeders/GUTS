// Drives the HeroArena round loop: heroSelect → placement → battle → resolve → repeat.
// Server is authoritative; clients receive phase change broadcasts via ClientNetworkSystem.
class AutobattlerRoundSystem extends GUTS.BaseSystem {

    static services = [
        'startLeaderSelect',
        'confirmLeaderSelection',
        'confirmHeroSelection',
        'startHeroSelect',
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
        'scheduleAction',
        'reapplyStandingOrders',
        'autoSpawnGoldMines',
        'resolveGoldMineCaptures',
        'getGoldMinePositions',
        'moveHero',
        'getStartingLocationsFromLevel',
        'tileToWorld',
        'getOwnedBuildingIds',
        'placeBuildingAuto'
    ];

    // AI battle-order heuristics (skirmish/headless only — online has no AI).
    static MINE_MIN_ARMY = 4;    // need at least this many units before sparing a mine detachment
    static MINE_FRACTION = 0.4;  // ~this share of the army peels off to contest one mine

    // AI prep-phase formation (units form up ahead of their Town Hall, facing the enemy).
    static FORM_SPACING = 48;        // gap between units along a row
    static FORM_ROW_SPACING = 48;    // gap between rows
    static FORM_FORWARD_OFFSET = 200; // round-1 distance the front row sits ahead of base
    static FORM_ADVANCE_PER_ROUND = 220; // extra forward distance added each round (presses the attack)
    static FORM_MAX_ADVANCE_FRAC = 0.45; // never form up past this fraction of the way to the enemy (stay on our half)

    // Attribute buildings offered as the starting pick (and the round-MILESTONE_ROUND
    // bonus pick). Each grants its archetype, which gates what the shop offers.
    static ATTRIBUTE_BUILDINGS = ['barracks', 'fletchersHall', 'mageTower'];
    // Round on which a one-time bonus "choose another building" select fires.
    static MILESTONE_ROUND = 5;

    // Hero class options (legacy — kept for reference; selection now picks a building)
    static HERO_CLASSES = [
        { id: 'barbarian',  label: 'Barbarian',  archetype: 'STR',     spawnType: '1_s_barbarian'  },
        { id: 'apprentice', label: 'Apprentice', archetype: 'INT',     spawnType: '1_i_apprentice' },
        { id: 'archer',     label: 'Archer',     archetype: 'DEX',     spawnType: '1_d_archer'     },
        { id: 'acolyte',    label: 'Acolyte',    archetype: 'STR/INT', spawnType: '1_is_acolyte'   },
        { id: 'soldier',    label: 'Soldier',    archetype: 'STR/DEX', spawnType: '1_sd_soldier'   },
        { id: 'scout',      label: 'Scout',      archetype: 'INT/DEX', spawnType: '1_di_scout'     }
    ];

    static LEADERS = [
        { id: 'commander',  label: 'The Commander',  bonus: '+10% HP to all STR heroes' },
        { id: 'alchemist',  label: 'The Alchemist',  bonus: '+5 bonus gold each round' },
        { id: 'warlord',    label: 'The Warlord',    bonus: 'Win streaks grant +1 bonus gold' },
        { id: 'scholar',    label: 'The Scholar',    bonus: '+15% spell damage to INT heroes' },
        { id: 'ranger',     label: 'The Ranger',     bonus: '+15% attack damage to DEX heroes' },
        { id: 'trickster',  label: 'The Trickster',  bonus: 'DEX heroes gain +10% evasion' }
    ];

    constructor(game) {
        super(game);
        this.game.autobattlerRoundSystem = this;
        this.pendingLeaderSelections = {}; // { numericPlayerId: leaderId }
        this.pendingBuildingSelections = {}; // { numericPlayerId: buildingId }
        this.isMilestoneSelect = false;
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
        const payload = { options: AutobattlerRoundSystem.LEADERS };
        this.call.broadcastToRoom(null, 'LEADER_SELECT_START', payload);
        // Direct trigger for same-instance delivery (local mode + server-side in multiplayer)
        this.game.triggerEvent('onLeaderSelectStart', payload);
        // AI picks go through the deterministic game-time scheduler, NOT
        // setTimeout: the headless run loop is a tight await chain that starves
        // wall-clock timers, and game-time delays keep replays deterministic.
        for (const pid of this.getAIPlayerIds()) {
            const forced = this.game.state.skirmishConfig?.leaders?.[pid];
            const leader = AutobattlerRoundSystem.LEADERS.find(l => l.id === forced)
                || this.game.rng.strand('ai').pick(AutobattlerRoundSystem.LEADERS);
            this.call.scheduleAction(() => this.confirmLeaderSelection(pid, leader.id), 0.1, null);
        }
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

        this.pendingLeaderSelections[numericPlayerId] = leaderId;
        this.call.selectLeader(numericPlayerId, leaderId);

        if (Object.keys(this.pendingLeaderSelections).length >= 2) {
            this.startHeroSelect(false);
        }
        return { success: true };
    }

    // The attribute buildings a player may still pick (not already owned).
    _availableBuildingIds(numericPlayerId) {
        const owned = new Set(this.call.getOwnedBuildingIds?.(numericPlayerId) || []);
        return AutobattlerRoundSystem.ATTRIBUTE_BUILDINGS.filter(id => !owned.has(id));
    }

    // Option cards for the select overlay: all three attribute buildings (already-owned
    // picks are rejected server-side in confirmHeroSelection, so one broadcast is valid
    // even when players own different buildings at a milestone).
    _buildingSelectOptions() {
        return AutobattlerRoundSystem.ATTRIBUTE_BUILDINGS.map(id => {
            const def = this.collections.buildings?.[id] || {};
            return { id, label: def.title || id, archetype: (def.archetype || '').toUpperCase() };
        });
    }

    // True if any player can still pick a new attribute building (gates the milestone).
    _anyPlayerCanPickBuilding() {
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            if (this._availableBuildingIds(stats.playerId).length > 0) return true;
        }
        return false;
    }

    // Called after leader select is complete (starting pick), or at the milestone.
    // The player picks a BUILDING here, not a hero — it auto-places (free) in startPrep.
    startHeroSelect(isMilestone = false) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        this.isMilestoneSelect = isMilestone;
        this.pendingBuildingSelections = {};
        // Only players who still have an unowned attribute building are expected to pick;
        // a milestone where someone already owns all three must not deadlock the advance.
        this._expectedSelections = this.call.getPlayerEntities()
            .map(eid => this.game.getComponent(eid, 'playerStats'))
            .filter(s => s && this._availableBuildingIds(s.playerId).length > 0)
            .length;
        this.game.state.phase = this.enums.gamePhase.heroSelect;
        const payload = { options: this._buildingSelectOptions(), isMilestone, round: this.game.state.round };
        this.call.broadcastToRoom(null, 'HERO_SELECT_START', payload);
        this.game.triggerEvent('onHeroSelectStart', payload);
        // Game-time scheduler, not setTimeout — see startLeaderSelect.
        for (const pid of this.getAIPlayerIds()) {
            const available = this._availableBuildingIds(pid);
            if (available.length === 0) continue; // owns all three; nothing to pick
            const forced = this.game.state.skirmishConfig?.buildings?.[pid];
            const buildingId = available.includes(forced)
                ? forced
                : this.game.rng.strand('ai').pick(available);
            this.call.scheduleAction(() => this.confirmHeroSelection(pid, buildingId), 0.1, null);
        }
    }

    // Receives a building selection from a player. Called by ServerNetworkSystem
    // (the wire field is still named heroClassId; it now carries a building id).
    // No hero is granted — the chosen building auto-places (free) in startPrep, and its
    // archetype gates what the shop offers.
    confirmHeroSelection(numericPlayerId, buildingId) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return { success: false };
        if (this.game.state.phase !== this.enums.gamePhase.heroSelect &&
            this.game.state.phase !== this.enums.gamePhase.milestone) {
            return { success: false, reason: 'wrong_phase' };
        }

        const def = this.collections.buildings?.[buildingId];
        if (!AutobattlerRoundSystem.ATTRIBUTE_BUILDINGS.includes(buildingId) || def?.buyable !== true) {
            return { success: false, reason: 'invalid_building' };
        }
        if ((this.call.getOwnedBuildingIds?.(numericPlayerId) || []).includes(buildingId)) {
            return { success: false, reason: 'already_owned' };
        }

        // Record the pick; it's placed in startPrep (needs the Town Hall to exist first).
        this.pendingBuildingSelections[numericPlayerId] = buildingId;

        // Advance once every player who could pick has picked.
        if (Object.keys(this.pendingBuildingSelections).length >= (this._expectedSelections || 1)) {
            this._advanceToPrep();
        }

        return { success: true };
    }

    startPrep() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        this.call.grantRoundIncome();
        this.game.state.phase = this.enums.gamePhase.placement;
        // Buildings: ensure each player has a Town Hall (round 1 only — the game ends
        // the moment a Town Hall is destroyed, so this never re-creates one). Buildings
        // keep their battle damage across rounds: no healing, no respawning.
        this.call.autoSpawnTownHalls?.();
        // Place each player's chosen starting/milestone building (free) — needs the Town
        // Hall to exist (above) and runs before the shop offers roll (below) so the
        // archetype is already owned when units are gated.
        this._placePendingStartingBuildings();
        // Starting sentries (ramp guard + forward outpost) — round 1 only, one-and-done.
        this.call.autoSpawnStartingSentries?.();
        // Neutral gold veins (dragon-guarded) in the free corners — clear the dragon
        // and hold a vein to auto-build a gold mine that pays income each round.
        this.call.autoSpawnGoldMines?.();
        this.call.spawnHeroesForRound();
        // Standing orders persist round to round: re-apply each hero's saved
        // order (snapshotted at last battle start) to its respawned unit, and
        // mirror to online clients through the squad-targets broadcast.
        const standing = this.call.reapplyStandingOrders?.();
        if (standing?.placementIds?.length && !this.game.state.isLocalGame) {
            this.call.broadcastToRoom(null, 'OPPONENT_SQUAD_TARGETS_SET', {
                placementIds: standing.placementIds,
                targetPositions: standing.targetPositions,
                meta: { isMoveOrder: true },
                issuedTime: this.game.state.now
            });
        }
        // Roll this round's shop offers (after the army has spawned so a buy can
        // spawn the new unit incrementally without double-spawning the roster).
        this.call.generateOffersForRound();
        // Prompt/auto-resolve any tier-1 units that reached the specialization level.
        this.call.processSpecializations();
        // AI players form their army up into a facing formation ahead of their Town
        // Hall (after buys/specializations so the whole army is included). Runs before
        // the sync so clients receive the arranged positions.
        this._repositionAIArmies();
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

    // Called by AutobattlerBattlePhaseSystem after battle ends with survivor data.
    resolveRound(survivingUnitsByTeam) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;

        // Permanently remove buildings destroyed this battle (they do not respawn) and drop
        // any upgrades they were providing. Surviving buildings are healed next startPrep.
        this.call.cullDestroyedBuildings?.();

        // Gold mine captures: most living units in range of a mine right now
        // (before heroes despawn) captures it for this round → gold bonus.
        this.call.resolveGoldMineCaptures?.();

        const leftSurvivors = survivingUnitsByTeam[this.enums.team.left] || [];
        const rightSurvivors = survivingUnitsByTeam[this.enums.team.right] || [];

        let winningTeam = null;
        if (leftSurvivors.length > 0 && rightSurvivors.length === 0) {
            winningTeam = this.enums.team.left;
        } else if (rightSurvivors.length > 0 && leftSurvivors.length === 0) {
            winningTeam = this.enums.team.right;
        }

        // Update win/loss streaks (leader bonuses key off these). Rounds carry no
        // abstract player damage — the only way to win is destroying the Town Hall.
        this._updateStreaks(winningTeam);

        // Check game over
        if (this._checkGameOver()) return;

        // Despawn this round's hero entities before next round
        this.call.despawnBattleHeroes();

        // Advance round counter
        this.game.state.round += 1;

        // One-time milestone: a free "choose another building" pick (skipped if everyone
        // already owns all three). Otherwise army growth comes from the shop each prep.
        if (this.game.state.round === AutobattlerRoundSystem.MILESTONE_ROUND
            && this._anyPlayerCanPickBuilding()) {
            this.startHeroSelect(true); // → confirm → _advanceToPrep → startPrep
        } else {
            this.startPrep();
        }
    }

    // With finite vision (fog of war), units only advance under an attack-move
    // order. AI players never place orders themselves, so at each battle start
    // give every AI army a single attack-move at its enemy's Town Hall.
    // Online matches have no AI players and are unaffected.
    onBattleStart() {
        for (const pid of this.getAIPlayerIds()) {
            const aiTeam = this._teamOf(pid);
            if (aiTeam == null) continue;
            this._issueAIBattleOrders(aiTeam);
        }
    }

    // Fair, non-cheating battle orders for one AI army. The main force attacks the
    // enemy Town Hall; once the army can spare a detachment, the squads nearest a
    // gold-vein objective peel off to contest it: kill the guardian dragon, hold a
    // cleared vein (→ its mine auto-builds), or destroy an enemy-owned mine.
    // Concentrates on a single (nearest) objective and always leaves at least one
    // squad attacking. Uses only player-available info (own positions, objective +
    // Town Hall locations) and is deterministic (sorted with tie-breaks, no random).
    _issueAIBattleOrders(aiTeam) {
        const now = this.game.state.now;
        const enemyTH = this._enemyBasePos(aiTeam);
        const squads = this._movableSquadsForTeam(aiTeam);
        if (squads.length === 0) return;

        const totalUnits = squads.reduce((n, s) => n + s.count, 0);

        // Choose a vein objective to contest (the one nearest the army's centroid),
        // but only when the army is large enough to split without giving up the main
        // fight. Skips veins we already hold a mine on (nothing to contest there).
        let mineTarget = null;
        const mines = this.call.getContestableObjectives?.(aiTeam) || [];
        if (mines.length > 0 && squads.length >= 2 &&
            totalUnits >= AutobattlerRoundSystem.MINE_MIN_ARMY) {
            const cx = squads.reduce((a, s) => a + s.pos.x, 0) / squads.length;
            const cz = squads.reduce((a, s) => a + s.pos.z, 0) / squads.length;
            mineTarget = this._nearestMine(mines, cx, cz);
        }

        // No mine worth contesting (or no Town Hall found): send everyone at the
        // best available objective.
        if (!mineTarget || !enemyTH) {
            const fallback = enemyTH || (mineTarget ? { x: mineTarget.x, z: mineTarget.z } : null);
            if (!fallback) return;
            for (const s of squads) {
                this.call.applySquadTargetPosition(s.placementId, fallback, { isMoveOrder: true }, now);
            }
            return;
        }

        // Peel the squads closest to the mine until ~MINE_FRACTION of the army is
        // committed, always keeping at least one squad on the attack.
        const quota = Math.max(1, Math.round(totalUnits * AutobattlerRoundSystem.MINE_FRACTION));
        const byMine = [...squads].sort((a, b) =>
            (this._dist2(a.pos, mineTarget) - this._dist2(b.pos, mineTarget)) ||
            (a.placementId - b.placementId));
        const mineSquads = new Set();
        let committed = 0;
        for (const s of byMine) {
            if (committed >= quota) break;
            if (mineSquads.size >= squads.length - 1) break; // keep ≥1 attacker
            mineSquads.add(s.placementId);
            committed += s.count;
        }

        for (const s of squads) {
            const target = mineSquads.has(s.placementId)
                ? { x: mineTarget.x, z: mineTarget.z }
                : { x: enemyTH.x, z: enemyTH.z };
            this.call.applySquadTargetPosition(s.placementId, target, { isMoveOrder: true }, now);
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
            for (const uid of units) {
                const pos = this.game.getComponent(uid, 'transform')?.position;
                if (pos) { sx += pos.x; sz += pos.z; n++; }
            }
            if (n === 0) continue;
            squads.push({ placementId: p.placementId, count: units.length, pos: { x: sx / n, z: sz / n } });
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
        // Anchor off the level's starting locations (not the Town Hall entity — its
        // buildingOwner tag isn't assigned yet this early in startPrep).
        const locs = this.call.getStartingLocationsFromLevel?.();
        if (!locs || locs[aiTeam] == null) return;
        const enemyTeam = Object.keys(locs).map(Number).find(t => t !== aiTeam);
        if (enemyTeam == null) return;
        const myStart = this.call.tileToWorld(locs[aiTeam].x, locs[aiTeam].z);
        const enemyStart = this.call.tileToWorld(locs[enemyTeam].x, locs[enemyTeam].z);
        if (!myStart || !enemyStart) return;

        // This team's movable units, sorted melee-first (low attack range to the
        // front rows); ties broken by entity id for determinism.
        const units = [];
        for (const p of (this.call.getPlacementsForSide(aiTeam) || [])) {
            for (const uid of (p?.squadUnits || [])) {
                if (uid == null || this.game.entityAlive?.[uid] !== 1) continue;
                if (this.game.getComponent(uid, 'buildingOwner')) continue;
                if (!this.game.getComponent(uid, 'heroRosterInfo')) continue;
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
        const cols = Math.max(1, Math.min(N, Math.ceil(Math.sqrt(N))));
        const rows = Math.ceil(N / cols);

        // The army presses forward over the match: the formation advances toward the
        // enemy each round so the AI eventually assaults even a defensive opponent
        // (positions don't otherwise carry round to round). Capped at our own half of
        // the map so the AI never sets up on the enemy's side — as fair as a human,
        // who positions on their own side too. The in-battle march covers the rest.
        const baseToBase = elen;
        const advance = Math.min(
            AutobattlerRoundSystem.FORM_FORWARD_OFFSET +
                Math.max(0, (this.game.state.round || 1) - 1) * AutobattlerRoundSystem.FORM_ADVANCE_PER_ROUND,
            baseToBase * AutobattlerRoundSystem.FORM_MAX_ADVANCE_FRAC
        );
        // Front row sits this far ahead of our base; later rows recede back toward it.
        const anchor = {
            x: myStart.x + enemyDir.x * advance,
            z: myStart.z + enemyDir.z * advance
        };

        for (let i = 0; i < N; i++) {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const unitsInRow = (row < rows - 1) ? cols : (N - cols * (rows - 1));
            const colOffset = (col - (unitsInRow - 1) / 2) * S;
            const rowOffset = row * RS;
            const x = anchor.x + frontDir.x * colOffset - enemyDir.x * rowOffset;
            const z = anchor.z + frontDir.z * colOffset - enemyDir.z * rowOffset;
            this.call.moveHero(units[i].uid, x, z, rotationY);
        }
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

    _advanceToPrep() {
        const payload = { selections: this.pendingBuildingSelections };
        this.call.broadcastToRoom(null, 'HERO_SELECT_COMPLETE', payload);
        this.game.triggerEvent('onHeroSelectComplete', payload);
        this.startPrep();
    }

    // Auto-place each player's pending starting/milestone building. Called from startPrep
    // AFTER autoSpawnTownHalls (placeBuildingAuto positions relative to the Town Hall) and
    // is FREE (placeBuildingAuto never charges gold). Consumes the pending map so a
    // building isn't re-placed on later rounds' startPrep.
    _placePendingStartingBuildings() {
        const selections = this.pendingBuildingSelections || {};
        for (const pidStr of Object.keys(selections)) {
            const pid = Number(pidStr);
            const buildingId = selections[pidStr];
            if (!buildingId) continue;
            const res = this.call.placeBuildingAuto?.(pid, buildingId);
            if (!res?.success) {
                console.warn('[AutobattlerRoundSystem] starting building placement failed:',
                    pid, buildingId, res?.reason);
            }
        }
        this.pendingBuildingSelections = {};
    }

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

    // The match ends when a Town Hall is destroyed. cullDestroyedBuildings has
    // already pruned dead buildings from stats.buildings this resolve, so a player
    // with townhallLevel 0 lost theirs this battle.
    _checkGameOver() {
        const playerEntities = this.call.getPlayerEntities();
        const standing = [];
        const eliminated = [];

        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            if (this.call.townhallLevel(stats.playerId) > 0) standing.push(stats.playerId);
            else eliminated.push(stats.playerId);
        }

        if (eliminated.length === 0) return false;

        const result = {
            // Both Town Halls down in the same battle is a draw (winner null).
            winner: standing.length === 1 ? standing[0] : null,
            reason: 'townhall_destroyed',
            totalRounds: this.game.state.round
        };
        this.call.broadcastGameEnd(result);
        this.game.endGame(result);
        return true;
    }
}
