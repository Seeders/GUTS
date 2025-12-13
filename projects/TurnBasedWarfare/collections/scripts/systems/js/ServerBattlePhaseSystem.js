class ServerBattlePhaseSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.engine = this.game.app;    
        this.game.serverBattlePhaseSystem = this;
        this.serverNetworkManager = this.engine.serverNetworkManager;
        
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

        // Initialize enums
        this.game.register('startBattle', this.startBattle.bind(this));
        this.game.register('serializeAllEntities', this.serializeAllEntities.bind(this));
    }

    startBattle(room) {
        try {

            this.game.state.isPaused = false;
            // Change room phase
            this.game.state.phase = this.enums.gamePhase.battle;

            // Reset game time to sync with client (client also calls resetCurrentTime)
            this.game.resetCurrentTime();

            // Record battle start time (use global game time like client does)
            this.battleStartTime = this.game.state.now || 0;

            // Initialize deterministic RNG for this battle
            // Seed based on room ID and round number for reproducibility
            const roomIdHash = room.id ? GUTS.SeededRandom.hashString(room.id) : 1;
            const battleSeed = GUTS.SeededRandom.combineSeed(roomIdHash, this.game.state.round || 1);
            this.game.rng = new GUTS.SeededRandom(battleSeed);

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
        if (!this.game.componentSystem) return;

        // Check if any team has lost all buildings
        const buildingVictory = this.checkBuildingVictoryCondition();
        if (buildingVictory) {
            this.endBattle(this.game.room, buildingVictory.winner, buildingVictory.reason);
            return;
        }

        // Calculate battle duration same way as client
        const battleDuration = (this.game.state.now || 0) - this.battleStartTime;

        // Battle always lasts exactly battleDuration seconds
        if (battleDuration >= this.battleDuration) {
            this.endBattle(this.game.room, null, 'timeout');
        }
    }

    /**
     * Check if any team has lost all their buildings
     * Returns { winner: playerId, reason: string } or null
     */
    checkBuildingVictoryCondition() {
        const room = this.game.room;
        if (!room) return null;

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
            // Find the winner (player on the opposite team)
            for (const [playerId, player] of room.players) {
                if (player.team !== losingTeam) {
                    return {
                        winner: playerId,
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

    endBattle(room, winner = null, reason = 'unknown') {

        this.game.triggerEvent('onBattleEnd');
        const playerStats = this.getPlayerStatsForBroadcast(room);
        let battleResult = {
            winner: winner,
            reason: reason,
            round: this.game.state.round,
            survivingUnits: this.getSurvivingUnits(),
            playerStats: playerStats
        };
        
        const entitySync = this.serializeAllEntities();
        // Broadcast with updated health values
        // Include server simulation time so clients can wait until they've caught up
        // Include nextEntityId so clients can sync their entity ID counters
        this.serverNetworkManager.broadcastToRoom(room.id, 'BATTLE_END', {
            result: battleResult,
            gameState: room.getGameState(), // This will also have updated player health
            entitySync: entitySync,
            serverTime: this.game.state.now, // Server's global game time when battle ended
            nextEntityId: this.game.nextEntityId // Sync entity ID counter
        });
        // Check for game end or continue to next round
        if (this.shouldEndGame(room)) {
            this.endGame(room);
        } else {
            this.game.state.round += 1;
            // Transition back to placement phase
            this.game.state.phase = this.enums.gamePhase.placement;
            // Reset placement ready states
            for (const [playerId, player] of room.players) {
                player.placementReady = false;
            }
            this.game.triggerEvent('onPlacementPhaseStart');
        }
    }


    serializeAllEntities() {
        // Return raw ECS data for direct array sync
        return this.game.getECSData();
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
                if (squad.squadUnits && this.game.componentSystem) {
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

    getPlayerStatsForBroadcast(room) {
        const stats = {};
        for (const [playerId, player] of room.players) {
            const playerStats = this.game.call('getPlayerStats', playerId);
            stats[playerId] = {
                name: player.name,
                stats: playerStats ? {
                    side: playerStats.side,
                    gold: playerStats.gold,
                    upgrades: playerStats.upgrades
                } : null
            };
        }
        return stats;
    }

    shouldEndGame(room) {
        // RTS-style: game ends when a team loses all buildings (checked in checkBuildingVictoryCondition)
        // This is called after battle ends - check if any team has no buildings
        const buildingVictory = this.checkBuildingVictoryCondition();
        return buildingVictory !== null;
    }

  
    addGoldForTeam(goldAmt, team){
        this.game.call('addPlayerGold', team, goldAmt);
    }

    endGame(room, reason = 'buildings_destroyed') {
        this.game.state.phase = this.enums.gamePhase.ended;

        // Determine final winner based on building victory condition
        const buildingVictory = this.checkBuildingVictoryCondition();
        let finalWinner = buildingVictory?.winner || null;

        // If no building victory (e.g., disconnect), find remaining player
        if (!finalWinner && reason === 'opponent_disconnected') {
            for (const [playerId] of room.players) {
                finalWinner = playerId;
                break;
            }
        }

        const gameResult = {
            winner: finalWinner,
            reason: reason,
            finalStats: this.getPlayerStatsForBroadcast(room),
            totalRounds: this.game.state.round
        };

        this.serverNetworkManager.broadcastToRoom(room.id, 'GAME_END', {
            result: gameResult,
            gameState: room.getGameState()
        });

        // Mark room as inactive after delay
        setTimeout(() => {
            room.isActive = false;
        }, 10000);
    }

    /**
     * Called when a player disconnects/leaves during an active game
     */
    handlePlayerDisconnect(playerId) {
        const room = this.game.room;
        if (!room) return;

        // If game is in battle or placement phase, the remaining player wins
        if (this.game.state.phase === this.enums.gamePhase.battle || this.game.state.phase === this.enums.gamePhase.placement) {
            // Find the remaining player
            let remainingPlayer = null;
            for (const [id, player] of room.players) {
                if (id !== playerId) {
                    remainingPlayer = id;
                    break;
                }
            }

            if (remainingPlayer) {
                this.endGame(room, 'opponent_disconnected');
            }
        }
    }

    onBattleEnd() {

        if (!this.game.componentSystem) return;

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