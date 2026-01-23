class ServerGameRoom extends global.GUTS.GameRoom {
    constructor(engine, roomId, gameInstance, maxPlayers = 2, gameConfig = {}) {
        super(engine, roomId, gameInstance, maxPlayers);

        // Get enums for phase comparisons
        this.enums = this.game.getEnums();

        // Add multiplayer lobby functionality
        this.game.state.phase = this.enums.gamePhase.lobby;
        this.gameConfig = gameConfig;
        this.createdAt = Date.now();

        // Subscribe to events from network manager
        this.subscribeToEvents();

        console.log(`ServerGameRoom ${roomId} created for ${maxPlayers} players`);
    }

    subscribeToEvents() {
        if (!this.game.serverEventManager) {
            console.error('No event manager found on engine');
            return;
        }

        // Subscribe to room management events (events are isolated per room's serverEventManager)
        this.game.serverEventManager.subscribe('LEAVE_ROOM', this.handleLeaveRoom.bind(this));
        this.game.serverEventManager.subscribe('PLAYER_DISCONNECT', this.handlePlayerDisconnect.bind(this));
        this.game.serverEventManager.subscribe('TOGGLE_READY', this.handleToggleReady.bind(this));
        this.game.serverEventManager.subscribe('UPLOAD_SAVE_DATA', this.handleUploadSaveData.bind(this));
    }

    handleToggleReady(eventData) {
        const { playerId, data } = eventData;
        try {
            // Store the selected level from host (numeric index)
            const player = this.players.get(playerId);
            if (player?.isHost && data?.level !== undefined) {
                this.selectedLevel = data.level;
                console.log(`Host selected level index: ${this.selectedLevel}`);
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
            if (this.game.state.phase !== this.enums.gamePhase.lobby) {
                this.serverNetworkManager.sendToPlayer(playerId, 'SAVE_DATA_UPLOADED', {
                    success: false,
                    error: 'Can only upload save data in lobby'
                });
                return;
            }

            // Store save data for this room
            this.pendingSaveData = data.saveData;

            // Update level to match save - handle both string (legacy) and numeric
            if (data.saveData?.level !== undefined) {
                if (typeof data.saveData.level === 'string') {
                    this.selectedLevel = this.enums.levels?.[data.saveData.level] ?? 1;
                } else {
                    this.selectedLevel = data.saveData.level;
                }
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

        // Only handle disconnect if player is in THIS room
        if (!this.players.has(playerId)) {
            return;
        }

        console.log(`[Room ${this.id}] Player ${playerId} disconnected`);

        // Get player data before removing
        const player = this.players.get(playerId);
        const playerName = player?.name || 'Unknown';

        // If game is active and has remaining players, trigger victory for remaining player
        if (this.isActive && this.players.size === 2) {
            // Find remaining player and end game with them as winner
            if (this.game && this.game.serverBattlePhaseSystem) {
                this.game.serverBattlePhaseSystem.handlePlayerDisconnect(playerId);
            }
        }

        // Clean up player state completely
        this.cleanupPlayerState(this, playerId);

        // Remove from room
        this.removePlayer(playerId);

        // Notify other players (after removing so gameState reflects the change)
        this.serverNetworkManager.broadcastToRoom(this.id, 'PLAYER_LEFT', {
            playerId: playerId,
            playerName: playerName,
            gameState: this.getGameState()
        });
        this.serverNetworkManager.leaveRoom(playerId, this.id);

        // Clean up empty rooms
        if (this.players.size === 0) {
            this.cleanupRoom(this);
            this.engine.gameRooms.delete(this.id);
            console.log(`[Room ${this.id}] Removed empty room after player ${playerId} disconnected`);
            console.log(`[Room ${this.id}] Remaining rooms:`, Array.from(this.engine.gameRooms.keys()));
        } else {
            // If room still has players, reset their states for next game
            this.resetPlayersForNextGame(this);
        }

        // Clean up network manager state
        this.serverNetworkManager.playerSockets.delete(playerId);
        console.log(`[Room ${this.id}] Cleaned up network state for player ${playerId}`);
    }

    handleLeaveRoom(eventData) {
        const { playerId } = eventData;

        // Only handle leave if player is in THIS room
        if (!this.players.has(playerId)) {
            return;
        }

        console.log(`[Room ${this.id}] Player ${playerId} leaving room`);

        // Get player data before removing
        const player = this.players.get(playerId);
        const playerName = player?.name || 'Unknown';

        // If game is active and has remaining players, trigger victory for remaining player
        if (this.isActive && this.players.size === 2) {
            // Find remaining player and end game with them as winner
            if (this.game && this.game.serverBattlePhaseSystem) {
                this.game.serverBattlePhaseSystem.handlePlayerDisconnect(playerId);
            }
        }

        // Clean up player state in the room
        this.cleanupPlayerState(this, playerId);

        // Remove from room
        this.removePlayer(playerId);
        this.serverNetworkManager.leaveRoom(playerId, this.id);

        // Notify other players (after removing so gameState reflects the change)
        this.serverNetworkManager.broadcastToRoom(this.id, 'PLAYER_LEFT', {
            playerId: playerId,
            playerName: playerName,
            gameState: this.getGameState()
        });

        // Clean up empty rooms
        if (this.players.size === 0) {
            this.cleanupRoom(this);
            this.engine.gameRooms.delete(this.id);
            console.log(`[Room ${this.id}] Removed empty room`);
        } else {
            // If room still has players, reset their states for next game
            this.resetPlayersForNextGame(this);
        }

        // IMPORTANT: DO NOT delete socket here - player is still connected, just not in a room
        // Only handlePlayerDisconnect should delete the socket
        console.log(`[Room ${this.id}] Player ${playerId} left room successfully, socket preserved`);
    }

    cleanupPlayerState(room, playerId) {
        const player = room.players.get(playerId);
        if (!player) return;

        // Destroy the player entity
        const playerEntityId = room.game.call('getPlayerEntityId', playerId);
        if (room.game && room.game.entityExists(playerEntityId)) {
            try {
                room.game.destroyEntity(playerEntityId);
            } catch (error) {
                console.warn(`Error destroying player entity ${playerEntityId}:`, error);
            }
        }

        // Clear any placement data (use numeric ID for ECS comparison)
        if (room.game && room.game.placementSystem) {
            const numericId = room.getNumericPlayerId(playerId);
            room.game.call('clearPlayerPlacements', numericId);
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
        if (room.game) {
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
            // Team enum: left=2, right=3 (host is left team)
            player.team = playerData.isHost ? 2 : 3;

            // Room is already in lobby phase - no need to transition
        }

        return result;
    }

    enterLobbyPhase() {
        this.game.state.phase = this.enums.gamePhase.lobby;
        
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
        if (!player || this.game.state.phase !== this.enums.gamePhase.lobby) {
            console.log("no player or not in lobby phase", this.game.state.phase);
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
        
        // Auto-start if all ready and we have at least 2 players
        if (allReady && this.players.size >= 2) {
            setTimeout(() => this.startGame(), 1000);
        }
        
        return true;
    }

    // Override parent's startGame to add multiplayer lobby logic
    async startGame() {
        if (this.game.state.phase !== this.enums.gamePhase.lobby) {
            console.log(`Cannot start game, not in lobby phase. Current phase: ${this.game.state.phase}`);
            return false;
        }

        // Check if all players are ready and we have at least 2 players
        const allReady = Array.from(this.players.values()).every(p => p.ready);
        if (!allReady || this.players.size < 2) {
            return false;
        }

        // Store level for scene loading
        const level = this.selectedLevel;
        this.game.state.level = level;

        // Generate game seed for deterministic RNG (based on room ID)
        this.game.state.gameSeed = GUTS.SeededRandom.hashString(this.id);

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

        this.game.state.phase = this.enums.gamePhase.placement;

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

        // Store player info on game state so SkirmishGameSystem can create player entities
        // This keeps player entity creation consistent across all game modes
        // Use numeric player IDs so both client and server can create matching entities
        this.game.state.onlinePlayers = [];
        for (const [socketId, player] of this.players) {
            const numericId = this.getNumericPlayerId(socketId);
            this.game.state.onlinePlayers.push({
                playerId: numericId,  // Use numeric ID, not socket ID
                socketId: socketId,    // Keep socket ID for server-side lookups
                team: player.team,
                gold: this.game.state.startingGold
            });
        }

        // Call parent's startGame (loads scene, spawns entities, etc.)
        // If pendingSaveData is set, SceneManager will load saved entities instead of scene entities
        // SkirmishGameSystem.postSceneLoad() will create player entities and starting state
        await super.startGame();

        // Log after scene load to verify entities were created
        const entityCount = this.game.getEntityCount?.() || 0;
        console.log(`[ServerGameRoom] After startGame. Total entities on server: ${entityCount}`);

        // Broadcast game started with level info and game state (no entitySync - clients spawn locally)
        if (this.serverNetworkManager) {
            let gameState = this.getGameState();
            console.log('[ServerGameRoom] Broadcasting GAME_STARTED with gameState:', {
                onlinePlayers: gameState.onlinePlayers,
                level: level,
                nextEntityId: this.game.nextEntityId
            });
            this.serverNetworkManager.broadcastToRoom(this.id, 'GAME_STARTED', {
                gameState: gameState,
                level: level,
                isLoadingSave: isLoadingSave,
                saveData: isLoadingSave ? this.pendingSaveData : null,
                nextEntityId: this.game.nextEntityId
            });
        }

        console.log(`Game started in room ${this.id} with level: ${level}${isLoadingSave ? ' (from save)' : ''}`);
        return true;
    }

    // Enhanced game state for multiplayer
    // networkUnitData included for spawning opponent entities on client
    // entitySync is authoritative for component data
    getGameState() {
        let players = Array.from(this.players.values());
        let playerData = [];
        players.forEach((p) => {
            // Get network unit data for spawning entities (includes placement + sync data)
            const networkUnitData = this.getNetworkUnitDataForPlayer(p.id);

            // Get stats from player entity if it exists (after game starts)
            const playerStats = this.game.call('getPlayerStats', p.id);

            playerData.push({
                id: p.id,
                name: p.name,
                ready: p.ready || false,
                isHost: p.isHost || false,
                team: playerStats?.team ?? p.team,  // Team at top level for easy access
                stats: {
                    gold: playerStats?.gold ?? this.game.state.startingGold,
                    team: playerStats?.team ?? p.team  // team field in playerStats component stores numeric team
                },
                networkUnitData: networkUnitData
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
            // Pass onlinePlayers for SkirmishGameSystem initialization
            onlinePlayers: this.game.state.onlinePlayers,
            // Let the game instance provide additional state if needed
            gameData: this.game.getGameState ? this.game.getGameState() : null
        };
    }

    /**
     * Get network unit data for client (spawning entities and syncing experience)
     * This is different from the placement component - it includes additional sync data
     * like experience, squadUnits, playerOrder, etc. for network transmission.
     * Client looks up unitType from collections using unitTypeId + collection
     * @param {string} socketPlayerId - The socket player ID
     * @returns {Array} Array of network unit data objects
     */
    getNetworkUnitDataForPlayer(socketPlayerId) {

        // Convert string playerId to numeric for comparison with ECS storage
        const playerId = this.getNumericPlayerId(socketPlayerId);

        const networkUnitData = [];
        const seenPlacementIds = new Set();
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');

        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            if (!placementComp?.placementId) continue;
            if (placementComp.playerId !== playerId) continue;
            if (seenPlacementIds.has(placementComp.placementId)) continue;
            // Skip scene entities (roundPlaced === 0) - they're loaded from scene, not player placements
            if (placementComp.roundPlaced === 0) continue;

            seenPlacementIds.add(placementComp.placementId);

            // Calculate cells for grid reservation on client
            // Look up unitType using getUnitTypeDef since placement stores numeric indices
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            let cells = [];
            if (unitType && this.game.squadSystem && placementComp.gridPosition) {
                const squadData = this.game.squadSystem.getSquadData(unitType);
                cells = this.game.squadSystem.getSquadCells(placementComp.gridPosition, squadData);
            }

            // Get experience data from SquadExperienceSystem
            const experience = this.game.squadExperienceSystem?.getSquadInfo(placementComp.placementId);

            // Get squadUnits (entity IDs) for this placement so clients use the same IDs
            const squadUnits = this.game.placementSystem?.getSquadUnitsForPlacement(placementComp.placementId) || [];

            // Get team from the team component (not placement.team which is deprecated)
            const teamComp = this.game.getComponent(entityId, 'team');
            const team = teamComp?.team;
            console.log(`[getNetworkUnitDataForPlayer] placementId=${placementComp.placementId}, entityId=${entityId}, squadUnits=${JSON.stringify(squadUnits)}, team=${team}`);

            // Get serverTime from assignedBuilder's playerOrder for sync
            let serverTime = null;
            if (placementComp.assignedBuilder != null) {
                const builderOrder = this.game.getComponent(placementComp.assignedBuilder, 'playerOrder');
                if (builderOrder) {
                    serverTime = builderOrder.issuedTime;
                }
            }

            // Get playerOrder from first squad unit (all units in squad share same order)
            // This is needed so opponent clients can simulate unit movement during battle
            let playerOrder = null;
            if (squadUnits.length > 0) {
                const firstUnitOrder = this.game.getComponent(squadUnits[0], 'playerOrder');
                if (firstUnitOrder && (firstUnitOrder.targetPositionX !== 0 || firstUnitOrder.targetPositionZ !== 0)) {
                    playerOrder = {
                        targetPositionX: firstUnitOrder.targetPositionX,
                        targetPositionY: firstUnitOrder.targetPositionY,
                        targetPositionZ: firstUnitOrder.targetPositionZ,
                        isMoveOrder: firstUnitOrder.isMoveOrder,
                        preventEnemiesInRangeCheck: firstUnitOrder.preventEnemiesInRangeCheck,
                        issuedTime: firstUnitOrder.issuedTime
                    };
                }
            }

            networkUnitData.push({
                placementId: placementComp.placementId,
                gridPosition: placementComp.gridPosition,
                unitTypeId: placementComp.unitTypeId,
                collection: placementComp.collection,
                team: team,  // From team component
                playerId: placementComp.playerId,
                cells: cells,
                experience: experience || null,
                squadUnits: squadUnits,
                roundPlaced: placementComp.roundPlaced,
                // Include building construction state if present
                isUnderConstruction: placementComp.isUnderConstruction === 1,
                buildTime: placementComp.buildTime,
                assignedBuilder: placementComp.assignedBuilder !== -1 ? placementComp.assignedBuilder : null,
                serverTime: serverTime,  // Authoritative time for builder's playerOrder
                playerOrder: playerOrder  // Movement order for battle simulation on opponent clients
            });
        }

        return networkUnitData;
    }

    // Reset all remaining players for next game
    resetPlayersForNextGame(room) {
        for (const [playerId, player] of room.players) {
            // Reset player entity stats
            const playerStats = room.game.call('getPlayerStats', playerId);
            if (playerStats) {
                playerStats.gold = room.game.state.startingGold;
                playerStats.upgrades = 0;
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
            // Room ID tracking is now handled at the point where room is deleted
            // (in handlePlayerDisconnect and handleLeaveRoom)

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
