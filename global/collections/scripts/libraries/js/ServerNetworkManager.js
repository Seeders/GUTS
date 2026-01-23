class ServerNetworkManager {
    constructor(engine) {
        this.engine = engine;
        this.io = null;
        this.playerSockets = new Map();
        this.nextRoomId = 1000; // Starting room code
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

            // Auto-join lobby room for global chat
            socket.join('lobby');
            this.playerSockets.set(socket.id, { socket, inLobby: true });

            socket.on('SET_PLAYER_NAME', (data) => {
                const playerData = this.playerSockets.get(socket.id);
                if (playerData && data.playerName) {
                    playerData.playerName = data.playerName;
                }
            });
            socket.on('CREATE_ROOM', (data) => {
                console.log('[ServerNetworkManager] CREATE_ROOM from', socket.id, 'current rooms:', Array.from(this.engine.gameRooms.keys()));
                this.handleCreateRoom(socket, data);
            });
            socket.on('JOIN_ROOM', (data) => {
                console.log('[ServerNetworkManager] JOIN_ROOM event received from', socket.id, data);
                this.handleJoinRoom(socket, data);
            });
            socket.on('CHAT_MESSAGE', (data) => {
                this.handleChatMessage(socket, data);
            });
            // Catch ALL events and route to game systems
            socket.onAny((eventName, data) => {
                console.log('[ServerNetworkManager] onAny event:', eventName, 'from', socket.id);

                // Skip internal socket.io events and events with dedicated handlers
                if (eventName.startsWith('__') ||
                    eventName === 'disconnect' ||
                    eventName === 'CREATE_ROOM' ||
                    eventName === 'JOIN_ROOM' ||
                    eventName === 'CHAT_MESSAGE') {
                    return;
                }

                this.routeEventToEngine(socket, eventName, data);
            });

            socket.on('disconnect', () => {
                console.log('Player disconnected:', socket.id);
                const playerData = this.playerSockets.get(socket.id);
                console.log('[ServerNetworkManager] Disconnect - player data:', playerData?.roomId ? `in room ${playerData.roomId}` : 'not in a room');
                this.routeEventToEngine(socket, 'PLAYER_DISCONNECT', { playerId: socket.id });
                this.playerSockets.delete(socket.id);
                console.log('[ServerNetworkManager] Remaining players in playerSockets:', Array.from(this.playerSockets.keys()));
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
                // Leave lobby when joining a game room
                this.leaveLobby(socket.id);
                this.playerSockets.set(socket.id, {
                    socket,
                    roomId,
                    isHost: true,
                    numericPlayerId: result.numericPlayerId,
                    inLobby: false,
                    playerName: playerName || `Player ${socket.id.substr(-4)}`
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
                console.log('[ServerNetworkManager] Room not found!');
                this.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', {
                    error: 'Room not found'
                });
                return;
            }

            // Check if room allows joining
            const enums = room.game.getEnums();
            console.log('[ServerNetworkManager] Room phase:', room.game.state.phase, 'lobby:', enums.gamePhase.lobby);
            if (room.game.state.phase !== enums.gamePhase.lobby) {
                console.log('[ServerNetworkManager] Rejecting join - game in progress, phase:', room.game.state.phase);
                this.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', {
                    error: 'Game already in progress'
                });
                return;
            }

            const result = room.addPlayer(playerId, {
                name: playerName || `Player ${playerId.substr(-4)}`,
                isHost: false
            });
            console.log('[ServerNetworkManager] addPlayer result:', result);

            if (result.success) {
                // Leave lobby when joining a game room
                this.leaveLobby(playerId);
                this.joinRoom(playerId, roomId);

                // Store player info in socket data
                const socketInfo = this.playerSockets.get(playerId);
                if (socketInfo) {
                    socketInfo.numericPlayerId = result.numericPlayerId;
                    socketInfo.inLobby = false;
                    socketInfo.playerName = playerName || `Player ${playerId.substr(-4)}`;
                }

                const gameState = room.getGameState();
                this.sendToPlayer(playerId, 'ROOM_JOINED', {
                    roomId: roomId,
                    playerId: playerId,
                    numericPlayerId: result.numericPlayerId,
                    isHost: false,
                    gameState: gameState
                });

                // Notify other players
                this.broadcastToRoom(roomId, 'PLAYER_JOINED', {
                    playerId: playerId,
                    numericPlayerId: result.numericPlayerId,
                    playerName: playerName,
                    gameState: gameState
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
        } while (this.engine.gameRooms.has(id.toString()));

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
        console.log('[ServerNetworkManager] sendToPlayer:', playerId, eventName);
        const playerData = this.playerSockets.get(playerId);
        if (playerData && playerData.socket) {
            playerData.socket.emit(eventName, data);
            console.log('[ServerNetworkManager] Event emitted successfully');
        } else {
            console.warn('[ServerNetworkManager] No socket found for player:', playerId);
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
            // Rejoin lobby when leaving a game room
            this.rejoinLobby(playerId);
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

    // Chat message handling
    handleChatMessage(socket, data) {
        const { content, context } = data;
        const playerData = this.playerSockets.get(socket.id);

        // Sanitize content (strip HTML, limit length)
        const sanitizedContent = this.sanitizeMessage(content);
        if (!sanitizedContent) return;

        // Get player name from room if in game, otherwise use stored name or socket ID
        let senderName = `Player ${socket.id.substr(-4)}`;
        if (playerData?.roomId) {
            const room = this.engine.gameRooms.get(playerData.roomId);
            if (room) {
                const player = room.players.get(socket.id);
                if (player?.name) {
                    senderName = player.name;
                }
            }
        } else if (playerData?.playerName) {
            senderName = playerData.playerName;
        }

        const message = {
            id: `${Date.now()}-${socket.id.substr(-4)}`,
            sender: senderName,
            senderId: socket.id,
            content: sanitizedContent,
            timestamp: Date.now(),
            type: 'chat',
            context: context
        };

        if (context === 'lobby' && playerData?.inLobby) {
            // Broadcast to all players in lobby room
            this.io.to('lobby').emit('CHAT_MESSAGE', message);
        } else if (context === 'game' && playerData?.roomId) {
            // Broadcast to players in the game room
            this.io.to(playerData.roomId).emit('CHAT_MESSAGE', message);
        }
    }

    sanitizeMessage(content) {
        if (!content || typeof content !== 'string') return null;
        // Strip HTML tags, trim whitespace, limit to 500 chars
        const sanitized = content.replace(/<[^>]*>/g, '').trim().slice(0, 500);
        return sanitized.length > 0 ? sanitized : null;
    }

    broadcastSystemMessage(roomOrContext, messageText) {
        const systemMsg = {
            id: `sys-${Date.now()}`,
            sender: 'System',
            senderId: 'system',
            content: messageText,
            timestamp: Date.now(),
            type: 'system',
            context: roomOrContext === 'lobby' ? 'lobby' : 'game'
        };

        if (roomOrContext === 'lobby') {
            this.io.to('lobby').emit('CHAT_MESSAGE', systemMsg);
        } else {
            this.io.to(roomOrContext).emit('CHAT_MESSAGE', systemMsg);
        }
    }

    // Leave lobby when joining a game room
    leaveLobby(playerId) {
        const playerData = this.playerSockets.get(playerId);
        if (playerData?.socket && playerData.inLobby) {
            playerData.socket.leave('lobby');
            playerData.inLobby = false;
        }
    }

    // Rejoin lobby when leaving a game room
    rejoinLobby(playerId) {
        const playerData = this.playerSockets.get(playerId);
        if (playerData?.socket && !playerData.inLobby) {
            playerData.socket.join('lobby');
            playerData.inLobby = true;
        }
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
