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

    // Commander HP: each surviving enemy unit deals its shop value x level as
    // damage after every battle. First commander at 0 loses. Sized like the
    // Mechabellum HQ (~15 rounds of base income) for ~10-14 round matches.
    static COMMANDER_HP = 210;

    // AI prep-phase formation for NEWLY BOUGHT units (veterans hold their spots).
    static FORM_SPACING = 48;        // gap between units along a row
    static FORM_ROW_SPACING = 48;    // gap between rows
    static FORM_FORWARD_OFFSET = 260; // distance the formation anchor sits ahead of base

    // Legacy building-pick constants (building select removed from the loop; kept
    // because ServerNetworkSystem still routes CONFIRM_HERO_SELECT here).
    static ATTRIBUTE_BUILDINGS = ['barracks', 'fletchersHall', 'mageTower'];

    // Hero class options (legacy — kept for reference; selection now picks a building)
    static HERO_CLASSES = [
        { id: 'barbarian',  label: 'Barbarian',  archetype: 'STR',     spawnType: '1_s_barbarian'  },
        { id: 'apprentice', label: 'Apprentice', archetype: 'INT',     spawnType: '1_i_apprentice' },
        { id: 'archer',     label: 'Archer',     archetype: 'DEX',     spawnType: '1_d_archer'     },
        { id: 'acolyte',    label: 'Acolyte',    archetype: 'STR/INT', spawnType: '1_is_acolyte'   },
        { id: 'soldier',    label: 'Soldier',    archetype: 'STR/DEX', spawnType: '1_sd_soldier'   },
        { id: 'scout',      label: 'Scout',      archetype: 'INT/DEX', spawnType: '1_di_scout'     }
    ];

    // Leader options come straight from LeaderSystem.LEADERS (the Mechabellum
    // starting specialists) — single source of truth for labels AND effects.
    static get LEADERS() {
        return GUTS.LeaderSystem?.LEADERS || [];
    }

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
            // Initialize commander HP for both players, then straight to prep
            // (the building pick is gone — units gate on tier unlocks instead).
            for (const entityId of this.call.getPlayerEntities()) {
                const stats = this.game.getComponent(entityId, 'playerStats');
                if (stats) stats.commanderHP = AutobattlerRoundSystem.COMMANDER_HP;
            }
            this.startPrep();
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
        // Command buildings: Town Hall + the leader's production building, one
        // per flank. Respawns any that fell last battle (fresh HP each round).
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

        const hpReport = [];
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            const dmg = damageToTeam[stats.team] || 0;
            stats.commanderHP = Math.max(0,
                (stats.commanderHP ?? AutobattlerRoundSystem.COMMANDER_HP) - dmg);
            hpReport.push({ playerId: stats.playerId, team: stats.team,
                damage: dmg, commanderHP: stats.commanderHP });
        }

        const roundResult = { round: this.game.state.round, winningTeam, report: hpReport };
        this.call.broadcastToRoom(null, 'ROUND_RESULT', roundResult);
        this.game.triggerEvent('onRoundResult', roundResult);

        // Update win/loss streaks (leader bonuses key off these).
        this._updateStreaks(winningTeam);

        // Check game over (a commander at 0 HP)
        if (this._checkGameOver()) return;

        // Despawn this round's entities before next round
        this.call.despawnBattleHeroes();

        // Advance round counter
        this.game.state.round += 1;
        this.startPrep();
    }

    // Total commander damage dealt by a list of surviving units: each unit's
    // shop value × its level — matching the stat scaling, where a rank-N squad
    // is N× as powerful (and N× as expensive) as a fresh one.
    _survivorDamage(survivorIds) {
        let total = 0;
        for (const eid of survivorIds) {
            const unitTypeComp = this.game.getComponent(eid, 'unitType');
            const def = this.game.getUnitTypeDef?.(unitTypeComp);
            const squadPrice = Math.max(1, Math.ceil((def?.value || 25) / 5)); // shop-cost scale
            const members = Math.max(1, (def?.squadWidth || 1) * (def?.squadHeight || 1));
            const level = this.game.getComponent(eid, 'heroRosterInfo')?.level || 1;
            total += (squadPrice / members) * level;   // each member carries its share
        }
        return Math.round(total);
    }

    // Battles are fully automatic (no player orders): at battle start EVERY
    // squad on BOTH teams gets a single attack-move at the enemy's base. Units
    // engage whatever they meet on the way; tactics live in deployment.
    onBattleStart() {
        const teams = [this.enums.team.left, this.enums.team.right];
        for (const team of teams) {
            this._issueBattleOrders(team);
        }
        this._nextRetargetAt = (this.game.state.now || 0) + AutobattlerRoundSystem.RETARGET_INTERVAL;
    }

    // Mechabellum target flow: the MARCH objective is always a structure —
    // each squad advances on its nearest living enemy building (then the
    // base when none stand), fighting whatever units enter vision along the
    // way (the order tree yields to combat). When a building falls, squads
    // roll on to the next nearest one instead of idling at the rubble.
    static RETARGET_INTERVAL = 2;

    update() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        if (this.game.state.phase !== this.enums.gamePhase.battle) return;
        const now = this.game.state.now || 0;
        if (now < (this._nextRetargetAt || 0)) return;
        this._nextRetargetAt = now + AutobattlerRoundSystem.RETARGET_INTERVAL;

        for (const team of [this.enums.team.left, this.enums.team.right]) {
            // March on buildings while any stand; once both are rubble, hunt
            // down the nearest enemy units to finish the round.
            let targets = this._livingEnemyBuildingPositions(team);
            if (targets.length === 0) targets = this._livingEnemyUnitPositions(team);
            if (targets.length === 0) continue;
            for (const s of this._movableSquadsForTeam(team)) {
                const anchor = s.pos;
                let best = null, bestD = Infinity;
                for (const t of targets) {
                    const d = (t.x - anchor.x) ** 2 + (t.z - anchor.z) ** 2;
                    if (d < bestD) { bestD = d; best = t; }
                }
                if (best) {
                    this.call.applySquadTargetPosition(s.placementId,
                        { x: best.x, z: best.z }, { isMoveOrder: true }, now);
                }
            }
        }
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
        const techs = (this.collections.unitTechs?.[def.id]?.techs || [])
            .filter(t => ownedTechs.includes(t.id));
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
            if (pos) out.push({ x: pos.x, z: pos.z });
        }
        return out;
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
