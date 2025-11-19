class ServerGameRoom extends global.GameRoom {
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
        if (!this.game.serverEventManager) {
            console.error('No event manager found on engine');
            return;
        }

        // Subscribe to room management events
        this.game.serverEventManager.subscribe('QUICK_MATCH', this.handleQuickMatch.bind(this));
        this.game.serverEventManager.subscribe('LEAVE_ROOM', this.handleLeaveRoom.bind(this));
        this.game.serverEventManager.subscribe('PLAYER_DISCONNECT', this.handlePlayerDisconnect.bind(this));
        this.game.serverEventManager.subscribe('TOGGLE_READY', this.handleToggleReady.bind(this));
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

    handlePlayerDisconnect(eventData) {
        const { playerId } = eventData;
        console.log(`Player ${playerId} disconnected`);
        
        // Get the room the player was in
        const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
        if (roomId) {
            const room = this.engine.gameRooms.get(roomId);
            if (room) {
                // Get player data before removing
                const player = room.players.get(playerId);
                const playerName = player?.name || 'Unknown';
                
                // Notify other players
                this.serverNetworkManager.broadcastToRoom(roomId, 'PLAYER_LEFT', {
                    playerId: playerId,
                    playerName: playerName
                });
                
                // Clean up player state completely
                this.cleanupPlayerState(room, playerId);
                
                // Remove from room
                room.removePlayer(playerId);
                this.serverNetworkManager.leaveRoom(playerId, roomId);

                
                // Clean up empty rooms
                if (room.players.size === 0) {
                    this.cleanupRoom(room);
                    this.engine.gameRooms.delete(roomId);
                    console.log(`Removed empty room ${roomId}`);
                } else {
                    // If room still has players, reset their states for next game
                    this.resetPlayersForNextGame(room);
                }
            }
        }
        
        // Clean up network manager state
        this.serverNetworkManager.playerSockets.delete(playerId);
    }

    handleLeaveRoom(eventData) {
        const { playerId } = eventData;
        console.log(`Player ${playerId} leaving room`);

        // Get the room the player was in
        const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
        if (roomId) {
            const room = this.engine.gameRooms.get(roomId);
            if (room) {
                // Get player data before removing
                const player = room.players.get(playerId);
                const playerName = player?.name || 'Unknown';

                // Notify other players
                this.serverNetworkManager.broadcastToRoom(roomId, 'PLAYER_LEFT', {
                    playerId: playerId,
                    playerName: playerName
                });

                // Clean up player state in the room
                this.cleanupPlayerState(room, playerId);

                // Remove from room
                room.removePlayer(playerId);
                this.serverNetworkManager.leaveRoom(playerId, roomId);

                // Check if only one player remains and game was active
                if (room.players.size === 1 && room.isActive) {
                    // Notify the remaining player that the game is over
                    this.serverNetworkManager.broadcastToRoom(roomId, 'GAME_ENDED_ALL_PLAYERS_LEFT', {
                        message: 'All other players have left the game.'
                    });
                    console.log(`Game in room ${roomId} ended - only one player remains`);
                }

                // Clean up empty rooms
                if (room.players.size === 0) {
                    this.cleanupRoom(room);
                    this.engine.gameRooms.delete(roomId);
                    console.log(`Removed empty room ${roomId}`);
                } else {
                    // If room still has players, reset their states for next game
                    this.resetPlayersForNextGame(room);
                }
            }
        }

        // IMPORTANT: DO NOT delete socket here - player is still connected, just not in a room
        // Only handlePlayerDisconnect should delete the socket
        console.log(`Player ${playerId} left room successfully, socket preserved`);
    }

    cleanupPlayerState(room, playerId) {
        const player = room.players.get(playerId);
        if (!player) return;
        
        // Clear any placement data
        if (room.game && room.game.placementSystem) {
            room.game.placementSystem.clearPlayerPlacements(playerId);
        }
        
        // Clear any battle data
        if (room.game && room.game.battlePhaseSystem) {
            const battleSystem = room.game.battlePhaseSystem;
            if (battleSystem.createdSquads) {
                battleSystem.createdSquads.delete(playerId);
            }
            if (battleSystem.battleResults) {
                battleSystem.battleResults.delete(playerId);
            }
        }
        
        // Clear any entities owned by this player
        if (room.game && room.game.componentManager) {
            const ComponentTypes = room.game.componentManager.getComponentTypes();
            const playerEntities = room.game.getEntitiesWith(ComponentTypes.PLAYER_OWNED)
                .filter(entityId => {
                    const ownerComp = room.game.getComponent(entityId, ComponentTypes.PLAYER_OWNED);
                    return ownerComp && ownerComp.playerId === playerId;
                });
            
            playerEntities.forEach(entityId => {
                try {
                    room.game.destroyEntity(entityId);
                } catch (error) {
                    console.warn(`Error destroying player entity ${entityId}:`, error);
                }
            });
        }
    }

    // Override parent's auto-start behavior to add lobby phase
    addPlayer(playerId, playerData) {
        const result = super.addPlayer(playerId, playerData);
        
        if (result.success) {
            // Add multiplayer-specific player properties
            const player = this.players.get(playerId);
            player.ready = false;
            player.placementReady = false;
            player.isHost = playerData.isHost || false;
            
            player.stats = {
                health: this.game.state.teamMaxHealth,
                gold: this.game.state.startingGold,
                side: playerData.isHost ? 'left' : 'right',
                upgrades: []
            };
            // Enter lobby phase when first player joins (supports single-player)
            // or when room is full (for multiplayer that requires all players)
            if (this.game.state.phase === 'waiting') {
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
        if (!player || (this.game.state.phase !== 'lobby' && this.game.state.phase !== 'waiting')) {
            console.log("no player or not in lobby/waiting phase", this.game.state.phase);
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

        // Check if at least one player and all players are ready
        if (this.players.size === 0) {
            console.log('Cannot start game, no players in room');
            return false;
        }

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


    // NEW METHOD: Reset all remaining players for next game
    resetPlayersForNextGame(room) {
        for (const [playerId, player] of room.players) {
            // Reset player stats to initial values
            player.stats = {
                health: this.game.state.teamMaxHealth,
                gold: this.game.state.startingGold,
                side: player.stats.side // Keep their side assignment
            };
            
            // Reset ready states
            player.ready = false;
            player.placementReady = false;
            
            console.log(`Reset player ${playerId} stats:`, player.stats);
        }
        
        // Broadcast updated game state
        this.serverNetworkManager.broadcastToRoom(room.id, 'GAME_STATE_UPDATE', {
            gameState: room.getGameState()
        });
    }

    // NEW METHOD: Complete room cleanup
    cleanupRoom(room) {
        try {
            // Clear all game systems
            if (room.game) {                
                room.game.triggerEvent('dispose');
            }
            // Remove room ID from tracking
            const roomIndex = this.currentRoomIds.indexOf(room.id);
            if (roomIndex > -1) {
                this.currentRoomIds.splice(roomIndex, 1);
            }
            
        } catch (error) {
            console.error('Error during room cleanup:', error);
        }
    }
}

if(typeof ServerGameRoom != 'undefined'){
    if (typeof window !== 'undefined') {
        window.ServerGameRoom = ServerGameRoom;
    }

    // Make available as ES module export (new for server)  
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ServerGameRoom;
    }

    // Make available as ES6 export (also new for server)
    if (typeof exports !== 'undefined') {
        exports.default = ServerGameRoom;
        exports.ServerGameRoom = ServerGameRoom;
    }
}