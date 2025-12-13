class ServerNetworkManager {
    constructor(engine) {
        this.engine = engine;
        this.io = null;
        this.playerSockets = new Map();
        this.nextRoomId = 1000; // Starting room code
        this.currentRoomIds = [];
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;

        if (!this.io) {
            const g = (typeof globalThis !== 'undefined' ? globalThis : global);
            if (g && (g.io || g._io)) {
                this.io = g.io || g._io;
            }
        }

        if (!this.io) {
            const { Server } = await import('socket.io');
            this.io = new Server({
                cors: {
                    origin: "*",
                    methods: ["GET", "POST"]
                },
                maxHttpBufferSize: 10e6 // 10MB max message size for save files
            });
            this.io.listen(3001);
            console.log('Socket.IO fallback listening on port 3001');
        }

        this.setupEventHandlers();
        this._initialized = true;
        console.log('ServerNetworkManager initialized');
    }

    setupEventHandlers() {
        this.io.removeAllListeners('connection');

        this.io.on('connection', (socket) => {

            console.log('Player connected:', socket.id);

            this.playerSockets.set(socket.id, { socket });

            socket.on('CREATE_ROOM', (data) => {
                this.handleCreateRoom(socket, data);
            });
            socket.on('JOIN_ROOM', (data) => {
                this.handleJoinRoom(socket, data);
            });
            // Catch ALL events and route to game systems
            socket.onAny((eventName, data) => {
                // Skip internal socket.io events and events with dedicated handlers
                if (eventName.startsWith('__') ||
                    eventName === 'disconnect' ||
                    eventName === 'CREATE_ROOM' ||
                    eventName === 'JOIN_ROOM') {
                    return;
                }

                this.routeEventToEngine(socket, eventName, data);
            });

            socket.on('disconnect', () => {
                console.log('Player disconnected:', socket.id);
                this.routeEventToEngine(socket, 'PLAYER_DISCONNECT', { playerId: socket.id });
                this.playerSockets.delete(socket.id);
            });

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
                    isHost: true,
                    numericPlayerId: result.numericPlayerId
                });
                socket.join(roomId);

                socket.emit('ROOM_CREATED', {
                    roomId: roomId,
                    playerId: socket.id,
                    numericPlayerId: result.numericPlayerId,
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
        
        const playerId = socket.id;
        console.log('joinRoom', data)
        try {
            const { roomId, playerName } = data;
            
            if (!roomId) {
                this.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', { 
                    error: 'Room code required' 
                });
                return;
            }
            
            const room = this.engine.gameRooms.get(roomId);
            if (!room) {
                this.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', { 
                    error: 'Room not found' 
                });
                return;
            }
            
            // Check if room allows joining
            const enums = room.game.call('getEnums');
            if (room.game.state.phase !== enums.gamePhase.waiting && room.game.state.phase !== enums.gamePhase.lobby) {
                this.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', { 
                    error: 'Game already in progress' 
                });
                return;
            }

            const result = room.addPlayer(playerId, {
                name: playerName || `Player ${playerId.substr(-4)}`,
                isHost: false
            });

            if (result.success) {
                this.joinRoom(playerId, roomId);

                // Store numeric ID in socket info
                const socketInfo = this.playerSockets.get(playerId);
                if (socketInfo) {
                    socketInfo.numericPlayerId = result.numericPlayerId;
                }

                this.sendToPlayer(playerId, 'ROOM_JOINED', {
                    roomId: roomId,
                    playerId: playerId,
                    numericPlayerId: result.numericPlayerId,
                    isHost: false,
                    gameState: room.getGameState()
                });

                // Notify other players
                this.broadcastToRoom(roomId, 'PLAYER_JOINED', {
                    playerId: playerId,
                    numericPlayerId: result.numericPlayerId,
                    playerName: playerName,
                    gameState: room.getGameState()
                });
                
                console.log(`Player ${playerName} joined room ${roomId}`);
            } else {
                this.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', { 
                    error: result.error || result.reason || 'Failed to join room' 
                });
            }
        } catch (error) {
            console.error('Error joining room:', error);
            this.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', { 
                error: 'Server error while joining room' 
            });
        }
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

    // Generic event routing - just forwards to appropriate room's event manager
    routeEventToEngine(socket, eventName, data) {
        const playerId = socket.id;
        const roomId = this.getPlayerRoom(playerId);
        
        try {
            // For player-specific events, route to their room's event manager
            if (roomId) {
                const room = this.engine.gameRooms.get(roomId);
                if (room && room.game.serverEventManager) {
                    const numericPlayerId = room.getNumericPlayerId(playerId);
                    room.game.serverEventManager.emit(eventName, {
                        playerId: playerId,
                        numericPlayerId: numericPlayerId,
                        eventName: eventName,
                        data: data,
                        socket: socket,
                        networkManager: this
                    });
                    return;
                }
            }
                        
            console.warn(`No room found for event ${eventName} from player ${playerId}`);
            
        } catch (error) {
            console.error(`Error routing event ${eventName}:`, error);
        }
    }


    // Helper methods for systems to use
    sendToPlayer(playerId, eventName, data) {
        const playerData = this.playerSockets.get(playerId);
        if (playerData && playerData.socket) {
            playerData.socket.emit(eventName, data);
        }
    }

    broadcastToRoom(roomId, eventName, data) {
        this.io.to(roomId).emit(eventName, data);
    }

    joinRoom(playerId, roomId) {
        const playerData = this.playerSockets.get(playerId);
        if (playerData && playerData.socket) {
            playerData.socket.join(roomId);
            playerData.roomId = roomId;
        }
    }

    leaveRoom(playerId, roomId) {
        const playerData = this.playerSockets.get(playerId);
        if (playerData && playerData.socket) {
            playerData.socket.leave(roomId);
            delete playerData.roomId;
        }
    }

    getPlayerRoom(playerId) {
        const playerData = this.playerSockets.get(playerId);
        return playerData?.roomId;
    }

    broadcastGameStates() {
        for (const [roomId, room] of this.engine.gameRooms) {
            if (room.isActive && room.lastStateSnapshot) {
                this.io.to(roomId).emit('GAME_STATE_UPDATE', room.lastStateSnapshot);
            }
        }
    }

    getServerStats() {
        return {
            connectedPlayers: this.playerSockets.size
        };
    }

    cleanup() {
        this.playerSockets.clear();
        console.log('ServerNetworkManager cleaned up');
    }
}

      

// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.ServerNetworkManager = ServerNetworkManager;
}

// ES6 exports for webpack bundling
export default ServerNetworkManager;
export { ServerNetworkManager };
