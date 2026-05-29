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
        'openShopForRound',
        'grantRoundIncome',
        'selectLeader'
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
        { id: 'alchemist',  label: 'The Alchemist',  bonus: 'Crafting orb costs reduced by 1g' },
        { id: 'warlord',    label: 'The Warlord',    bonus: 'Win streaks grant +1 bonus gold' },
        { id: 'scholar',    label: 'The Scholar',    bonus: '+15% spell damage to INT heroes' },
        { id: 'ranger',     label: 'The Ranger',     bonus: 'Items found have +20% chance to be one rarity higher' },
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

    // Mirrors TBW RoundSystem.onGameStarted() → onPlacementPhaseStart().
    // Kicks off the match flow once all systems and player entities are ready.
    onGameStarted() {
        if (this.game.isServer || this.game.state?.isLocalGame) {
            this.startLeaderSelect();
        }
    }

    // ─── Server-side: round loop entry points ──────────────────────────────────

    startLeaderSelect() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;
        this.pendingLeaderSelections = {};
        this.game.state.phase = this.enums.gamePhase.leaderSelect;
        const payload = { options: AutobattlerRoundSystem.LEADERS };
        this.call.broadcastToRoom(null, 'LEADER_SELECT_START', payload);
        // Direct trigger for same-instance delivery (local mode + server-side in multiplayer)
        this.game.triggerEvent('onLeaderSelectStart', payload);
        if (this.game.state.isLocalGame) {
            const aiLeader = AutobattlerRoundSystem.LEADERS[
                Math.floor(Math.random() * AutobattlerRoundSystem.LEADERS.length)
            ];
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
            const aiClass = AutobattlerRoundSystem.HERO_CLASSES[
                Math.floor(Math.random() * AutobattlerRoundSystem.HERO_CLASSES.length)
            ];
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

        // Heroes start with empty equipment — all items come from the shop.
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.playerId === numericPlayerId) {
                if (!Array.isArray(stats.heroRoster)) stats.heroRoster = [];
                stats.heroRoster.push({
                    heroClass:    heroClassId,
                    roundsPlayed: 0,
                    equipment: {
                        mainWeapon: null,
                        offhand:    null,
                        bodyArmor:  null,
                        charm:      null
                    }
                });
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
        // Grant income, then open the round-start shop — players spend gold to buy items
        // (stacking on bases they already own), reroll, or upgrade the shop.
        this.call.grantRoundIncome();
        this.call.openShopForRound();
        this.game.state.phase = this.enums.gamePhase.placement;
        this.call.spawnHeroesForRound();
        this.call.broadcastToRoom(null, 'PREP_PHASE_START', {
            round: this.game.state.round
        });
        this.game.triggerEvent('onPlacementPhaseStart');
    }

    // ─── Server-side: round resolution ─────────────────────────────────────────

    // Called by AutobattlerBattlePhaseSystem after battle ends with survivor data.
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

        // Apply HP damage to the losing player
        if (winningTeam !== null) {
            const winningSurvivors = winningTeam === this.enums.team.left ? leftSurvivors : rightSurvivors;
            this._applyHPDamage(winningTeam, winningSurvivors);
        }

        // Update win/loss streaks
        this._updateStreaks(winningTeam);

        // Check game over
        if (this._checkGameOver()) return;

        // Despawn this round's hero entities before next round
        this.call.despawnBattleHeroes();

        // Advance round counter
        this.game.state.round += 1;

        // Every 5 rounds → milestone hero selection; otherwise straight to prep
        const round = this.game.state.round;
        if (round > 1 && (round - 1) % 5 === 0) {
            this._startMilestone();
        } else {
            this.startPrep();
        }
    }

    // ─── Private helpers ────────────────────────────────────────────────────────

    _advanceToPrep() {
        const payload = { selections: this.pendingHeroSelections };
        this.call.broadcastToRoom(null, 'HERO_SELECT_COMPLETE', payload);
        this.game.triggerEvent('onHeroSelectComplete', payload);
        this.startPrep();
    }

    _startMilestone() {
        this.game.state.phase = this.enums.gamePhase.milestone;
        this.startHeroSelect(true);
    }

    _applyHPDamage(winningTeam, winningSurvivors) {
        const damage = 2 + winningSurvivors.length;
        const losingTeam = winningTeam === this.enums.team.left ? this.enums.team.right : this.enums.team.left;

        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.team === losingTeam) {
                stats.hp = Math.max(0, (stats.hp || 100) - damage);
                break;
            }
        }
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

    _checkGameOver() {
        const playerEntities = this.call.getPlayerEntities();
        let eliminatedTeam = null;
        let winningPlayerId = null;

        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.hp <= 0) {
                eliminatedTeam = stats.team;
            }
        }

        if (eliminatedTeam === null) return false;

        for (const entityId of playerEntities) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats && stats.team !== eliminatedTeam) {
                winningPlayerId = stats.playerId;
                break;
            }
        }

        const result = {
            winner: winningPlayerId,
            reason: 'hp_depleted',
            totalRounds: this.game.state.round
        };
        this.call.broadcastGameEnd(result);
        this.game.endGame(result);
        return true;
    }
}
