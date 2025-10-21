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
            nm.listen('READY_FOR_BATTLE_UPDATE', (data) => {
                this.syncWithServerState(data);   
                this.handleReadyForBattleUpdate(data);
            }),

            nm.listen('BATTLE_END', (data) => {
                this.syncWithServerState(data);   
                this.handleBattleEnd(data);
            }),

            nm.listen('NEXT_ROUND', (data) => {
                this.syncWithServerState(data);   
                this.handleNextRound(data);
            }),

            nm.listen('GAME_END', (data) => {
                this.syncWithServerState(data);        
                this.handleGameEnd(data);
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

    purchaseBuilding(data, callback){
        this.game.clientNetworkManager.call(
            'PURCHASE_BUILDING',
            { data },
            'PURCHASED_BUILDING',
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

    purchaseUpgrade(data, callback){
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

    toggleReadyForBattle(callback) {
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
        this.game.uiSystem.transitionToGame(data);
    }

    handleReadyForBattleUpdate(data) {
        this.game.placementSystem.handleReadyForBattleUpdate(data);
    }

    handleBattleEnd(data) {
        const myPlayerId = this.game.clientNetworkManager.playerId;
        let winningSide = this.game.state.mySide;
        if (data.result.winner === myPlayerId) {
            this.game.uiSystem.showNotification('Victory! You won this round!', 'success');
        } else {
            winningSide = winningSide == "left" ? "right" : "left";
            this.game.uiSystem.showNotification('Defeat! Better luck next round!', 'warning');
        }
        console.log('battle result', data);

        if(data.result?.survivingUnits){
            let winningUnits = data.result.survivingUnits[data.result.winner];                
            this.game.teamHealthSystem?.applyRoundDamage(winningSide, winningUnits);                        

            if(winningUnits && winningUnits.length > 0 ){
                this.game.uiSystem.startVictoryCelebration(winningUnits);
            }
        }

        if (data.entitySync) {
            this.resyncEntities(data.entitySync);
        }
    }

    resyncEntities(entitySync) {

        for (const [entityId, components] of Object.entries(entitySync)) {
        
            
            for (const [componentType, componentData] of Object.entries(components)) {
                if (this.game.hasComponent(entityId, componentType)) {
                    const existing = this.game.getComponent(entityId, componentType);
                    Object.assign(existing, componentData);
                } 
            }
        }
        
    }

    handleNextRound(data) {
        const myPlayerId = this.game.clientNetworkManager.playerId;
        this.gameState = data.gameState;
        data.gameState?.players?.forEach((player) => {
            if(player.id == myPlayerId) {
                this.game.state.playerGold = player.stats.gold;
            }
        })
        this.game.uiSystem.startPlacementPhase();
    }

    handleGameEnd(data) {
        const myPlayerId = this.game.clientNetworkManager.playerId;
        if (data.result.winner === myPlayerId) {
            this.game.uiSystem.showNotification('GAME WON! Congratulations!', 'success');
        } else {
            this.game.uiSystem.showNotification('Game lost. Better luck next time!', 'warning');
        }
    }
 
    handleRoundResult(roundResult) {
        const state = this.game.state;
        state.phase = 'ended';      
    }

    handleOpponentSquadTarget(data) {
        const { placementId, targetPosition } = data;
        this.game.placementSystem.applySquadTargetPosition(placementId, targetPosition);        
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
                this.game.state.squadsPlacedThisRound = myPlayer.squadsPlaced || 0;
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
                this.game.shopSystem.createShop(); // Refresh experience panels
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