class ServerBattlePhaseSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.engine = this.game.app;    
        this.game.serverBattlePhaseSystem = this;
        this.serverNetworkManager = this.engine.serverNetworkManager;
        
        // Battle configuration
        this.maxBattleDuration = 30; // 30 seconds max
        this.minBattleDuration = 29;
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

        // Calculate battle duration same way as client
        const battleDuration = (this.game.state.now || 0) - this.battleStartTime;

        const allBattleEntities = this.game.getEntitiesWith(
            "team",
            "health",
            "unitType"
        );

        const aliveEntities = allBattleEntities.filter(entityId => {
            const health = this.game.getComponent(entityId, "health");
            const deathState = this.game.getComponent(entityId, "deathState");
            return health && health.current > 0 && (!deathState || !deathState.isDying);
        });

        const teams = new Map();
        for (const entityId of aliveEntities) {
            const team = this.game.getComponent(entityId, "team");
            if (team) {
                if (!teams.has(team.team)) {
                    teams.set(team.team, []);
                }
                teams.get(team.team).push(entityId);
            }
        }
        const aliveTeams = Array.from(teams.keys());

        const noCombatActive = this.checkNoCombatActive(aliveEntities);
        const allUnitsAtTarget = this.checkAllUnitsAtTargetPosition(aliveEntities);

        if( battleDuration < this.minBattleDuration){
            return;
        }
        if( battleDuration >= this.maxBattleDuration){
            this.endBattle(this.game.room, null);
            return;
        }

        if (aliveEntities.length === 0) {
            console.log('no alive entities');
            this.endBattle(this.game.room, null);
            return;
        }
        
        if (aliveTeams.length === 1 && allUnitsAtTarget) {
            console.log('aliveTeams length is 1', aliveTeams, aliveEntities);
            console.log('all entities', allBattleEntities);
            console.log('aliveEntities', aliveEntities);
            this.endBattle(this.game.room, aliveTeams[0]);
            return;
        }
     
        if (noCombatActive && allUnitsAtTarget) {
            console.log('no combat active and all units at target');
            this.endBattle(this.game.room, null);
        }
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
            const pos = this.game.getComponent(entityId, "position");
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

    endGame(room) {
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