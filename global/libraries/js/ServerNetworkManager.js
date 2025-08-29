export default class ServerNetworkManager {
    constructor(engine) {
        this.engine = engine;
        this.io = null;
        this.playerSockets = new Map();
        this.nextRoomId = 1000; // Starting room code
        this.currentRoomIds = [];
        this._initialized = false; // prevent duplicate listeners on hot-reload
    }

    async init() {
        // If we've already wired handlers, don't add them again
        if (this._initialized) return;

        // Prefer an io instance that was created and attached to the HTTP server in server.js
        // and stashed globally (to avoid creating multiple Socket.IO servers across restarts).
        if (!this.io) {
            // support either global.io or global._io (set in server.js)
            const g = (typeof globalThis !== 'undefined' ? globalThis : global);
            if (g && (g.io || g._io)) {
                this.io = g.io || g._io;
            }
        }

        // Absolute fallback (e.g., tests) â€" create a standalone io only if none was provided.
        // NOTE: In production we attach to the existing HTTP server via server.js (preferred).
        if (!this.io) {
            const { Server } = await import('socket.io');
            this.io = new Server({
                cors: {
                    origin: "*",
                    methods: ["GET", "POST"]
                }
            });
            this.io.listen(3001);
            console.log('Auto Battle Socket.IO fallback listening on port 3001');
        }

        this.setupEventHandlers();
        this._initialized = true;

        // Do NOT call io.listen here when attached to the HTTP server.
        console.log('Auto Battle server Socket.IO initialized');
    }

    setupEventHandlers() {
        // Remove any prior handlers (useful during dev hot-reload) to avoid duplicates
        this.io.removeAllListeners('connection');

        this.io.on('connection', (socket) => {
            console.log('Player connected:', socket.id);

            // Auto Battle specific events
            socket.on('CREATE_ROOM', (data) => {
                this.handleCreateRoom(socket, data);
            });

            socket.on('JOIN_ROOM', (data) => {
                this.handleJoinRoom(socket, data);
            });

            socket.on('QUICK_MATCH', (data) => {
                this.handleQuickMatch(socket, data);
            });

            socket.on('TOGGLE_READY', () => {
                this.handleToggleReady(socket);
            });

            socket.on('SUBMIT_PLACEMENTS', (data) => {
                this.handleSubmitPlacements(socket, data);
            });

            socket.on('LEAVE_ROOM', () => {
                this.handleLeaveRoom(socket);
            });

            socket.on('disconnect', () => {
                this.handlePlayerDisconnect(socket);
            });

            // Send initial connection success
            socket.emit('CONNECTED', { 
                playerId: socket.id,
                serverTime: Date.now() 
            });
        });
    }

    handleCreateRoom(socket, data) {
        try {
            const { playerName, maxPlayers = 2 } = data;
            
            // Generate room code
            const roomId = this.generateRoomId();            
            
            // Create new game room using the engine's method
            const room = this.engine.createGameRoom(roomId, maxPlayers);
            
            const result = room.addPlayer(socket.id, {
                name: playerName || `Player ${socket.id.substr(-4)}`,
                socket: socket,
                isHost: true
            });

            if (result.success) {
                this.currentRoomIds.push(roomId);
                this.playerSockets.set(socket.id, { 
                    socket, 
                    roomId,
                    isHost: true 
                });
                socket.join(roomId);
                
                socket.emit('ROOM_CREATED', {
                    roomId: roomId,
                    playerId: socket.id,
                    isHost: true,
                    gameState: room.getGameState()
                });
                
                console.log(`Player ${playerName} created room ${roomId}`);
            } else {
                socket.emit('CREATE_ROOM_FAILED', { 
                    error: result.error || 'Failed to create room' 
                });
            }
        } catch (error) {
            console.error('Error creating room:', error);
            socket.emit('CREATE_ROOM_FAILED', { 
                error: 'Server error while creating room' 
            });
        }
    }

    handleJoinRoom(socket, data) {
        try {
            const { roomId, playerName } = data;
            
            if (!roomId) {
                socket.emit('JOIN_ROOM_FAILED', { error: 'Room code required' });
                return;
            }
            
            console.log('roomId', roomId, typeof roomId);      
            const room = roomId ? this.engine.gameRooms.get(roomId) : null;
            console.log(this.engine.gameRooms);
            console.log('room', room);
            if (!room) {
                socket.emit('JOIN_ROOM_FAILED', { error: 'Room not found' });
                return;
            }
            
            if (room.gamePhase !== 'waiting' && room.gamePhase !== 'lobby') {
                socket.emit('JOIN_ROOM_FAILED', { error: 'Game already in progress' });
                return;
            }

            const result = room.addPlayer(socket.id, {
                name: playerName || `Player ${socket.id.substr(-4)}`,
                socket: socket,
                isHost: false
            });

            if (result.success) {
                this.playerSockets.set(socket.id, { 
                    socket, 
                    roomId,
                    isHost: false 
                });
                socket.join(roomId);
                
                socket.emit('ROOM_JOINED', {
                    roomId: roomId,
                    playerId: socket.id,
                    isHost: false,
                    gameState: room.getGameState()
                });
                
                // Notify other players
                socket.to(roomId).emit('PLAYER_JOINED', {
                    playerId: socket.id,
                    playerName: playerName,
                    gameState: room.getGameState()
                });
                
                console.log(`Player ${playerName} joined room ${roomId}`);
            } else {
                socket.emit('JOIN_ROOM_FAILED', { 
                    error: result.error || 'Failed to join room' 
                });
            }
        } catch (error) {
            console.error('Error joining room:', error);
            socket.emit('JOIN_ROOM_FAILED', { 
                error: 'Server error while joining room' 
            });
        }
    }

    handleQuickMatch(socket, data) {
        try {
            const { playerName } = data;
            
            // Find available room or create new one
            let availableRoom = null;
            for (const [roomId, room] of this.engine.gameRooms) {
                if ((room.gamePhase === 'waiting' || room.gamePhase === 'lobby') && 
                    room.players.size < room.maxPlayers) {
                    availableRoom = room;
                    break;
                }
            }
            
            if (!availableRoom) {
                // Create new room for quick match
                const roomId = this.generateRoomId();
                availableRoom = this.engine.createGameRoom(roomId, 2);
                if(availableRoom){
                    this.currentRoomIds.push(roomId);
                }
            }
            
            const result = availableRoom.addPlayer(socket.id, {
                name: playerName || `Player ${socket.id.substr(-4)}`,
                socket: socket,
                isHost: availableRoom.players.size === 0
            });

            if (result.success) {
                this.playerSockets.set(socket.id, { 
                    socket, 
                    roomId: availableRoom.id,
                    isHost: availableRoom.players.size === 1
                });
                socket.join(availableRoom.id);
                
                socket.emit('QUICK_MATCH_FOUND', {
                    roomId: availableRoom.id,
                    playerId: socket.id,
                    isHost: availableRoom.players.size === 1,
                    gameState: availableRoom.getGameState()
                });
                
                // Notify other players in room
                socket.to(availableRoom.id).emit('PLAYER_JOINED', {
                    playerId: socket.id,
                    playerName: playerName,
                    gameState: availableRoom.getGameState()
                });
                
                console.log(`Player ${playerName} quick-matched into room ${availableRoom.id}`);
            } else {
                socket.emit('QUICK_MATCH_FAILED', { 
                    error: result.error || 'Failed to find match' 
                });
            }
        } catch (error) {
            console.error('Error in quick match:', error);
            socket.emit('QUICK_MATCH_FAILED', { 
                error: 'Server error during quick match' 
            });
        }
    }

    handleToggleReady(socket) {
        try {
            const playerData = this.playerSockets.get(socket.id);
            if (!playerData) {
                socket.emit('ERROR', { error: 'Player not in room' });
                return;
            }

            const room = this.engine.gameRooms.get(playerData.roomId);
            if (!room) {
                socket.emit('ERROR', { error: 'Room not found' });
                return;
            }

            const success = room.togglePlayerReady(socket.id);
            if (success) {
                // Room will broadcast the ready state update
                console.log(`Player ${socket.id} toggled ready in room ${playerData.roomId}`);
            } else {
                socket.emit('ERROR', { error: 'Cannot toggle ready in current phase' });
            }
        } catch (error) {
            console.error('Error toggling ready:', error);
            socket.emit('ERROR', { error: 'Server error' });
        }
    }

    handleSubmitPlacements(socket, data) {
        try {
            const { placements, ready } = data;
            const playerData = this.playerSockets.get(socket.id);
            
            if (!playerData) {
                socket.emit('PLACEMENT_READY_UPDATE', { 
                    error: 'Player not in room',
                    playerId: socket.id,
                    ready: false
                });
                return;
            }

            const room = this.engine.gameRooms.get(playerData.roomId);
            if (!room) {
                socket.emit('PLACEMENT_READY_UPDATE', { 
                    error: 'Room not found',
                    playerId: socket.id,
                    ready: false
                });
                return;
            }

            console.log(`Player ${socket.id} submitting`, placements);
            
            // Submit placements and update ready state
            const result = room.submitPlayerPlacements(socket.id, placements, ready);
            
            if (result.success) {
                // Send success response to the requesting player
                socket.emit('PLACEMENT_READY_UPDATE', {
                    playerId: socket.id,
                    ready: ready,
                    gameState: room.getGameState(),
                    allReady: room.areAllPlayersReady()
                });
                
                // Broadcast ready state update to all players in room
                this.io.to(playerData.roomId).emit('PLACEMENT_READY_UPDATE', {
                    playerId: socket.id,
                    ready: ready,
                    gameState: room.getGameState(),
                    allReady: room.areAllPlayersReady()
                });
                
                console.log(`Player ${socket.id} placement submission successful, ready: ${ready}`);
                
                // Check if all players are ready and start battle if so
                if (room.areAllPlayersReady() && room.gamePhase === 'placement') {
                    console.log(`All players ready in room ${playerData.roomId}, starting battle...`);
                    
                    // Small delay to ensure clients receive the ready update
                    setTimeout(() => {
                        this.startBattleForRoom(room);
                    }, 500);
                }
            } else {
                socket.emit('PLACEMENT_READY_UPDATE', { 
                    error: result.error,
                    playerId: socket.id,
                    ready: false
                });
            }
        } catch (error) {
            console.error('Error submitting placements:', error);
            socket.emit('PLACEMENT_READY_UPDATE', { 
                error: 'Server error while submitting placements',
                playerId: socket.id,
                ready: false
            });
        }
    }

    /**
     * Start battle for a room when all players are ready
     * @param {GameRoom} room - The game room to start battle for
     */
    startBattleForRoom(room) {
        try {
            console.log(`Starting battle for room ${room.id}`);
            
            // Transition room to battle phase
            const battleStartResult = room.startBattle();
            
            if (battleStartResult.success) {
                // Send opponent placements and battle start to all players
                for (const [playerId, playerData] of room.players) {
                    const opponentPlacements = room.getOpponentPlacements(playerId);
                    
                    // Send opponent placements first
                    if (playerData.socket) {
                        playerData.socket.emit('OPPONENT_PLACEMENTS', {
                            placements: opponentPlacements
                        });
                        
                        // Then send battle start notification
                        playerData.socket.emit('BATTLE_STARTED', {
                            gameState: room.getGameState(),
                            round: room.round
                        });
                    }
                }
                
                console.log(`Battle started successfully for room ${room.id}`);
            } else {
                console.error(`Failed to start battle for room ${room.id}:`, battleStartResult.error);
                
                // Notify players of battle start failure
                this.io.to(room.id).emit('BATTLE_START_FAILED', {
                    error: battleStartResult.error || 'Failed to start battle'
                });
            }
        } catch (error) {
            console.error(`Error starting battle for room ${room.id}:`, error);
            
            // Notify players of battle start failure
            this.io.to(room.id).emit('BATTLE_START_FAILED', {
                error: 'Server error while starting battle'
            });
        }
    }

    handleLeaveRoom(socket) {
        const playerData = this.playerSockets.get(socket.id);
        if (playerData) {
            const room = this.engine.gameRooms.get(playerData.roomId);
            if (room) {
                // Notify other players
                socket.to(playerData.roomId).emit('PLAYER_LEFT', {
                    playerId: socket.id,
                    gameState: room.getGameState()
                });
                
                room.removePlayer(socket.id);
                
                // Clean up empty rooms
                if (room.players.size === 0) {
                    this.engine.gameRooms.delete(playerData.roomId);
                    console.log(`Removed empty room ${playerData.roomId}`);
                }
            }
            this.playerSockets.delete(socket.id);
        }
    }

    handlePlayerDisconnect(socket) {
        console.log('Player disconnected:', socket.id);
        this.handleLeaveRoom(socket);
    }

    generateRoomId() {
        let id;
        do {
            id = this.nextRoomId++;
            if (this.nextRoomId > 9999) {
                this.nextRoomId = 1000; // Reset to avoid very long codes
            }
        } while (this.currentRoomIds.includes(id.toString()));
        
        return id.toString();
    }

    sendToPlayer(playerId, message) {
        const playerData = this.playerSockets.get(playerId);
        if (playerData && playerData.socket) {
            playerData.socket.emit(message.type, message);
        }
    }

    broadcastToRoom(roomId, message) {
        this.io.to(roomId).emit(message.type, message);
    }

    broadcastGameStates() {
        for (const [roomId, room] of this.engine.gameRooms) {
            if (room.isActive && room.lastStateSnapshot) {
                this.io.to(roomId).emit('GAME_STATE_UPDATE', {
                    gameState: room.getGameState(),
                    entities: room.lastStateSnapshot.entities
                });
            }
        }
    }

    // Get server statistics for monitoring
    getServerStats() {
        return {
            connectedPlayers: this.playerSockets.size,
            activeRooms: this.engine.gameRooms.size,
            roomsInLobby: Array.from(this.engine.gameRooms.values())
                .filter(room => room.gamePhase === 'lobby' || room.gamePhase === 'waiting').length,
            roomsInGame: Array.from(this.engine.gameRooms.values())
                .filter(room => room.gamePhase === 'placement' || room.gamePhase === 'battle').length
        };
    }

    // Cleanup method
    cleanup() {
        this.playerSockets.clear();
        this.currentRoomIds.clear();
        
        // NOTE: don't close io here; server.js owns the singleton io tied to the HTTP server.
        
        console.log('ServerNetworkManager cleaned up');
    }
}