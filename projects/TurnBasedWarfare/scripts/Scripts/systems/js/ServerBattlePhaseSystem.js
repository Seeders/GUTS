class ServerBattlePhaseSystem {
    constructor(game) {
        this.game = game;
        this.engine = this.game.app;    
        this.game.serverBattlePhaseSystem = this;
        this.serverNetworkManager = this.engine.serverNetworkManager;
        
        // Battle configuration
        this.battleDuration = 90000; // 90 seconds max
        this.battleTimer = null;
        
        // Battle state tracking
        this.battleResults = new Map();
        this.createdSquads = new Map();
        this.currentRound = 1;
        this.maxRounds = 5;
        this.baseGoldPerRound = 50;
    }

    init(params) {
        this.params = params || {};
    }

    startBattle(room) {
        try {

            room.game.state.isPaused = false;
            // Change room phase
            room.game.state.phase = 'battle';
            
            room.game.app.resetCurrentTime();
            // Start battle timer
            this.startBattleTimer(room);
            
            return { success: true };
            
        } catch (error) {
            console.error('Error in startBattle:', error);
            return { success: false, error: error.message };
        }
    }

    spawnSquadsFromPlacements(room) {
        try {
            // Clear existing battle entities
            this.clearBattlefield();
            
            if (!this.game.unitCreationManager) {
                throw new Error('Unit creation manager not available');
            }
            
            // Get placements from placement phase manager
            const placementManager = this.game.placementSystem;
            if (!placementManager) {
                throw new Error('Placement phase manager not available');
            }
            let success = true;
            // Spawn squads for each player
            for (const [playerId, player] of room.players) {
                const placements = placementManager.playerPlacements.get(playerId) || [];
                
                if (placements.length === 0) continue;
                
                // Create squads using unit creation manager
                const createdSquads = this.game.unitCreationManager.createSquadsFromPlacements(
                    placements,
                    player.stats.side,
                    playerId
                );
                if(!createdSquads){
                    console.log("Failed to create squads");
                    success = false;
                } else {
                    // Store created squads for tracking
                    this.createdSquads.set(playerId, createdSquads);
                    
                    // Deduct gold cost if player has gold
                    if (player.stats.gold !== undefined) {
                        const totalCost = placements.reduce((sum, p) => sum + (p.unitType?.value || 0), 0);
                        player.stats.gold -= totalCost;
                    }
                }
                
            }
            
            return { success: success };
            
        } catch (error) {
            console.error('Error spawning units from placements:', error);
            return { success: false, error: `Failed to spawn units: ${error.message}` };
        }
    }

    startBattleTimer(room) {
        if (this.battleTimer) {
            clearTimeout(this.battleTimer);
        }
        
        this.battleTimer = setTimeout(() => {
            this.endBattle(room, null, 'timeout');
        }, this.battleDuration);
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
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const allBattleEntities = this.game.getEntitiesWith(
            ComponentTypes.TEAM,
            ComponentTypes.HEALTH,
            ComponentTypes.UNIT_TYPE
        );

        const aliveEntities = allBattleEntities.filter(entityId => {
            const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
            const deathState = this.game.getComponent(entityId, ComponentTypes.DEATH_STATE);
            return health && health.current > 0 && (!deathState || !deathState.isDying);
        });

        // Group by teams
        const teams = new Map();
        for (const entityId of aliveEntities) {
            const team = this.game.getComponent(entityId, ComponentTypes.TEAM);
            if (team) {
                if (!teams.has(team.team)) {
                    teams.set(team.team, []);
                }
                teams.get(team.team).push(entityId);
            }
        }

        // Check for battle end conditions
        const aliveTeams = Array.from(teams.keys());
        
        if (aliveTeams.length <= 1) {
            const winner = aliveTeams.length === 1 ? 
                this.getPlayerIdByTeam(aliveTeams[0]) : null;
            
            // Find the room this battle belongs to
            const room = this.game.room;
            if (room) {
                this.endBattle(room, winner, 'victory');
            }
        }
    }

    getPlayerIdByTeam(team) {
        if (!this.game.componentManager) return null;
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const teamEntities = this.game.getEntitiesWith(ComponentTypes.TEAM);
        
        for (const entityId of teamEntities) {
            const teamComp = this.game.getComponent(entityId, ComponentTypes.TEAM);
            if (teamComp && teamComp.team === team) {
                return teamComp.playerId;
            }
        }
        return null;
    }

    endBattle(room, winner = null, reason = 'unknown') {
        if (this.battleTimer) {
            clearTimeout(this.battleTimer);
            this.battleTimer = null;
        }
        
        room.game.state.phase = 'round_end';
        
        
        let battleResult = {
            winner: winner,
            reason: reason,
            round: this.currentRound,
            survivingUnits: this.getSurvivingUnits(),
            playerStats: this.getPlayerStats(room)
        };
        let winningUnits = battleResult.survivingUnits[winner]; 
        let winningSide = battleResult.playerStats[winner]?.stats.side || null;
        battleResult.winningUnits = winningUnits;
        battleResult.winningSide = winningSide;
        if(winningSide){
            room.game.teamHealthSystem.applyRoundDamage(winningSide, winningUnits);
        }
        // Broadcast battle end to all players in room
        this.serverNetworkManager.broadcastToRoom(room.id, 'BATTLE_END', {
            result: battleResult,
            gameState: room.getGameState()
        });
        
        
        // Check for game end or continue to next round
        setTimeout(() => {
            if (this.shouldEndGame(room)) {
                this.endGame(room);
            } else {
                this.prepareNextRound(room);
            }
        }, 3000);
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
                    const ComponentTypes = this.game.componentManager.getComponentTypes();
                    
                    for (const unit of squad.squadUnits) {
                        const health = this.game.getComponent(unit.entityId, ComponentTypes.HEALTH);
                        const deathState = this.game.getComponent(unit.entityId, ComponentTypes.DEATH_STATE);
                  
                        if (health && health.current > 0 && (!deathState || !deathState.isDying)) {
                            sideSurvivors.push(unit.entityId);
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

    prepareNextRound(room) {
        this.currentRound++;
        this.clearBattlefield();
        
        // Transition back to placement phase
        this.game.state.phase = 'placement';
        
        // Reset placement ready states
        for (const [playerId, player] of room.players) {
            player.placementReady = false;
            player.stats.gold = player.stats.gold + this.calculateRoundGold(this.currentRound);
        }
        
        this.serverNetworkManager.broadcastToRoom(room.id, 'NEXT_ROUND', {
            round: this.currentRound,
            gameState: room.getGameState()
        });
    }

    endGame(room) {
        room.game.state.phase = 'ended';
        
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
            totalRounds: this.currentRound
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

    clearBattlefield() {
        this.game.gridSystem.clear();

        if (!this.game.componentManager) return;
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const entitiesToDestroy = new Set();
        
        // Collect battle entities (but not players)
        [
            ComponentTypes.TEAM,
            ComponentTypes.UNIT_TYPE,
            ComponentTypes.PROJECTILE,
            ComponentTypes.DEATH_STATE,
            ComponentTypes.CORPSE
        ].forEach(componentType => {
            const entities = this.game.getEntitiesWith(componentType);
            entities.forEach(id => {
                // Don't destroy player entities
                if (!this.game.hasComponent(id, ComponentTypes.PLAYER)) {
                    entitiesToDestroy.add(id);
                }
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

    // Cleanup method
    cleanup() {
        if (this.battleTimer) {
            clearTimeout(this.battleTimer);
            this.battleTimer = null;
        }
        
        this.clearBattlefield();
        this.battleResults.clear();
        this.createdSquads.clear();
        
    }
}