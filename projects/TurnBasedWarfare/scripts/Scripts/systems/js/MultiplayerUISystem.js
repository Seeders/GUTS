class MultiplayerUISystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.uiSystem = this;
        
        // State tracking
        this.currentScreen = null;
        this.roomId = null;
        this.isHost = false;
        this.gameState = null;
        this.config = {
            maxSquadsPerRound: 2,
            maxCombinationsToCheck: 1000,
            unitPlacementDelay: 200,
            enablePreview: true,
            enableUndo: true,
            enableGridSnapping: true,
            mouseMoveThrottle: 16,
            validationThrottle: 32,
            raycastThrottle: 16
        };
        // Store unsubscribe functions
        this.networkUnsubscribers = [];
    }

    // GUTS Manager Interface
    init(params) {
        this.params = params || {};
        this.initializeUI();
        this.enhanceGameModeManager();
        // Connect to server and get player ID
        this.connectToServer();
        
        this.setupNetworkListeners();
        this.setupEventListeners();
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
                        this.showNotification('Failed to get player ID from server', 'error');
                    } else if (data && data.playerId) {
                        this.game.clientNetworkManager.playerId = data.playerId;
                    } else {
                        console.error('Server response missing player ID:', data);
                        this.showNotification('Server did not provide player ID', 'error');
                    }
                }
            );
            
        } catch (error) {
            console.error('Failed to connect to server:', error);
            this.showNotification('Failed to connect to server', 'error');
        }
    }

    initializeUI() {
        // Add multiplayer UI elements to existing interface
        const multiplayerHTML = `
            <div id="multiplayerHUD" style="display: none; position: absolute; top: 10px; right: 330px; z-index: 1000;">
                <div class="opponent-info">
                    <h4>Opponent</h4>
                    <div class="opponent-stats">
                        <div>Name: <span id="opponentName">-</span></div>
                        <div>Health: <span id="opponentHealth">100</span></div>
                        <div>Gold: <span id="opponentGold">-</span></div>
                    </div>
                </div>
            </div>
            
            <div id="multiplayerNotifications" style="position: fixed; top: 50px; left: 50%; transform: translateX(-50%); z-index: 2000;">
                <!-- Notifications appear here -->
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', multiplayerHTML);
    }

    enhanceGameModeManager() {
        // Add multiplayer modes to existing GameModeManager
        if (this.game.gameModeManager) {
            const originalModes = this.game.gameModeManager.modes || {};
            
            const multiplayerModes = {
                multiplayer_1v1: {
                    id: 'multiplayer_1v1',
                    title: '1v1 Multiplayer',
                    icon: 'swords',
                    description: 'Battle against another player in real-time strategic combat',
                    difficulty: 'Player vs Player',
                    difficultyClass: 'pvp',
                    startingGold: 100,
                    maxRounds: 5,
                    goldMultiplier: 1.0,
                    difficultyScaling: 'player',
                    isMultiplayer: true,
                    maxPlayers: 2
                },
                multiplayer_quick: {
                    id: 'multiplayer_quick',
                    title: 'Quick Match',
                    icon: 'lightning',
                    description: 'Find a random opponent and battle immediately',
                    difficulty: 'Player vs Player',
                    difficultyClass: 'pvp',
                    startingGold: 100,
                    maxRounds: 3,
                    goldMultiplier: 1.0,
                    difficultyScaling: 'player',
                    isMultiplayer: true,
                    maxPlayers: 2
                }
            };
            
            this.game.gameModeManager.modes = { ...originalModes, ...multiplayerModes };
            
            const originalSelectMode = this.game.gameModeManager.selectMode.bind(this.game.gameModeManager);
            this.game.gameModeManager.selectMode = (modeId) => {
                originalSelectMode(modeId);
                const mode = this.game.gameModeManager.modes[modeId];
                if (mode && mode.isMultiplayer) {
                    this.handleMultiplayerModeSelection(mode);
                }
            };
            
            if (this.game.gameModeManager.setupUI) {
                this.game.gameModeManager.setupUI();
            }
        }
    }

    handleMultiplayerModeSelection(mode) {
        // Create setup dialog for multiplayer
        const setupDialog = document.createElement('div');
        setupDialog.className = 'multiplayer-setup-dialog';
        setupDialog.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.9); display: flex; justify-content: center;
            align-items: center; z-index: 10000;
        `;
        
        setupDialog.innerHTML = `
            <div class="setup-content" style="background: #1a1a1a; padding: 2rem; border: 2px solid #444; border-radius: 10px; text-align: center; color: white;">
                <h2>${mode.title}</h2>
                <p>${mode.description}</p>
                
                <div class="player-name-input" style="margin: 1rem 0;">
                    <label for="playerName">Your Name:</label><br>
                    <input type="text" id="playerName" placeholder="Enter your name" maxlength="20" value="Player" 
                           style="padding: 0.5rem; margin: 0.5rem; border: 1px solid #666; background: #333; color: white;">
                </div>
                
                <div class="multiplayer-options" style="margin: 1.5rem 0;">
                    ${mode.id === 'multiplayer_quick' ? `
                        <button id="quickMatchBtn" class="btn btn-primary" style="padding: 0.75rem 1.5rem; margin: 0.5rem; background: #0066cc; border: none; color: white; cursor: pointer; border-radius: 5px;">Find Match</button>
                    ` : `
                        <button id="createRoomBtn" class="btn btn-primary" style="padding: 0.75rem 1.5rem; margin: 0.5rem; background: #0066cc; border: none; color: white; cursor: pointer; border-radius: 5px;">Create Room</button><br>
                        <div class="room-join-section" style="margin-top: 1rem;">
                            <input type="text" id="roomIdInput" value="1000" placeholder="Enter Room ID" maxlength="6" 
                                   style="padding: 0.5rem; border: 1px solid #666; background: #333; color: white;">
                            <button id="joinRoomBtn" class="btn btn-secondary" 
                                    style="padding: 0.5rem 1rem; margin-left: 0.5rem; background: #666; border: none; color: white; cursor: pointer; border-radius: 5px;">Join Room</button>
                        </div>
                    `}
                </div>
                
                <button id="cancelMultiplayerBtn" class="btn btn-secondary" 
                        style="padding: 0.5rem 1rem; background: #666; border: none; color: white; cursor: pointer; border-radius: 5px;">Cancel</button>
            </div>
        `;

        document.body.appendChild(setupDialog);
        this.setupMultiplayerDialogEvents(setupDialog, mode);
    }

    setupMultiplayerDialogEvents(dialog, mode) {
        const playerNameInput = dialog.querySelector('#playerName');
        const quickMatchBtn = dialog.querySelector('#quickMatchBtn');
        const createRoomBtn = dialog.querySelector('#createRoomBtn');
        const joinRoomBtn = dialog.querySelector('#joinRoomBtn');
        const roomIdInput = dialog.querySelector('#roomIdInput');
        const cancelBtn = dialog.querySelector('#cancelMultiplayerBtn');

        const getPlayerName = () => playerNameInput.value.trim() || 'Player';

        if (quickMatchBtn) {
            quickMatchBtn.addEventListener('click', () => {
                this.startQuickMatch(getPlayerName());
                dialog.remove();
            });
        }

        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', () => {
                this.createRoom(getPlayerName(), mode.maxPlayers);
                dialog.remove();
            });
        }

        if (joinRoomBtn) {
            joinRoomBtn.addEventListener('click', () => {
                const roomId = roomIdInput.value.trim().toUpperCase();
                if (roomId) {
                    this.joinRoom(roomId, getPlayerName());
                    dialog.remove();
                } else {
                    this.showNotification('Please enter a Room ID', 'error');
                }
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                dialog.remove();
            });
        }

        playerNameInput.focus();
        playerNameInput.select();
    }

    // =============================================
    // NETWORK ACTIONS (USING .call())
    // =============================================

    createRoom(playerName, maxPlayers = 2) {
        this.showNotification('Creating room...', 'info');
        
        this.game.clientNetworkManager.call(
            'CREATE_ROOM',
            { playerName, maxPlayers },
            'ROOM_CREATED',
            (data, error) => {
                if (error) {
                    this.showNotification(`Failed to create room: ${error.message}`, 'error');
                } else {
                    this.roomId = data.roomId;
                    this.isHost = data.isHost;
                    this.gameState = data.gameState;
                    this.showNotification(`Room created! Code: ${this.roomId}`, 'success');
                    this.showLobby(data.gameState);
                }
            }
        );
    }

    joinRoom(roomId, playerName) {
        this.showNotification('Joining room...', 'info');
        
        this.game.clientNetworkManager.call(
            'JOIN_ROOM',
            { roomId, playerName },
            'ROOM_JOINED',
            (data, error) => {
                if (error) {
                    this.showNotification(`Failed to join room: ${error.message}`, 'error');
                } else {
                    this.roomId = data.roomId;
                    this.isHost = data.isHost;
                    this.gameState = data.gameState;
                    this.showNotification(`Joined room ${this.roomId}`, 'success');
                    this.showLobby(data.gameState);
                }
            }
        );
    }

    startQuickMatch(playerName) {
        this.showNotification('Finding opponent...', 'info');
        
        this.game.clientNetworkManager.call(
            'QUICK_MATCH',
            { playerName },
            'QUICK_MATCH_FOUND',
            (data, error) => {
                if (error) {
                    this.showNotification(`Quick match failed: ${error.message}`, 'error');
                } else {
                    this.roomId = data.roomId;
                    this.isHost = data.isHost;
                    this.gameState = data.gameState;
                    this.showNotification(`Match found! Entering room...`, 'success');
                    this.showLobby(data.gameState);
                }
            }
        );
    }

    toggleReady() {
        // Disable button while updating
        const btn = document.getElementById('player1ReadyBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Updating...';
        }
        
        this.game.clientNetworkManager.call('TOGGLE_READY');
    }

    startGame() {
        if (!this.isHost) return;
        this.game.clientNetworkManager.call('START_GAME');
    }

    leaveRoom() {
        this.game.clientNetworkManager.call('LEAVE_ROOM');
        this.exitToMainMenu();
    }

    // =============================================
    // NETWORK EVENT LISTENERS
    // =============================================

    setupNetworkListeners() {
        const nm = this.game.clientNetworkManager;
        if (!nm) {
            console.error('ClientNetworkManager not available');
            return;
        }

        // Listen to events that update the UI
        this.networkUnsubscribers.push(
            nm.listen('PLAYER_JOINED', (data) => {
                this.gameState = data.gameState;
                this.showNotification(`${data.playerName} joined the room`, 'info');
                this.updateLobby(data.gameState);
            }),

            nm.listen('PLAYER_LEFT', (data) => {
                this.gameState = data.gameState;
                this.showNotification('Player left the room', 'warning');
                this.updateLobby(data.gameState);
            }),

            nm.listen('PLAYER_READY_UPDATE', (data) => {
                this.gameState = data.gameState;
                this.updateLobby(data.gameState);
                
                // Show notification for ready state changes
                const myPlayerId = this.game.clientNetworkManager.playerId;
                if (data.playerId === myPlayerId) {
                    if(!data.ready){
                        console.log("not ready", data);
                    }
                    this.showNotification(
                        data.ready ? 'You are ready!' : 'Ready status removed',
                        data.ready ? 'success' : 'info'
                    );
                }
                
                if (data.allReady) {
                    this.showNotification('All players ready! Game starting...', 'success');
                }
            }),

            nm.listen('GAME_STARTED', (data) => {
                this.transitionToGame(data);
            }),

            nm.listen('PLACEMENT_READY_UPDATE', (data) => {
                this.handlePlacementReadyUpdate(data);
            }),

            nm.listen('BATTLE_END', (data) => {
                this.handleBattleEnd(data);
            }),

            nm.listen('NEXT_ROUND', (data) => {
                this.handleNextRound(data);
            }),

            nm.listen('GAME_END', (data) => {
                this.handleGameEnd(data);
            })
        );
    }

    setupEventListeners() {
        // Set up lobby event handlers (these elements created by showLobby)
        document.addEventListener('click', (e) => {
            if (e.target.id === 'player1ReadyBtn') {
                this.toggleReady();
            }
            if (e.target.id === 'startGameBtn') {
                this.startGame();
            }
            if (e.target.id === 'leaveLobbyBtn') {
                this.leaveRoom();
            }
        });
    }

    // =============================================
    // UI MANAGEMENT
    // =============================================

    showLobby(gameState) {
        this.currentScreen = 'lobby';
        
        // Create lobby screen if it doesn't exist
        if (!document.getElementById('multiplayerLobby')) {
            this.createLobbyScreen();
        }
        
        // Show lobby screen
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById('multiplayerLobby').classList.add('active');

        this.updateLobby(gameState);
    }

    createLobbyScreen() {
        const lobbyHTML = `
            <div id="multiplayerLobby" class="screen" style="display: none;">
                <div class="lobby-container" style="max-width: 800px; margin: 2rem auto; padding: 2rem; background: #1a1a1a; border-radius: 10px; color: white;">
                    <h1>Multiplayer Lobby</h1>
                    
                    <div class="lobby-info">
                        <div class="room-info">
                            <h3>Room: <span id="lobbyRoomId">------</span></h3>
                            <p>Players: <span id="playerCount">0</span>/2</p>
                        </div>
                        
                        <div class="players-section" style="display: flex; gap: 2rem; margin: 2rem 0;">
                            <div class="player-card player-1" style="flex: 1; padding: 1rem; border: 2px solid #666; border-radius: 5px;">
                                <h4 id="player1Name">You</h4>
                                <p id="player1Ready">Not Ready</p>
                                <button id="player1ReadyBtn" class="btn" style="padding: 0.5rem 1rem; background: #003300; border: none; color: white; cursor: pointer;">Ready Up</button>
                            </div>
                            
                            <div class="player-card player-2" style="flex: 1; padding: 1rem; border: 2px solid #666; border-radius: 5px;">
                                <h4 id="player2Name">Waiting for opponent...</h4>
                                <p id="player2Ready">Waiting</p>
                            </div>
                        </div>
                        
                        <div class="lobby-status">
                            <p id="lobbyStatusMessage" style="font-weight: bold; margin: 1rem 0;">Waiting for players...</p>
                        </div>
                        
                        <div class="lobby-controls" style="display: flex; gap: 1rem; justify-content: center;">
                            <button id="startGameBtn" class="btn btn-primary" style="display: none; padding: 0.75rem 1.5rem; background: #0066cc; border: none; color: white; cursor: pointer;">Start Game</button>
                            <button id="leaveLobbyBtn" class="btn btn-secondary" style="padding: 0.75rem 1.5rem; background: #666; border: none; color: white; cursor: pointer;">Leave Lobby</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', lobbyHTML);
    }

    updateLobby(gameState) {
        if (!gameState) return;

        const myPlayerId = this.game.clientNetworkManager.playerId;
        
        // Update room ID
        document.getElementById('lobbyRoomId').textContent = this.roomId || '------';
        
        // Update player count
        document.getElementById('playerCount').textContent = gameState.players?.length || 0;

        // Update player cards
        if (gameState.players) {
            const myPlayer = gameState.players.find(p => p.id === myPlayerId);
            const opponent = gameState.players.find(p => p.id !== myPlayerId);

          
            // Update my player card
            if (myPlayer) {
                const player1Name = document.getElementById('player1Name');
                const player1Ready = document.getElementById('player1Ready');
                const player1ReadyBtn = document.getElementById('player1ReadyBtn');

                if (player1Name) {
                    player1Name.textContent = `${myPlayer.name} (You)${myPlayer.isHost ? ' (Host)' : ''}`;
                }
                if (player1Ready) {
                    player1Ready.textContent = myPlayer.ready ? 'Ready' : 'Not Ready';
                    player1Ready.style.color = myPlayer.ready ? '#00ff00' : '#ff4444';
                }
                if (player1ReadyBtn) {
                    player1ReadyBtn.disabled = false;
                    player1ReadyBtn.textContent = myPlayer.ready ? 'Not Ready' : 'Ready Up';
                    player1ReadyBtn.style.background = myPlayer.ready ? '#440000' : '#003300';
                }
            }

            // Update opponent card
            const player2Name = document.getElementById('player2Name');
            const player2Ready = document.getElementById('player2Ready');
            
            if (opponent) {
             
                if (player2Name) {
                    player2Name.textContent = `${opponent.name}${opponent.isHost ? ' (Host)' : ''}`;
                }
                if (player2Ready) {
                    player2Ready.textContent = opponent.ready ? 'Ready' : 'Not Ready';
                    player2Ready.style.color = opponent.ready ? '#00ff00' : '#ff4444';
                }
            } else {
                // No opponent yet
                if (player2Name) {
                    player2Name.textContent = 'Waiting for opponent...';
                }
                if (player2Ready) {
                    player2Ready.textContent = 'Waiting';
                    player2Ready.style.color = '#888';
                }
            }

            // Update start button (only show for host when all ready)
            const allReady = gameState.players.every(p => p.ready);
            const startBtn = document.getElementById('startGameBtn');
            
         
            if (this.isHost && gameState.players.length === 2 && allReady) {
                if (startBtn) {
                    startBtn.style.display = 'block';
                    startBtn.disabled = false;
                    startBtn.textContent = 'Start Game';
                }
            } else {
                if (startBtn) {
                    startBtn.style.display = this.isHost ? 'block' : 'none';
                    startBtn.disabled = true;
                    startBtn.textContent = allReady ? 'Starting...' : 'Waiting for Ready';
                }
            }
        }
    }

    transitionToGame(data) {
        if (data.gameState) {
            this.syncWithServerState(data.gameState);
        }
        this.currentScreen = 'game';
        
        // Hide lobby, show game
        document.getElementById('multiplayerLobby')?.classList.remove('active');
        document.getElementById('gameScreen')?.classList.add('active');
        
        // Start the game
        this.game.gameManager.startSelectedMode();
        
        this.game.placementSystem.startNewPlacementPhase();
    }

    handlePlacementReadyUpdate(data) {
        if (data.gameState) {
            this.syncWithServerState(data.gameState);
        }
        this.game.placementSystem.handlePlacementReadyUpdate(data);
    }

    handleBattleEnd(data) {
        if (data.gameState) {
            this.syncWithServerState(data.gameState);
        }
        const myPlayerId = this.game.clientNetworkManager.playerId;
        let winningSide = this.game.state.mySide;
        if (data.result.winner === myPlayerId) {
            this.showNotification('Victory! You won this round!', 'success');
        } else {
            winningSide = winningSide == "left" ? "right" : "left";
            this.showNotification('Defeat! Better luck next round!', 'warning');
        }
        console.log('battle result', data);

        if(data.result?.survivingUnits){
            let winningUnits = data.result.survivingUnits[data.result.winner];                
            this.game.teamHealthSystem?.applyRoundDamage(winningSide, winningUnits);                        
            if(winningUnits && winningUnits.length > 0 ){
                this.startVictoryCelebration(winningUnits);
            }
        }
    }


    handleNextRound(data) {
        if (data.gameState) {
            this.syncWithServerState(data.gameState);
        }
        const myPlayerId = this.game.clientNetworkManager.playerId;
        this.gameState = data.gameState;
        data.gameState?.players?.forEach((player) => {
            if(player.id == myPlayerId) {
                this.game.state.playerGold = player.gold;
            }
        })
        this.startPlacementPhase();
    }

    handleGameEnd(data) {
        if (data.gameState) {
            this.syncWithServerState(data.gameState);
        }
        const myPlayerId = this.game.clientNetworkManager.playerId;
        if (data.result.winner === myPlayerId) {
            this.showNotification('GAME WON! Congratulations!', 'success');
        } else {
            this.showNotification('Game lost. Better luck next time!', 'warning');
        }
    }
    syncWithServerState(gameState) {
        if (!gameState.players) return;
        
        const myPlayerId = this.game.clientNetworkManager.playerId;
        const myPlayer = gameState.players.find(p => p.id === myPlayerId);
        
        if (myPlayer) {
            // Sync squad count and side
            if (this.game.state) {
                this.game.state.squadsPlacedThisRound = myPlayer.squadsPlaced || 0;
                this.game.state.mySide = myPlayer.side;
                this.game.state.playerGold = myPlayer.gold;
                this.game.state.round = gameState.round;
            }
            
            // Set team sides in grid system
            const opponent = gameState.players.find(p => p.id !== myPlayerId);
            if (opponent && this.game.gridSystem) {
                this.game.gridSystem.setTeamSides({
                    player: myPlayer.side,
                    enemy: opponent.side
                });
            }
            
            // Also set sides in placement system
            if (this.game.placementSystem && this.game.placementSystem.setTeamSides) {
                
                this.game.placementSystem.setTeamSides({
                    player: myPlayer.side,
                    enemy: opponent.side
                });
            }
            
            console.log(`Synced with server - Side: ${myPlayer.side}, Squads: ${myPlayer.squadsPlaced}, Gold: ${myPlayer.gold}`);
        }
    }

    // =============================================
    // UTILITY METHODS
    // =============================================

    showNotification(message, type = 'info', duration = 4000) {
        const notification = document.createElement('div');
        notification.textContent = message;
        
        const colors = {
            info: '#00aaff',
            success: '#00ff00',
            warning: '#ffaa00',
            error: '#ff4444'
        };
        
        const color = colors[type] || colors.info;
        notification.style.cssText = `
            background: rgba(0, 0, 0, 0.9); border: 2px solid ${color};
            color: ${color}; padding: 12px 16px; border-radius: 6px;
            margin-bottom: 8px; font-weight: bold; pointer-events: auto; cursor: pointer;
        `;
        
        notification.onclick = () => notification.remove();
        
        const container = document.getElementById('multiplayerNotifications') || document.body;
        container.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, duration);
    }
    
    start() {
       // this.game.statisticsTrackingSystem.startSession();
        this.game.shopSystem.createShop();
        //this.game.phaseSystem.startPlacementPhase();
        this.game.particleSystem.initialize(); 
        this.game.effectsSystem.initialize();                  
        // Welcome messages
        this.game.battleLogSystem.addWelcomeMessages();
    }

    exitToMainMenu() {
        this.currentScreen = null;
        this.roomId = null;
        this.isHost = false;
        this.gameState = null;

        if (this.game.screenManager?.showMainMenu) {
            this.game.screenManager.showMainMenu();
        } else {
            window.location.reload();
        }
    }

    // =============================================
    // CLEANUP
    // =============================================

    dispose() {
        this.networkUnsubscribers.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this.networkUnsubscribers = [];
        
    }
    startPlacementPhase() {
        const state = this.game.state;
        state.phase = 'placement';
        state.phaseTimeLeft = null; // No timer in multiplayer
        state.playerReady = false;
        state.enemyPlacementComplete = false; // Actually opponent placement
        state.roundEnding = false;
        
        // Reset squad counters for the new round
        state.playerSquadsPlacedThisRound = 0;
        state.enemySquadsPlacedThisRound = 0;
        
        this.clearBattlefield();
        this.game.placementSystem.startNewPlacementPhase();
    
     
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(`Round ${state.round} - Deploy your army! Waiting for opponent...`);
        }
    }
    clearBattlefield() {
        // Save player squad experience BEFORE clearing
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.saveSquadExperience();
        }
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const entitiesToDestroy = new Set();
        
        [
            ComponentTypes.TEAM,
            ComponentTypes.UNIT_TYPE,
            ComponentTypes.PROJECTILE,
            ComponentTypes.LIFETIME,
            ComponentTypes.HEALTH
        ].forEach(componentType => {
            const entities = this.game.getEntitiesWith(componentType);
            entities.forEach(id => entitiesToDestroy.add(id));
        });
        
        entitiesToDestroy.forEach(entityId => {
            try {
                this.game.destroyEntity(entityId);
            } catch (error) {
                console.warn(`Error destroying entity ${entityId}:`, error);
            }
        });
        
        if (this.game.renderSystem) {
            const modelEntities = Array.from(this.game.renderSystem.entityModels.keys());
            modelEntities.forEach(entityId => {
                this.game.renderSystem.removeEntityModel(entityId);
            });
        }
        
        if (this.game.animationSystem) {
            const animationEntities = Array.from(this.game.animationSystem.entityAnimationStates.keys());
            animationEntities.forEach(entityId => {
                this.game.animationSystem.removeEntityAnimations(entityId);
            });
        }
        
        if (this.game.projectileSystem?.clearAllProjectiles) {
            this.game.projectileSystem.clearAllProjectiles();
        }
        
        // Clean up experience data but keep earned experience
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.cleanupInvalidSquads();
        }
        if (this.game.gridSystem?.clear) {
          this.game.gridSystem.clear();
        }
    
        // Drop any opponent cache so we don't double-spawn next round
        if (this.game.placementSystem) {
          this.game.placementSystem.enemyPlacements = [];
          this.game.placementSystem.opponentPlacements = [];
        }
    }
       
    startVictoryCelebration(victoriousUnits) {
        if (!this.game.animationSystem) return;
        
        // Determine which team won
        const firstUnit = victoriousUnits[0];
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const team = this.game.getComponent(firstUnit, ComponentTypes.TEAM);
        const teamType = team?.team || 'player';
        
        victoriousUnits.forEach(entityId => {
            this.game.animationSystem.startCelebration(entityId, teamType);
        });
    }

    update() {
        this.updatePhaseUI();
        this.updateSquadCountDisplay();
        this.updateGoldDisplay();
    }

    applyRoundDamage() {       
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const allLivingEntities = this.game.getEntitiesWith(
            ComponentTypes.TEAM, 
            ComponentTypes.HEALTH,
            ComponentTypes.UNIT_TYPE
        );
        
        const aliveEntities = allLivingEntities.filter(id => {
            const health = this.game.getComponent(id, ComponentTypes.HEALTH);
            return health && health.current > 0;
        });
        
        const leftUnits = aliveEntities.filter(id => {
            const team = this.game.getComponent(id, ComponentTypes.TEAM);
            return team && team.team === 'left';
        });
        
        const rightUnits = aliveEntities.filter(id => {
            const team = this.game.getComponent(id, ComponentTypes.TEAM);
            return team && team.team === 'right';
        });
        
        let roundResult = null;
        let victoriousUnits = [];
        
        if (leftUnits.length === 0 && rightUnits.length > 0) {
            roundResult = this.game.teamHealthSystem?.applyRoundDamage('right', rightUnits);
            victoriousUnits = rightUnits;
        } else if (rightUnits.length === 0 && leftUnits.length > 0) {
            roundResult = this.game.teamHealthSystem?.applyRoundDamage('left', leftUnits);
            victoriousUnits = leftUnits;
        } else if (leftUnits.length === 0 && rightUnits.length === 0) {
            roundResult = this.game.teamHealthSystem?.applyRoundDraw();
            victoriousUnits = [];
        }
        if (roundResult) {
            this.game.state.roundEnding = true;
            
            if (victoriousUnits.length > 0) {
                this.startVictoryCelebration(victoriousUnits);
            }
            
            this.handleRoundResult(roundResult);
        }
    }

    handleRoundResult(roundResult) {
        const state = this.game.state;
        state.phase = 'ended';      
    }

    updatePhaseUI() {
        const state = this.game.state;
        
        // Update round number
        const roundNumberEl = document.getElementById('multiplayerRoundNumber');
        if (roundNumberEl) {
            roundNumberEl.textContent = state.round || 1;
        }
        
        // Update phase title
        const phaseTitleEl = document.getElementById('multiplayerPhaseTitle');
        if (phaseTitleEl) {
            switch (state.phase) {
                case 'placement':
                    phaseTitleEl.textContent = 'PLACEMENT PHASE';
                    break;
                case 'battle':
                    phaseTitleEl.textContent = 'BATTLE PHASE';
                    break;
                case 'ended':
                    phaseTitleEl.textContent = 'ROUND ENDED';
                    break;
                default:
                    phaseTitleEl.textContent = 'PREPARING...';
            }
        }
        
        // Update phase status
        const phaseStatusEl = document.getElementById('multiplayerPhaseStatus');
        if (phaseStatusEl) {
            if (state.phase === 'placement') {
                if (state.playerReady) {
                    phaseStatusEl.textContent = 'Army deployed! Waiting for opponent...';
                } else {
                    phaseStatusEl.textContent = 'Deploy your units and get ready!';
                }
            } else if (state.phase === 'battle') {
                phaseStatusEl.textContent = 'Battle in progress! Watch your units fight!';
            }
        }
        
        // Update phase timer (always infinity symbol for multiplayer)
        const phaseTimerEl = document.getElementById('multiplayerPhaseTimer');
        if (phaseTimerEl) {
            if (state.phase === 'placement') {
                phaseTimerEl.textContent = '∞';
                phaseTimerEl.style.color = '#00ffff';
            } else {
                phaseTimerEl.textContent = '';
            }
        }
        
        // Update opponent indicator
        if (this.game.multiplayerManager) {
            const opponentIndicator = document.getElementById('opponentIndicator');
            const opponent = Array.from(this.game.multiplayerManager.opponents.values())[0];
            if (opponentIndicator && opponent) {
                opponentIndicator.textContent = opponent.name;
            }
        }
    }


      
    updateGoldDisplay() {
        const goldDisplay = document.getElementById('multiplayerPlayerGold');
        if (goldDisplay) {
            goldDisplay.textContent = this.game.state.playerGold || 0;
        }
    }
    
    updateSquadCountDisplay() {
        const state = this.game.state;
        const squadCountDisplay = document.getElementById('squadCount');
        if (squadCountDisplay) {
            const remaining = this.config.maxSquadsPerRound - state.playerSquadsPlacedThisRound;
            squadCountDisplay.textContent = `${remaining}/${this.config.maxSquadsPerRound} squads left`;
            
            if (remaining === 0) {
                squadCountDisplay.style.color = '#ff4444';
            } else if (remaining === 1) {
                squadCountDisplay.style.color = '#ffaa44';
            } else {
                squadCountDisplay.style.color = '#44ff44';
            }
        }
    }
   
}