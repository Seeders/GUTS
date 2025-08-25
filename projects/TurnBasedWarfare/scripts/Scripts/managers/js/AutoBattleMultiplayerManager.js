class AutoBattleMultiplayerManager {
    constructor(game, sceneManager) {
        this.game = game;
        this.sceneManager = sceneManager;
        this.game.multiplayerManager = this;
        
        this.socket = null;
        this.isConnected = false;
        this.playerId = null;
        this.roomId = null;
        this.opponents = new Map();
        
        // Connection settings
        const config = this.game.getCollections()?.configs?.multiplayer || {};
        this.serverUrl = config.serverUrl || 'ws://localhost:3001';
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 5;
        this.reconnectDelay = config.reconnectDelay || 1000;
        
        // Game sync
        this.lastGameState = null;
        this.isInLobby = false;
        
        console.log('MultiplayerManager initialized for multiplayer scene');
    }

    // GUTS Manager Interface
    init(params) {
        this.params = params || {};
        
        // Check if Socket.IO is available
        if (typeof io === 'undefined') {
            console.error('Socket.IO not available - multiplayer cannot function');
            this.showError('Socket.IO library not loaded. Multiplayer is not available.');
            return;
        }
        this.isAvailable = true;
        
        this.initializeUI();
        this.enhanceGameModeManager();
        console.log('MultiplayerManager ready for connections');
    }
    initializeUI() {
        
        // Add multiplayer UI elements to existing interface
        const multiplayerHTML = `
            <div id="multiplayerHUD" style="display: none; position: absolute; top: 10px; right: 330px; z-index: 1000;">
                <div class="opponent-info">
                    <h4>🎯 Opponent</h4>
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
            // Get existing modes from collections or GameModeManager
            const originalModes = this.game.gameModeManager.modes || {};
            
            // Add multiplayer modes
            const multiplayerModes = {
                multiplayer_1v1: {
                    id: 'multiplayer_1v1',
                    title: '1v1 Multiplayer',
                    icon: '⚔️',
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
                    icon: '⚡',
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
            
            // Merge with existing modes
            this.game.gameModeManager.modes = { ...originalModes, ...multiplayerModes };
            
            // Override mode selection to handle multiplayer
            const originalSelectMode = this.game.gameModeManager.selectMode.bind(this.game.gameModeManager);
            this.game.gameModeManager.selectMode = (modeId) => {
                originalSelectMode(modeId);
                debugger;
                const mode = this.game.gameModeManager.modes[modeId];
                if (mode && mode.isMultiplayer) {
                    this.handleMultiplayerModeSelection(mode);
                }
            };
            
            // Refresh UI if it exists
            if (this.game.gameModeManager.setupUI) {
                this.game.gameModeManager.setupUI();
            }
        }
    }
    handleMultiplayerModeSelection(mode) {
        // Create setup dialog for multiplayer
        const setupDialog = document.createElement('div');
        setupDialog.className = 'multiplayer-setup-dialog';
        setupDialog.innerHTML = `
            <div class="setup-content">
                <h2>🎮 ${mode.title}</h2>
                <p>${mode.description}</p>
                
                <div class="player-name-input">
                    <label for="playerName">Your Name:</label>
                    <input type="text" id="playerName" placeholder="Enter your name" maxlength="20" value="Player">
                </div>
                
                <div class="multiplayer-options">
                    ${mode.id === 'multiplayer_quick' ? `
                        <button id="quickMatchBtn" class="btn btn-primary">⚡ FIND MATCH</button>
                    ` : `
                        <button id="createRoomBtn" class="btn btn-primary">🏠 CREATE ROOM</button>
                        <div class="room-join-section">
                            <input type="text" id="roomIdInput" placeholder="Enter Room ID" maxlength="6">
                            <button id="joinRoomBtn" class="btn btn-secondary">🚪 JOIN ROOM</button>
                        </div>
                    `}
                </div>
                
                <button id="cancelMultiplayerBtn" class="btn btn-secondary">❌ CANCEL</button>
            </div>
        `;

        document.body.appendChild(setupDialog);
        
        // Add event listeners
        this.setupMultiplayerDialogEvents(setupDialog, mode);
    }

    setupMultiplayerDialogEvents(dialog, mode) {
        const playerNameInput = document.getElementById('playerName');
        const quickMatchBtn = document.getElementById('quickMatchBtn');
        const createRoomBtn = document.getElementById('createRoomBtn');
        const joinRoomBtn = document.getElementById('joinRoomBtn');
        const roomIdInput = document.getElementById('roomIdInput');
        const cancelBtn = document.getElementById('cancelMultiplayerBtn');

        const getPlayerName = () => playerNameInput.value.trim() || 'Player';

        if (quickMatchBtn) {
            quickMatchBtn.addEventListener('click', async () => {
                await this.startMultiplayerQuickMatch(getPlayerName(), dialog);
            });
        }

        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', async () => {
                dialog.remove();
                await this.createRoom(getPlayerName(), mode.maxPlayers, dialog);
            });
        }

        if (joinRoomBtn) {
            joinRoomBtn.addEventListener('click', async () => {
                const roomId = roomIdInput.value.trim().toUpperCase();
                if (roomId) {
                    dialog.remove();
                    await this.joinRoom(roomId, getPlayerName(), dialog);
                } else {
                    alert('Please enter a Room ID');
                }
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(dialog);
            });
        }

        playerNameInput.focus();
        playerNameInput.select();
    }
        
    // =============================================
    // CONNECTION MANAGEMENT
    // =============================================

    async connect() {
        if (this.isConnected) return Promise.resolve();
        
        return new Promise((resolve, reject) => {
            try {
                this.socket = io(this.serverUrl, {
                    transports: ['websocket', 'polling']
                });
                
                this.socket.on('connect', () => {
                    console.log('Connected to multiplayer server');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.setupEventHandlers();
                    resolve();
                });
                
                this.socket.on('disconnect', (reason) => {
                    console.log('Disconnected from server:', reason);
                    this.isConnected = false;
                    this.handleDisconnection();
                });
                
                this.socket.on('connect_error', (error) => {
                    console.error('Connection error:', error);
                    this.handleConnectionError();
                    reject(error);
                });
                
            } catch (error) {
                console.error('Failed to create socket connection:', error);
                reject(error);
            }
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.playerId = null;
        this.roomId = null;
        this.opponents.clear();
        this.isInLobby = false;
    }

    handleDisconnection() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            console.log(`Attempting to reconnect... (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.reconnectAttempts++;
                this.connect().catch(() => {
                    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                        this.handleConnectionLost();
                    }
                });
            }, this.reconnectDelay * this.reconnectAttempts);
        } else {
            this.handleConnectionLost();
        }
    }

    handleConnectionError() {
        this.showNotification('Connection failed. Please check the server is running.', 'error');
    }

    handleConnectionLost() {
        this.showNotification('Lost connection to server. Returning to main menu.', 'error');
        this.exitToMainMenu();
    }

    // =============================================
    // ROOM MANAGEMENT
    // =============================================

    async createRoom(playerName, maxPlayers = 2) {
        if (!this.isConnected) {
            await this.connect();
        }
        
        return new Promise((resolve, reject) => {
            this.socket.emit('create_room', {
                playerData: { name: playerName },
                maxPlayers: maxPlayers
            });
            
            this.socket.once('room_created', (data) => {
                this.roomId = data.roomId;
                this.playerId = data.playerId;
                this.isInLobby = true;
                
                console.log(`Created room ${this.roomId} as ${this.playerId}`);
                
                // Show lobby
                this.showLobby(data.gameState);
                
                resolve(data);
            });
            
            this.socket.once('error', (error) => {
                reject(new Error(error));
            });
        });
    }

    async joinRoom(roomId, playerName) {
        if (!this.isConnected) {
            await this.connect();
        }
        
        return new Promise((resolve, reject) => {
            this.socket.emit('join_room', {
                roomId: roomId,
                playerData: { name: playerName }
            });
            
            this.socket.once('room_joined', (data) => {
                this.roomId = data.roomId;
                this.playerId = data.playerId;
                this.isInLobby = true;
                
                console.log(`Joined room ${this.roomId} as ${this.playerId}`);
                
                // Show lobby
                this.showLobby(data.gameState);
                
                resolve(data);
            });
            
            this.socket.once('error', (error) => {
                reject(new Error(error));
            });
        });
    }

    async quickMatch(playerName) {
        if (!this.isConnected) {
            await this.connect();
        }
        
        return new Promise((resolve, reject) => {
            this.socket.emit('quick_match', {
                playerData: { name: playerName }
            });
            
            this.socket.once('room_joined', (data) => {
                this.roomId = data.roomId;
                this.playerId = data.playerId;
                this.isInLobby = true;
                
                console.log(`Quick matched into room ${this.roomId} as ${this.playerId}`);
                
                // Show lobby
                this.showLobby(data.gameState);
                
                resolve(data);
            });
            
            this.socket.once('error', (error) => {
                reject(new Error(error));
            });
        });
    }

    leaveRoom() {
        if (this.socket && this.roomId) {
            this.socket.emit('leave_room', { roomId: this.roomId });
        }
        this.exitToMainMenu();
    }

    // =============================================
    // LOBBY MANAGEMENT
    // =============================================

    showLobby(gameState) {
        this.isInLobby = true;
        
        if (this.game.uiSystem && this.game.uiSystem.showLobby) {
            this.game.uiSystem.showLobby({
                roomId: this.roomId,
                players: gameState.players || [],
                gameState: gameState.gameState
            });
        }
    }

    transitionToGame() {
        this.isInLobby = false;
        
        console.log('Transitioning from lobby to game...');
        
        if (this.game.uiSystem && this.game.uiSystem.showGameScreen) {
            this.game.uiSystem.showGameScreen();
        }
        
        // Start the game
        setTimeout(() => {
            if (this.game.uiSystem && this.game.uiSystem.start) {
                this.game.uiSystem.start();
            }
        }, 500);
    }

    // =============================================
    // EVENT HANDLERS
    // =============================================

    setupEventHandlers() {
        if (!this.socket) return;
        
        this.socket.on('game_state_updated', (gameState) => {
            this.updateGameStateFromServer(gameState);
        });
        
        this.socket.on('player_joined', (data) => {
            this.handlePlayerJoined(data);
        });
        
        this.socket.on('player_left', (data) => {
            this.handlePlayerLeft(data);
        });
        
        this.socket.on('battle_resolved', (data) => {
            this.handleBattleResolved(data);
        });
        
        this.socket.on('game_ended', (data) => {
            this.handleGameEnded(data);
        });
        
        this.socket.on('room_closed', (data) => {
            this.handleRoomClosed(data);
        });
        
        this.socket.on('placements_submitted', () => {
            this.showNotification('Army deployed successfully!', 'success');
        });
    }

    updateGameStateFromServer(serverGameState) {
        this.lastGameState = serverGameState;
        
        // Update local game state
        if (this.game.state) {
            this.game.state.round = serverGameState.currentRound;
            this.game.state.phase = this.convertServerPhaseToLocal(serverGameState.gameState);
            
            // Update player data
            const myPlayerData = serverGameState.players.find(p => p.id === this.playerId);
            if (myPlayerData) {
                this.game.state.playerGold = myPlayerData.gold;
            }
            
            // Update opponents
            this.opponents.clear();
            serverGameState.players.forEach(player => {
                if (player.id !== this.playerId) {
                    this.opponents.set(player.id, player);
                }
            });
        }
        
        // Update UI based on current state
        if (this.isInLobby) {
            if (this.game.uiSystem && this.game.uiSystem.updateLobbyInfo) {
                this.game.uiSystem.updateLobbyInfo({
                    roomId: this.roomId,
                    players: serverGameState.players || [],
                    gameState: serverGameState.gameState
                });
            }
        } else {
            // In-game updates are handled by individual systems
            this.handlePhaseUpdate(serverGameState);
        }
    }

    convertServerPhaseToLocal(serverPhase) {
        const phaseMap = {
            'waiting': 'waiting',
            'placement': 'placement',
            'battle': 'battle',
            'upgrading': 'upgrading',
            'ended': 'ended'
        };
        return phaseMap[serverPhase] || 'waiting';
    }

    handlePhaseUpdate(gameState) {
        switch (gameState.gameState) {
            case 'placement':
                this.syncPlacementPhase(gameState);
                break;
            case 'battle':
                this.syncBattlePhase(gameState);
                break;
            case 'upgrading':
                this.syncUpgradePhase(gameState);
                break;
            case 'ended':
                this.syncGameEnd(gameState);
                break;
        }
    }

    handlePlayerJoined(data) {
        this.showNotification(`${data.player.name} joined the game!`, 'info');
        
        // If room is now full and in lobby, prepare for game start
        if (data.gameState.players.length === 2 && this.isInLobby) {
            this.showNotification('Room is full! Both players can ready up to start.', 'success');
        }
        
    }

    handlePlayerLeft(data) {
        const opponent = this.opponents.get(data.playerId);
        const playerName = opponent ? opponent.name : 'Player';
        this.showNotification(`${playerName} left the game`, 'warning');
        
        if (!this.isInLobby) {
            this.showNotification('Game ended due to player disconnect', 'error');
            setTimeout(() => this.exitToMainMenu(), 3000);
        }
    }

    handleBattleResolved(data) {
        const results = data.battleResults;
        
        if (this.game.phaseSystem && this.game.phaseSystem.handleRoundResult) {
            this.game.phaseSystem.handleRoundResult(results);
        }
        
        // Show battle results notification
        if (results.winner === this.playerId) {
            this.showNotification('Victory! You won this round!', 'success');
        } else {
            this.showNotification('Defeat! Better luck next round!', 'warning');
        }
    }

    handleGameEnded(data) {
        const finalWinner = data.winner;
        
        if (this.game.phaseSystem && this.game.phaseSystem.handleGameEnd) {
            this.game.phaseSystem.handleGameEnd(data);
        }
        
        // Show final results
        setTimeout(() => {
            if (finalWinner === this.playerId) {
                if (this.game.uiSystem && this.game.uiSystem.showVictoryScreen) {
                    this.game.uiSystem.showVictoryScreen(data.finalStats[this.playerId]);
                } else {
                    this.showNotification('🎉 GAME WON! Congratulations! 🎉', 'victory');
                }
            } else {
                if (this.game.uiSystem && this.game.uiSystem.showDefeatScreen) {
                    this.game.uiSystem.showDefeatScreen(data.finalStats[this.playerId]);
                } else {
                    this.showNotification('💀 GAME LOST! Better luck next time! 💀', 'defeat');
                }
            }
        }, 2000);
    }

    handleRoomClosed(data) {
        this.showNotification(`Room closed: ${data.reason}`, 'error');
        this.exitToMainMenu();
    }

    // =============================================
    // GAME SYNCHRONIZATION
    // =============================================

    syncPlacementPhase(gameState) {
        // Start placement phase if needed
        if (this.game.phaseSystem && this.game.state.phase !== 'placement') {
            this.game.phaseSystem.startPlacementPhase();
        }
        
        // Update opponent readiness status
        this.updateOpponentReadiness(gameState);
    }

    syncBattlePhase(gameState) {
        // Apply opponent placements to battlefield
        this.applyOpponentPlacements(gameState);
        
        // Start local battle simulation
        if (this.game.phaseSystem) {
            this.game.phaseSystem.startBattlePhase();
        }
    }

    syncUpgradePhase(gameState) {
        // Handle upgrade phase (if implemented)
        console.log('Upgrade phase started');
    }

    syncGameEnd(gameState) {
        if (this.game.state) {
            this.game.state.phase = 'ended';
        }
    }

    updateOpponentReadiness(gameState) {
        let readyCount = 0;
        let totalPlayers = gameState.players.length;
        
        gameState.players.forEach(player => {
            if (player.ready) readyCount++;
        });
        
        const waitingFor = totalPlayers - readyCount;
        if (waitingFor > 0 && this.game.battleLogSystem) {
            this.game.battleLogSystem.add(`Waiting for ${waitingFor} player(s) to deploy...`);
        }
    }

    applyOpponentPlacements(gameState) {
        if (!this.game.placementSystem) return;
        
        // Get opponent placements
        const opponentPlacements = [];
        gameState.players.forEach(player => {
            if (player.id !== this.playerId && player.armyPlacements) {
                opponentPlacements.push(...player.armyPlacements);
            }
        });
        
        // Apply opponent placements via placement system
        if (this.game.placementSystem.applyOpponentPlacements) {
            this.game.placementSystem.applyOpponentPlacements(opponentPlacements);
        }
    }

    // =============================================
    // PLACEMENT SUBMISSION
    // =============================================

    submitPlacements() {
        if (!this.isConnected || !this.socket) {
            return false;
        }
        
        // Collect current placements from placement system
        const placements = this.collectPlayerPlacements();
        
        this.socket.emit('submit_placements', {
            placements: placements
        });
        
        // Show waiting message
        this.showNotification('Army deployed! Waiting for opponent...', 'info');
        
        return true;
    }

    collectPlayerPlacements() {
        const placements = [];
        
        if (this.game.placementSystem && this.game.placementSystem.playerPlacements) {
            this.game.placementSystem.playerPlacements.forEach(placement => {
                placements.push({
                    unitType: placement.unitType,
                    gridPosition: placement.gridPosition,
                    cells: placement.cells,
                    placementId: placement.placementId
                });
            });
        }
        
        return placements;
    }

    submitUpgrades(upgrades) {
        if (!this.isConnected || !this.socket) {
            return false;
        }
        
        this.socket.emit('submit_upgrades', {
            upgrades: upgrades
        });
        
        this.showNotification('Upgrades selected! Waiting for opponent...', 'info');
        return true;
    }

    // =============================================
    // UI HELPERS
    // =============================================

    showNotification(message, type = 'info', duration = 4000) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `multiplayer-notification notification-${type}`;
        notification.textContent = message;
        
        // Style based on type
        const colors = {
            info: { border: '#00ffff', color: '#00ffff' },
            success: { border: '#00ff00', color: '#00ff00' },
            warning: { border: '#ffff00', color: '#ffff00' },
            error: { border: '#ff4444', color: '#ff4444' },
            victory: { border: '#00ff00', color: '#00ff00' },
            defeat: { border: '#ff4444', color: '#ff4444' }
        };
        
        const color = colors[type] || colors.info;
        notification.style.cssText = `
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid ${color.border};
            color: ${color.color};
            padding: 1rem 2rem;
            border-radius: 8px;
            font-weight: bold;
            z-index: 3000;
            animation: notificationSlide 0.3s ease-out;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;
        
        // Add to notifications container or body
        let container = document.getElementById('multiplayerNotifications');
        if (!container) {
            container = document.body;
        }
        container.appendChild(notification);
        
        // Auto-remove after duration
        setTimeout(() => {
            if (notification.parentElement) {
                notification.style.animation = 'notificationSlideOut 0.3s ease-in forwards';
                setTimeout(() => {
                    if (notification.parentElement) {
                        notification.parentElement.removeChild(notification);
                    }
                }, 300);
            }
        }, duration);
        
        // Add victory glow effect
        if (type === 'victory') {
            notification.style.animation += ', victoryGlow 1s ease-in-out infinite';
        }
    }

    showError(message) {
        // Create error overlay for critical errors
        const errorOverlay = document.createElement('div');
        errorOverlay.className = 'multiplayer-error-overlay';
        errorOverlay.innerHTML = `
            <div class="error-content">
                <h2>❌ Multiplayer Error</h2>
                <p>${message}</p>
                <button onclick="this.parentElement.parentElement.remove(); window.location.reload();" class="btn btn-primary">Reload Game</button>
            </div>
        `;
        
        errorOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 5000;
        `;
        
        document.body.appendChild(errorOverlay);
    }

    exitToMainMenu() {
        this.isInLobby = false;
        this.disconnect();
        
        // Return to main menu using GUTS ScreenManager
        if (this.game.screenManager) {
            this.game.screenManager.showMainMenu();
        } else if (this.game.eventManager) {
            this.game.eventManager.setScreen('mainMenu');
        } else {
            // Fallback
            window.location.reload();
        }
    }

    // =============================================
    // PUBLIC API METHODS
    // =============================================

    isInMultiplayerGame() {
        return this.isConnected && this.roomId && this.playerId && !this.isInLobby;
    }

    getMultiplayerStatus() {
        return {
            isConnected: this.isConnected,
            isInLobby: this.isInLobby,
            roomId: this.roomId,
            playerId: this.playerId,
            opponentCount: this.opponents.size,
            lastGameState: this.lastGameState
        };
    }

    requestGameStateUpdate() {
        if (this.socket && this.isConnected) {
            this.socket.emit('get_game_state');
        }
    }

    getRoomId() {
        return this.roomId;
    }

    getOpponents() {
        return Array.from(this.opponents.values());
    }

    // =============================================
    // CLEANUP
    // =============================================

    dispose() {
        this.disconnect();
        
        // Remove notifications
        const notifications = document.querySelectorAll('.multiplayer-notification, .multiplayer-error-overlay');
        notifications.forEach(notification => notification.remove());
        
        console.log('MultiplayerManager disposed');
    }
}
