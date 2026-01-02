class ClientNetworkSystem extends GUTS.BaseNetworkSystem {
    static services = [
        'connectToServer',
        'createRoom',
        'joinRoom',
        'startQuickMatch',
        'leaveRoom',
        'toggleReady',
        'startGame',
        'getStartingState',
        'submitPlacementToServer',
        'purchaseUpgrade',
        'toggleReadyForBattle',
        'setSquadTarget',
        'setSquadTargets',
        'cancelBuilding',
        'upgradeBuildingRequest',
        'uploadSaveData',
        'resyncEntities',
        'sendCheatRequest',
        'sendPlacementRequest',
        'transformUnit',
        'levelSquad',
        // Local game mode services (set by SkirmishGameSystem or other local modes)
        'getLocalPlayerId',
        'setLocalGame',
        'resetTeamReadyState'
    ];

    constructor(game) {
        super(game);
        this.game.clientNetworkSystem = this;

        // State tracking
        this.roomId = null;
        this.isHost = false;
        this.gameState = null;
        // Store unsubscribe functions
        this.networkUnsubscribers = [];
        // Local game mode flag (set by SkirmishGameSystem or other local modes)
        this._localPlayerId = 0;
        // Track ready state per team for local mode (both teams must be ready to start battle)
        this._teamReadyState = { left: false, right: false };
    }

    // ==================== LOCAL GAME MODE ====================

    /**
     * Get the local player ID (used when running without server)
     */
    getLocalPlayerId() {
        return this._localPlayerId;
    }

    /**
     * Set local game mode (called by SkirmishGameSystem or other local modes)
     */
    setLocalGame(isLocal, playerId = 0) {
        this.game.state.isLocalGame = isLocal;
        this._localPlayerId = playerId;
    }

    /**
     * Reset team ready state (called at start of each placement phase)
     */
    resetTeamReadyState() {
        this._teamReadyState = { left: false, right: false };
    }

    /**
     * Convert event name to handler name (e.g., 'SUBMIT_PLACEMENT' -> 'handleSubmitPlacement')
     */
    _eventToHandler(eventName) {
        // SUBMIT_PLACEMENT -> Submit_Placement -> SubmitPlacement -> handleSubmitPlacement
        const camelCase = eventName.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        return 'handle' + camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
    }

    /**
     * Unified network request handler for local and multiplayer modes.
     * Transport layer is the ONLY difference - same handlers process requests in both modes.
     *
     * Flow:
     *   Client: networkRequest() -> [socket.io OR direct call] -> ServerNetworkSystem.handler()
     *   Server: handler() -> respond() -> [socket.io OR direct call] -> Client callback
     *
     * @param {Object} options
     * @param {string} options.eventName - Event name (e.g., 'SUBMIT_PLACEMENT')
     * @param {string} options.responseName - Response event name (e.g., 'SUBMITTED_PLACEMENT')
     * @param {Object} options.data - Request data
     * @param {Function} options.onSuccess - Called with response data on success
     * @param {Function} callback - Final callback(success, result)
     */
    networkRequest(options, callback) {
        const { eventName, responseName, data, onSuccess } = options;

        const handleResponse = (result, error) => {
            if (error || result?.error || result?.success === false) {
                callback(false, error || result?.error || 'Request failed');
            } else {
                if (onSuccess) onSuccess(result);
                callback(true, result || {});
            }
        };

        if (this.game.state.isLocalGame) {
            // Local mode: call ServerNetworkSystem handler directly
            const playerId = this.game.call('getLocalPlayerId');
            const eventData = { playerId, numericPlayerId: playerId, data };
            const handlerName = this._eventToHandler(eventName);
            this.game.call(handlerName, eventData, handleResponse);
        } else {
            // Multiplayer mode: send via socket.io
            this.game.clientNetworkManager.call(eventName, data, responseName, handleResponse);
        }
    }

    // GUTS Manager Interface
    init(params) {
        this.params = params || {};
    }

    onSceneLoad() {
        // Set up network listeners when scene loads
        // Connection is initiated explicitly when player selects multiplayer mode
        // via GameModeSystem.showMultiplayerConnect()
        // Listeners are registered here so they're ready when connection is established
        this.setupNetworkListeners();
    }

    async connectToServer() {
        try {
            await this.game.clientNetworkManager.connect();
            
            // Call server to get player ID
            this.game.clientNetworkManager.call(
                'CONNECT',
                null,
                'CONNECTED',
                (data, error) => {
                    if (error) {
                        console.error('Failed to get player ID:', error);
                       // this.game.uiSystem.showNotification('Failed to get player ID from server', 'error');
                    } else if (data && data.playerId) {
                        this.game.clientNetworkManager.playerId = data.playerId;
                        this.game.state.playerId = data.playerId;
                    } else {
                        console.error('Server response missing player ID:', data);
                       // this.game.uiSystem.showNotification('Server did not provide player ID', 'error');
                    }
                }
            );
            
        } catch (error) {
            console.error('Failed to connect to server:', error);
            //this.game.uiSystem.showNotification('Failed to connect to server', 'error');
        }
    }

    setupNetworkListeners() {
        const nm = this.game.clientNetworkManager;
        if (!nm) {
            console.error('ClientNetworkManager not available');
            return;
        }

        // Listen to events that update the UI
        this.networkUnsubscribers.push(
            nm.listen('PLAYER_JOINED', (data) => {
                this.syncWithServerState(data);   
                this.handlePlayerJoined(data);
            }),

            nm.listen('PLAYER_LEFT', (data) => {
                this.syncWithServerState(data);   
                this.handlePlayerLeft(data);
            }),

            nm.listen('PLAYER_READY_UPDATE', (data) => {
                this.syncWithServerState(data);   
                this.handlePlayerReadyUpdate(data);
            }),

            nm.listen('GAME_STARTED', (data) => {
                this.syncWithServerState(data);   
                this.handleGameStarted(data);
            }),
            nm.listen('OPPONENT_SQUAD_TARGET_SET', (data) => {
                this.syncWithServerState(data);   
                this.handleOpponentSquadTarget(data);
            }),
            nm.listen('OPPONENT_SQUAD_TARGETS_SET', (data) => {
                this.syncWithServerState(data);   
                this.handleOpponentSquadTargets(data);
            }),
            nm.listen('READY_FOR_BATTLE_UPDATE', (data) => {
                this.syncWithServerState(data);
                this.handleReadyForBattleUpdate(data);
            }),

            nm.listen('BATTLE_END', (data) => {
                this.syncWithServerState(data);   
                this.handleBattleEnd(data);
            }),

            nm.listen('GAME_END', (data) => {
                this.syncWithServerState(data);
                this.handleGameEnd(data);
            }),

            nm.listen('GAME_ENDED_ALL_PLAYERS_LEFT', (data) => {
                this.handleAllPlayersLeft(data);
            }),

            nm.listen('SAVE_DATA_LOADED', (data) => {
                this.handleSaveDataLoaded(data);
            }),
            

            nm.listen('OPPONENT_BUILDING_CANCELLED', (data) => {
                this.handleOpponentBuildingCancelled(data);
            }),

            nm.listen('OPPONENT_BUILDING_UPGRADED', (data) => {
                this.handleOpponentBuildingUpgraded(data);
            }),

            nm.listen('CHEAT_BROADCAST', (data) => {
                this.handleCheatBroadcast(data);
            }),

            nm.listen('OPPONENT_UNIT_TRANSFORMED', (data) => {
                this.handleOpponentUnitTransformed(data);
            })
        );
    }

    createRoom(playerName, maxPlayers = 2) {
        this.game.call('showNotification', 'Creating room...', 'info');

        this.game.clientNetworkManager.call(
            'CREATE_ROOM',
            { playerName, maxPlayers },
            'ROOM_CREATED',
            (data, error) => {
                if (error) {
                    this.game.call('showNotification', `Failed to create room: ${error.message}`, 'error');
                } else {
                    this.roomId = data.roomId;
                    this.isHost = data.isHost;
                    this.gameState = data.gameState;
                    this.game.clientNetworkManager.numericPlayerId = data.numericPlayerId;

                    // Set myTeam from lobby response so it's available before game scene loads
                    this.setMyTeamFromGameState(data.playerId, data.gameState);

                    this.game.call('showNotification', `Room created! Code: ${this.roomId}`, 'success');
                    this.game.call('showLobby', data.gameState, this.roomId);
                }
            }
        );
    }

    joinRoom(roomId, playerName) {
        this.game.call('showNotification', 'Joining room...', 'info');

        this.game.clientNetworkManager.call(
            'JOIN_ROOM',
            { roomId, playerName },
            'ROOM_JOINED',
            (data, error) => {
                if (error) {
                    this.game.call('showNotification', `Failed to join room: ${error.message}`, 'error');
                } else {
                    this.roomId = data.roomId;
                    this.isHost = data.isHost;
                    this.gameState = data.gameState;
                    this.game.clientNetworkManager.numericPlayerId = data.numericPlayerId;

                    // Set myTeam from lobby response so it's available before game scene loads
                    this.setMyTeamFromGameState(data.playerId, data.gameState);

                    this.game.call('showNotification', `Joined room ${this.roomId}`, 'success');
                    this.game.call('showLobby', data.gameState, this.roomId);
                }
            }
        );
    }

    startQuickMatch(playerName) {
        this.game.call('showNotification', 'Finding opponent...', 'info');

        this.game.clientNetworkManager.call(
            'QUICK_MATCH',
            { playerName },
            'QUICK_MATCH_FOUND',
            (data, error) => {
                if (error) {
                    this.game.call('showNotification', `Quick match failed: ${error.message}`, 'error');
                } else {
                    this.roomId = data.roomId;
                    this.isHost = data.isHost;
                    this.gameState = data.gameState;

                    // Set myTeam from lobby response so it's available before game scene loads
                    this.setMyTeamFromGameState(data.playerId, data.gameState);

                    this.game.call('showNotification', `Match found! Entering room...`, 'success');
                    this.game.call('showLobby', data.gameState, this.roomId);
                }
            }
        );
    }

    getStartingState(callback){
        this.game.clientNetworkManager.call(
            'GET_STARTING_STATE',
            {},
            'GOT_STARTING_STATE',
            (data, error) => {
                if (error || !data || data.error) {
                    callback(false, error || data?.error || 'No response from server');
                } else {
                    callback(true, data);
                }
            }
        );
    }

    uploadSaveData(saveData, callback) {
        // Use longer timeout for large save files (60 seconds)
        this.game.clientNetworkManager.call(
            'UPLOAD_SAVE_DATA',
            { saveData },
            'SAVE_DATA_UPLOADED',
            (data, error) => {
                if (error || !data || data.error) {
                    callback(false, { error: error || data?.error || 'Failed to upload save' });
                } else {
                    callback(true, data);
                }
            },
            60000
        );
    }

    /**
     * Send placement request to server (used by PlacementUISystem)
     * Alias for submitPlacement with cleaner interface
     */
    sendPlacementRequest(placement, callback) {
        this.submitPlacementToServer(placement, callback);
    }

    submitPlacementToServer(networkUnitData, callback) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            callback(false, 'Not in placement phase.');
            return;
        }

        // Send only minimal placement data - server resolves unitType from numeric indices
        const minimalPlacement = {
            placementId: networkUnitData.placementId,
            gridPosition: networkUnitData.gridPosition,
            unitTypeId: networkUnitData.unitTypeId,
            collection: networkUnitData.collection,
            team: networkUnitData.team,
            playerId: networkUnitData.playerId,
            roundPlaced: networkUnitData.roundPlaced,
            timestamp: networkUnitData.timestamp,
            peasantInfo: networkUnitData.peasantInfo,
            isStartingState: networkUnitData.isStartingState
        };

        this.networkRequest({
            eventName: 'SUBMIT_PLACEMENT',
            responseName: 'SUBMITTED_PLACEMENT',
            data: { placement: minimalPlacement },
            onSuccess: (result) => {
                // Update placementId from server/handler response
                networkUnitData.placementId = result.placementId;
                // In multiplayer, also need to call processPlacement on client to sync state
                if (!this.game.state.isLocalGame) {
                    const numericPlayerId = this.game.clientNetworkManager?.numericPlayerId;
                    const player = { team: this.game.call('getActivePlayerTeam') };
                    this.processPlacement(numericPlayerId, numericPlayerId, player, networkUnitData, result.squadUnits);
                }
            }
        }, callback);
    }

    cancelBuilding(requestData, callback) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            callback(false, 'Not in placement phase.');
            return;
        }

        const { buildingEntityId } = requestData;

        this.networkRequest({
            eventName: 'CANCEL_BUILDING',
            responseName: 'BUILDING_CANCELLED',
            data: requestData,
            onSuccess: () => {
                // In multiplayer, also need to call processCancelBuilding on client to sync state
                if (!this.game.state.isLocalGame) {
                    const numericPlayerId = this.game.clientNetworkManager?.numericPlayerId;
                    this.processCancelBuilding(buildingEntityId, numericPlayerId);
                }
            }
        }, callback);
    }

    handleOpponentBuildingCancelled(data) {
        const { placementId, side } = data;

        // Remove the opponent's cancelled placement
        this.game.call('clearPlayerPlacements', side, [placementId]);
        this.game.call('showNotification', 'Opponent cancelled a building', 'info', 1500);
    }

    handleOpponentBuildingUpgraded(data) {
        const { buildingEntityId, placementId, targetBuildingId, newEntityId, newPlacementId } = data;

        // Get opponent's team from the old building
        const oldPlacement = this.game.getComponent(buildingEntityId, 'placement');
        const opponentTeam = oldPlacement?.team;
        const opponentPlayerId = oldPlacement?.playerId;

        if (opponentTeam === undefined) {
            return;
        }

        // Use shared processUpgradeBuilding with opponent's data
        const player = { team: opponentTeam };

        this.processUpgradeBuilding(
            opponentPlayerId,
            opponentPlayerId,
            player,
            buildingEntityId,
            placementId,
            targetBuildingId,
            [newEntityId],
            newPlacementId
        );
    }

    upgradeBuildingRequest(requestData, callback) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            callback(false, { error: 'Not in placement phase.' });
            return;
        }

        const { buildingEntityId, placementId, targetBuildingId } = requestData;

        this.networkRequest({
            eventName: 'UPGRADE_BUILDING',
            responseName: 'BUILDING_UPGRADED',
            data: requestData,
            onSuccess: (result) => {
                // In multiplayer, also need to call processUpgradeBuilding on client to sync state
                if (!this.game.state.isLocalGame) {
                    const numericPlayerId = this.game.clientNetworkManager?.numericPlayerId;
                    const player = { team: this.game.call('getActivePlayerTeam') };
                    this.processUpgradeBuilding(
                        numericPlayerId,
                        numericPlayerId,
                        player,
                        buildingEntityId,
                        placementId,
                        targetBuildingId,
                        [result.newEntityId],
                        result.newPlacementId
                    );
                }
            }
        }, callback);
    }

    purchaseUpgrade(requestData, callback) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            callback(false, 'Not in placement phase.');
            return;
        }

        const { upgradeId } = requestData;

        this.networkRequest({
            eventName: 'PURCHASE_UPGRADE',
            responseName: 'PURCHASED_UPGRADE',
            data: { data: requestData }, // Server expects data.data.upgradeId
            onSuccess: () => {
                // In multiplayer, also need to call processPurchaseUpgrade on client to sync state
                if (!this.game.state.isLocalGame) {
                    const numericPlayerId = this.game.clientNetworkManager?.numericPlayerId;
                    const upgrade = this.collections.upgrades[upgradeId];
                    if (upgrade) {
                        this.processPurchaseUpgrade(numericPlayerId, upgradeId, upgrade);
                    }
                }
            }
        }, callback);
    }

    levelSquad(requestData, callback) {
        console.log('[ClientNetworkSystem.levelSquad] called with requestData:', requestData);
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            console.log('[ClientNetworkSystem.levelSquad] not in placement phase');
            callback(false, 'Not in placement phase.');
            return;
        }

        console.log('[ClientNetworkSystem.levelSquad] calling networkRequest');
        this.networkRequest({
            eventName: 'LEVEL_SQUAD',
            responseName: 'SQUAD_LEVELED',
            data: requestData
        }, (success, result) => {
            console.log('[ClientNetworkSystem.levelSquad] networkRequest callback, success:', success, 'result:', result);
            callback(success, result);
        });
    }

    setSquadTarget(requestData, callback) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            callback(false, 'Not in placement phase.');
            return;
        }

        this.networkRequest({
            eventName: 'SET_SQUAD_TARGET',
            responseName: 'SQUAD_TARGET_SET',
            data: requestData,
            onSuccess: (result) => {
                // In multiplayer, call processSquadTarget with server's authoritative issuedTime
                if (!this.game.state.isLocalGame) {
                    this.processSquadTarget(result.placementId, result.targetPosition, result.meta, result.issuedTime);
                }
            }
        }, callback);
    }

    setSquadTargets(requestData, callback) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            callback(false, 'Not in placement phase.');
            return;
        }

        this.networkRequest({
            eventName: 'SET_SQUAD_TARGETS',
            responseName: 'SQUAD_TARGETS_SET',
            data: requestData,
            onSuccess: (result) => {
                // In multiplayer, call processSquadTargets with server's authoritative issuedTime
                if (!this.game.state.isLocalGame) {
                    this.processSquadTargets(result.placementIds, result.targetPositions, result.meta, result.issuedTime);
                }
            }
        }, callback);
    }

    transformUnit(requestData, callback) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            callback(false, 'Not in placement phase.');
            return;
        }

        this.networkRequest({
            eventName: 'TRANSFORM_UNIT',
            responseName: 'UNIT_TRANSFORMED',
            data: requestData,
            onSuccess: (result) => {
                // In multiplayer, call processTransformUnit with server's authoritative data
                if (!this.game.state.isLocalGame) {
                    this.processTransformUnit(result.entityId, result.targetUnitType, result.animationType, result.newEntityId, result.issuedTime);
                }
            }
        }, callback);
    }

    handleOpponentUnitTransformed(data) {
        const { entityId, targetUnitType, animationType, newEntityId, issuedTime } = data;
        // Use shared processTransformUnit for opponent transforms
        this.processTransformUnit(entityId, targetUnitType, animationType, newEntityId, issuedTime);
    }

    toggleReadyForBattle(team, callback) {
        // Handle optional team parameter (for backwards compatibility)
        if (typeof team === 'function') {
            callback = team;
            team = this.game.call('getActivePlayerTeam');
        }

        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            if (callback) callback(false, 'Not in placement phase.');
            return;
        }

        this.networkRequest({
            eventName: 'READY_FOR_BATTLE',
            responseName: 'READY_FOR_BATTLE_RESPONSE',
            data: { team } // Pass team to handler for proper ready state tracking
        }, callback || (() => {}));
    }

    toggleReady() {
        // Include selected level from UI (host's selection will be used) as numeric index
        const selectedLevelName = this.game.call('getSelectedLevel');
        const levelIndex = this.enums.levels?.[selectedLevelName] ?? 1;
        this.game.clientNetworkManager.call('TOGGLE_READY', { level: levelIndex });
    }

    startGame() {
        if (!this.isHost) return;
        const selectedLevelName = this.game.call('getSelectedLevel');
        const levelIndex = this.enums.levels?.[selectedLevelName] ?? 1;
        this.game.clientNetworkManager.call('START_GAME', { level: levelIndex });
    }

    leaveRoom() {
        this.game.clientNetworkManager.call('LEAVE_ROOM');
    }

    /**
     * Set myTeam from game state response (lobby join/create)
     * This ensures myTeam is available before the game scene loads
     */
    setMyTeamFromGameState(playerId, gameState) {
        if (!gameState?.players || !playerId) return;

        const myPlayer = gameState.players.find(p => p.id === playerId);
        if (myPlayer?.stats?.team !== undefined) {
            // Set active player with team so getActivePlayerTeam() works
            const numericPlayerId = this.game.clientNetworkManager?.numericPlayerId;
            if (numericPlayerId !== undefined && this.game.hasService('setActivePlayer')) {
                this.game.call('setActivePlayer', numericPlayerId, myPlayer.stats.team);
            }
        }
    }

    handlePlayerJoined(data){
        this.game.call('showNotification', `${data.playerName} joined the room`, 'info');
        this.game.call('updateLobby', data.gameState);
    }

    handlePlayerLeft(data){
        this.game.call('showNotification', 'Player left the room', 'warning');
        this.game.call('updateLobby', data.gameState);
    }

    handlePlayerReadyUpdate(data){
        this.game.call('updateLobby', data.gameState);
        // Show notification for ready state changes
        const myPlayerId = this.game.clientNetworkManager?.playerId ?? this.game.state.localPlayerId;
        if (data.playerId === myPlayerId) {
            this.game.call('showNotification',
                data.ready ? 'You are ready!' : 'Ready status removed',
                data.ready ? 'success' : 'info'
            );
        }

        if (data.allReady) {
            this.game.call('showNotification', 'All players ready! Game starting...', 'success');
        }
    }

    handleSaveDataLoaded(data) {
        // Show notification that host loaded a save file
        this.game.call('showNotification', `Save loaded: ${data.saveName}. Level: ${data.level}`, 'info', 5000);

        // Update level selector to match save
        if (data.level) {
            const levelSelect = document.getElementById('levelSelect');
            if (levelSelect) {
                levelSelect.value = data.level;
            }
        }
    }

    async handleGameStarted(data) {
        // Store the level from server (numeric index)
        const levelIndex = data.level ?? 1;
        this.game.state.level = levelIndex;

        // Check if server is sending save data (host uploaded a save file)
        if (data.isLoadingSave && data.saveData) {
            this.game.pendingSaveData = data.saveData;
        }

        // Show loading screen
        this.game.call('showLoadingScreen');

        // Load the game scene with the selected level
        // First, we need to modify the scene's terrain entity to use the selected level
        const collections = this.collections;
        const gameScene = collections?.scenes?.game;

        if (gameScene && gameScene.entities) {
            // Update terrain entity with selected level (find by prefab type)
            const terrainEntity = gameScene.entities.find(e => e.prefab === 'terrain');
            if (terrainEntity) {
                if (!terrainEntity.components) {
                    terrainEntity.components = {};
                }
                if (!terrainEntity.components.terrain) {
                    terrainEntity.components.terrain = {};
                }
                // Set level as numeric index
                terrainEntity.components.terrain.level = levelIndex;
            }
        }

        // Switch to the game scene
        await this.game.switchScene('game');

        // Sync nextEntityId from server to ensure subsequent entity creation is in sync
        if (data.nextEntityId !== undefined) {
            this.game.nextEntityId = data.nextEntityId;
        }

        // Create player entities from server (gold, upgrades, etc.)
        this.syncPlayerEntities();

        // Now initialize the game
        this.game.call('initializeGame', data);
    }

    /**
     * Sync player entities from server (gold, upgrades, etc.)
     */
    syncPlayerEntities() {
        this.game.call('getStartingState', (success, response) => {
            if (success && response.playerEntities) {
                const numericPlayerId = this.game.clientNetworkManager?.numericPlayerId;
                let myTeam = null;

                for (const playerEntity of response.playerEntities) {
                    if (!this.game.entityExists(playerEntity.entityId)) {
                        this.game.createEntity(playerEntity.entityId);
                    }
                    if (!this.game.hasComponent(playerEntity.entityId, 'playerStats')) {
                        this.game.addComponent(playerEntity.entityId, 'playerStats', playerEntity.playerStats);
                    } else {
                        // Update existing component
                        const stats = this.game.getComponent(playerEntity.entityId, 'playerStats');
                        Object.assign(stats, playerEntity.playerStats);
                    }

                    // Track our team
                    if (playerEntity.playerStats.playerId === numericPlayerId) {
                        myTeam = playerEntity.playerStats.team;
                    }
                }

                // Set active player with team now that player entities are created
                if (numericPlayerId !== undefined && myTeam !== null && this.game.hasService('setActivePlayer')) {
                    this.game.call('setActivePlayer', numericPlayerId, myTeam);

                    // Reposition camera now that we know our team
                    if (this.game.hasService('positionCameraAtStart')) {
                        this.game.call('positionCameraAtStart');
                    }
                }
            } else {
                console.error('[ClientNetworkSystem] syncPlayerEntities failed:', response);
            }
        });
    }

    handleReadyForBattleUpdate(data) {
        this.game.call('handleReadyForBattleUpdate', data);
    }

    handleBattleEnd(data) {
        // Store battle end data and wait for client to catch up to server time
        this.pendingBattleEnd = data;

        const serverTime = data.serverTime || 0;
        const clientTime = this.game.state.now || 0;

        // If client is already caught up, apply immediately
        if (clientTime >= serverTime - 0.01) { // Small tolerance for float precision
            this.applyBattleEndSync();
        } else {
            // Wait for client to catch up
            this.waitForBattleEndSync();
        }
    }

    waitForBattleEndSync() {
        if (!this.pendingBattleEnd) return;

        const serverTime = this.pendingBattleEnd.serverTime || 0;
        const clientTime = this.game.state.now || 0;

        if (clientTime >= serverTime - 0.01) {
            this.applyBattleEndSync();
        } else {
            // Check again next frame - use requestAnimationFrame in browser, setTimeout in Node.js
            if (typeof requestAnimationFrame !== 'undefined') {
                requestAnimationFrame(() => this.waitForBattleEndSync());
            } else {
                setTimeout(() => this.waitForBattleEndSync(), 16);
            }
        }
    }

    applyBattleEndSync() {
        const data = this.pendingBattleEnd;
        if (!data) return;

        this.pendingBattleEnd = null;

        // In headless/local mode, ServerBattlePhaseSystem already handles:
        // - onBattleEnd event
        // - round increment
        // - phase transition to placement
        // - onPlacementPhaseStart event
        // So we only need to do entity sync here
        if (this.game.state.isHeadlessSimulation) {
            // Just do entity sync if needed
            if (data.entitySync) {
                this.resyncEntities(data);
            }
            return;
        }

        // Unpause game if it was paused waiting for battle end
        this.game.state.isPaused = false;
        this.game.call('setBattlePaused', false);

        // Trigger onBattleEnd BEFORE resync to match server state
        // Server serializes entities AFTER onBattleEnd, so client must also
        // run onBattleEnd before comparing to have matching state
        this.game.triggerEvent('onBattleEnd');

        if (data.entitySync) {
            // Pass full data object - resyncEntities handles both entitySync and nextEntityId
            this.resyncEntities(data);
        }

        this.game.desyncDebugger.displaySync(true);
        this.game.desyncDebugger.enabled = false;
        // Update player entity gold from server state
        // In local/editor mode, clientNetworkManager doesn't exist
        const myPlayerId = this.game.clientNetworkManager?.playerId ?? this.game.state.localPlayerId;
        if (myPlayerId) {
            data.gameState?.players?.forEach((player) => {
                if(player.id == myPlayerId) {
                    // Update player entity
                    const playerStats = this.game.call('getPlayerStats', myPlayerId);
                    if (playerStats) {
                        playerStats.gold = player.stats.gold;
                    }
                }
            });
        }
        this.game.state.round += 1;
        // Transition back to placement phase
        this.game.state.phase = this.enums.gamePhase.placement;

        // Reset the engine's accumulator to prevent catchup after sync
        if (this.game.app?.resetAccumulator) {
            this.game.app.resetAccumulator();
        }

        this.game.triggerEvent('onPlacementPhaseStart');
    }

    /**
     * Resync client state with server using direct ECS data sync
     * @param {Object} syncData - Object with { entitySync (ECS data), nextEntityId }
     */
    resyncEntities(syncData) {
        const ecsData = syncData.entitySync;
        if (!ecsData) {
            return;
        }

        // DEBUG: Log playerOrder data in entity sync
        // playerOrder uses numeric arrays (not object components) for its fields
        const playerOrderKeys = Object.keys(ecsData.numericArrays || {}).filter(k => k.startsWith('playerOrder.'));
        if (playerOrderKeys.length > 0) {
            console.log('[resyncEntities] playerOrder fields in sync:', playerOrderKeys);
            // Log isHiding specifically
            const isHidingData = ecsData.numericArrays['playerOrder.isHiding'];
            if (isHidingData) {
                console.log('[resyncEntities] playerOrder.isHiding values:', JSON.stringify(isHidingData));
            }
        } else {
            console.log('[resyncEntities] NO playerOrder fields in numericArrays!');
        }

        // Apply raw ECS data directly to arrays
        this.game.applyECSData(ecsData);
    }

    compareComponents(entityId, componentType, clientData, serverData) {
        const diffs = [];

        // Compare all properties
        for (const key of Object.keys(serverData)) {
            const clientValue = clientData[key];
            const serverValue = serverData[key];

            // Skip functions for comparison
            if (typeof serverValue === 'function') continue;

            // Use tolerance for floating-point number comparisons
            if (typeof serverValue === 'number' && typeof clientValue === 'number') {
                const tolerance = 0.001;
                if (Math.abs(clientValue - serverValue) <= tolerance) {
                    continue; // Close enough, skip reporting
                }
            }

            // Compare values
            if (JSON.stringify(clientValue) !== JSON.stringify(serverValue)) {
                diffs.push({
                    property: key,
                    client: clientValue,
                    server: serverValue
                });
            }
        }

        return diffs;
    }

    logSyncDifferences(differences) {
        const hasAnyDifferences =
            differences.created.length > 0 ||
            differences.deleted.length > 0 ||
            differences.componentAdded.length > 0 ||
            differences.componentUpdated.length > 0;

        if (!hasAnyDifferences) {
            return;
        }
    }

    handleGameEnd(data) {
        // In local/editor mode, clientNetworkManager doesn't exist
        const myPlayerId = this.game.clientNetworkManager?.playerId ?? this.game.state.localPlayerId;
        const isWinner = data.result.winner === myPlayerId;
        const reason = data.result.reason || 'unknown';

        // Pause the game
        this.game.state.phase = this.enums.gamePhase.ended;
        this.game.state.isPaused = true;

        // Determine the result message based on reason
        let reasonText = '';
        switch (reason) {
            case 'buildings_destroyed':
                reasonText = isWinner ? 'You destroyed all enemy buildings!' : 'All your buildings were destroyed.';
                break;
            case 'opponent_disconnected':
                reasonText = isWinner ? 'Your opponent left the game.' : 'You disconnected from the game.';
                break;
            default:
                reasonText = isWinner ? 'Victory!' : 'Defeat!';
        }

        // Populate stats and show appropriate screen
        if (isWinner) {
            this.populateGameEndStats('victoryStats', data.result, reasonText);
            this.game.call('showVictoryScreen');
        } else {
            this.populateGameEndStats('defeatStats', data.result, reasonText);
            this.game.call('showDefeatScreen');
        }
    }

    populateGameEndStats(containerId, result, reasonText) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // In local/editor mode, clientNetworkManager doesn't exist
        const myPlayerId = this.game.clientNetworkManager?.playerId ?? this.game.state.localPlayerId;
        const myStats = result.finalStats?.[myPlayerId];
        const totalRounds = result.totalRounds || this.game.state.round || 1;

        container.innerHTML = `
            <div class="stat-item">
                <span class="stat-label">Result</span>
                <span class="stat-value">${reasonText}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Rounds Played</span>
                <span class="stat-value">${totalRounds}</span>
            </div>
            ${myStats ? `
            <div class="stat-item">
                <span class="stat-label">Final Gold</span>
                <span class="stat-value">${myStats.stats?.gold || 0}</span>
            </div>
            ` : ''}
        `;
    }

    handleAllPlayersLeft(data) {
        // Show modal that all players have left
        this.showGameEndedModal(data.message || 'All other players have left the game.');
    }

    showGameEndedModal(message) {
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'gameEndedModal';
        modal.style.cssText = `
            display: flex;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 5000;
            justify-content: center;
            align-items: center;
        `;

        modal.innerHTML = `
            <div style="background: #1a1a1a; padding: 2.5rem; border: 3px solid #cc3333; border-radius: 10px; color: white; min-width: 450px; text-align: center;">
                <h2 style="color: #ff6666; margin-bottom: 1.5rem; font-size: 1.8rem;">Game Over</h2>
                <p style="color: #ccc; font-size: 1.2rem; margin-bottom: 2rem;">${message}</p>
                <button id="gameEndedLeaveBtn" style="padding: 1rem 2rem; background: #cc3333; border: none; color: white; cursor: pointer; border-radius: 5px; font-size: 1.1rem; font-weight: bold; transition: background 0.2s;">
                    Leave Game
                </button>
            </div>
        `;

        document.body.appendChild(modal);

        // Add click handler to leave button
        const leaveBtn = document.getElementById('gameEndedLeaveBtn');
        leaveBtn.addEventListener('click', () => {
            modal.remove();
            this.game.call('leaveGame');
        });

        // Add hover effect
        leaveBtn.addEventListener('mouseenter', () => {
            leaveBtn.style.background = '#dd4444';
        });
        leaveBtn.addEventListener('mouseleave', () => {
            leaveBtn.style.background = '#cc3333';
        });
    }

    handleRoundResult(roundResult) {
        const state = this.game.state;
        state.phase = this.enums.gamePhase.ended;
    }

    handleOpponentSquadTarget(data) {
        const { placementId, targetPosition, meta, issuedTime } = data;
        console.log(`[ClientNetworkSystem] handleOpponentSquadTarget: placementId=${placementId}, meta=${JSON.stringify(meta)}`);
        // Use shared processSquadTarget for opponent actions too
        this.processSquadTarget(placementId, targetPosition, meta, issuedTime);
    }

    handleOpponentSquadTargets(data) {
        const { placementIds, targetPositions, meta, issuedTime } = data;
        console.log(`[ClientNetworkSystem] handleOpponentSquadTargets: placementIds=${JSON.stringify(placementIds)}, meta=${JSON.stringify(meta)}`);
        // Use shared processSquadTargets for opponent actions too
        this.processSquadTargets(placementIds, targetPositions, meta, issuedTime);
    }

    syncWithServerState(data) {
        if (!data.gameState) return;
        const gameState = data.gameState;

        // Sync basic game state
        if (gameState.round !== undefined) {
            this.game.state.round = gameState.round;
        }
        if (gameState.phase !== undefined) {
            this.game.state.phase = gameState.phase;
        }

        // Legacy multiplayer sync (when server sends players array from room)
        // This is used in lobby/multiplayer - local game uses ECS entities directly
        if (gameState.players && this.game.clientNetworkManager) {
            const myPlayerId = this.game.clientNetworkManager.playerId;
            const myPlayer = gameState.players.find(p => p.id === myPlayerId);

            // Only update player entities if PlayerStatsSystem is loaded (in game scene, not lobby)
            if (this.game.hasService('getPlayerEntityId')) {
                for (const playerData of gameState.players) {
                    const playerEntityId = this.game.call('getPlayerEntityId', playerData.id);

                    if (this.game.entityExists(playerEntityId)) {
                        // Update existing player entity
                        const stats = this.game.getComponent(playerEntityId, 'playerStats');
                        if (stats && playerData.stats) {
                            stats.gold = playerData.stats.gold;
                            stats.side = playerData.stats.team;
                        }
                    }
                }
            }

            if (myPlayer) {
                // Set active player with team so getActivePlayerTeam() works
                // Use numeric player ID (not socket ID) for ECS lookups
                const numericPlayerId = this.game.clientNetworkManager?.numericPlayerId;
                if (myPlayer.stats?.team !== undefined && numericPlayerId !== undefined && this.game.hasService('setActivePlayer')) {
                    this.game.call('setActivePlayer', numericPlayerId, myPlayer.stats.team);
                }

                const opponent = gameState.players.find(p => p.id !== myPlayerId);

                // Sync experience for both player and opponent network unit data
                if (myPlayer.networkUnitData) {
                    this.syncNetworkUnitDataExperience(myPlayer.networkUnitData);
                }
                if (opponent?.networkUnitData) {
                    this.syncNetworkUnitDataExperience(opponent.networkUnitData);
                }
            }
        }

        // Update UI
        if (this.game.hasService('updateGoldDisplay')) {
            this.game.call('updateGoldDisplay');
        }
    }

    /**
     * Sync experience data from network unit data
     * NetworkUnitData includes experience info that needs to be applied to local squads
     * @param {Array} networkUnitData - Array of network unit data objects with experience data
     */
    syncNetworkUnitDataExperience(networkUnitData) {
        if (!networkUnitData) return;

        for (const unitData of networkUnitData) {
            if (unitData.experience) {
                this.game.call('setSquadInfo', unitData.placementId, unitData.experience);
            }
        }
    }

    // ==================== CHEAT NETWORK HANDLING ====================

    /**
     * Send cheat request to server
     */
    sendCheatRequest(cheatName, params, callback) {
        this.game.clientNetworkManager.call(
            'EXECUTE_CHEAT',
            { cheatName, params },
            'CHEAT_EXECUTED',
            (data, error) => {
                if (error) {
                    if (callback) callback(false, error);
                } else if (data.error) {
                    if (callback) callback(false, data.error);
                } else {
                    if (callback) callback(true, data);
                }
            }
        );
    }

    /**
     * Handle cheat broadcast from server - execute on client using shared processCheat
     */
    handleCheatBroadcast(data) {
        const { cheatName, params, result } = data;

        // Merge server result (contains entity IDs) into params
        const mergedParams = { ...params, ...result };

        // Execute the cheat locally using shared processCheat
        this.processCheat(cheatName, mergedParams);
    }

    dispose() {
        this.networkUnsubscribers.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this.networkUnsubscribers = [];
    }

    onSceneUnload() {
        // Note: Don't call dispose() here as we want to keep network listeners
        // active across scene transitions. Only reset game-specific state.

        // Reset game state tracking
        this.gameState = null;
        this.pendingBattleEnd = null;

        // Remove any game ended modals (only in browser environment)
        if (typeof document !== 'undefined') {
            const gameEndedModal = document.getElementById('gameEndedModal');
            if (gameEndedModal) {
                gameEndedModal.remove();
            }
        }
    }
}
