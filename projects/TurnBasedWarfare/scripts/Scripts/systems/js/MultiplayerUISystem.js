class MultiplayerUISystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.uiSystem = this;
        
        // State tracking
        this.currentScreen = null;
        this.gameState = null;
        this.config = {
            maxSquadsPerRound: 2,
            numBackgrounds: 5
        };
    }

    // GUTS Manager Interface
    init(params) {
        this.params = params || {};
        this.initializeUI();
        this.setupEventListeners();
    }

    initializeUI() {
        let randomBG = Math.floor(Math.random() * (this.config.numBackgrounds + 1));
        document.body.classList.add(`bg${randomBG}`);
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

    handleMultiplayerModeSelection(mode) {
        // Create setup dialog for multiplayer
        const setupDialog = document.createElement('div');
        setupDialog.className = 'multiplayer-setup-dialog modal';

        const interfaceConfig = this.game.getCollections().interfaces[mode.interfaceId]
        setupDialog.innerHTML = interfaceConfig?.html || `Interface ${mode.interfaceId} not found`;

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
                this.game.networkManager.startQuickMatch(getPlayerName());
                dialog.remove();
            });
        }

        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', () => {
                this.game.networkManager.createRoom(getPlayerName(), mode.maxPlayers);
                dialog.remove();
            });
        }

        if (joinRoomBtn) {
            joinRoomBtn.addEventListener('click', () => {
                const roomId = roomIdInput.value.trim().toUpperCase();
                if (roomId) {
                    this.game.networkManager.joinRoom(roomId, getPlayerName());
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

    toggleReady() {
        // Disable button while updating
        const btn = document.getElementById('player1ReadyBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Updating...';
        }
        
        this.game.networkManager.toggleReady(() => {
            
        });
    }
    startGame() {
        this.game.networkManager.startGame();
    }
    leaveRoom() {
        this.game.networkManager.leaveRoom();
        this.exitToMainMenu();
    }


    setupEventListeners() {
        // Set up lobby event handlers (these elements created by showLobby)
        document.addEventListener('click', (e) => {
            if (e.target.id === 'player1ReadyBtn') {
                this.toggleReady();
            }
            if (e.target.id === 'leaveLobbyBtn') {
                this.leaveRoom();
            }
        });
    }

    showLobby(gameState, roomId) {
        this.currentScreen = 'lobby';
        this.roomId = roomId;
          
        // Show lobby screen
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById('multiplayerLobby').classList.add('active');

        this.updateLobby(gameState);
    }

    updateLobby(gameState) {
        if (!gameState) return;

        const myPlayerId = this.game.clientNetworkManager.playerId;
        
        // Update room ID
        const lobbyRoomId = document.getElementById('lobbyRoomId');
        if (lobbyRoomId) {
            lobbyRoomId.textContent = this.roomId || '------';
        }
        
        // Update player count
        const playerCount = document.getElementById('playerCount');
        if (playerCount) {
            playerCount.textContent = gameState.players?.length || 0;
        }

        // Update player cards
        if (gameState.players) {
            const myPlayer = gameState.players.find(p => p.id === myPlayerId);
            const opponent = gameState.players.find(p => p.id !== myPlayerId);

            // Update my player card (Player 1)
            if (myPlayer) {
                const player1Name = document.getElementById('player1Name');
                const player1Status = document.getElementById('player1Status');
                const player1ReadyBtn = document.getElementById('player1ReadyBtn');
                const player1Info = document.getElementById('player1Info');

                if (player1Name) {
                    player1Name.textContent = `${myPlayer.name} (You)${myPlayer.isHost ? ' - Host' : ''}`;
                }
                if (player1Status) {
                    player1Status.textContent = myPlayer.ready ? '🟢 Ready for Battle!' : '🟡 Preparing...';
                    player1Status.className = `player-status ${myPlayer.ready ? 'ready' : 'waiting'}`;
                }
                if (player1ReadyBtn) {
                    player1ReadyBtn.disabled = false;
                    player1ReadyBtn.textContent = myPlayer.ready ? '⏳ CANCEL READY' : '🛡️ READY FOR BATTLE';
                    player1ReadyBtn.className = myPlayer.ready ? 'ready-btn ready-state' : 'ready-btn';
                }
                if (player1Info) {
                    player1Info.className = `player-card ${myPlayer.ready ? 'ready' : 'waiting'}`;
                }
            }

            // Update opponent card (Player 2)
            if (opponent) {
                const player2Name = document.getElementById('player2Name');
                const player2Status = document.getElementById('player2Status');
                const player2Info = document.getElementById('player2Info');

                if (player2Info) {
                    player2Info.style.display = 'block';
                    player2Info.className = `player-card ${opponent.ready ? 'ready' : 'waiting'}`;
                }
                if (player2Name) {
                    player2Name.textContent = `${opponent.name}${opponent.isHost ? ' - Host' : ''}`;
                }
                if (player2Status) {
                    player2Status.textContent = opponent.ready ? '🟢 Ready for Battle!' : '🟡 Preparing...';
                    player2Status.className = `player-status ${opponent.ready ? 'ready' : 'waiting'}`;
                }
            } else {
                // Hide opponent card if no second player
                const player2Info = document.getElementById('player2Info');
                if (player2Info) {
                    player2Info.style.display = 'none';
                }
            }

            // Update start game button (only for host)
            const startBtn = document.getElementById('startGameBtn');
            if (startBtn && myPlayer?.isHost) {
                const allReady = gameState.players.every(p => p.ready);
                const canStart = gameState.players.length === 2 && allReady;
                
                startBtn.style.display = gameState.players.length === 2 ? 'block' : 'none';
                startBtn.disabled = !canStart;
                startBtn.textContent = allReady ? '⚡ COMMENCE WAR' : 'Waiting for Ready';
            }

            // Update lobby status message
            const statusMsg = document.getElementById('lobbyStatusMessage');
            if (statusMsg) {
                if (gameState.players.length === 1) {
                    statusMsg.textContent = 'Waiting for worthy opponents...';
                } else if (gameState.players.length === 2) {
                    const allReady = gameState.players.every(p => p.ready);
                    statusMsg.textContent = allReady ? 
                        'All warriors ready! Prepare for battle!' : 
                        'Opponent found! Awaiting ready status...';
                }
            }
        }
    }

    transitionToGame(data) {

        this.currentScreen = 'game';
        
        // Hide lobby, show game
        document.getElementById('multiplayerLobby')?.classList.remove('active');
        document.getElementById('gameScreen')?.classList.add('active');
        
        // Start the game
        this.game.gameManager.startSelectedMode();
        
        this.game.placementSystem.startGame();
    }

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
        state.squadsPlacedThisRound = 0;
        state.enemySquadsPlacedThisRound = 0;
        
        this.clearBattlefield();
        this.game.placementSystem.startNewPlacementPhase();
    
     
        this.game.shopSystem?.createShop(); // Refresh experience panels
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(`Round ${state.round} - Deploy your army! Waiting for opponent...`);
        }
    }
    clearBattlefield() {
        if (this.game.abilitySystem) {
            this.game.abilitySystem.handleEndBattle();
        }
        // Save player squad experience BEFORE clearing
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.saveSquadExperience();
        }
        
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const entitiesToDestroy = new Set();
        
        [
            ComponentTypes.CORPSE
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
        
 
        if (this.game.projectileSystem?.clearAllProjectiles) {
            this.game.projectileSystem.clearAllProjectiles();
        }
        
        // Clean up experience data but keep earned experience
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.cleanupInvalidSquads();
        }
        
        this.game.placementSystem.removeDeadSquadsAfterRound();
        this.game.placementSystem.updateGridPositionsAfterRound();
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
        this.updateGoldDisplay();
        this.updateRoundDisplay();
        this.updateSideDisplay();
        this.updateSquadsPlacedDisplay();
    }

    handleRoundResult(roundResult) {
        const state = this.game.state;
        state.phase = 'ended'; 
    }

    updatePhaseUI() {
        const state = this.game.state;
        
        // Update round number
 
         
        // Update phase status
        const phaseStatusEl = document.getElementById('phaseStatus');
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
    }
    
    updateGoldDisplay() {
        const goldDisplay = document.getElementById('playerGold');
        if (goldDisplay) {
            goldDisplay.textContent = this.game.state.playerGold || 0;
        }
    }
    
    updateRoundDisplay() {
        const roundNumberEl = document.getElementById('currentRound');
        if (roundNumberEl) {
            roundNumberEl.textContent = this.game.state.round || 1;
        }
    }
    updateSideDisplay() {
        const sideDisplay = document.getElementById('playerSide');
        if (sideDisplay) {
            sideDisplay.textContent = this.game.state.mySide || 0;
        }
    }
    
    updateSquadsPlacedDisplay() {
        const sideDisplay = document.getElementById('playerSquadsPlaced');
        if (sideDisplay) {
            sideDisplay.textContent = `${this.game.state.squadsPlacedThisRound || 0} / ${this.config.maxSquadsPerRound}`;
        }
    }
   
}