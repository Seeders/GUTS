class ServerBattlePhaseSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.engine = this.game.app;    
        this.game.serverBattlePhaseSystem = this;
        this.serverNetworkManager = this.engine.serverNetworkManager;
        
        // Battle configuration
        this.battleDuration = 90000; // 90 seconds max
        this.battleTimer = null;
        
        // Battle state tracking
        this.battleResults = new Map();
        this.createdSquads = new Map();
        this.maxRounds = 5;
        this.baseGoldPerRound = 50;
    }

    init(params) {
        this.params = params || {};
    }

    startBattle(room) {
        try {

            this.game.state.isPaused = false;
            // Change room phase
            this.game.state.phase = 'battle';
            
            this.game.resetCurrentTime();
            this.game.desyncDebugger.displaySync(true);
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
                this.getPlayerIdBySide(aliveTeams[0]) : null;
            
            // Find the room this battle belongs to
            const room = this.game.room;
            if (room) {
                this.endBattle(room, winner, 'victory');
            }
        }
    }

    getPlayerIdBySide(side) {
        const room = this.game.room;
        for (const [playerId, player] of room.players) {
            if (player.stats && player.stats.side === side) {
                return playerId; // Found the player on this team side
            }
        }
        return null;
    }

    endBattle(room, winner = null, reason = 'unknown') {
        if (this.battleTimer) {
            clearTimeout(this.battleTimer);
            this.battleTimer = null;
        }
        
        this.game.state.phase = 'round_end';
        
        let battleResult = {
            winner: winner,
            reason: reason,
            round: this.game.state.round,
            survivingUnits: this.getSurvivingUnits(),
            playerStats: this.getPlayerStats(room)
        };
        
        let winningUnits = battleResult.survivingUnits[winner]; 
        let winningSide = battleResult.playerStats[winner]?.stats.side || null;
        battleResult.winningUnits = winningUnits;
        battleResult.winningSide = winningSide;
        
        // Apply round damage and get the health results
        if(winningSide) {
            let roundDamageResult = this.game.teamHealthSystem.applyRoundDamage(winningSide, winningUnits);

            // CRITICAL: Use the health values from roundDamageResult.remainingHealth
            if (roundDamageResult && roundDamageResult.remainingHealth) {
                const newLeftHealth = roundDamageResult.remainingHealth.left;
                const newRightHealth = roundDamageResult.remainingHealth.right;

                
                // Update room player stats with the new health values from damage result
                for (const [playerId, player] of room.players) {
                    if (player.stats && player.stats.side) {
                        const oldHealth = player.stats.health;
                        
                        if (player.stats.side === 'left') {
                            player.stats.health = newLeftHealth;
                        } else if (player.stats.side === 'right') {
                            player.stats.health = newRightHealth;
                        }
                        
                    }
                }
                
                // CRITICAL: Regenerate playerStats AFTER updating room player data
                battleResult.playerStats = this.getPlayerStats(room);
                
                // Add the damage information to battle result for client display
                battleResult.damageInfo = {
                    winningTeam: roundDamageResult.winningTeam,
                    losingTeam: roundDamageResult.losingTeam,
                    damage: roundDamageResult.damage,
                    survivingSquads: roundDamageResult.survivingSquads,
                    gameOver: roundDamageResult.gameOver,
                    healthAfterDamage: {
                        left: newLeftHealth,
                        right: newRightHealth
                    }
                };
                
            }
        }
        
        // Broadcast with updated health values
        this.serverNetworkManager.broadcastToRoom(room.id, 'BATTLE_END', {
            result: battleResult,
            gameState: room.getGameState() // This will also have updated player health
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
        this.game.state.round += 1;
        this.clearBattlefield();
        
        // Transition back to placement phase
        this.game.state.phase = 'placement';
        // Reset placement ready states
        for (const [playerId, player] of room.players) {
            player.placementReady = false;
            player.stats.gold = player.stats.gold + this.calculateRoundGold(this.game.state.round);
        }
        
        this.serverNetworkManager.broadcastToRoom(room.id, 'NEXT_ROUND', {
            round: this.game.state.round,
            gameState: room.getGameState()
        });
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

    clearBattlefield() {

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