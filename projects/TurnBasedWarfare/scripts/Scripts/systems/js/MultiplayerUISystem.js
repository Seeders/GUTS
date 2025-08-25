class MultiplayerUISystem {
    constructor(game, sceneManager) {
        this.game = game;
        this.sceneManager = sceneManager;
        this.game.uiSystem = this;
        
        this.currentScreen = null;
        this.lobbyUpdateInterval = null;
    }

    // GUTS Manager Interface
    init(params) {
        this.params = params || {};
        this.setupEventListeners();
        console.log('MultiplayerUISystem initialized');
    }

    setupEventListeners() {
        // Delegate to input handler and add multiplayer-specific events
        this.game.inputManager.setup();
        this.setupMultiplayerEvents();
    }

    setupMultiplayerEvents() {
        // Lobby controls
        const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
        const startGameBtn = document.getElementById('startGameBtn');
        const player1ReadyBtn = document.getElementById('player1ReadyBtn');
        const copyRoomIdBtn = document.getElementById('copyRoomIdBtn');

        if (leaveLobbyBtn) {
            leaveLobbyBtn.addEventListener('click', () => {
                this.leaveLobby();
            });
        }

        if (startGameBtn) {
            startGameBtn.addEventListener('click', () => {
                this.startMultiplayerGame();
            });
        }

        if (player1ReadyBtn) {
            player1ReadyBtn.addEventListener('click', () => {
                this.togglePlayerReady();
            });
        }

        if (copyRoomIdBtn) {
            copyRoomIdBtn.addEventListener('click', () => {
                this.copyRoomId();
            });
        }

        // Multiplayer game controls
        const multiplayerReadyBtn = document.getElementById('multiplayerReadyButton');
        const multiplayerPauseBtn = document.getElementById('multiplayerPauseBtn');
        const multiplayerExitBtn = document.getElementById('multiplayerExitBtn');

        if (multiplayerReadyBtn) {
            multiplayerReadyBtn.addEventListener('click', () => {
                if (this.game.phaseSystem) {
                    this.game.phaseSystem.toggleReady();
                }
            });
        }

        if (multiplayerPauseBtn) {
            multiplayerPauseBtn.addEventListener('click', () => {
                this.showMultiplayerPauseMenu();
            });
        }

        if (multiplayerExitBtn) {
            multiplayerExitBtn.addEventListener('click', () => {
                this.exitMultiplayerGame();
            });
        }

        // Canvas click events for placement
        const canvas = document.getElementById('multiplayerGameCanvas');
        if (canvas) {
            canvas.addEventListener('click', (event) => {
                if (this.game.placementSystem) {
                    this.game.placementSystem.handleCanvasClick(event);
                }
            });
        }
    }

    // =============================================
    // LOBBY MANAGEMENT
    // =============================================

    showLobby(roomData) {
        this.currentScreen = 'lobby';
        
        // Show lobby screen
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById('multiplayerLobby').classList.add('active');

        // Update lobby with room data
        this.updateLobbyInfo(roomData);

        // Start lobby update polling
        this.startLobbyUpdates();
    }

    updateLobbyInfo(roomData) {
        // Update room ID
        const roomIdDisplay = document.getElementById('lobbyRoomId');
        if (roomIdDisplay) {
            roomIdDisplay.textContent = roomData.roomId || '------';
        }

        // Update connection status
        const connectionStatus = document.getElementById('connectionStatus');
        if (connectionStatus) {
            if (this.game.multiplayerManager?.isConnected) {
                connectionStatus.textContent = '🟢 Connected';
                connectionStatus.style.color = '#00ff00';
            } else {
                connectionStatus.textContent = '🔴 Disconnected';
                connectionStatus.style.color = '#ff4444';
            }
        }

        // Update player count
        const playerCount = document.getElementById('playerCount');
        if (playerCount && roomData.players) {
            playerCount.textContent = roomData.players.length;
        }

        // Update player cards
        this.updatePlayerCards(roomData);

        // Update game settings
        this.updateGameSettings(roomData);

        // Update lobby status
        this.updateLobbyStatus(roomData);
    }

    updatePlayerCards(roomData) {
        if (!roomData.players) return;

        const myPlayerId = this.game.multiplayerManager?.playerId;
        
        // Update Player 1 (always the local player)
        const player1 = roomData.players.find(p => p.id === myPlayerId);
        if (player1) {
            const player1Name = document.getElementById('player1Name');
            const player1Ready = document.getElementById('player1Ready');
            const player1ReadyBtn = document.getElementById('player1ReadyBtn');

            if (player1Name) player1Name.textContent = `${player1.name} (You)`;
            if (player1Ready) {
                player1Ready.textContent = player1.ready ? '✅ Ready' : '❌ Not Ready';
                player1Ready.style.color = player1.ready ? '#00ff00' : '#ff4444';
            }
            if (player1ReadyBtn) {
                player1ReadyBtn.textContent = player1.ready ? '❌ NOT READY' : '✅ READY UP';
                player1ReadyBtn.style.background = player1.ready ? '#440000' : '#003300';
            }
        }

        // Update Player 2 (opponent)
        const player2 = roomData.players.find(p => p.id !== myPlayerId);
        const player2Card = document.querySelector('.player-card.player-2');
        
        if (player2) {
            // Player 2 exists
            if (player2Card) player2Card.classList.add('active');

            const player2Name = document.getElementById('player2Name');
            const player2Ready = document.getElementById('player2Ready');
            const player2Connection = document.getElementById('player2Connection');

            if (player2Name) player2Name.textContent = player2.name;
            if (player2Ready) {
                player2Ready.textContent = player2.ready ? '✅ Ready' : '❌ Not Ready';
                player2Ready.style.color = player2.ready ? '#00ff00' : '#ff4444';
            }
            if (player2Connection) {
                player2Connection.textContent = '🟢 Connected';
                player2Connection.style.color = '#00ff00';
            }
        } else {
            // No Player 2 yet
            if (player2Card) player2Card.classList.remove('active');

            const player2Name = document.getElementById('player2Name');
            const player2Ready = document.getElementById('player2Ready');
            const player2Connection = document.getElementById('player2Connection');

            if (player2Name) player2Name.textContent = 'Waiting for opponent...';
            if (player2Ready) {
                player2Ready.textContent = '⏳ Waiting';
                player2Ready.style.color = '#ffff00';
            }
            if (player2Connection) {
                player2Connection.textContent = '⚪ Waiting';
                player2Connection.style.color = '#888';
            }
        }
    }

    updateGameSettings(roomData) {
        const gameMode = document.getElementById('gameMode');
        const maxRounds = document.getElementById('maxRounds');
        const startingGold = document.getElementById('startingGold');

        if (gameMode) gameMode.textContent = '1v1 Multiplayer';
        if (maxRounds) maxRounds.textContent = '5';
        if (startingGold) startingGold.textContent = '100';
    }

    updateLobbyStatus(roomData) {
        const statusMessage = document.getElementById('lobbyStatusMessage');
        const startGameBtn = document.getElementById('startGameBtn');

        if (!roomData.players || roomData.players.length < 2) {
            if (statusMessage) {
                statusMessage.textContent = 'Waiting for another player to join...';
                statusMessage.style.color = '#ffff00';
            }
            if (startGameBtn) {
                startGameBtn.disabled = true;
                startGameBtn.textContent = '⏳ WAITING FOR PLAYERS';
            }
        } else {
            const allReady = roomData.players.every(p => p.ready);
            
            if (allReady) {
                if (statusMessage) {
                    statusMessage.textContent = 'All players ready! Game can start!';
                    statusMessage.style.color = '#00ff00';
                }
                if (startGameBtn) {
                    startGameBtn.disabled = false;
                    startGameBtn.textContent = '🚀 START GAME';
                }
            } else {
                if (statusMessage) {
                    statusMessage.textContent = 'Waiting for all players to be ready...';
                    statusMessage.style.color = '#ffff00';
                }
                if (startGameBtn) {
                    startGameBtn.disabled = true;
                    startGameBtn.textContent = '⏳ WAITING FOR READY';
                }
            }
        }
    }

    startLobbyUpdates() {
        if (this.lobbyUpdateInterval) {
            clearInterval(this.lobbyUpdateInterval);
        }

        this.lobbyUpdateInterval = setInterval(() => {
            if (this.game.multiplayerManager && this.currentScreen === 'lobby') {
                // Request updated game state from server
                this.game.multiplayerManager.requestGameStateUpdate();
            }
        }, 2000); // Update every 2 seconds
    }

    stopLobbyUpdates() {
        if (this.lobbyUpdateInterval) {
            clearInterval(this.lobbyUpdateInterval);
            this.lobbyUpdateInterval = null;
        }
    }

    // =============================================
    // LOBBY ACTIONS
    // =============================================

    togglePlayerReady() {
        if (this.game.multiplayerManager) {
            // In lobby, this could send a ready state to server
            // For now, we'll let the MultiplayerManager handle it
            console.log('Player ready toggle - handled by MultiplayerManager');
        }
    }

    copyRoomId() {
        const roomIdDisplay = document.getElementById('lobbyRoomId');
        if (roomIdDisplay) {
            const roomId = roomIdDisplay.textContent;
            
            navigator.clipboard.writeText(roomId).then(() => {
                const btn = document.getElementById('copyRoomIdBtn');
                const originalText = btn.textContent;
                btn.textContent = '✅ Copied!';
                btn.style.background = '#003300';
                
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '';
                }, 2000);
            }).catch(() => {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = roomId;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                
                const btn = document.getElementById('copyRoomIdBtn');
                const originalText = btn.textContent;
                btn.textContent = '✅ Copied!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            });
        }
    }

    startMultiplayerGame() {
        // Hide lobby and show game screen
        this.currentScreen = 'game';
        this.stopLobbyUpdates();

        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById('multiplayerGameScreen').classList.add('active');

        // Start the actual game
        this.start();
    }

    leaveLobby() {
        if (confirm('Are you sure you want to leave the lobby?')) {
            this.stopLobbyUpdates();
            
            if (this.game.multiplayerManager) {
                this.game.multiplayerManager.leaveRoom();
            }
        }
    }

    // =============================================
    // GAME UI MANAGEMENT
    // =============================================

    start() {
        if (this.game.statisticsTrackingSystem) {
            this.game.statisticsTrackingSystem.startSession();
        }
        if (this.game.shopSystem) {
            this.game.shopSystem.createShop();
        }
        if (this.game.phaseSystem) {
            this.game.phaseSystem.startPlacementPhase();
        }
        if (this.game.particleSystem) {
            this.game.particleSystem.initialize();
        }
        if (this.game.effectsSystem) {
            this.game.effectsSystem.initialize();
        }
        
        // Add welcome messages
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add('🎮 Multiplayer battle begins!');
            this.game.battleLogSystem.add('💡 Deploy your army and prepare for battle!');
        }
    }

    update(deltaTime) {
        // Update opponent info overlay
        this.updateOpponentOverlay();
        
        // Update multiplayer-specific UI elements
        this.updateMultiplayerGameUI();
    }

    updateOpponentOverlay() {
        if (!this.game.multiplayerManager || this.currentScreen !== 'game') return;

        const opponent = Array.from(this.game.multiplayerManager.opponents.values())[0];
        if (!opponent) return;

        // Update opponent name
        const opponentNameGame = document.getElementById('opponentNameGame');
        if (opponentNameGame) {
            opponentNameGame.textContent = opponent.name;
        }

        // Update opponent health
        const opponentHealthGame = document.getElementById('opponentHealthGame');
        if (opponentHealthGame) {
            opponentHealthGame.textContent = opponent.health || 100;
        }

        // Update opponent gold
        const opponentGoldGame = document.getElementById('opponentGoldGame');
        if (opponentGoldGame) {
            opponentGoldGame.textContent = opponent.gold || '-';
        }

        // Update opponent status
        const opponentStatusGame = document.getElementById('opponentStatusGame');
        if (opponentStatusGame) {
            if (this.game.state.phase === 'placement') {
                if (opponent.ready) {
                    opponentStatusGame.textContent = '✅ Ready';
                    opponentStatusGame.className = 'status-ready';
                } else {
                    opponentStatusGame.textContent = '🏗️ Deploying';
                    opponentStatusGame.className = 'status-deploying';
                }
            } else if (this.game.state.phase === 'battle') {
                opponentStatusGame.textContent = '⚔️ Battling';
                opponentStatusGame.className = 'status-battling';
            }
        }
    }

    updateMultiplayerGameUI() {
        // Update player health
        const playerHealthEl = document.getElementById('multiplayerPlayerHealth');
        if (playerHealthEl && this.game.state) {
            // Get health from team health system if available
            const playerHealth = this.game.teamHealthSystem?.getPlayerHealth() || this.game.state.playerHealth || 100;
            playerHealthEl.textContent = playerHealth;
        }

        // Gold display is handled by PhaseSystem
        // Ready button state is handled by PhaseSystem
        // Phase info is handled by PhaseSystem
    }

    // =============================================
    // MULTIPLAYER GAME ACTIONS
    // =============================================

    showMultiplayerPauseMenu() {
        const pauseMenu = document.createElement('div');
        pauseMenu.className = 'pause-overlay';
        pauseMenu.id = 'multiplayerPauseMenu';
        pauseMenu.innerHTML = `
            <div class="pause-content">
                <h2>⏸️ GAME PAUSED</h2>
                <p style="color: #ffff00; margin-bottom: 2rem;">⚠️ This is a multiplayer game. Leaving will forfeit the match.</p>
                <button id="resumeMultiplayerBtn" class="btn">▶️ RESUME</button>
                <button id="forfeitGameBtn" class="btn btn-danger">🏳️ FORFEIT & EXIT</button>
            </div>
        `;
        
        document.body.appendChild(pauseMenu);
        
        document.getElementById('resumeMultiplayerBtn').onclick = () => {
            document.body.removeChild(pauseMenu);
        };
        
        document.getElementById('forfeitGameBtn').onclick = () => {
            if (confirm('Are you sure you want to forfeit this multiplayer game?')) {
                this.exitMultiplayerGame();
                document.body.removeChild(pauseMenu);
            }
        };
    }

    exitMultiplayerGame() {
        if (confirm('Are you sure you want to exit? You will forfeit the multiplayer game.')) {
            this.stopLobbyUpdates();
            
            if (this.game.multiplayerManager) {
                this.game.multiplayerManager.leaveRoom();
            }
        }
    }

    // =============================================
    // SCREEN TRANSITIONS
    // =============================================

    showGameScreen() {
        this.currentScreen = 'game';
        this.stopLobbyUpdates();

        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById('multiplayerGameScreen').classList.add('active');
    }

    showLobbyScreen() {
        this.currentScreen = 'lobby';

        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById('multiplayerLobby').classList.add('active');

        this.startLobbyUpdates();
    }

    // =============================================
    // GAME END SCREENS
    // =============================================

    showVictoryScreen(stats) {
        this.stopLobbyUpdates();
        this.currentScreen = 'victory';

        // Create victory overlay
        const victoryOverlay = document.createElement('div');
        victoryOverlay.className = 'multiplayer-victory-overlay';
        victoryOverlay.innerHTML = `
            <div class="victory-content">
                <h1>🎉 VICTORY! 🎉</h1>
                <h2>You defeated your opponent!</h2>
                <div class="victory-stats">
                    <div class="stat">
                        <span class="stat-label">Rounds Won:</span>
                        <span class="stat-value">${stats.roundsWon || 0}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Final Health:</span>
                        <span class="stat-value">${stats.finalHealth || 0}/100</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Opponent Defeated:</span>
                        <span class="stat-value">✅ Complete</span>
                    </div>
                </div>
                <div class="victory-controls">
                    <button id="playAgainBtn" class="btn btn-primary">🔄 PLAY AGAIN</button>
                    <button id="backToMenuBtn" class="btn btn-secondary">🏠 MAIN MENU</button>
                </div>
            </div>
        `;

        document.body.appendChild(victoryOverlay);

        document.getElementById('playAgainBtn').onclick = () => {
            document.body.removeChild(victoryOverlay);
            // Could implement rematch functionality here
            this.exitToMainMenu();
        };

        document.getElementById('backToMenuBtn').onclick = () => {
            document.body.removeChild(victoryOverlay);
            this.exitToMainMenu();
        };
    }

    showDefeatScreen(stats) {
        this.stopLobbyUpdates();
        this.currentScreen = 'defeat';

        // Create defeat overlay
        const defeatOverlay = document.createElement('div');
        defeatOverlay.className = 'multiplayer-defeat-overlay';
        defeatOverlay.innerHTML = `
            <div class="defeat-content">
                <h1>💀 DEFEAT 💀</h1>
                <h2>Your opponent was victorious!</h2>
                <div class="defeat-stats">
                    <div class="stat">
                        <span class="stat-label">Rounds Survived:</span>
                        <span class="stat-value">${stats.roundsSurvived || 0}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Final Health:</span>
                        <span class="stat-value">0/100</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Result:</span>
                        <span class="stat-value">Army Eliminated</span>
                    </div>
                </div>
                <div class="defeat-controls">
                    <button id="tryAgainBtn" class="btn btn-primary">🔄 TRY AGAIN</button>
                    <button id="backToMenuBtn2" class="btn btn-secondary">🏠 MAIN MENU</button>
                </div>
            </div>
        `;

        document.body.appendChild(defeatOverlay);

        document.getElementById('tryAgainBtn').onclick = () => {
            document.body.removeChild(defeatOverlay);
            // Could implement rematch functionality here
            this.exitToMainMenu();
        };

        document.getElementById('backToMenuBtn2').onclick = () => {
            document.body.removeChild(defeatOverlay);
            this.exitToMainMenu();
        };
    }

    exitToMainMenu() {
        this.stopLobbyUpdates();
        this.currentScreen = null;

        // Clean up any overlays
        const overlays = document.querySelectorAll('.multiplayer-victory-overlay, .multiplayer-defeat-overlay, .multiplayer-stats-overlay');
        overlays.forEach(overlay => overlay.remove());

        // Return to main menu
        if (this.game.screenManager) {
            this.game.screenManager.showMainMenu();
        }

        // Disconnect from multiplayer
        if (this.game.multiplayerManager) {
            this.game.multiplayerManager.disconnect();
        }
    }

    // =============================================
    // HELPER METHODS
    // =============================================

    // Get reference to game state
    getGameState() { 
        return this.game.state; 
    }

    // Show notification in multiplayer context
    showNotification(message, type = 'info', duration = 4000) {
        if (this.game.multiplayerManager) {
            this.game.multiplayerManager.showNotification(message, type, duration);
        } else {
            // Fallback notification
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    // =============================================
    // CLEANUP
    // =============================================

    dispose() {
        this.stopLobbyUpdates();
        
        // Remove any created overlays
        const overlays = document.querySelectorAll('.multiplayer-victory-overlay, .multiplayer-defeat-overlay, .multiplayer-stats-overlay, #multiplayerPauseMenu');
        overlays.forEach(overlay => overlay.remove());
        
        console.log('MultiplayerUISystem disposed');
    }
}
