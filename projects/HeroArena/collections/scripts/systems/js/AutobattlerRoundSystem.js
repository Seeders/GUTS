// Drives the HeroArena round loop: heroSelect → placement → battle → resolve → repeat.
// Server is authoritative; clients receive phase change broadcasts via ClientNetworkSystem.
class AutobattlerRoundSystem extends GUTS.BaseSystem {

    static services = [
        'startLeaderSelect',
        'confirmLeaderSelection',
        'confirmHeroSelection',
        'startHeroSelect',
        'startPrep'
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
        'cullDestroyedBuildings',
        'townhallLevel'
    ];

    // Hero class options shown during selection
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
        this.pendingHeroSelections = {}; // { numericPlayerId: heroClassId }
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
        if (this.game.state.isLocalGame) {
            const aiLeader = this.game.rng.strand('ai').pick(AutobattlerRoundSystem.LEADERS);
            setTimeout(() => this.confirmLeaderSelection(1, aiLeader.id), 0);
        }
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

    // Called after leader select is complete, or at milestones.
    startHeroSelect(isMilestone = false) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        this.isMilestoneSelect = isMilestone;
        this.pendingHeroSelections = {};
        this.game.state.phase = this.enums.gamePhase.heroSelect;
        const payload = { options: AutobattlerRoundSystem.HERO_CLASSES, isMilestone, round: this.game.state.round };
        this.call.broadcastToRoom(null, 'HERO_SELECT_START', payload);
        this.game.triggerEvent('onHeroSelectStart', payload);
        if (this.game.state.isLocalGame) {
            const aiClass = this.game.rng.strand('ai').pick(AutobattlerRoundSystem.HERO_CLASSES);
            setTimeout(() => this.confirmHeroSelection(1, aiClass.id), 0);
        }
    }

    // Receives a hero selection from a player. Called by ServerNetworkSystem.
    confirmHeroSelection(numericPlayerId, heroClassId) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return { success: false };
        if (this.game.state.phase !== this.enums.gamePhase.heroSelect &&
            this.game.state.phase !== this.enums.gamePhase.milestone) {
            return { success: false, reason: 'wrong_phase' };
        }

        const heroClass = AutobattlerRoundSystem.HERO_CLASSES.find(c => c.id === heroClassId);
        if (!heroClass) return { success: false, reason: 'invalid_class' };

        this.pendingHeroSelections[numericPlayerId] = heroClassId;

        // Heroes derive all combat/health stats from their unitType definition
        // (spawned fresh each round by HeroRosterSystem). The roster entry just
        // records the chosen class and progression.
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.playerId === numericPlayerId) {
                if (!Array.isArray(stats.heroRoster)) stats.heroRoster = [];
                stats.heroRoster.push({
                    heroClass:    heroClassId,
                    spawnType:    heroClass.spawnType,
                    roundsPlayed: 0,
                    level:        1,
                    xp:           0
                });
                if (!Array.isArray(stats.unlockedUnits)) stats.unlockedUnits = [];
                if (!stats.unlockedUnits.includes(heroClass.spawnType)) {
                    stats.unlockedUnits.push(heroClass.spawnType);
                }
                break;
            }
        }

        // If all players have selected, advance to prep
        if (Object.keys(this.pendingHeroSelections).length >= 2) {
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
        this.call.spawnHeroesForRound();
        // Roll this round's shop offers (after the army has spawned so a buy can
        // spawn the new unit incrementally without double-spawning the roster).
        this.call.generateOffersForRound();
        // Prompt/auto-resolve any tier-1 units that reached the specialization level.
        this.call.processSpecializations();
        // Replicate the freshly-spawned army to clients (multiplayer) so they render
        // and can position units this prep. No-op in local.
        this.call.syncEntitiesToClients?.();
        this.call.broadcastToRoom(null, 'PREP_PHASE_START', {
            round: this.game.state.round
        });
        this.game.triggerEvent('onPlacementPhaseStart');
    }

    // ─── Server-side: round resolution ─────────────────────────────────────────

    // Called by AutobattlerBattlePhaseSystem after battle ends with survivor data.
    resolveRound(survivingUnitsByTeam) {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;

        // Permanently remove buildings destroyed this battle (they do not respawn) and drop
        // any upgrades they were providing. Surviving buildings are healed next startPrep.
        this.call.cullDestroyedBuildings?.();

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

        // Army growth now comes from the shop every prep phase (no milestone re-pick).
        this.startPrep();
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    _advanceToPrep() {
        const payload = { selections: this.pendingHeroSelections };
        this.call.broadcastToRoom(null, 'HERO_SELECT_COMPLETE', payload);
        this.game.triggerEvent('onHeroSelectComplete', payload);
        this.startPrep();
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
