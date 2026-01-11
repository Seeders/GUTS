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
        console.log('[handleJoinRoom] START - playerId:', playerId, 'data:', JSON.stringify(data));

        try {
            const { roomId, playerName } = data;

            if (!roomId) {
                console.log('[handleJoinRoom] FAIL - no roomId provided');
                this.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', {
                    error: 'Room code required'
                });
                return;
            }

            console.log('[handleJoinRoom] Looking for room:', roomId, 'Available rooms:', Array.from(this.engine.gameRooms.keys()));
            const room = this.engine.gameRooms.get(roomId);
            if (!room) {
                console.log('[handleJoinRoom] FAIL - room not found:', roomId);
                this.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', {
                    error: 'Room not found'
                });
                return;
            }

            // Check if room allows joining
            const enums = room.game.call('getEnums');
            console.log('[handleJoinRoom] Room phase:', room.game.state.phase, 'waiting:', enums.gamePhase.waiting, 'lobby:', enums.gamePhase.lobby);
            if (room.game.state.phase !== enums.gamePhase.waiting && room.game.state.phase !== enums.gamePhase.lobby) {
                console.log('[handleJoinRoom] FAIL - game already in progress, phase:', room.game.state.phase);
                this.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', {
                    error: 'Game already in progress'
                });
                return;
            }

            console.log('[handleJoinRoom] Adding player to room...');
            const result = room.addPlayer(playerId, {
                name: playerName || `Player ${playerId.substr(-4)}`,
                isHost: false
            });
            console.log('[handleJoinRoom] addPlayer result:', JSON.stringify(result));

            if (result.success) {
                this.joinRoom(playerId, roomId);

                // Store numeric ID in socket info
                const socketInfo = this.playerSockets.get(playerId);
                if (socketInfo) {
                    socketInfo.numericPlayerId = result.numericPlayerId;
                }

                const gameState = room.getGameState();
                console.log('[handleJoinRoom] SUCCESS - sending ROOM_JOINED to player:', playerId);
                this.sendToPlayer(playerId, 'ROOM_JOINED', {
                    roomId: roomId,
                    playerId: playerId,
                    numericPlayerId: result.numericPlayerId,
                    isHost: false,
                    gameState: gameState
                });

                // Notify other players
                console.log('[handleJoinRoom] Broadcasting PLAYER_JOINED to room:', roomId);
                this.broadcastToRoom(roomId, 'PLAYER_JOINED', {
                    playerId: playerId,
                    numericPlayerId: result.numericPlayerId,
                    playerName: playerName,
                    gameState: gameState
                });

                console.log(`[handleJoinRoom] COMPLETE - Player ${playerName} joined room ${roomId}`);
            } else {
                console.log('[handleJoinRoom] FAIL - addPlayer failed:', result.error || result.reason);
                this.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', {
                    error: result.error || result.reason || 'Failed to join room'
                });
            }
        } catch (error) {
            console.error('[handleJoinRoom] ERROR:', error);
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
