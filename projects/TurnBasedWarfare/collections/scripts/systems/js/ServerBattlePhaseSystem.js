class ServerBattlePhaseSystem extends GUTS.BaseSystem {
    static services = [
        'startBattle',
        'serializeAllEntities'
    ];

    constructor(game) {
        super(game);
        this.engine = this.game.app;
        this.game.serverBattlePhaseSystem = this;

        // Battle configuration
        this.battleDuration = 30; // 30 seconds max
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
            console.log('[ServerBattlePhaseSystem] === STARTING BATTLE ===');
            console.log(`[ServerBattlePhaseSystem] Before: phase=${this.game.state.phase}, round=${this.game.state.round}`);

            this.game.state.isPaused = false;
            this.game.state.phase = this.enums.gamePhase.battle;

            // Reset game time to sync with client (client also calls resetCurrentTime)
            this.game.resetCurrentTime();

            // Record battle start time (use global game time like client does)
            this.battleStartTime = this.game.state.now || 0;

            // Initialize deterministic RNG for this battle
            // Seed based on game seed and round number for reproducibility
            const gameSeed = this.game.state.gameSeed || 1;
            const battleSeed = GUTS.SeededRandom.combineSeed(gameSeed, this.game.state.round || 1);
            this.game.rng.strand('battle').reseed(battleSeed);

            console.log(`[ServerBattlePhaseSystem] After: phase=${this.game.state.phase}, battleStartTime=${this.battleStartTime}`);
            console.log(`[ServerBattlePhaseSystem] Triggering onBattleStart event`);
            this.game.triggerEvent('onBattleStart');

            return { success: true };

        } catch (error) {
            console.error('Error in startBattle:', error);
            return { success: false, error: error.message };
        }
    }

    // Called by game update loop to check for battle end
    update() {
        if (this.game.state?.phase !== this.enums.gamePhase.battle) {
            return;
        }
        // Check for battle end conditions
        this.checkForBattleEnd();
    }

    checkForBattleEnd() {
     
        // Check if any team has lost all buildings
        const buildingVictory = this.checkBuildingVictoryCondition();
        if (buildingVictory) {
            this.endBattle(buildingVictory.winner, buildingVictory.reason);
            return;
        }

        // Calculate battle duration same way as client
        const battleDuration = (this.game.state.now || 0) - this.battleStartTime;

        // Battle always lasts exactly battleDuration seconds
        if (battleDuration >= this.battleDuration) {
            this.endBattle(null, 'timeout');
        }
    }

    /**
     * Check if any team has lost all their buildings
     * Returns { winner: playerId, reason: string } or null
     */
    checkBuildingVictoryCondition() {
        // Get all alive buildings grouped by team (using numeric team keys)
        const buildingsByTeam = {};
        buildingsByTeam[this.enums.team.left] = [];
        buildingsByTeam[this.enums.team.right] = [];

        const buildingEntities = this.game.getEntitiesWith('unitType', 'team', 'health');
        for (const entityId of buildingEntities) {
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            if (!unitType || unitType.collection !== 'buildings') continue;

            const health = this.game.getComponent(entityId, 'health');
            if (!health || health.current <= 0) continue;

            const deathState = this.game.getComponent(entityId, 'deathState');
            if (deathState && deathState.state >= this.enums.deathState.dying) continue;

            const team = this.game.getComponent(entityId, 'team');
            if (team && buildingsByTeam[team.team] !== undefined) {
                buildingsByTeam[team.team].push(entityId);
            }
        }

        // Check if any team has no buildings left
        let losingTeam = null;
        if (buildingsByTeam[this.enums.team.left].length === 0 && buildingsByTeam[this.enums.team.right].length > 0) {
            losingTeam = this.enums.team.left;
        } else if (buildingsByTeam[this.enums.team.right].length === 0 && buildingsByTeam[this.enums.team.left].length > 0) {
            losingTeam = this.enums.team.right;
        }

        if (losingTeam !== null) {
            // Find the winner (player on the opposite team) using player entities
            const playerEntities = this.game.call('getPlayerEntities');
            for (const entityId of playerEntities) {
                const stats = this.game.getComponent(entityId, 'playerStats');
                if (stats && stats.team !== losingTeam) {
                    return {
                        winner: stats.playerId,
                        reason: 'buildings_destroyed'
                    };
                }
            }
        }

        return null;
    }

    checkNoCombatActive(aliveEntities) {
        for (const entityId of aliveEntities) {
            // Check behaviorMeta for active target (not aiState component)
            const behaviorMeta = this.game.call('getBehaviorMeta', entityId);
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
        this.game.triggerEvent('onBattleEnd');
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
        this.game.call('broadcastToRoom', null, 'BATTLE_END', {
            result: battleResult,
            gameState: this.game.state,
            entitySync: entitySync,
            serverTime: this.game.state.now,
            nextEntityId: this.game.nextEntityId
        });

        // Check for game end or continue to next round
        if (this.shouldEndGame()) {
            this.endGame();
        } else {
            this.game.state.round += 1;
            // Transition back to placement phase
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

    getPlayerStatsForBroadcast() {
        const stats = {};
        const playerEntities = this.game.call('getPlayerEntities');
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

    shouldEndGame() {
        // RTS-style: game ends when a team loses all buildings (checked in checkBuildingVictoryCondition)
        // This is called after battle ends - check if any team has no buildings
        const buildingVictory = this.checkBuildingVictoryCondition();
        return buildingVictory !== null;
    }

  
    addGoldForTeam(goldAmt, team){
        this.game.call('addPlayerGold', team, goldAmt);
    }

    endGame(reason = 'buildings_destroyed') {
        this.game.state.phase = this.enums.gamePhase.ended;

        // Determine final winner based on building victory condition
        const buildingVictory = this.checkBuildingVictoryCondition();
        let finalWinner = buildingVictory?.winner || null;

        // If no building victory (e.g., disconnect), find remaining player
        if (!finalWinner && reason === 'opponent_disconnected') {
            const playerEntities = this.game.call('getPlayerEntities');
            if (playerEntities.length > 0) {
                const stats = this.game.getComponent(playerEntities[0], 'playerStats');
                finalWinner = stats?.playerId ?? null;
            }
        }

        const gameResult = {
            winner: finalWinner,
            reason: reason,
            finalStats: this.getPlayerStatsForBroadcast(),
            totalRounds: this.game.state.round
        };

        this.game.call('broadcastToRoom', null, 'GAME_END', {
            result: gameResult,
            gameState: this.game.state
        });

        // Mark room as inactive after delay (multiplayer only)
        if (this.game.room) {
            setTimeout(() => {
                this.game.room.isActive = false;
            }, 10000);
        }
    }

    /**
     * Called when a player disconnects/leaves during an active game
     */
    handlePlayerDisconnect(playerId) {
        // If game is in battle or placement phase, the remaining player wins
        if (this.game.state.phase === this.enums.gamePhase.battle || this.game.state.phase === this.enums.gamePhase.placement) {
            // Find the remaining player using player entities
            const playerEntities = this.game.call('getPlayerEntities');
            let remainingPlayer = null;
            for (const entityId of playerEntities) {
                const stats = this.game.getComponent(entityId, 'playerStats');
                if (stats && stats.playerId !== playerId) {
                    remainingPlayer = stats.playerId;
                    break;
                }
            }

            if (remainingPlayer !== null) {
                this.endGame('opponent_disconnected');
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
    }
}