// server.js - Node.js Multiplayer Server for Auto Battle Arena
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Game state management
class GameRoom {
    constructor(roomId, maxPlayers = 2) {
        this.roomId = roomId;
        this.maxPlayers = maxPlayers;
        this.players = new Map();
        this.hostPlayerId = null; // Track who is the host
        this.currentRound = 1;
        this.maxRounds = 5;
        this.placementTimer = null;
        this.placementTimeLimit = 90;
        this.battleResults = null;
        this.createdAt = Date.now();
        this.lastActivity = Date.now();
        
        this.placementSubmissions = new Map();
        this.battleReadyConfirmations = new Map();
        this.battleResults = new Map();
        this.currentPhase = 'waiting'; // 'placement', 'battle_prep', 'battle', 'battle_results'
    }

    addPlayer(socketId, playerData) {
        if (this.players.size >= this.maxPlayers) {
            return { success: false, error: 'Room is full' };
        }

        const playerId = `player_${this.players.size + 1}`;

        // Side assignment: first in gets 'left', second gets 'right'
        const assignedSide = this.players.size === 0 ? 'left' : 'right';

        const player = {
            id: playerId,
            socketId: socketId,
            name: playerData.name || `Player ${this.players.size + 1}`,
            ready: false,
            gold: 100,
            health: 100,
            armyPlacements: [],
            upgrades: [],
            wins: 0,
            isHost: false,          // host tracking
            side: assignedSide,     // <-- NEW: fixed board side
            joinedAt: Date.now()
        };

        // First player becomes host
        if (this.players.size === 0) {
            player.isHost = true;
            this.hostPlayerId = playerId;
            console.log(`Player ${player.name} is now the host of room ${this.roomId}`);
        }

        this.players.set(playerId, player);
        this.lastActivity = Date.now();

        console.log(`Player ${player.name} (${playerId}) joined room ${this.roomId} on side=${player.side}`);

        return { success: true, playerId, player };
    }
    
    removePlayer(socketId) {
        for (const [playerId, player] of this.players) {
            if (player.socketId === socketId) {
                const wasHost = player.isHost;
                this.players.delete(playerId);
                console.log(`Player ${player.name} left room ${this.roomId}`);
                
                // If host left, assign new host
                if (wasHost && this.players.size > 0) {
                    const newHost = Array.from(this.players.values())[0];
                    newHost.isHost = true;
                    this.hostPlayerId = newHost.id;
                    console.log(`${newHost.name} is now the host of room ${this.roomId}`);
                }
                
                // End game if player leaves during active game
                if (this.currentPhase !== 'waiting' && this.currentPhase !== 'ended') {
                    this.endGame('player_disconnect');
                }
                
                return { playerId, wasHost, newHost: this.hostPlayerId };
            }
        }
        return null;
    }
    startGameByHost(hostPlayerId) {
        if (this.hostPlayerId !== hostPlayerId) {
            return { success: false, error: 'Only the host can start the game' };
        }
        
        if (this.players.size < this.maxPlayers) {
            return { success: false, error: 'Not enough players to start' };
        }
        
        // Check if all players are ready
        const allReady = Array.from(this.players.values()).every(p => p.ready);
        if (!allReady) {
            return { success: false, error: 'All players must be ready before starting' };
        }
        
        if (this.currentPhase !== 'waiting') {
            return { success: false, error: 'Game already started' };
        }
        
        this.startGame();
        return { success: true };
    }

    startGame() {
        console.log(`Host started game in room ${this.roomId} with ${this.players.size} players`);
        
        this.currentPhase = 'placement';
        this.currentRound = 1;
        
        // Reset all players for new game
        for (const player of this.players.values()) {
            player.gold = 100;
            player.health = 100;
            player.armyPlacements = [];
            player.upgrades = [];
            player.wins = 0;
            // Keep ready state and host status unchanged
        }
        
        this.startPlacementPhase();
    }
    
    startPlacementPhase() {
        this.currentPhase = 'placement';
        this.placementSubmissions.clear();
        
        // Clear placement timer if exists
        if (this.placementTimer) {
            clearTimeout(this.placementTimer);
        }
        
        // Calculate gold for round
        this.distributeRoundGold();
        
        // Set placement timer
        this.placementTimer = setTimeout(() => {
            this.endPlacementPhase();
        }, this.placementTimeLimit * 1000);
        
        console.log(`Round ${this.currentRound} placement phase started in room ${this.roomId}`);
    }
    
    distributeRoundGold() {
        const baseGold = 25;
        const roundGold = baseGold + (this.currentRound * baseGold);
        
        for (const player of this.players.values()) {
            if (this.currentRound === 1) {
                player.gold = 100; // Starting gold
            } else {
                player.gold += roundGold;
            }
        }
    }
    
    submitPlacements(playerId, placements) {
        if (this.currentPhase !== 'placement') {
            return { success: false, error: 'Not in placement phase' };
        }

        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }

        // Store placements
        this.placementSubmissions.set(playerId, {
            placements,
            submittedAt: Date.now()
        });

        player.armyPlacements = placements;
        player.ready = true;

        console.log(`Player ${player.name} submitted ${placements.length} placements`);

        // Check if all players have submitted
        if (this.placementSubmissions.size === this.players.size) {
            this.startBattlePrep();
        }

        return { success: true };
    }
    startBattlePrep() {
        this.currentPhase = 'battle_prep';
        this.battleReadyConfirmations.clear();
        
        console.log(`All players submitted placements in room ${this.roomId}, sending opponent data`);

        // Send all placements to all players
        for (const [playerId, player] of this.players) {
            const opponentPlacements = [];
            
            // Collect placements from other players
            for (const [otherPlayerId, otherPlayer] of this.players) {
                if (otherPlayerId !== playerId) {
                    opponentPlacements.push(...otherPlayer.armyPlacements);
                }
            }

            const socket = io.sockets.sockets.get(player.socketId);
            if (socket) {
                socket.emit('battle_prep', {
                    opponentPlacements: opponentPlacements,
                    allPlayerData: Array.from(this.players.values()).map(p => ({
                        id: p.id,
                        name: p.name,
                        placements: p.armyPlacements
                    }))
                });
            }
        }
    }
    confirmBattleReady(playerId) {
        if (this.currentPhase !== 'battle_prep') {
            return { success: false, error: 'Not in battle prep phase' };
        }

        this.battleReadyConfirmations.set(playerId, Date.now());
        
        console.log(`Player ${playerId} confirmed battle ready (${this.battleReadyConfirmations.size}/${this.players.size})`);

        // Check if all players are ready for battle
        if (this.battleReadyConfirmations.size === this.players.size) {
            this.startBattle();
        }

        return { success: true };
    }
    validatePlacements(placements, playerGold) {
        // Basic validation - check if placement cost doesn't exceed gold
        let totalCost = 0;
        
        for (const placement of placements) {
            if (!placement.unitType || !placement.gridPosition) {
                return false;
            }
            totalCost += placement.unitType.value || 0;
        }
        
        return totalCost <= playerGold;
    }
    
    endPlacementPhase() {
        if (this.placementTimer) {
            clearTimeout(this.placementTimer);
            this.placementTimer = null;
        }
        this.startBattlePrep();       
        
    }
    startBattle() {
        this.currentPhase = 'battle';
        this.battleResults.clear();
        
        console.log(`Starting battle in room ${this.roomId}`);

        // Tell all clients to start their local battles
        for (const [playerId, player] of this.players) {
            const socket = io.sockets.sockets.get(player.socketId);
            if (socket) {
                socket.emit('start_battle', {
                    battleSeed: Date.now(), // For deterministic randomness
                    battleConfig: {
                        maxDuration: 30000, // 30 second max battle
                        roundNumber: this.currentRound
                    }
                });
            }
        }
    }
    submitBattleResult(playerId, battleResult) {
        if (this.currentPhase !== 'battle') {
            return { success: false, error: 'Not in battle phase' };
        }

        this.battleResults.set(playerId, {
            result: battleResult,
            submittedAt: Date.now()
        });

        console.log(`Player ${playerId} submitted battle result: ${battleResult.winner}`);

        // Check if all players submitted results
        if (this.battleResults.size === this.players.size) {
            this.processBattleResults();
        }

        return { success: true };
    }
    processBattleResults() {
        const results = Array.from(this.battleResults.values());
        
        // Verify all clients got the same result
        const firstResult = results[0].result;
        const allMatch = results.every(r => 
            r.result.winner === firstResult.winner &&
            r.result.survivorCount === firstResult.survivorCount
        );

        if (!allMatch) {
            console.error('Battle results mismatch! Results:', results);
            // Handle desync - for now, use first result
        }

        const finalResult = firstResult;
        this.currentPhase = 'round_end';

        // Send final results to all players
        for (const [playerId, player] of this.players) {
            const socket = io.sockets.sockets.get(player.socketId);
            if (socket) {
                socket.emit('battle_complete', {
                    battleResult: finalResult,
                    verified: allMatch,
                    roundNumber: this.currentRound
                });
            }
        }

        // Prepare for next round or end game
        setTimeout(() => {
            if (this.shouldEndGame(finalResult)) {
                this.endGame(finalResult.winner);
            } else {
                this.prepareNextRound();
            }
        }, 3000);
    }
    prepareNextRound() {
        this.currentRound++;
        this.currentPhase = 'placement';
        this.placementSubmissions.clear();
        this.battleReadyConfirmations.clear();
        this.battleResults.clear();

        // Reset player ready states
        for (const player of this.players.values()) {
            player.ready = false;
            player.armyPlacements = [];
        }

        console.log(`Starting round ${this.currentRound} in room ${this.roomId}`);

        // Notify all players of new round
        for (const [playerId, player] of this.players) {
            const socket = io.sockets.sockets.get(player.socketId);
            if (socket) {
                socket.emit('new_round', {
                    roundNumber: this.currentRound,
                    gameState: this.getGameState()
                });
            }
        }
    }

    shouldEndGame() {
        // Check if any player is eliminated or max rounds reached
        const alivePlayers = Array.from(this.players.values()).filter(p => p.health > 0);
        return alivePlayers.length <= 1 || this.currentRound >= this.maxRounds;
    }
    
    startUpgradePhase() {
        this.currentPhase = 'upgrading';
        this.upgradeSubmissions.clear();
        
        console.log(`Upgrade phase started in room ${this.roomId}`);
        
        // Give players 30 seconds to choose upgrades
        setTimeout(() => {
            this.endUpgradePhase();
        }, 30000);
    }
    
    submitUpgrades(playerId, upgrades) {
        if (this.currentPhase !== 'upgrading') {
            return { success: false, error: 'Not in upgrade phase' };
        }
        
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        this.upgradeSubmissions.set(playerId, {
            upgrades,
            submittedAt: Date.now()
        });
        
        player.upgrades = [...(player.upgrades || []), ...upgrades];
        
        console.log(`Player ${player.name} submitted upgrades`);
        
        // Check if all players have submitted
        if (this.upgradeSubmissions.size === this.players.size) {
            this.endUpgradePhase();
        }
        
        return { success: true };
    }
    
    endUpgradePhase() {
        this.currentRound++;
        
        if (this.shouldEndGame()) {
            this.endGame('victory');
        } else {
            this.startPlacementPhase();
        }
    }
    
    endGame(reason) {
        this.currentPhase = 'ended';
        
        if (this.placementTimer) {
            clearTimeout(this.placementTimer);
            this.placementTimer = null;
        }
        
        // Determine final winner
        let finalWinner = null;
        let maxWins = -1;
        let maxHealth = -1;
        
        for (const [playerId, player] of this.players) {
            if (player.wins > maxWins || (player.wins === maxWins && player.health > maxHealth)) {
                maxWins = player.wins;
                maxHealth = player.health;
                finalWinner = playerId;
            }
        }
        
        console.log(`Game ended in room ${this.roomId}. Winner: ${finalWinner}, Reason: ${reason}`);
        
        return {
            winner: finalWinner,
            reason,
            finalStats: this.getFinalStats()
        };
    }
    
    getFinalStats() {
        const stats = {};
        for (const [playerId, player] of this.players) {
            stats[playerId] = {
                name: player.name,
                wins: player.wins,
                health: player.health,
                finalGold: player.gold
            };
        }
        return stats;
    }
    
    getGameState() {
        console.log(this.currentPhase);
        return {
            roomId: this.roomId,
            currentPhase: this.currentPhase,
            currentRound: this.currentRound,
            maxRounds: this.maxRounds,
            hostPlayerId: this.hostPlayerId, // Include host info
            players: Array.from(this.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                ready: p.ready,
                gold: p.gold,
                health: p.health,
                wins: p.wins,
                isHost: p.isHost, // Include host status
                side: p.side // <-- include side in state sent to clients
            })),
            placementTimeRemaining: this.placementTimer ? this.placementTimeLimit : 0,
            battleResults: this.battleResults
        };
    }
}

// Room management
const gameRooms = new Map();
const playerRooms = new Map(); // Track which room each socket is in

// Utility functions
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function findAvailableRoom() {
    for (const room of gameRooms.values()) {
        if (room.players.size < room.maxPlayers && room.currentPhase === 'waiting') {
            return room;
        }
    }
    return null;
}

function cleanupInactiveRooms() {
    const now = Date.now();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes
    
    for (const [roomId, room] of gameRooms) {
        if (now - room.lastActivity > inactiveThreshold) {
            console.log(`Cleaning up inactive room ${roomId}`);
            gameRooms.delete(roomId);
            
            // Notify any remaining players
            for (const player of room.players.values()) {
                const socket = io.sockets.sockets.get(player.socketId);
                if (socket) {
                    socket.emit('room_closed', { reason: 'inactivity' });
                    playerRooms.delete(socket.id);
                }
            }
        }
    }
}

// Run cleanup every 10 minutes
setInterval(cleanupInactiveRooms, 10 * 60 * 1000);

// Socket.IO event handlers
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    
    socket.on('create_room', (data) => {
        const roomId = generateRoomId();
        const room = new GameRoom(roomId, data.maxPlayers || 2);
        gameRooms.set(roomId, room);
        
        const result = room.addPlayer(socket.id, data.playerData || {});
        if (result.success) {
            socket.join(roomId);
            playerRooms.set(socket.id, roomId);
            
            socket.emit('room_created', {
                roomId,
                playerId: result.playerId,
                gameState: room.getGameState()
            });
            
            // Notify room of new player
            socket.to(roomId).emit('player_joined', {
                player: result.player,
                gameState: room.getGameState()
            });
        } else {
            socket.emit('error', result.error);
        }
    });
    
    socket.on('join_room', (data) => {
        const { roomId, playerData } = data;
        const room = gameRooms.get(roomId);
        
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }
        
        const result = room.addPlayer(socket.id, playerData || {});
        if (result.success) {
            socket.join(roomId);
            playerRooms.set(socket.id, roomId);
            
            socket.emit('room_joined', {
                roomId,
                playerId: result.playerId,
                gameState: room.getGameState()
            });
            
            // Notify room of new player
            socket.to(roomId).emit('player_joined', {
                player: result.player,
                gameState: room.getGameState()
            });
        } else {
            socket.emit('error', result.error);
        }
    });
    
    socket.on('quick_match', (data) => {
        // Find or create a room for quick matching
        let room = findAvailableRoom();
        
        if (!room) {
            const roomId = generateRoomId();
            room = new GameRoom(roomId, 2);
            gameRooms.set(roomId, room);
        }
        
        const result = room.addPlayer(socket.id, data.playerData || {});
        if (result.success) {
            socket.join(room.roomId);
            playerRooms.set(socket.id, room.roomId);
            
            socket.emit('room_joined', {
                roomId: room.roomId,
                playerId: result.playerId,
                gameState: room.getGameState()
            });
            
            // Notify room of new player
            socket.to(room.roomId).emit('player_joined', {
                player: result.player,
                gameState: room.getGameState()
            });
        } else {
            socket.emit('error', result.error);
        }
    });
    socket.on('toggle_ready', () => {
        const roomId = playerRooms.get(socket.id);
        const room = gameRooms.get(roomId);
        
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }
        
        let player = null;
        for (const p of room.players.values()) {
            if (p.socketId === socket.id) {
                player = p;
                break;
            }
        }
        
        if (!player) {
            socket.emit('error', 'Player not found in room');
            return;
        }
        
        // Toggle ready state
        player.ready = !player.ready;
        room.lastActivity = Date.now();
        
        console.log(`Player ${player.name} is now ${player.ready ? 'ready' : 'not ready'} in room ${roomId}`);
        
        socket.emit('ready_toggled', { 
            ready: player.ready,
            playerId: player.id 
        });
        
        // Update entire room with new game state (no auto-start)
        io.to(roomId).emit('game_state_updated', room.getGameState());
    });
    socket.on('start_game', () => {
        const roomId = playerRooms.get(socket.id);
        const room = gameRooms.get(roomId);
        
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }
        
        // Find player
        let player = null;
        for (const p of room.players.values()) {
            if (p.socketId === socket.id) {
                player = p;
                break;
            }
        }
        
        if (!player) {
            socket.emit('error', 'Player not found in room');
            return;
        }
        
        // Attempt to start game
        const result = room.startGameByHost(player.id);
        
        if (result.success) {
            console.log(`Game started by host ${player.name} in room ${roomId}`);
            io.to(roomId).emit('game_started', room.getGameState());
        } else {
            socket.emit('error', result.error);
        }
    });
    socket.on('confirm_battle_ready', () => {
        const roomId = playerRooms.get(socket.id);
        const room = gameRooms.get(roomId);
        
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }

        let playerId = null;
        for (const [pid, player] of room.players) {
            if (player.socketId === socket.id) {
                playerId = pid;
                break;
            }
        }

        if (!playerId) {
            socket.emit('error', 'Player not found in room');
            return;
        }

        const result = room.confirmBattleReady(playerId);
        
        if (result.success) {
            socket.emit('battle_ready_confirmed');
        } else {
            socket.emit('error', result.error);
        }
    });

    socket.on('submit_battle_result', (data) => {
        const roomId = playerRooms.get(socket.id);
        const room = gameRooms.get(roomId);
        
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }

        let playerId = null;
        for (const [pid, player] of room.players) {
            if (player.socketId === socket.id) {
                playerId = pid;
                break;
            }
        }

        if (!playerId) {
            socket.emit('error', 'Player not found in room');
            return;
        }

        const result = room.submitBattleResult(playerId, data.battleResult);
        
        if (result.success) {
            socket.emit('battle_result_submitted');
        } else {
            socket.emit('error', result.error);
        }
    });
    socket.on('submit_placements', (data) => {
        const roomId = playerRooms.get(socket.id);
        const room = gameRooms.get(roomId);
        
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }
        
        // Find player ID
        let playerId = null;
        for (const [pid, player] of room.players) {
            if (player.socketId === socket.id) {
                playerId = pid;
                break;
            }
        }
        
        if (!playerId) {
            socket.emit('error', 'Player not found in room');
            return;
        }
        
        const result = room.submitPlacements(playerId, data.placements);
        
        if (result.success) {
            socket.emit('placements_submitted');
            
            // Notify room of updated game state
            io.to(roomId).emit('game_state_updated', room.getGameState());
        } else {
            socket.emit('error', result.error);
        }
    });
    
    socket.on('submit_upgrades', (data) => {
        const roomId = playerRooms.get(socket.id);
        const room = gameRooms.get(roomId);
        
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }
        
        // Find player ID
        let playerId = null;
        for (const [pid, player] of room.players) {
            if (player.socketId === socket.id) {
                playerId = pid;
                break;
            }
        }
        
        if (!playerId) {
            socket.emit('error', 'Player not found in room');
            return;
        }
        
        const result = room.submitUpgrades(playerId, data.upgrades);
        
        if (result.success) {
            socket.emit('upgrades_submitted');
            
            // Notify room of updated game state
            io.to(roomId).emit('game_state_updated', room.getGameState());
        } else {
            socket.emit('error', result.error);
        }
    });
    
    socket.on('get_game_state', () => {
        const roomId = playerRooms.get(socket.id);
        const room = gameRooms.get(roomId);
        
        if (room) {
            socket.emit('game_state_updated', room.getGameState());
        } else {
            socket.emit('error', 'Not in a room');
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        
        const roomId = playerRooms.get(socket.id);
        if (roomId) {
            const room = gameRooms.get(roomId);
            if (room) {
                const playerId = room.removePlayer(socket.id);
                if (playerId) {
                    // Notify room of player leaving
                    socket.to(roomId).emit('player_left', {
                        playerId,
                        gameState: room.getGameState()
                    });
                    
                    // Remove empty rooms
                    if (room.players.size === 0) {
                        gameRooms.delete(roomId);
                        console.log(`Removed empty room ${roomId}`);
                    }
                }
            }
            playerRooms.delete(socket.id);
        }
    });
});

// REST API endpoints for room management
app.get('/api/rooms', (req, res) => {
    const publicRooms = [];
    for (const [roomId, room] of gameRooms) {
        if (room.currentPhase === 'waiting' && room.players.size < room.maxPlayers) {
            publicRooms.push({
                roomId,
                playerCount: room.players.size,
                maxPlayers: room.maxPlayers,
                createdAt: room.createdAt
            });
        }
    }
    res.json(publicRooms);
});

app.get('/api/stats', (req, res) => {
    res.json({
        activeRooms: gameRooms.size,
        totalPlayers: Array.from(gameRooms.values()).reduce((sum, room) => sum + room.players.size, 0),
        gamesInProgress: Array.from(gameRooms.values()).filter(room => room.currentPhase !== 'waiting').length
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Auto Battle Arena Multiplayer Server running on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    console.log(`HTTP API: http://localhost:${PORT}/api`);
});