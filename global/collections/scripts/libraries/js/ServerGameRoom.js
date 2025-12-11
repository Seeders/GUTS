class ServerGameRoom extends global.GUTS.GameRoom {
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
        this.game.serverEventManager.subscribe('UPLOAD_SAVE_DATA', this.handleUploadSaveData.bind(this));
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
        const { playerId, data } = eventData;
        try {
            // Store the selected level from host
            const player = this.players.get(playerId);
            if (player?.isHost && data?.level) {
                this.selectedLevel = data.level;
                console.log(`Host selected level: ${this.selectedLevel}`);
            }

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

    handleUploadSaveData(eventData) {
        const { playerId, data } = eventData;
        try {
            // Only host can upload save data
            const player = this.players.get(playerId);
            if (!player?.isHost) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SAVE_DATA_UPLOADED', {
                    success: false,
                    error: 'Only the host can upload save data'
                });
                return;
            }

            // Only allow in lobby phase
            if (this.game.state.phase !== 'lobby' && this.game.state.phase !== 'waiting') {
                this.serverNetworkManager.sendToPlayer(playerId, 'SAVE_DATA_UPLOADED', {
                    success: false,
                    error: 'Can only upload save data in lobby'
                });
                return;
            }

            // Store save data for this room
            this.pendingSaveData = data.saveData;

            // Update level to match save
            if (data.saveData?.level) {
                this.selectedLevel = data.saveData.level;
            }

            console.log(`[ServerGameRoom] Save data uploaded by host. Level: ${this.selectedLevel}`);

            // Notify host of success
            this.serverNetworkManager.sendToPlayer(playerId, 'SAVE_DATA_UPLOADED', {
                success: true,
                saveName: data.saveData?.saveName || 'Unknown'
            });

            // Notify all players that a save was loaded
            this.serverNetworkManager.broadcastToRoom(this.id, 'SAVE_DATA_LOADED', {
                saveName: data.saveData?.saveName || 'Unknown',
                level: this.selectedLevel
            });

        } catch (error) {
            console.error('Error uploading save data:', error);
            this.serverNetworkManager.sendToPlayer(playerId, 'SAVE_DATA_UPLOADED', {
                success: false,
                error: 'Server error uploading save data'
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

                // If game is active and has remaining players, trigger victory for remaining player
                if (room.isActive && room.players.size === 2) {
                    // Find remaining player and end game with them as winner
                    if (room.game && room.game.serverBattlePhaseSystem) {
                        room.game.serverBattlePhaseSystem.handlePlayerDisconnect(playerId);
                    }
                }

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

                // If game is active and has remaining players, trigger victory for remaining player
                if (room.isActive && room.players.size === 2) {
                    // Find remaining player and end game with them as winner
                    if (room.game && room.game.serverBattlePhaseSystem) {
                        room.game.serverBattlePhaseSystem.handlePlayerDisconnect(playerId);
                    }
                }

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

        // Destroy the player entity
        const playerEntityId = room.game.call('getPlayerEntityId', playerId);
        if (room.game && room.game.entities.has(playerEntityId)) {
            try {
                room.game.destroyEntity(playerEntityId);
            } catch (error) {
                console.warn(`Error destroying player entity ${playerEntityId}:`, error);
            }
        }

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
        if (room.game && room.game.componentSystem) {
            const playerEntities = room.game.getEntitiesWith("playerOwned")
                .filter(entityId => {
                    const ownerComp = room.game.getComponent(entityId, "playerOwned");
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
            player.side = playerData.isHost ? 'left' : 'right';

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
    async startGame() {
        if (this.game.state.phase !== 'lobby') {
            console.log(`Cannot start game, not in lobby phase. Current phase: ${this.game.state.phase}`);
            return false;
        }

        // Check if all players are ready
        const allReady = Array.from(this.players.values()).every(p => p.ready);
        if (!allReady) {
            return false;
        }

        // Store level for scene loading
        const level = this.selectedLevel;
        this.game.state.level = level;

        // Update game scene's terrain entity to use the selected level
        const collections = this.game.getCollections();
        const gameScene = collections?.scenes?.game;
        if (gameScene && gameScene.entities) {
            const terrainEntity = gameScene.entities.find(e => e.prefab === 'terrain');
            if (terrainEntity) {
                if (!terrainEntity.components) {
                    terrainEntity.components = {};
                }
                if (!terrainEntity.components.terrain) {
                    terrainEntity.components.terrain = {};
                }
                terrainEntity.components.terrain.level = level;
            }
        }

        this.game.state.phase = 'placement';

        // If we have pending save data, restore player stats and set up for entity loading
        const isLoadingSave = !!this.pendingSaveData;
        if (isLoadingSave && this.pendingSaveData.state) {
            const savedState = this.pendingSaveData.state;

            // Restore game state values
            if (savedState.round !== undefined) {
                this.game.state.round = savedState.round;
            }

            // Set pendingSaveData on game object so SceneManager loads saved entities
            this.game.pendingSaveData = this.pendingSaveData;

            console.log(`[ServerGameRoom] Set pendingSaveData on game object. Entities count: ${this.pendingSaveData.entities?.length || 0}`);
        }

        // Log before calling parent startGame
        console.log(`[ServerGameRoom] About to call super.startGame(). pendingSaveData set: ${!!this.game.pendingSaveData}, isLoadingSave: ${isLoadingSave}`);

        // Call parent's startGame (loads scene, spawns entities, etc.)
        // If pendingSaveData is set, SceneManager will load saved entities instead of scene entities
        await super.startGame();

        // Create player entities now that the game scene is loaded
        this.createPlayerEntities();

        // Log after scene load to verify entities were created
        const entityCount = this.game.entities?.size || 0;
        console.log(`[ServerGameRoom] After startGame. Total entities on server: ${entityCount}`);

        // Broadcast game started with level info, entity sync, and save data flag
        if (this.serverNetworkManager) {
            let gameState = this.getGameState();
            // Include entity sync so client can create player entities
            const entitySync = this.game.serverBattlePhaseSystem?.serializeAllEntities() || {};
            this.serverNetworkManager.broadcastToRoom(this.id, 'GAME_STARTED', {
                gameState: gameState,
                entitySync: entitySync,
                level: level,
                isLoadingSave: isLoadingSave,
                saveData: isLoadingSave ? this.pendingSaveData : null,
                nextEntityId: this.game.nextEntityId
            });
        }

        console.log(`Game started in room ${this.id} with level: ${level}${isLoadingSave ? ' (from save)' : ''}`);
        return true;
    }

    /**
     * Create player entities for all players in the room
     * Called after scene loads so PlayerStatsSystem is available
     */
    createPlayerEntities() {
        for (const [playerId, player] of this.players) {
            // Create player entity with playerStats component via service
            this.game.call('createPlayerEntity', playerId, {
                side: player.side,
                gold: this.game.state.startingGold,
                upgrades: []
            });

            console.log(`[ServerGameRoom] Created player entity for player ${playerId}`);
        }
    }

    // Enhanced game state for multiplayer
    // Placements included for spawning opponent entities on client
    // entitySync is authoritative for component data
    getGameState() {
        let players = Array.from(this.players.values());
        let playerData = [];
        players.forEach((p) => {
            // Get minimal placement data for spawning entities
            const placements = this.getPlacementsForPlayer(p.id);

            // Get stats from player entity if it exists (after game starts)
            const playerStats = this.game.call('getPlayerStats', p.id);

            playerData.push({
                id: p.id,
                name: p.name,
                ready: p.ready || false,
                isHost: p.isHost || false,
                stats: {
                    gold: playerStats?.gold ?? this.game.state.startingGold,
                    side: playerStats?.side ?? p.side
                },
                placements: placements
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

    // Get placement data for client (spawning entities and syncing experience)
    // Client looks up unitType from collections using unitTypeId + collection
    getPlacementsForPlayer(playerId) {
        if (!this.game.componentSystem) return [];

        const placements = [];
        const seenPlacementIds = new Set();
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');

        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (!placementComp?.placementId) continue;
            if (placementComp.playerId !== playerId) continue;
            if (seenPlacementIds.has(placementComp.placementId)) continue;

            seenPlacementIds.add(placementComp.placementId);

            // Calculate cells for grid reservation on client
            const collections = this.game.getCollections();
            const unitType = collections[placementComp.collection]?.[placementComp.unitTypeId];
            let cells = [];
            if (unitType && this.game.squadSystem) {
                const squadData = this.game.squadSystem.getSquadData(unitType);
                cells = this.game.squadSystem.getSquadCells(placementComp.gridPosition, squadData);
            }

            // Get experience data from SquadExperienceSystem
            const experience = this.game.squadExperienceSystem?.getSquadInfo(placementComp.placementId);

            // Get squadUnits (entity IDs) for this placement so clients use the same IDs
            const squadUnits = this.game.placementSystem?.getSquadUnitsForPlacement(placementComp.placementId) || [];

            // Get serverTime from assignedBuilder's playerOrder for sync
            let serverTime = null;
            if (placementComp.assignedBuilder) {
                const builderOrder = this.game.getComponent(placementComp.assignedBuilder, 'playerOrder');
                if (builderOrder) {
                    serverTime = builderOrder.issuedTime;
                }
            }

            placements.push({
                placementId: placementComp.placementId,
                gridPosition: placementComp.gridPosition,
                unitTypeId: placementComp.unitTypeId,
                collection: placementComp.collection,
                team: placementComp.team,
                playerId: placementComp.playerId,
                cells: cells,
                experience: experience || null,
                squadUnits: squadUnits,
                roundPlaced: placementComp.roundPlaced,
                // Include building construction state if present
                isUnderConstruction: placementComp.isUnderConstruction || false,
                buildTime: placementComp.buildTime,
                assignedBuilder: placementComp.assignedBuilder,
                serverTime: serverTime  // Authoritative time for builder's playerOrder
            });
        }

        return placements;
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


    // Reset all remaining players for next game
    resetPlayersForNextGame(room) {
        for (const [playerId, player] of room.players) {
            // Reset player entity stats
            const playerStats = room.game.call('getPlayerStats', playerId);
            if (playerStats) {
                playerStats.gold = room.game.state.startingGold;
                playerStats.upgrades = [];
            }

            // Reset ready states
            player.ready = false;
            player.placementReady = false;

            console.log(`Reset player ${playerId} stats: gold=${playerStats?.gold}`);
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


// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.ServerGameRoom = ServerGameRoom;
}

// ES6 exports for webpack bundling
export default ServerGameRoom;
export { ServerGameRoom };
