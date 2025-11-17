// MatchmakingService.js - Server-level service (not a game system)
class ServerMatchmakingService {
    constructor(engine) {
        this.engine = engine;
        
        // Matchmaking pool management
        this.matchmakingPool = new Map(); // playerId -> { playerName, timestamp, playerId }
        this.nextRoomId = 1000;
        
        // Timing for periodic operations
        this.lastPoolCheck = 0;
        this.poolCheckInterval = 2000; // Check every 2 seconds
        this.lastPoolUpdate = 0;
        this.poolUpdateInterval = 5000; // Update waiting players every 5 seconds
        this.maxWaitTime = 60000; // Remove stale requests after 60 seconds
        
        // Subscribe to network events
        this.setupEventListeners();
    }

    // =============================================
    // ENGINE-LEVEL UPDATE FUNCTION
    // =============================================

    update(deltaTime, currentTime) {
        // Check for matches periodically
        if (currentTime - this.lastPoolCheck >= this.poolCheckInterval) {
            this.processMatchmakingPool();
            this.lastPoolCheck = currentTime;
        }

        // Update waiting players with current status
        if (currentTime - this.lastPoolUpdate >= this.poolUpdateInterval) {
            this.updateWaitingPlayers();
            this.lastPoolUpdate = currentTime;
        }

        // Clean up stale matchmaking requests
        this.cleanupStaleRequests(currentTime);
    }

    // =============================================
    // EVENT LISTENERS
    // =============================================

    setupEventListeners() {
        if (!this.engine.serverEventManager) {
            console.error('No server event manager found');
            return;
        }

        // Subscribe to matchmaking events
        this.engine.serverEventManager.subscribe('QUICK_MATCH', this.handleQuickMatch.bind(this));
        this.engine.serverEventManager.subscribe('CANCEL_MATCHMAKING', this.handleCancelMatchmaking.bind(this));
        this.engine.serverEventManager.subscribe('PLAYER_DISCONNECT', this.handlePlayerDisconnect.bind(this));
    }

    // =============================================
    // MATCHMAKING POOL MANAGEMENT
    // =============================================

    addToMatchmakingPool(playerId, playerName) {
        // Check if player is already in a room
        if (this.findPlayerRoom(playerId)) {
            return {
                success: false,
                error: 'Player already in a game room'
            };
        }

        // Check if player is already in pool
        if (this.matchmakingPool.has(playerId)) {
            return {
                success: false,
                error: 'Player already searching for a match'
            };
        }

        this.matchmakingPool.set(playerId, {
            playerId,
            playerName: playerName || `Player ${playerId.substr(-4)}`,
            timestamp: Date.now()
        });
        
        console.log(`Player ${playerName} added to matchmaking pool. Pool size: ${this.matchmakingPool.size}`);
        
        // Send confirmation to player
        this.engine.serverNetworkManager.sendToPlayer(playerId, 'MATCHMAKING_SEARCHING', {
            message: 'Searching for opponent...',
            playersInPool: this.matchmakingPool.size
        });
        
        return { success: true };
    }

    removeFromMatchmakingPool(playerId) {
        const removed = this.matchmakingPool.delete(playerId);
        if (removed) {
            console.log(`Player removed from matchmaking pool. Pool size: ${this.matchmakingPool.size}`);
        }
        return removed;
    }

    processMatchmakingPool() {
        if (this.matchmakingPool.size < 2) {
            return; // Need at least 2 players
        }

        // Get two players from the pool (first come, first served)
        const players = Array.from(this.matchmakingPool.values());
        const player1 = players[0];
        const player2 = players[1];

        // Remove matched players from pool
        this.removeFromMatchmakingPool(player1.playerId);
        this.removeFromMatchmakingPool(player2.playerId);

        // Create a new room for these players
        this.createMatchmadeRoom(player1, player2);
    }

    updateWaitingPlayers() {
        if (this.matchmakingPool.size === 0) return;

        // Send updates to all players in the pool
        for (const [playerId, playerData] of this.matchmakingPool) {
            const currentTime = Date.now();
            const waitTime = Math.floor((currentTime - playerData.timestamp) / 1000);
            
            this.engine.serverNetworkManager.sendToPlayer(playerId, 'MATCHMAKING_SEARCHING', {
                message: this.matchmakingPool.size === 1 ? 
                    'Waiting for another player...' : 
                    `Found ${this.matchmakingPool.size} players searching...`,
                playersInPool: this.matchmakingPool.size,
                waitTime: waitTime
            });
        }
    }

    cleanupStaleRequests(currentTime) {
        const toRemove = [];
        
        for (const [playerId, playerData] of this.matchmakingPool) {
            const waitTime = currentTime - playerData.timestamp;
            if (waitTime > this.maxWaitTime) {
                toRemove.push(playerId);
            }
        }
        
        toRemove.forEach(playerId => {
            this.removeFromMatchmakingPool(playerId);
            this.engine.serverNetworkManager.sendToPlayer(playerId, 'MATCHMAKING_CANCELLED', {
                message: 'Matchmaking request timed out'
            });
        });
    }

    // =============================================
    // ROOM CREATION
    // =============================================

    createMatchmadeRoom(player1, player2) {
        try {
            // Generate room ID
            const roomId = this.generateRoomId();
            
            // Create new game room using the engine's method
            const room = this.engine.createGameRoom(roomId, 2);
            
            if (!room) {
                console.error('Failed to create game room');
                // Return players to pool if room creation fails
                this.addToMatchmakingPool(player1.playerId, player1.playerName);
                this.addToMatchmakingPool(player2.playerId, player2.playerName);
                return;
            }

            // Add both players to the room
            const result1 = room.addPlayer(player1.playerId, {
                name: player1.playerName,
                isHost: true
            });

            const result2 = room.addPlayer(player2.playerId, {
                name: player2.playerName,
                isHost: false
            });

            if (result1.success && result2.success) {
                // Join both players to the room via network manager
                this.engine.serverNetworkManager.joinRoom(player1.playerId, roomId);
                this.engine.serverNetworkManager.joinRoom(player2.playerId, roomId);

                // Send match found messages
                this.engine.serverNetworkManager.sendToPlayer(player1.playerId, 'QUICK_MATCH_FOUND', {
                    roomId: roomId,
                    playerId: player1.playerId,
                    isHost: true,
                    gameState: room.getGameState(),
                    opponent: player2.playerName
                });

                this.engine.serverNetworkManager.sendToPlayer(player2.playerId, 'QUICK_MATCH_FOUND', {
                    roomId: roomId,
                    playerId: player2.playerId,
                    isHost: false,
                    gameState: room.getGameState(),
                    opponent: player1.playerName
                });

                console.log(`Match created: ${player1.playerName} vs ${player2.playerName} in room ${roomId}`);
            } else {
                // If adding players failed, return them to pool
                console.error('Failed to add players to room:', result1, result2);
                this.addToMatchmakingPool(player1.playerId, player1.playerName);
                this.addToMatchmakingPool(player2.playerId, player2.playerName);
                
                // Clean up the room if it was created
                this.engine.gameRooms.delete(roomId);
            }
        } catch (error) {
            console.error('Error creating matchmade room:', error);
            // Return players to pool
            this.addToMatchmakingPool(player1.playerId, player1.playerName);
            this.addToMatchmakingPool(player2.playerId, player2.playerName);
        }
    }

    // =============================================
    // EVENT HANDLERS
    // =============================================

    handleQuickMatch(eventData) {
        const { playerId, data } = eventData;
        
        try {
            const { playerName } = data;
            
            const result = this.addToMatchmakingPool(playerId, playerName);
            
            if (!result.success) {
                this.engine.serverNetworkManager.sendToPlayer(playerId, 'QUICK_MATCH_FAILED', { 
                    error: result.error 
                });
            }

        } catch (error) {
            console.error('Error in quick match:', error);
            this.engine.serverNetworkManager.sendToPlayer(playerId, 'QUICK_MATCH_FAILED', { 
                error: 'Server error during quick match' 
            });
        }
    }

    handleCancelMatchmaking(eventData) {
        const { playerId } = eventData;
        
        const removed = this.removeFromMatchmakingPool(playerId);
        if (removed) {
            this.engine.serverNetworkManager.sendToPlayer(playerId, 'MATCHMAKING_CANCELLED', {
                message: 'Matchmaking cancelled'
            });
        }
    }

    handlePlayerDisconnect(eventData) {
        const { playerId } = eventData;
        
        // Remove from matchmaking pool if they were searching
        this.removeFromMatchmakingPool(playerId);
    }

    // =============================================
    // UTILITY METHODS
    // =============================================

    findPlayerRoom(playerId) {
        for (const [roomId, room] of this.engine.gameRooms) {
            if (room.players && room.players.has(playerId)) {
                return room;
            }
        }
        return null;
    }

    generateRoomId() {
        let roomId;
        do {
            roomId = (Math.floor(Math.random() * 9000) + 1000).toString();
        } while (this.engine.gameRooms.has(roomId));
        return roomId;
    }

    getMatchmakingStats() {
        const totalPlayersInRooms = Array.from(this.engine.gameRooms.values())
            .reduce((total, room) => total + (room.players ? room.players.size : 0), 0);
            
        return {
            playersInPool: this.matchmakingPool.size,
            activeRooms: this.engine.gameRooms.size,
            playersInRooms: totalPlayersInRooms,
            totalPlayers: totalPlayersInRooms + this.matchmakingPool.size
        };
    }

    // =============================================
    // CLEANUP
    // =============================================

    destroy() {
        // Notify all players in pool that matchmaking is shutting down
        for (const [playerId, player] of this.matchmakingPool) {
            this.engine.serverNetworkManager.sendToPlayer(playerId, 'MATCHMAKING_CANCELLED', {
                message: 'Server shutting down'
            });
        }
        
        this.matchmakingPool.clear();
        console.log('MatchmakingService destroyed');
    }
}