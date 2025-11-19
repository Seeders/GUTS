class MultiplayerNetworkManager {
    constructor(game) {
        this.game = game;
        this.game.networkManager = this;
        
        // State tracking
        this.roomId = null;
        this.isHost = false;
        this.gameState = null;
        // Store unsubscribe functions
        this.networkUnsubscribers = [];
    }

    // GUTS Manager Interface
    init(params) {
        this.params = params || {};
        this.connectToServer();        
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
                        this.game.uiSystem.showNotification('Failed to get player ID from server', 'error');
                    } else if (data && data.playerId) {
                        this.game.clientNetworkManager.playerId = data.playerId;
                        this.game.state.playerId = data.playerId;
                    } else {
                        console.error('Server response missing player ID:', data);
                        this.game.uiSystem.showNotification('Server did not provide player ID', 'error');
                    }
                }
            );
            
        } catch (error) {
            console.error('Failed to connect to server:', error);
            this.game.uiSystem.showNotification('Failed to connect to server', 'error');
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
            

            nm.listen('OPPONENT_BUILDING_CANCELLED', (data) => {
                this.handleOpponentBuildingCancelled(data);
            })
        );
    }

    createRoom(playerName, maxPlayers = 2) {
        this.game.uiSystem.showNotification('Creating room...', 'info');
        
        this.game.clientNetworkManager.call(
            'CREATE_ROOM',
            { playerName, maxPlayers },
            'ROOM_CREATED',
            (data, error) => {
                if (error) {
                    this.game.uiSystem.showNotification(`Failed to create room: ${error.message}`, 'error');
                } else {
                    this.roomId = data.roomId;
                    this.isHost = data.isHost;
                    this.gameState = data.gameState;
                    this.game.uiSystem.showNotification(`Room created! Code: ${this.roomId}`, 'success');
                    this.game.uiSystem.showLobby(data.gameState, this.roomId);
                }
            }
        );
    }

    joinRoom(roomId, playerName) {
        this.game.uiSystem.showNotification('Joining room...', 'info');
        
        this.game.clientNetworkManager.call(
            'JOIN_ROOM',
            { roomId, playerName },
            'ROOM_JOINED',
            (data, error) => {
                if (error) {
                    this.game.uiSystem.showNotification(`Failed to join room: ${error.message}`, 'error');
                } else {
                    this.roomId = data.roomId;
                    this.isHost = data.isHost;
                    this.gameState = data.gameState;
                    this.game.uiSystem.showNotification(`Joined room ${this.roomId}`, 'success');
                    this.game.uiSystem.showLobby(data.gameState, this.roomId);
                }
            }
        );
    }

    startQuickMatch(playerName) {
        this.game.uiSystem.showNotification('Finding opponent...', 'info');
        
        this.game.clientNetworkManager.call(
            'QUICK_MATCH',
            { playerName },
            'QUICK_MATCH_FOUND',
            (data, error) => {
                if (error) {
                    this.game.uiSystem.showNotification(`Quick match failed: ${error.message}`, 'error');
                } else {
                    this.roomId = data.roomId;
                    this.isHost = data.isHost;
                    this.gameState = data.gameState;
                    this.game.uiSystem.showNotification(`Match found! Entering room...`, 'success');
                    this.game.uiSystem.showLobby(data.gameState, this.roomId);
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
                if (data.error) {
                    console.log('getStartingState error:', data.error);
                    callback(false, error);
                } else {
                    console.log('getStartingState response:', data);
                    callback(true, data);
                }
            }
        );
    }

    submitPlacement(placement, callback){
        if(this.game.state.phase != "placement") {
            callback(false, 'Not in placement phase.');
        };
        this.game.clientNetworkManager.call(
            'SUBMIT_PLACEMENT',
            { placement },
            'SUBMITTED_PLACEMENT',
            (data, error) => {           
                if (data.error) {
                    console.log('Placement error:', data.error);
                    callback(false, error);
                } else {
                    console.log('Placement response:', data);
                    callback(true, data);
                }
            }
        );
    }

    cancelBuilding(data, callback) {
        if (this.game.state.phase !== 'placement') {
            callback(false, 'Not in placement phase.');
            return;
        }
        
        this.game.clientNetworkManager.call(
            'CANCEL_BUILDING',
            data,
            'BUILDING_CANCELLED',
            (data, error) => {
                if (error || data.error) {
                    console.log('Cancel building error:', error || data.error);
                    callback(false, error || data.error);
                } else {
                    console.log('Cancel building response:', data);
                    callback(true, data);
                }
            }
        );
    }

    handleOpponentBuildingCancelled(data) {
        const { placementId, side } = data;
        
        if (this.game.placementSystem && this.game.placementSystem.removeOpponentPlacement) {
            this.game.placementSystem.removeOpponentPlacement(placementId);
            this.game.uiSystem?.showNotification('Opponent cancelled a building', 'info', 1500);
        }
    }
    
    purchaseUpgrade(data, callback){
        if(this.game.state.phase != "placement") {
            callback(false, 'Not in placement phase.');
        };
        this.game.clientNetworkManager.call(
            'PURCHASE_UPGRADE',
            { data },
            'PURCHASED_UPGRADE',
            (data, error) => {           
                if (data.error) {
                    console.log('Purchase error:', data.error);
                    callback(false, error);
                } else {
                    console.log('Purchase response:', data);
                    callback(true, data);
                }
            }
        );
    }

    setSquadTarget(data, callback) {
        if(this.game.state.phase != "placement") {
            callback(false, 'Not in placement phase.');
        };
        this.game.clientNetworkManager.call(
            'SET_SQUAD_TARGET',
            data,
            'SQUAD_TARGET_SET',
            (data, error) => {
                if (error || data.error) {
                    console.log('Set target error:', error || data.error);
                    callback(false, error || data.error);
                } else {
                    console.log('Set target response:', data);
                    callback(true, data);
                }
            }
        );
    }

    setSquadTargets(data, callback) {
        if(this.game.state.phase != "placement") {
            callback(false, 'Not in placement phase.');
        };
        this.game.clientNetworkManager.call(
            'SET_SQUAD_TARGETS',
            data,
            'SQUAD_TARGETS_SET',
            (data, error) => {
                if (error || data.error) {
                    console.log('Set target error:', error || data.error);
                    callback(false, error || data.error);
                } else {
                    console.log('Set target response:', data);
                    callback(true, data);
                }
            }
        );
    }

    toggleReadyForBattle(callback) {
        if(this.game.state.phase != "placement") {
            callback(false, 'Not in placement phase.');
        };
        this.game.clientNetworkManager.call(
            'READY_FOR_BATTLE',
            {},
            'READY_FOR_BATTLE_RESPONSE',
            (data, error) => {                                
                if (data.error) {
                    console.log('Battle ready state error:', data.error);
                    callback(false, data.error);
                } else {
                    console.log('Battle ready state updated:', data);
                    callback(true, data);
                }
            }
        );
    }

    toggleReady() {
        this.game.clientNetworkManager.call('TOGGLE_READY');
    }

    startGame() {
        if (!this.isHost) return;
        this.game.clientNetworkManager.call('START_GAME');
    }

    leaveRoom() {
        this.game.clientNetworkManager.call('LEAVE_ROOM');
    }

    handlePlayerJoined(data){

        this.game.uiSystem.showNotification(`${data.playerName} joined the room`, 'info');
        this.game.uiSystem.updateLobby(data.gameState);
    }

    handlePlayerLeft(data){

        this.game.uiSystem.showNotification('Player left the room', 'warning');
        this.game.uiSystem.updateLobby(data.gameState);
    }

    handlePlayerReadyUpdate(data){

        this.game.uiSystem.updateLobby(data.gameState);
        console.log('handlePlayerReadyUpdate', data);
        // Show notification for ready state changes
        const myPlayerId = this.game.clientNetworkManager.playerId;
        if (data.playerId === myPlayerId) {
            if(!data.ready){
                console.log("not ready", data);
            }
            this.game.uiSystem.showNotification(
                data.ready ? 'You are ready!' : 'Ready status removed',
                data.ready ? 'success' : 'info'
            );
        }
        
        if (data.allReady) {
            this.game.uiSystem.showNotification('All players ready! Game starting...', 'success');
        }
    }

    handleGameStarted(data){
        this.game.gameManager.initializeGame(data);
    }

    handleReadyForBattleUpdate(data) {
        this.game.placementSystem.handleReadyForBattleUpdate(data);
    }

    handleBattleEnd(data) {
        // Store battle end data and wait for client to catch up to server time
        this.pendingBattleEnd = data;

        const serverTime = data.serverTime || 0;
        const clientTime = this.game.state.now || 0;

        console.log(`Battle end received. Server time: ${serverTime.toFixed(3)}, Client time: ${clientTime.toFixed(3)}`);

        // If client is already caught up, apply immediately
        if (clientTime >= serverTime - 0.01) { // Small tolerance for float precision
            this.applyBattleEndSync();
        } else {
            // Wait for client to catch up
            console.log(`Waiting for client to catch up... (${(serverTime - clientTime).toFixed(3)}s behind)`);
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
            // Check again next frame
            requestAnimationFrame(() => this.waitForBattleEndSync());
        }
    }

    applyBattleEndSync() {
        const data = this.pendingBattleEnd;
        if (!data) return;

        this.pendingBattleEnd = null;

        // Unpause game if it was paused waiting for battle end
        this.game.state.isPaused = false;
        if (this.game.placementSystem) {
            this.game.placementSystem.isBattlePaused = false;
        }

        console.log(`Applying battle end sync at client time: ${this.game.state.now?.toFixed(3)}`);

        if (data.entitySync) {
            this.resyncEntities(data.entitySync);
        }
        this.game.triggerEvent('onBattleEnd');
        console.log('battle result', data);
        this.game.desyncDebugger.displaySync(true);
        this.game.desyncDebugger.enabled = false;
        const myPlayerId = this.game.clientNetworkManager.playerId;
        data.gameState?.players?.forEach((player) => {
            if(player.id == myPlayerId) {
                this.game.state.playerGold = player.stats.gold;
            }
        })
        this.game.state.round += 1;
        // Transition back to placement phase
        this.game.state.phase = 'placement';
        this.game.triggerEvent('onPlacementPhaseStart');
    }

    resyncEntities(entitySync) {
        const differences = {
            created: [],
            deleted: [],
            updated: [],
            componentAdded: [],
            componentUpdated: []
        };

        // Get all server entity IDs
        const serverEntityIds = new Set(Object.keys(entitySync));

        // Get all client entity IDs (only those with components we care about)
        const clientEntityIds = new Set();
        for (const [entityId] of this.game.entities) {
            clientEntityIds.add(entityId);
        }

        // Find entities to create (exist on server but not client)
        const entitiesToCreate = [];
        for (const entityId of serverEntityIds) {
            if (!clientEntityIds.has(entityId)) {
                entitiesToCreate.push(entityId);
            }
        }

        // Find entities to delete (exist on client but not server)
        // Skip entities marked as CLIENT_ONLY - they only exist on client
        const entitiesToDelete = [];
        for (const entityId of clientEntityIds) {
            if (!serverEntityIds.has(entityId)) {
                // Check if entity is marked as client-only
                const isClientOnly = this.game.hasComponent(entityId, "CLIENT_ONLY");
                if (!isClientOnly) {
                    entitiesToDelete.push(entityId);
                }
            }
        }

        // Create missing entities
        for (const entityId of entitiesToCreate) {
            try {
                // Create the entity with the same ID
                this.game.createEntity(entityId);

                // Add all components from server
                const components = entitySync[entityId];
                for (const [componentType, componentData] of Object.entries(components)) {
                    this.game.addComponent(entityId, componentType, JSON.parse(JSON.stringify(componentData)));
                }

                differences.created.push({
                    entityId,
                    components: Object.keys(components)
                });
            } catch (error) {
                console.error(`Failed to create entity ${entityId}:`, error);
            }
        }

        // Delete extra entities
        for (const entityId of entitiesToDelete) {
            try {
                this.game.destroyEntity(entityId);
                differences.deleted.push(entityId);
            } catch (error) {
                console.error(`Failed to delete entity ${entityId}:`, error);
            }
        }

        // Update existing entities
        for (const [entityId, components] of Object.entries(entitySync)) {
            // Skip entities we just created
            if (entitiesToCreate.includes(entityId)) continue;

            for (const [componentType, componentData] of Object.entries(components)) {
                if (this.game.hasComponent(entityId, componentType)) {
                    // Update existing component
                    const existing = this.game.getComponent(entityId, componentType);
                    const componentDiffs = this.compareComponents(entityId, componentType, existing, componentData);

                    if (componentDiffs.length > 0) {
                        differences.componentUpdated.push({
                            entityId,
                            componentType,
                            diffs: componentDiffs
                        });
                    }

                    Object.assign(existing, componentData);
                } else {
                    // Add missing component
                    try {
                        this.game.addComponent(entityId, componentType, JSON.parse(JSON.stringify(componentData)));
                        differences.componentAdded.push({
                            entityId,
                            componentType
                        });
                    } catch (error) {
                        console.error(`Failed to add component ${componentType} to ${entityId}:`, error);
                    }
                }
            }
        }

        // Log all differences
        this.logSyncDifferences(differences);
    }

    compareComponents(entityId, componentType, clientData, serverData) {
        const diffs = [];

        // Skip visual-only properties for environment objects (trees, rocks, etc.)
        // These have floating-point precision differences that don't affect gameplay
        const isEnvironmentObject = entityId.startsWith('env_');
        const visualOnlyProperties = ['scale', 'rotation', 'angle'];

        // Compare all properties
        for (const key of Object.keys(serverData)) {
            const clientValue = clientData[key];
            const serverValue = serverData[key];

            // Skip functions and complex objects for comparison
            if (typeof serverValue === 'function') continue;

            // Skip visual-only properties for environment objects
            if (isEnvironmentObject && visualOnlyProperties.includes(key)) {
                continue;
            }

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
            console.log('%c[SYNC] No differences found - client and server are in sync!', 'color: green');
            return;
        }

        console.log('%c[SYNC] State differences detected:', 'color: orange; font-weight: bold');

        // Log created entities
        if (differences.created.length > 0) {
            console.group('%c[SYNC] Entities created on client (missing from client):', 'color: cyan');
            for (const item of differences.created) {
                console.log(`  + ${item.entityId} [${item.components.join(', ')}]`);
            }
            console.groupEnd();
        }

        // Log deleted entities
        if (differences.deleted.length > 0) {
            console.group('%c[SYNC] Entities deleted from client (extra on client):', 'color: red');
            for (const entityId of differences.deleted) {
                console.log(`  - ${entityId}`);
            }
            console.groupEnd();
        }

        // Log added components
        if (differences.componentAdded.length > 0) {
            console.group('%c[SYNC] Components added to entities:', 'color: cyan');
            for (const item of differences.componentAdded) {
                console.log(`  + ${item.entityId}.${item.componentType}`);
            }
            console.groupEnd();
        }

        // Log updated components with details
        if (differences.componentUpdated.length > 0) {
            console.group('%c[SYNC] Components updated with different values:', 'color: yellow');
            for (const item of differences.componentUpdated) {
                console.group(`  ~ ${item.entityId}.${item.componentType}`);
                for (const diff of item.diffs) {
                    const clientStr = JSON.stringify(diff.client);
                    const serverStr = JSON.stringify(diff.server);
                    console.log(`    ${diff.property}: ${clientStr} -> ${serverStr}`);
                }
                console.groupEnd();
            }
            console.groupEnd();
        }

        // Summary
        console.log(`%c[SYNC] Summary: ${differences.created.length} created, ${differences.deleted.length} deleted, ${differences.componentAdded.length} components added, ${differences.componentUpdated.length} components updated`, 'color: orange');
    }

    handleGameEnd(data) {
        const myPlayerId = this.game.clientNetworkManager.playerId;
        if (data.result.winner === myPlayerId) {
            this.game.uiSystem.showNotification('GAME WON! Congratulations!', 'success');
        } else {
            this.game.uiSystem.showNotification('Game lost. Better luck next time!', 'warning');
        }
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
            if (this.game.uiSystem && this.game.uiSystem.leaveGame) {
                this.game.uiSystem.leaveGame();
            }
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
        state.phase = 'ended';      
    }

    handleOpponentSquadTarget(data) {
        const { placementId, targetPosition, meta } = data;
        this.game.unitOrderSystem.applySquadTargetPosition(placementId, targetPosition, meta);        
    }

    handleOpponentSquadTargets(data) {
        const { placementIds, targetPositions, meta } = data;
        this.game.unitOrderSystem.applySquadsTargetPositions(placementIds, targetPositions, meta);        
    }

    syncWithServerState(data) {
        if(!data.gameState) return;
        const gameState = data.gameState;
        if (!gameState.players) return;
        console.log('sync with server', gameState);
        const myPlayerId = this.game.clientNetworkManager.playerId;
        const myPlayer = gameState.players.find(p => p.id === myPlayerId);
        
        if (myPlayer) {
            // Sync squad count and side
            if (this.game.state) {
                this.game.state.mySide = myPlayer.stats.side;
                this.game.state.playerGold = myPlayer.stats.gold;
                this.game.state.playerHealth = myPlayer.stats.health;
                this.game.state.round = gameState.round;
                this.game.state.serverGameState = gameState;
            }
            
            // Set team sides in grid system
            const opponent = gameState.players.find(p => p.id !== myPlayerId);
            if (opponent && this.game.gridSystem) {
                this.game.gridSystem.setTeamSides({
                    player: myPlayer.stats.side,
                    enemy: opponent.stats.side
                });
            }
            
            // Also set sides in placement system
            if (this.game.placementSystem ) {
                if(this.game.placementSystem.setTeamSides) {
                
                    this.game.placementSystem.setTeamSides({
                        player: myPlayer.stats.side,
                        enemy: opponent.stats.side
                    });
                }

                this.game.placementSystem.setPlacementExperience(myPlayer.placements);
            }

                
            // Update UI to reflect synced experience data
            if (this.game.shopSystem && this.game.shopSystem.updateGoldDisplay) {
                this.game.shopSystem.updateGoldDisplay();
            }
            
        }
    }
 
    dispose() {
        this.networkUnsubscribers.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this.networkUnsubscribers = [];
        
    }

         
}