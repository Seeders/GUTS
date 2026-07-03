class ServerBattlePhaseSystem extends GUTS.BaseSystem {
    static services = [
        'startBattle',
        'serializeAllEntities'
    ];

    static serviceDependencies = [
        'getBehaviorMeta',
        'broadcastToRoom',
        'getPlayerEntities',
        'addPlayerGold',
        'broadcastGameEnd',
        'clearAllDamageEffects'
    ];

    constructor(game) {
        super(game);
        this.engine = this.game.app;
        this.game.serverBattlePhaseSystem = this;

        // Battle configuration
        // Mechabellum battle phase: 60-90s cap; fights usually resolve by wipe
        // well before it. If the timer expires with both armies standing, BOTH
        // commanders take the enemy survivors' damage (checkForBattleEnd).
        this.battleDuration = 75;
        // When one army is wiped, the survivors siege the enemy buildings. Extend
        // the round if needed so they always get at least this long to do it.
        this.siegeWindow = 20;
        this.battleStartTime = 0;
        // Battle state tracking
        this.battleResults = new Map();
        this.createdSquads = new Map();
        this.maxRounds = 5;
        this.baseGoldPerRound = 50;
    }

    init(params) {
        this.params = params || {};
    }

    startBattle() {
        try {
            this.game.state.isPaused = false;
            this.game.state.phase = this.enums.gamePhase.battle;

            // Snapshot hero positions BEFORE combat begins. These positions are
            // saved on each hero's roster entry so they respawn here next round
            // instead of reverting to the team's default starting location.
            if (this.game.heroRosterSystem?.snapshotHeroPositions) {
                this.game.heroRosterSystem.snapshotHeroPositions();
            }

            // Reset game time to sync with client (client also calls resetCurrentTime)
            this.game.resetCurrentTime();

            // Record battle start time (use global game time like client does)
            this.battleStartTime = this.game.state.now || 0;
            this._siegeDeadline = null;
            // Published battle deadline for the HUD countdown. Clients set the same
            // initial value themselves at battle start; extensions (siege window)
            // are pushed via the BATTLE_DEADLINE broadcast.
            this.game.state.battleEndsAt = this.battleStartTime + this.battleDuration;

            // Initialize deterministic RNG for this battle
            // Seed based on game seed and round number for reproducibility
            const gameSeed = this.game.state.gameSeed || 1;
            const battleSeed = GUTS.SeededRandom.combineSeed(gameSeed, this.game.state.round || 1);
            this.game.rng.strand('battle').reseed(battleSeed);

            this.game.triggerEvent('onBattleStart');

            return { success: true };

        } catch (error) {
            console.error('Error in startBattle:', error);
            return { success: false, error: error.message };
        }
    }

    // Called by game update loop to check for battle end
    update() {
        // Drive the post-battle intermission off game time so it stays deterministic
        // and stays in sync between server and clients (no wall-clock setTimeout).
        if (this.endBattlePending && this.endBattleAt != null) {
            if ((this.game.state.now || 0) >= this.endBattleAt) {
                this._completeBattleEnd();
            }
            return;
        }

        if (this.game.state?.phase !== this.enums.gamePhase.battle) {
            return;
        }
        // Check for battle end conditions
        this.checkForBattleEnd();
    }

    checkForBattleEnd() {
        // Skip if we've already triggered an endBattle that's waiting on its intermission timer
        if (this.endBattlePending) return;

        const now = this.game.state.now || 0;

        const winner = this._getHeroWinner();

        // Both armies wiped → draw.
        if (winner === null) {
            this.endBattle(null, 'draw');
            return;
        }

        // One army standing → the round ends immediately; the survivors' value
        // is dealt to the enemy commander in resolveRound (no siege phase —
        // there are no buildings to siege under commander-HP scoring).
        if (winner !== undefined) {
            this.endBattle(winner, 'army_wiped');
            return;
        }

        // Both sides still fighting: the 30s cap ends it — both take survivor damage.
        if (now >= this.battleStartTime + this.battleDuration) {
            this.endBattle(null, 'timeout');
        }
    }

    // Returns the team whose Town Hall is destroyed this battle, or undefined if
    // both still stand. Checked from the live entity (cull happens at resolve).
    _getDestroyedTownHallTeam() {
        const thTiers = this.game.buildingSystem?.constructor?.TOWNHALL_LEVEL
            || { townHall: 1, keep: 2, castle: 3 };
        for (const eid of this.game.getEntitiesWith('buildingOwner')) {
            const owner = this.game.getComponent(eid, 'buildingOwner');
            if (!owner || !thTiers[owner.buildingId]) continue;
            const team = this.game.getComponent(eid, 'team');
            const health = this.game.getComponent(eid, 'health');
            if (!team || !health) continue;
            const ds = this.game.getComponent(eid, 'deathState');
            const destroyed = health.current <= 0 ||
                (ds && ds.state !== this.enums.deathState.alive);
            if (destroyed) return team.team;
        }
        return undefined;
    }

    // Returns the winning team enum, null for a draw (no living units on either
    // side — the round ends early, nothing can progress), or undefined if the
    // battle is still contested.
    _getHeroWinner() {
        const combatEntities = this.game.getEntitiesWith('combat');

        const aliveByTeam = {};
        for (const entityId of combatEntities) {
            const health = this.game.getComponent(entityId, 'health');
            const teamComp = this.game.getComponent(entityId, 'team');
            if (!teamComp || !health) continue;

            // Buildings are not combatants for round-end purposes — a standing
            // sentry tower must not keep its side "alive" (the unitType COMPONENT
            // has no isBuilding field, so the buildingOwner tag is the reliable
            // marker).
            if (this.game.getComponent(entityId, 'buildingOwner')) continue;

            // Only the two player armies decide round end. Hostile creeps (the
            // gold-mine dragons) must not keep battles running — or worse, be
            // declared the round winner after both armies wipe.
            if (teamComp.team !== this.enums.team.left &&
                teamComp.team !== this.enums.team.right) continue;

            const deathState = this.game.getComponent(entityId, 'deathState');
            const isAlive = health.current > 0 &&
                (!deathState || deathState.state === this.enums.deathState.alive);
            if (isAlive) {
                aliveByTeam[teamComp.team] = (aliveByTeam[teamComp.team] || 0) + 1;
            }
        }

        const teams = Object.keys(aliveByTeam).map(Number);
        if (teams.length === 0) {
            // No living unit anywhere. Grace the first second of the round so an
            // oddly-ordered battle start can't end before units are counted.
            const elapsed = (this.game.state.now || 0) - this.battleStartTime;
            return elapsed >= 1 ? null : undefined;
        }
        if (teams.length === 1) return teams[0]; // one side wiped
        return undefined; // both sides still have units
    }

    checkNoCombatActive(aliveEntities) {
        for (const entityId of aliveEntities) {
            // Check behaviorMeta for active target (not aiState component)
            const behaviorMeta = this.call.getBehaviorMeta( entityId);
            if (behaviorMeta?.target !== undefined && behaviorMeta.target !== null && behaviorMeta.target >= 0) {
                return false;
            }
        }

        return true;
    }

    checkAllUnitsAtTargetPosition(aliveEntities) {
        const TARGET_POSITION_THRESHOLD = 20;

        for (const entityId of aliveEntities) {
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            const aiState = this.game.getComponent(entityId, "aiState");
            const targetPos = aiState?.targetPosition;

            if (!pos || !targetPos) {
                continue;
            }
            const distance = Math.sqrt(
                Math.pow(targetPos.x - pos.x, 2) +
                Math.pow(targetPos.z - pos.z, 2)
            );

            if (distance > TARGET_POSITION_THRESHOLD) {
                return false;
            }
        }

        return true;
    }

    endBattle(winner = null, reason = 'unknown') {
        // Guard against re-entry. checkForBattleEnd() runs every tick and will keep
        // detecting the same "all heroes dead" condition until heroes are despawned.
        if (this.endBattlePending) return;
        this.endBattlePending = true;

        this.game.triggerEvent('onBattleEnd');

        // Check if a scenario system ended the game during onBattleEnd
        if (this.game.state.phase === this.enums.gamePhase.ended) {
            this.endBattlePending = false;
            return;
        }

        const playerStats = this.getPlayerStatsForBroadcast();
        let battleResult = {
            winner: winner,
            reason: reason,
            round: this.game.state.round,
            survivingUnits: this.getSurvivingUnits(),
            playerStats: playerStats
        };

        const entitySync = this.serializeAllEntities(false); // Delta sync at battle end
        // Broadcast with updated health values
        // Include server simulation time so clients can wait until they've caught up
        // Include nextEntityId so clients can sync their entity ID counters
        this.call.broadcastToRoom( null, 'BATTLE_END', {
            result: battleResult,
            gameState: this.game.state,
            entitySync: entitySync,
            serverTime: this.game.state.now,
            nextEntityId: this.game.nextEntityId
        });

        // Capture survivors NOW (before the intermission delay) so they aren't lost
        // if any further damage/death processing happens during the wait.
        this._pendingSurvivingByTeam = this._getSurvivingByTeam();

        // Freeze combat for the intermission so heroes stop swinging/moving and the
        // user sees the actual end-of-round state. BehaviorSystem checks this flag.
        this.game.state.battleIntermission = true;

        // Intermission: schedule completion off the deterministic game tick clock
        // (state.now advances by tickRate each tick, accumulator-driven). Wall-clock
        // setTimeout would desync server and clients in online play.
        const INTERMISSION_SEC = 3.5;
        this.endBattleAt = (this.game.state.now || 0) + INTERMISSION_SEC;
    }

    _completeBattleEnd() {
        this.endBattlePending = false;
        this.endBattleAt = null;
        this.game.state.battleIntermission = false;
        const survivingByTeam = this._pendingSurvivingByTeam || {};
        this._pendingSurvivingByTeam = null;

        // Bail if game ended during the intermission (e.g., final round resolution)
        if (this.game.state.phase === this.enums.gamePhase.ended) return;

        // Hand off to AutobattlerRoundSystem to manage next phase
        if (this.game.autobattlerRoundSystem) {
            this.game.autobattlerRoundSystem.resolveRound(survivingByTeam);
        } else {
            // Fallback to original TBW behaviour if running without HeroArena systems
            this.game.state.round += 1;
            this.game.state.phase = this.enums.gamePhase.placement;
            this.game.triggerEvent('onPlacementPhaseStart');
        }
    }


    serializeAllEntities(fullSync = true) {
        // Return raw ECS data for direct array sync
        // fullSync=true: send complete state (used for initial sync, battle start)
        // fullSync=false: send only changes since last sync (used for periodic updates)
        return this.game.getECSData(fullSync);
    }
    calculateRoundGold(round) {
        return this.baseGoldPerRound + (round * this.baseGoldPerRound);
    }
    getSurvivingUnits() {
        const survivors = {};
        
        // Count surviving units from created squads
        for (const [playerId, squads] of this.createdSquads) {
            let survivingCount = 0;
            let sideSurvivors = [];
            for (const squad of squads) {
                if (squad.squadUnits) {
                    for (const entityId of squad.squadUnits) {
                        const health = this.game.getComponent(entityId, "health");
                        const deathState = this.game.getComponent(entityId, "deathState");
                  
                        if (health && health.current > 0 && (!deathState || deathState.state === this.enums.deathState.alive)) {
                            sideSurvivors.push(entityId);
                            survivingCount++;
                        }
                    }
                }
            }
            
            survivors[playerId] = sideSurvivors;
        }
        
        return survivors;
    }

    _getSurvivingByTeam() {
        const result = {};
        const combatEntities = this.game.getEntitiesWith('combat');
        for (const entityId of combatEntities) {
            const health = this.game.getComponent(entityId, 'health');
            const deathState = this.game.getComponent(entityId, 'deathState');
            const teamComp = this.game.getComponent(entityId, 'team');
            if (!teamComp || !health) continue;
            // Buildings never count as survivors (see _getHeroWinner note).
            if (this.game.getComponent(entityId, 'buildingOwner')) continue;

            const isAlive = health.current > 0 &&
                (!deathState || deathState.state === this.enums.deathState.alive);
            if (isAlive) {
                const t = teamComp.team;
                if (!result[t]) result[t] = [];
                result[t].push(entityId);
            }
        }
        return result;
    }

    getPlayerStatsForBroadcast() {
        const stats = {};
        const playerEntities = this.call.getPlayerEntities();
        for (const entityId of playerEntities) {
            const playerStats = this.game.getComponent(entityId, 'playerStats');
            if (playerStats) {
                stats[playerStats.playerId] = {
                    name: playerStats.playerId === 0 ? 'Player' : 'Opponent',
                    stats: {
                        team: playerStats.team,
                        gold: playerStats.gold,
                        upgrades: playerStats.upgrades
                    }
                };
            }
        }
        return stats;
    }

    addGoldForTeam(goldAmt, team) {
        this.call.addPlayerGold( team, goldAmt);
    }

    /**
     * Called when a player disconnects/leaves during an active game
     */
    handlePlayerDisconnect(playerId) {
        // If game is in battle or placement phase, the remaining player wins
        if (this.game.state.phase === this.enums.gamePhase.battle || this.game.state.phase === this.enums.gamePhase.placement) {
            // Find the remaining player using player entities
            const playerEntities = this.call.getPlayerEntities();
            let remainingPlayer = null;
            for (const entityId of playerEntities) {
                const stats = this.game.getComponent(entityId, 'playerStats');
                if (stats && stats.playerId !== playerId) {
                    remainingPlayer = stats.playerId;
                    break;
                }
            }

            if (remainingPlayer !== null) {
                const result = {
                    winner: remainingPlayer,
                    reason: 'opponent_disconnected',
                    finalStats: this.getPlayerStatsForBroadcast(),
                    totalRounds: this.game.state.round
                };
                // Broadcast to clients then end game locally
                this.call.broadcastGameEnd( result);
                this.game.endGame(result);
            }
        }
    }

    onBattleEnd() {
        this.battleStartTime = 0;

        const entitiesToDestroy = new Set();

        // Collect battle entities (but not players)
        [
            "corpse"
        ].forEach(componentType => {
            const entities = this.game.getEntitiesWith(componentType);
            entities.forEach(id => {
                entitiesToDestroy.add(id);
            });
        });

        // Destroy entities
        entitiesToDestroy.forEach(entityId => {
            try {
                this.game.destroyEntity(entityId);
            } catch (error) {
                console.warn(`Error destroying entity ${entityId}:`, error);
            }
        });

        // Clear squad references
        this.createdSquads.clear();

        // Drop everything mid-flight from the finished battle so nothing carries
        // into the next round: pending scheduled actions (delayed damage, queued
        // projectile spawns) and lingering status effects — buildings persist
        // across rounds, so a poison stack on a tower would otherwise keep
        // ticking through prep. (Projectile entities and ability queues are
        // already cleared by ProjectileSystem/AbilitySystem onBattleEnd.)
        this.game.schedulingSystem?.clearAllActions?.();
        this.call.clearAllDamageEffects?.();
    }
}