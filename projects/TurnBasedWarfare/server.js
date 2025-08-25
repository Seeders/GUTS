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
        this.gameState = 'waiting'; // waiting, placement, battle, upgrading, ended
        this.currentRound = 1;
        this.maxRounds = 5;
        this.placementTimer = null;
        this.placementTimeLimit = 90; // seconds
        this.battleResults = null;
        this.createdAt = Date.now();
        this.lastActivity = Date.now();
        
        // Track placement submissions
        this.placementSubmissions = new Map();
        this.upgradeSubmissions = new Map();
        
        console.log(`Created room ${roomId} with ${maxPlayers} max players`);
    }
    
    addPlayer(socketId, playerData) {
        if (this.players.size >= this.maxPlayers) {
            return { success: false, error: 'Room is full' };
        }
        
        const playerId = `player_${this.players.size + 1}`;
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
            joinedAt: Date.now()
        };
        
        this.players.set(playerId, player);
        this.lastActivity = Date.now();
        
        console.log(`Player ${player.name} (${playerId}) joined room ${this.roomId}`);
        
        // Start game if room is full
        if (this.players.size === this.maxPlayers) {
            this.startGame();
        }
        
        return { success: true, playerId, player };
    }
    
    removePlayer(socketId) {
        for (const [playerId, player] of this.players) {
            if (player.socketId === socketId) {
                this.players.delete(playerId);
                console.log(`Player ${player.name} left room ${this.roomId}`);
                
                // End game if player leaves during active game
                if (this.gameState !== 'waiting' && this.gameState !== 'ended') {
                    this.endGame('player_disconnect');
                }
                
                return playerId;
            }
        }
        return null;
    }
    
    startGame() {
        if (this.players.size < this.maxPlayers) return;
        
        this.gameState = 'placement';
        this.currentRound = 1;
        
        // Reset all players for new game
        for (const player of this.players.values()) {
            player.ready = false;
            player.gold = 100;
            player.health = 100;
            player.armyPlacements = [];
            player.upgrades = [];
            player.wins = 0;
        }
        
        console.log(`Starting game in room ${this.roomId}`);
        this.startPlacementPhase();
    }
    
    startPlacementPhase() {
        this.gameState = 'placement';
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
        if (this.gameState !== 'placement') {
            return { success: false, error: 'Not in placement phase' };
        }
        
        const player = this.players.get(playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        // Validate placements (basic validation)
        if (!this.validatePlacements(placements, player.gold)) {
            return { success: false, error: 'Invalid placements' };
        }
        
        // Store placements
        this.placementSubmissions.set(playerId, {
            placements,
            submittedAt: Date.now()
        });
        
        player.armyPlacements = placements;
        player.ready = true;
        
        console.log(`Player ${player.name} submitted placements for round ${this.currentRound}`);
        
        // Check if all players have submitted
        if (this.placementSubmissions.size === this.players.size) {
            this.endPlacementPhase();
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
        
        this.gameState = 'battle';
        console.log(`Battle phase started in room ${this.roomId}`);
        
        // Simulate battle (in real game, this would be handled by game engine)
        setTimeout(() => {
            this.resolveBattle();
        }, 3000); // 3 second battle simulation
    }
    
    resolveBattle() {
        // Simple battle resolution - in real game this would be much more complex
        const playerIds = Array.from(this.players.keys());
        const results = this.simulateBattle(playerIds);
        
        this.battleResults = results;
        
        // Apply battle results
        for (const [playerId, result] of Object.entries(results.playerResults)) {
            const player = this.players.get(playerId);
            if (player) {
                player.health = Math.max(0, result.healthRemaining);
                if (result.winner) {
                    player.wins++;
                }
            }
        }
        
        console.log(`Battle resolved in room ${this.roomId}:`, results);
        
        // Check for game end conditions
        if (this.shouldEndGame()) {
            this.endGame('victory');
        } else {
            this.startUpgradePhase();
        }
    }
    
    simulateBattle(playerIds) {
        // Simple battle simulation - randomly determine winner with some logic
        const results = {
            winner: null,
            battleDuration: Math.random() * 30 + 10, // 10-40 seconds
            playerResults: {}
        };
        
        // For now, simple random with army size influence
        const playerStrengths = {};
        
        for (const playerId of playerIds) {
            const player = this.players.get(playerId);
            const armySize = player.armyPlacements?.length || 0;
            const armyValue = player.armyPlacements?.reduce((sum, p) => sum + (p.unitType?.value || 0), 0) || 0;
            
            playerStrengths[playerId] = {
                size: armySize,
                value: armyValue,
                strength: armySize + (armyValue / 50) + Math.random() * 10
            };
        }
        
        // Determine winner based on strength
        const sortedPlayers = playerIds.sort((a, b) => 
            playerStrengths[b].strength - playerStrengths[a].strength
        );
        
        const winner = sortedPlayers[0];
        const loser = sortedPlayers[1];
        
        results.winner = winner;
        results.playerResults[winner] = {
            winner: true,
            healthRemaining: Math.max(60, 100 - Math.random() * 40),
            damageDealt: playerStrengths[winner].strength
        };
        
        results.playerResults[loser] = {
            winner: false,
            healthRemaining: Math.max(0, this.players.get(loser).health - Math.random() * 50 - 20),
            damageDealt: playerStrengths[loser].strength
        };
        
        return results;
    }
    
    shouldEndGame() {
        // Check if any player is eliminated or max rounds reached
        const alivePlayers = Array.from(this.players.values()).filter(p => p.health > 0);
        return alivePlayers.length <= 1 || this.currentRound >= this.maxRounds;
    }
    
    startUpgradePhase() {
        this.gameState = 'upgrading';
        this.upgradeSubmissions.clear();
        
        console.log(`Upgrade phase started in room ${this.roomId}`);
        
        // Give players 30 seconds to choose upgrades
        setTimeout(() => {
            this.endUpgradePhase();
        }, 30000);
    }
    
    submitUpgrades(playerId, upgrades) {
        if (this.gameState !== 'upgrading') {
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
        this.gameState = 'ended';
        
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
        return {
            roomId: this.roomId,
            gameState: this.gameState,
            currentRound: this.currentRound,
            maxRounds: this.maxRounds,
            players: Array.from(this.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                ready: p.ready,
                gold: p.gold,
                health: p.health,
                wins: p.wins
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
        if (room.players.size < room.maxPlayers && room.gameState === 'waiting') {
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
        if (room.gameState === 'waiting' && room.players.size < room.maxPlayers) {
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
        gamesInProgress: Array.from(gameRooms.values()).filter(room => room.gameState !== 'waiting').length
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Auto Battle Arena Multiplayer Server running on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    console.log(`HTTP API: http://localhost:${PORT}/api`);
});