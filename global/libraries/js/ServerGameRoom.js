import GameRoom from './GameRoom.js';

export default class ServerGameRoom extends GameRoom {
    constructor(engine, roomId, gameInstance, maxPlayers = 2, gameConfig = {}) {
        super(engine, roomId, gameInstance, maxPlayers);
        
        // Add multiplayer lobby functionality
        this.game.state.phase = 'waiting'; // 'waiting', 'lobby', 'playing', 'ended'
        this.gameConfig = gameConfig;
        this.createdAt = Date.now();
        this.nextRoomId = 1000;
        this.currentRoomIds = [];
        
        // Subscribe to events from network manager
        this.subscribeToEvents();
        
        console.log(`ServerGameRoom ${roomId} created for ${maxPlayers} players`);
    }

    subscribeToEvents() {
        console.log('game room subscribing to events');
        if (!this.serverEventManager) {
            console.error('No event manager found on engine');
            return;
        }

        // Subscribe to room management events
        this.serverEventManager.subscribe('JOIN_ROOM', this.handleJoinRoom.bind(this));
        this.serverEventManager.subscribe('QUICK_MATCH', this.handleQuickMatch.bind(this));
        this.serverEventManager.subscribe('LEAVE_ROOM', this.handleLeaveRoom.bind(this));
        this.serverEventManager.subscribe('PLAYER_DISCONNECT', this.handlePlayerDisconnect.bind(this));
        this.serverEventManager.subscribe('TOGGLE_READY', this.handleToggleReady.bind(this));
    }

    handleJoinRoom(eventData) {
        const { playerId, data } = eventData;
        
        try {
            const { roomId, playerName } = data;
            
            if (!roomId) {
                this.serverNetworkManager.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', { 
                    error: 'Room code required' 
                });
                return;
            }
            
            const room = this.engine.gameRooms.get(roomId);
            if (!room) {
                this.serverNetworkManager.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', { 
                    error: 'Room not found' 
                });
                return;
            }
            
            // Check if room allows joining
            if (this.game.state.phase !== 'waiting' && this.game.state.phase !== 'lobby') {
                this.serverNetworkManager.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', { 
                    error: 'Game already in progress' 
                });
                return;
            }

            const result = room.addPlayer(playerId, {
                name: playerName || `Player ${playerId.substr(-4)}`,
                isHost: false
            });

            if (result.success) {
                this.serverNetworkManager.joinRoom(playerId, roomId);
                
                this.serverNetworkManager.sendToPlayer(playerId, 'ROOM_JOINED', {
                    roomId: roomId,
                    playerId: playerId,
                    isHost: false,
                    gameState: room.getGameState()
                });
                
                // Notify other players
                this.serverNetworkManager.broadcastToRoom(roomId, 'PLAYER_JOINED', {
                    playerId: playerId,
                    playerName: playerName,
                    gameState: room.getGameState()
                });
                
                console.log(`Player ${playerName} joined room ${roomId}`);
            } else {
                this.serverNetworkManager.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', { 
                    error: result.error || result.reason || 'Failed to join room' 
                });
            }
        } catch (error) {
            console.error('Error joining room:', error);
            this.serverNetworkManager.sendToPlayer(playerId, 'JOIN_ROOM_FAILED', { 
                error: 'Server error while joining room' 
            });
        }
    }

    handleQuickMatch(eventData) {
        const { playerId, data } = eventData;
        
        try {
            const { playerName } = data;
            
            // Find available room
            let availableRoom = null;
            for (const [roomId, room] of this.engine.gameRooms) {
                if ((this.game.state.phase === 'waiting' || this.game.state.phase === 'lobby') && 
                    room.players.size < room.maxPlayers) {
                    availableRoom = room;
                    break;
                }
            }
            
            if (!availableRoom) {
                // Create new room for quick match
                const roomId = this.generateRoomId();
                availableRoom = this.engine.createGameRoom(roomId, 2);
            }
            
            if (!availableRoom) {
                this.serverNetworkManager.sendToPlayer(playerId, 'QUICK_MATCH_FAILED', { 
                    error: 'Failed to create or find room' 
                });
                return;
            }

            const result = availableRoom.addPlayer(playerId, {
                name: playerName || `Player ${playerId.substr(-4)}`,
                isHost: availableRoom.players.size === 0
            });

            if (result.success) {
                this.serverNetworkManager.joinRoom(playerId, availableRoom.id);
                
                this.serverNetworkManager.sendToPlayer(playerId, 'QUICK_MATCH_FOUND', {
                    roomId: availableRoom.id,
                    playerId: playerId,
                    isHost: availableRoom.players.size === 1,
                    gameState: availableRoom.getGameState()
                });
                
                // Notify other players in room
                this.serverNetworkManager.broadcastToRoom(availableRoom.id, 'PLAYER_JOINED', {
                    playerId: playerId,
                    playerName: playerName,
                    gameState: availableRoom.getGameState()
                });
                
                console.log(`Player ${playerName} quick-matched into room ${availableRoom.id}`);
            } else {
                this.serverNetworkManager.sendToPlayer(playerId, 'QUICK_MATCH_FAILED', { 
                    error: result.error || result.reason || 'Failed to find match' 
                });
            }
        } catch (error) {
            console.error('Error in quick match:', error);
            this.serverNetworkManager.sendToPlayer(playerId, 'QUICK_MATCH_FAILED', { 
                error: 'Server error during quick match' 
            });
        }
    }

    handleToggleReady(eventData) {
        const { playerId } = eventData;
        
        try {
    
            const success = this.togglePlayerReady(playerId);
            if (!success) {
                this.serverNetworkManager.sendToPlayer(playerId, 'ERROR', { 
                    error: 'Cannot toggle ready in current phase' 
                });
            }
        } catch (error) {
            console.error('Error toggling ready:', error);
            this.serverNetworkManager.sendToPlayer(playerId, 'ERROR', { 
                error: 'Server error' 
            });
        }
    }

    handleLeaveRoom(eventData) {
        const { playerId } = eventData;
        
        const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
        if (roomId) {
            const room = this.engine.gameRooms.get(roomId);
            if (room) {
                // Notify other players
                this.serverNetworkManager.broadcastToRoom(roomId, 'PLAYER_LEFT', {
                    playerId: playerId
                });
                
                // Use GameRoom's removePlayer method
                room.removePlayer(playerId);
                this.serverNetworkManager.leaveRoom(playerId, roomId);
                
                // Clean up empty rooms
                if (room.players.size === 0) {
                    this.engine.gameRooms.delete(roomId);
                    console.log(`Removed empty room ${roomId}`);
                }
            }
        }
    }

    handlePlayerDisconnect(eventData) {
        const { playerId } = eventData;
        console.log(`Player ${playerId} disconnected`);
        
        // Handle as leave room
        this.handleLeaveRoom({ playerId });
    }

    // Override parent's auto-start behavior to add lobby phase
    addPlayer(playerId, playerData) {
        const result = super.addPlayer(playerId, playerData);
        
        if (result.success) {
            // Add multiplayer-specific player properties
            const player = this.players.get(playerId);
            player.ready = false;
            player.isHost = playerData.isHost || false;
            
            player.stats = {
                health: 5000,                
                gold: 100,
                side: playerData.isHost ? 'left' : 'right'
            };
            // If room is full, enter lobby phase (don't auto-start like parent does)
            if (this.players.size === this.maxPlayers && this.game.state.phase === 'waiting') {
                this.enterLobbyPhase();
            }
        }
        
        return result;
    }

    enterLobbyPhase() {
        this.game.state.phase = 'lobby';
        
        // Broadcast lobby entered to all players in room
        if (this.serverNetworkManager) {
            this.serverNetworkManager.broadcastToRoom(this.id, 'LOBBY_ENTERED', {
                gameState: this.getGameState()
            });
        }
        
        console.log(`Room ${this.id} entered lobby phase`);
    }

    togglePlayerReady(playerId) {
        const player = this.players.get(playerId);
        if (!player || this.game.state.phase !== 'lobby') {
            console.log("no player or not lobby phase", this.game.state.phase);
            return false;
        }
        
        player.ready = !player.ready;
        
        const allReady = Array.from(this.players.values()).every(p => p.ready);
        
        // Broadcast ready state update
        if (this.serverNetworkManager) {
            this.serverNetworkManager.broadcastToRoom(this.id, 'PLAYER_READY_UPDATE', {
                playerId: playerId,
                ready: player.ready,
                allReady: allReady,
                gameState: this.getGameState()
            });
        }
        
        // Auto-start if all ready
        if (allReady) {
            setTimeout(() => this.startGame(), 1000);
        }
        
        return true;
    }

    // Override parent's startGame to add multiplayer lobby logic
    startGame() {
        if (this.game.state.phase !== 'lobby') {
            console.log(`Cannot start game, not in lobby phase. Current phase: ${this.game.state.phase}`);
            return false;
        }
        
        // Check if all players are ready
        const allReady = Array.from(this.players.values()).every(p => p.ready);
        if (!allReady) {
            return false;
        }
        
        this.game.state.phase = 'placement';
        
        // Call parent's startGame (loads scene, spawns entities, etc.)
        super.startGame();
        
        // Broadcast game started
        if (this.serverNetworkManager) {
            let gameState = this.getGameState();
            this.serverNetworkManager.broadcastToRoom(this.id, 'GAME_STARTED', {
                gameState: gameState
            });            
        }
        
        console.log(`Game started in room ${this.id}`);
        return true;
    }

    // Enhanced game state for multiplayer
    getGameState() {
        let players = Array.from(this.players.values());
        let playerData = [];
        players.forEach((p) => {
            let placements = null;
            if(this.game.placementSystem){
                placements = this.game.placementSystem.playerPlacements.get(p.id);
            }

            if(this.game.squadExperienceSystem && placements){                
                placements.forEach((placement) => {
                    placement.experience = this.game.squadExperienceSystem.getSquadInfo(placement.placementId)
                });
            }
            playerData.push({
                id: p.id,
                name: p.name,
                ready: p.ready || false,
                isHost: p.isHost || false,
                stats: p.stats,
                placements: placements || [],
                entityId: p.entityId,
                lastInputSequence: p.lastInputSequence || 0,
                latency: p.latency || 0
            });
        });
        return {
            roomId: this.id,
            phase: this.game.state.phase,
            isActive: this.isActive,
            maxPlayers: this.maxPlayers,
            gameType: this.gameConfig?.type || 'default',
            players: playerData,
            round: this.game.state.round,
            // Let the game instance provide additional state if needed
            gameData: this.game.getGameState ? this.game.getGameState() : null
        };
    }

    generateRoomId() {
        let id;
        do {
            id = this.nextRoomId++;
            if (this.nextRoomId > 9999) {
                this.nextRoomId = 1000;
            }
        } while (this.currentRoomIds.includes(id.toString()));
        
        this.currentRoomIds.push(id.toString());
        return id.toString();
    }
}
