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

        this.game.gameManager.register('startBattle', this.startBattle.bind(this));
        this.game.gameManager.register('spawnSquadFromPlacement', this.spawnSquadFromPlacement.bind(this));
    }

    startBattle(room) {
        try {

            this.game.state.isPaused = false;
            // Change room phase
            this.game.state.phase = 'battle';

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
    spawnSquadFromPlacement(playerId, placement) {
        try {
            const player = this.game.room.getPlayer(playerId);
            
            if (!this.game.unitCreationManager) {
                throw new Error('Unit creation manager not available');
            }
            
            // Get placements from placement phase manager
            const placementManager = this.game.placementSystem;
            if (!placementManager) {
                throw new Error('Placement phase manager not available');
            }
            let createdSquad = null;
      
            // Create squads using unit creation manager
            createdSquad = this.game.unitCreationManager.createSquadFromPlacement(
                placement,
                player.stats.side,
                playerId
            );

            if(!createdSquad){
                console.log("Failed to create squads");
                return { success: false };
            } else {
                // Store created squads for tracking
                let playerSquads = this.createdSquads.get(playerId);
                if(playerSquads){
                    playerSquads.push(createdSquad);
                } else {
                    playerSquads = [createdSquad];                    
                }
                this.createdSquads.set(playerId, playerSquads);
                return { success: true, squad: createdSquad };
            }
            
        } catch (error) {
            console.error('Error spawning units from placements:', error);
            return { success: false, error: `Failed to spawn units: ${error.message}` };
        }
    }

    // Called by game update loop to check for battle end
    update() {
        if (this.game.state?.phase !== 'battle') {
            return;
        }
        // Check for battle end conditions
        this.checkForBattleEnd();
    }

    checkForBattleEnd() {
        if (!this.game.componentManager) return;

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

        // Get all alive buildings grouped by team
        const buildingsByTeam = { left: [], right: [] };

        const buildingEntities = this.game.getEntitiesWith('unitType', 'team', 'health');
        for (const entityId of buildingEntities) {
            const unitType = this.game.getComponent(entityId, 'unitType');
            if (!unitType || unitType.collection !== 'buildings') continue;

            const health = this.game.getComponent(entityId, 'health');
            if (!health || health.current <= 0) continue;

            const deathState = this.game.getComponent(entityId, 'deathState');
            if (deathState && deathState.isDying) continue;

            const team = this.game.getComponent(entityId, 'team');
            if (team && buildingsByTeam[team.team] !== undefined) {
                buildingsByTeam[team.team].push(entityId);
            }
        }

        // Check if any team has no buildings left
        let losingTeam = null;
        if (buildingsByTeam.left.length === 0 && buildingsByTeam.right.length > 0) {
            losingTeam = 'left';
        } else if (buildingsByTeam.right.length === 0 && buildingsByTeam.left.length > 0) {
            losingTeam = 'right';
        }

        if (losingTeam) {
            // Find the winner (player on the opposite team)
            for (const [playerId, player] of room.players) {
                if (player.stats.side !== losingTeam) {
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
            const aiState = this.game.getComponent(entityId, "aiState");
         //   console.log(entityId, 'currentTarget', aiState.target);
            if (aiState && aiState.target) {
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
        const playerStats = this.getPlayerStats(room);
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
        this.serverNetworkManager.broadcastToRoom(room.id, 'BATTLE_END', {
            result: battleResult,
            gameState: room.getGameState(), // This will also have updated player health
            entitySync: entitySync,
            serverTime: this.game.state.now // Server's global game time when battle ended
        });
        // Check for game end or continue to next round
        if (this.shouldEndGame(room)) {
            this.endGame(room);
        } else {
            this.game.state.round += 1;
            // Transition back to placement phase
            this.game.state.phase = 'placement';
            // Reset placement ready states
            for (const [playerId, player] of room.players) {
                player.placementReady = false;
            }
            this.game.triggerEvent('onPlacementPhaseStart');
        }
    }


    serializeAllEntities() {
        const serialized = {};
        
        for (const [entityId, componentTypes] of this.game.entities) {
            serialized[entityId] = {};
            
            for (const componentType of componentTypes) {
                const component = this.game.getComponent(entityId, componentType);
                if (component) {
                    serialized[entityId][componentType] = JSON.parse(JSON.stringify(component));
                }
            }
        }
        
        return serialized;
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
                if (squad.squadUnits && this.game.componentManager) {
                    for (const entityId of squad.squadUnits) {
                        const health = this.game.getComponent(entityId, "health");
                        const deathState = this.game.getComponent(entityId, "deathState");
                  
                        if (health && health.current > 0 && (!deathState || !deathState.isDying)) {
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

    getPlayerStats(room) {
        const stats = {};
        for (const [playerId, player] of room.players) {
            stats[playerId] = {
                name: player.name,
                stats: player.stats
            };
        }
        return stats;
    }

    shouldEndGame(room) {
        const alivePlayers = Array.from(room.players.values()).filter(p => (p.stats.health) > 0);
        return alivePlayers.length <= 1;
    }

  
    addGoldForTeam(goldAmt, team){
        for (const [playerId, player] of room.players) {
            if(player.side == team){
                player.stats.gold = player.stats.gold + goldAmt;
                break;
            }
        }
    }

    endGame(room, reason = 'health_depleted') {
        this.game.state.phase = 'ended';

        // Determine final winner
        let finalWinner = null;
        let maxHealth = -1;

        for (const [playerId, player] of room.players) {
            const health = player.stats.health;
            if (health > maxHealth) {
                maxHealth = health;
                finalWinner = playerId;
            }
        }

        const gameResult = {
            winner: finalWinner,
            reason: reason,
            finalStats: this.getPlayerStats(room),
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
        if (this.game.state.phase === 'battle' || this.game.state.phase === 'placement') {
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

        if (!this.game.componentManager) return;

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