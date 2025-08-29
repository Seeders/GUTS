import GameRoom from './GameRoom.js';

export default class ServerGameRoom extends GameRoom {
    constructor(roomId, gameInstance, maxPlayers = 2) {
        super(roomId, gameInstance, maxPlayers);
        
        // Auto Battle specific state
        this.gamePhase = 'waiting'; // 'lobby', 'placement', 'battle', 'ended'
        this.currentRound = 1;
        this.maxRounds = 5;
        this.battleTimer = null;
        this.placementTimer = null;
        
        // Squad placement limits
        this.maxSquadsPerRound = 2;
        this.baseGoldPerRound = 25;
        this.startingGold = 100;
        
        // Battle configuration
        this.FIXED_DT = 1 / 60; // 60Hz simulation
        this.battleDuration = 30000; // 30 seconds max
        this.placementDuration = 90000; // 90 seconds max
        
        // Game state tracking
        this.playerReadyStates = new Map(); // For lobby ready
        this.placementReadyStates = new Map(); // For placement ready
        this.playerPlacements = new Map();
        this.battleResults = new Map();
        this.teamHealths = new Map();
        this.createdSquads = new Map(); // Track created squads for cleanup
        
        // Initialize team health
        this.initializeTeamHealth();
        
        console.log(`Auto Battle room ${roomId} created for ${maxPlayers} players`);
    }

    initializeTeamHealth() {
        // Each player starts with full health
        for (const [playerId, player] of this.players) {
            this.teamHealths.set(playerId, 100);
        }
    }


    addPlayer(playerId, playerData) {
        const result = super.addPlayer(playerId, playerData);
        
        if (result.success) {
            // Initialize Auto Battle specific player data
            const player = this.players.get(playerId);
            player.gold = this.startingGold;
            player.health = 100;
            player.squadsPlacedThisRound = 0;
            player.ready = false;
            player.placementReady = false; // Separate ready state for placement phase
            player.side = this.players.size === 1 ? 'left' : 'right'; // Assign sides
            player.wins = 0;
            
            this.playerReadyStates.set(playerId, false);
            this.placementReadyStates.set(playerId, false);
            this.playerPlacements.set(playerId, []);
            this.teamHealths.set(playerId, 100);
            this.createdSquads.set(playerId, []);
            
            // If room is full, start lobby phase
            if (this.players.size === this.maxPlayers) {
                this.startLobbyPhase();
            }
        }
        
        return result;
    }

    startLobbyPhase() {
        this.gamePhase = 'lobby';
        this.broadcastToPlayers({
            type: 'PHASE_UPDATE',
            phase: 'lobby',
            gameState: this.getGameState()
        });
        
        console.log(`Room ${this.id} entered lobby phase`);
    }

    togglePlayerReady(playerId) {
        const player = this.players.get(playerId);
        if (!player || this.gamePhase !== 'lobby') return false;
        
        player.ready = !player.ready;
        this.playerReadyStates.set(playerId, player.ready);
        
        // Check if all players are ready
        const allReady = Array.from(this.players.values()).every(p => p.ready);
        
        // Broadcast to all players so everyone sees the state change
        this.broadcastToPlayers({
            type: 'PLAYER_READY_UPDATE',
            playerId: playerId,
            ready: player.ready,
            allReady: allReady,
            gameState: this.getGameState()
        });
        
        console.log(`Player ${playerId} ready: ${player.ready}, all ready: ${allReady}`);
        
        if (allReady) {
            console.log(`All players ready, starting game in room ${this.id}`);
            setTimeout(() => this.startGame(), 1000); // 1 second delay
        }
        
        return true;
    }

    startGame() {
        if (this.gamePhase !== 'lobby') {
            console.log(`Cannot start game, not in lobby phase. Current phase: ${this.gamePhase}`);
            return;
        }
        
        this.isActive = true;
        this.currentRound = 1;
        
        console.log(`Starting game in room ${this.id}`);
        
        // Send GAME_STARTED event first
        this.broadcastToPlayers({
            type: 'GAME_STARTED',
            gameState: this.getGameState()
        });
        
        // Load the multiplayer battle scene on server
        this.game.sceneManager.load('server');
        
        // Start placement phase after a brief delay to allow clients to transition
        setTimeout(() => {
            this.startPlacementPhase();
        }, 500);
        
        console.log(`Game started in room ${this.id}`);
    }

    startPlacementPhase() {
        this.gamePhase = 'placement';
        
        // Reset player states for new round
        for (const [playerId, player] of this.players) {
            player.placementReady = false; // Reset placement ready state
            player.squadsPlacedThisRound = 0;
            
            // Give round gold (except first round)
            if (this.currentRound > 1) {
                const roundGold = this.baseGoldPerRound + (this.currentRound * this.baseGoldPerRound);
                player.gold += roundGold;
            }
        }
        
        // Clear placement data for new round
        this.placementReadyStates.clear();
        this.playerPlacements.clear();
        this.createdSquads.clear();
        
        // Initialize placement ready states
        for (const playerId of this.players.keys()) {
            this.placementReadyStates.set(playerId, false);
            this.playerPlacements.set(playerId, []);
            this.createdSquads.set(playerId, []);
        }
        
        // Start placement timer
        this.startPlacementTimer();
        
        this.broadcastToPlayers({
            type: 'PHASE_UPDATE',
            phase: 'placement',
            round: this.currentRound,
            gameState: this.getGameState()
        });
        
        console.log(`Round ${this.currentRound} placement phase started in room ${this.id}`);
    }

    startPlacementTimer() {
        if (this.placementTimer) {
            clearTimeout(this.placementTimer);
        }
        
        this.placementTimer = setTimeout(() => {
            console.log(`Placement time expired in room ${this.id}`);
            this.endPlacementPhase();
        }, this.placementDuration);
    }

    // Handle placement submissions with ready state
    submitPlayerPlacements(playerId, placements, ready = true) {
        if (this.gamePhase !== 'placement') {
            return { success: false, error: 'Not in placement phase' };
        }
        
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
 
        // Validate placements if provided
        if (placements.length > 0 && !this.validatePlacements(placements, player)) {
            return { success: false, error: 'Invalid placements' };
        }
        
        // Store placements
        this.playerPlacements.set(playerId, placements);
        player.squadsPlacedThisRound = placements.length;
        
        // Update ready state
        player.placementReady = ready;
        this.placementReadyStates.set(playerId, ready);
        
        console.log(`Player ${player} submitted ${placements.length} placements, ready: ${ready}`);
        
        return { success: true };
    }

    // Check if all players are ready for battle
    areAllPlayersReady() {
        return Array.from(this.players.values()).every(p => p.placementReady);
    }

    // Get opponent placements for a specific player
    getOpponentPlacements(playerId) {
        const opponents = Array.from(this.players.keys()).filter(id => id !== playerId);
        const allOpponentPlacements = [];
        
        for (const opponentId of opponents) {
            const opponentPlacements = this.playerPlacements.get(opponentId) || [];
            allOpponentPlacements.push(...opponentPlacements);
        }
        
        return allOpponentPlacements;
    }

    // Start battle when called by network manager
    startBattle() {
        try {
            console.log(`Starting battle for room ${this.id}`);
            
            // Validate that all players are ready
            if (!this.areAllPlayersReady()) {
                return { success: false, error: 'Not all players are ready' };
            }
            
            // End placement phase if still active
            if (this.gamePhase === 'placement') {
                this.endPlacementPhase();
            }
            
            // Spawn units from placements using proper squad creation
            const spawnResult = this.spawnUnitsFromPlacements();
            if (!spawnResult.success) {
                return spawnResult;
            }
            
            // Start battle phase
            this.startBattlePhase();
            
            return { success: true };
            
        } catch (error) {
            console.error(`Error starting battle for room ${this.id}:`, error);
            return { success: false, error: `Battle start failed: ${error.message}` };
        }
    }

    validatePlacements(placements, player) {
        // Check squad count limit
        if (placements.length > this.maxSquadsPerRound) {
            console.log(`Player ${player.id} exceeded squad limit: ${placements.length} > ${this.maxSquadsPerRound}`);
            return false;
        }
        
        // Check gold cost
        let totalCost = 0;
        for (const placement of placements) {
            totalCost += placement.unitType?.value || 0;
        }
        
        if (totalCost > player.gold) {
            console.log(`Player ${player.id} insufficient gold: ${totalCost} > ${player.gold}`);
            return false;
        }
        
        // Check placement positions (basic validation)
        for (const placement of placements) {
            if (!placement.gridPosition || !placement.unitType) {
                console.log(`Player ${player.id} invalid placement data:`, placement);
                return false;
            }
            
            // Validate side placement - no mirroring, direct side enforcement
               // Validate side placement - no mirroring, direct side enforcement
            const squadData = this.game.squadManager.getSquadData(placement.unitType);
            const cells = this.game.squadManager.getSquadCells(placement.gridPosition, squadData);
            if(!this.game.gridSystem.isValidPlacement(cells, player.team)){
                console.log('Invalid Placement', player, placement);
            }
        }
        
        return true;
    }

    endPlacementPhase() {
        if (this.placementTimer) {
            clearTimeout(this.placementTimer);
            this.placementTimer = null;
        }
        
        this.gamePhase = 'battle_prep';
        console.log(`Placement phase ended in room ${this.id}, preparing battle`);
    }

    spawnUnitsFromPlacements() {
        try {
            // Clear existing battle entities
            this.clearBattlefield();
            
            if (!this.game.battleSystem) {
                throw new Error('Battle system not available');
            }
            
            // Spawn squads for each player using the enhanced battle system
            for (const [playerId, placements] of this.playerPlacements) {
                const player = this.players.get(playerId);
                if (!player) continue;
                
                console.log(`Spawning ${placements.length} squads for player ${playerId} (${player.side} side)`);
                
                // Use the battle system's squad creation from placements
                const createdSquads = this.game.battleSystem.spawnSquadsFromPlacements(
                    placements,
                    player.side,
                    playerId
                );
                
                // Store created squads for tracking and cleanup
                this.createdSquads.set(playerId, createdSquads);
                
                // Deduct gold cost
                const totalCost = placements.reduce((sum, p) => sum + (p.unitType?.value || 0), 0);
                player.gold -= totalCost;
                
                console.log(`Successfully spawned ${createdSquads.length} squads for player ${playerId}, cost: ${totalCost}g`);
            }
            
            return { success: true };
            
        } catch (error) {
            console.error(`Error spawning units from placements in room ${this.id}:`, error);
            return { success: false, error: `Failed to spawn units: ${error.message}` };
        }
    }

    startBattlePhase() {
        this.gamePhase = 'battle';
        this.battleResults.clear();
        
        // Initialize battle simulation
        this.game.state.phase = 'battle';
        this.game.state.simTime = 0;
        this.game.state.simTick = 0;
        this.game.state.isPaused = false;
        
        // Start battle timer
        this.startBattleTimer();
        
        this.broadcastToPlayers({
            type: 'PHASE_UPDATE',
            phase: 'battle',
            gameState: this.getGameState()
        });
        
        console.log(`Battle phase started in room ${this.id}`);
    }

    startBattleTimer() {
        if (this.battleTimer) {
            clearTimeout(this.battleTimer);
        }
        
        this.battleTimer = setTimeout(() => {
            console.log(`Battle time expired in room ${this.id}`);
            this.endBattle();
        }, this.battleDuration);
    }

    handleBattleResult(battleResult) {
        this.endBattle(battleResult.winner);
    }

    endBattle(winner = null) {
        if (this.battleTimer) {
            clearTimeout(this.battleTimer);
            this.battleTimer = null;
        }
        
        this.gamePhase = 'round_end';
        
        // Apply damage to losing team
        if (winner && winner !== 'draw') {
            const loser = Array.from(this.players.values()).find(p => p.id !== winner);
            if (loser) {
                const damage = this.calculateRoundDamage(winner);
                this.teamHealths.set(loser.id, Math.max(0, this.teamHealths.get(loser.id) - damage));
                loser.health = this.teamHealths.get(loser.id);
            }
            
            // Increment winner's wins
            const winningPlayer = this.players.get(winner);
            if (winningPlayer) {
                winningPlayer.wins++;
            }
        }
        
        const battleResult = {
            winner: winner,
            round: this.currentRound,
            survivingUnits: this.getSurvivingUnits(),
            playerHealths: Object.fromEntries(this.teamHealths)
        };
        
        this.broadcastToPlayers({
            type: 'BATTLE_END',
            result: battleResult,
            gameState: this.getGameState()
        });
        
        console.log(`Battle ended in room ${this.id}, winner: ${winner}`);
        
        // Check for game end or continue to next round
        setTimeout(() => {
            if (this.shouldEndGame()) {
                this.endGame();
            } else {
                this.prepareNextRound();
            }
        }, 3000);
    }

    calculateRoundDamage(winner) {
        // Calculate damage based on surviving units
        const survivingUnits = this.getSurvivingUnits();
        const winnerUnits = survivingUnits[winner] || 0;
        
        // Base damage + bonus for surviving units
        return 10 + Math.floor(winnerUnits * 2);
    }

    getSurvivingUnits() {
        const survivors = {};
        
        for (const [playerId, player] of this.players) {
            survivors[playerId] = 0;
        }
        
        // Count surviving units from created squads
        for (const [playerId, squads] of this.createdSquads) {
            let survivingCount = 0;
            
            for (const squad of squads) {
                if (squad.squadUnits && this.game.componentManager) {
                    const ComponentTypes = this.game.componentManager.getComponentTypes();
                    
                    for (const unit of squad.squadUnits) {
                        const health = this.game.getComponent(unit.entityId, ComponentTypes.HEALTH);
                        const deathState = this.game.getComponent(unit.entityId, ComponentTypes.DEATH_STATE);
                        
                        if (health && health.current > 0 && (!deathState || !deathState.isDying)) {
                            survivingCount++;
                        }
                    }
                }
            }
            
            survivors[playerId] = survivingCount;
        }
        
        return survivors;
    }

    shouldEndGame() {
        // Check if any player is eliminated
        const alivePlayers = Array.from(this.teamHealths.values()).filter(health => health > 0);
        return alivePlayers.length <= 1 || this.currentRound >= this.maxRounds;
    }

    prepareNextRound() {
        this.currentRound++;
        this.clearBattlefield();
        this.startPlacementPhase();
    }

    endGame() {
        this.gamePhase = 'ended';
        
        // Determine final winner
        let finalWinner = null;
        let maxHealth = -1;
        
        for (const [playerId, health] of this.teamHealths) {
            if (health > maxHealth) {
                maxHealth = health;
                finalWinner = playerId;
            }
        }
        
        const gameResult = {
            winner: finalWinner,
            finalStats: this.getFinalStats(),
            totalRounds: this.currentRound - 1
        };
        
        this.broadcastToPlayers({
            type: 'GAME_END',
            result: gameResult,
            gameState: this.getGameState()
        });
        
        console.log(`Game ended in room ${this.id}, final winner: ${finalWinner}`);
        
        // Clean up room after delay
        setTimeout(() => {
            this.isActive = false;
        }, 10000);
    }

    getFinalStats() {
        const stats = {};
        for (const [playerId, player] of this.players) {
            stats[playerId] = {
                name: player.name,
                health: this.teamHealths.get(playerId),
                wins: player.wins,
                gold: player.gold
            };
        }
        return stats;
    }

    clearBattlefield() {
        try {
            if (this.game.battleSystem) {
                this.game.battleSystem.clearBattlefield();
            }
            
            // Clean up squad references
            for (const [playerId, squads] of this.createdSquads) {
                for (const squad of squads) {
                    // Squads are already cleaned up by battle system clearBattlefield
                    // Just clear our references
                    if (squad.squadUnits) {
                        squad.squadUnits.length = 0;
                    }
                }
            }
            
            this.createdSquads.clear();
            
        } catch (error) {
            console.error(`Error clearing battlefield in room ${this.id}:`, error);
        }
    }

    getPlayerBySide(side) {
        return Array.from(this.players.values()).find(p => p.side === side);
    }

    getGameState() {
        return {
            roomId: this.id,
            phase: this.gamePhase,
            round: this.currentRound,
            maxRounds: this.maxRounds,
            players: Array.from(this.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                side: p.side,
                ready: p.ready,
                placementReady: p.placementReady,
                gold: p.gold,
                health: this.teamHealths.get(p.id),
                wins: p.wins,
                squadsPlaced: p.squadsPlacedThisRound
            })),
            timeRemaining: this.getPhaseTimeRemaining()
        };
    }

    getPhaseTimeRemaining() {
        // Calculate remaining time for current phase
        if (this.gamePhase === 'placement' && this.placementTimer) {
            return Math.max(0, this.placementDuration);
        } else if (this.gamePhase === 'battle' && this.battleTimer) {
            return Math.max(0, this.battleDuration);
        }
        return 0;
    }
}