class MultiplayerManager {
    constructor(game, sceneManager) {
        this.game = game;
        this.sceneManager = sceneManager;
        this.game.multiplayerManager = this;
        
        this.socket = null;
        this.isConnected = false;
        this.isMultiplayer = false;
        this.playerId = null;
        this.roomId = null;
        this.opponents = new Map();
        
        // Connection settings - get from collections if available
        const config = this.game.getCollections()?.configs?.multiplayer || {};
        this.serverUrl = config.serverUrl || 'ws://localhost:3001';
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 5;
        this.reconnectDelay = config.reconnectDelay || 1000;
        
        // Game sync
        this.pendingPlacements = [];
        this.lastGameState = null;
        this.syncCallbacks = new Map();
        
        // UI elements
        this.multiplayerUI = null;
        
        console.log('MultiplayerManager initialized in GUTS engine');
    }
    
    // GUTS Manager Interface
    init(params) {
        // Called by GUTS SceneManager with parameters from scene JSON
        this.params = params || {};
        
        // Check if Socket.IO is available
        if (typeof io === 'undefined') {
            console.warn('Socket.IO not available - multiplayer disabled');
            this.isAvailable = false;
            return;
        }
        
        this.isAvailable = true;
        this.initializeUI();
        this.enhanceGameModeManager();
        
        console.log('MultiplayerManager initialized with params:', params);
    }
    
    // =============================================
    // GUTS INTEGRATION METHODS
    // =============================================
    
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
    
    enhancePhaseSystem() {
        // Override PhaseSystem ready button behavior for multiplayer
        if (this.game.phaseSystem) {
            const originalToggleReady = this.game.phaseSystem.toggleReady.bind(this.game.phaseSystem);
            
            this.game.phaseSystem.toggleReady = () => {
                if (this.isInMultiplayerGame()) {
                    return this.submitPlacements();
                } else {
                    return originalToggleReady();
                }
            };
        }
    }
    
    enhancePlacementSystem() {
        // Override PlacementSystem enemy placement for multiplayer
        if (this.game.placementSystem) {
            const originalPlaceEnemyUnits = this.game.placementSystem.placeEnemyUnits.bind(this.game.placementSystem);
            
            this.game.placementSystem.placeEnemyUnits = (strategy, onComplete) => {
                if (this.isInMultiplayerGame()) {
                    // In multiplayer, enemy units come from opponent placements
                    // This is handled by applyOpponentPlacements()
                    if (onComplete && typeof onComplete === 'function') {
                        onComplete();
                    }
                    return;
                } else {
                    return originalPlaceEnemyUnits(strategy, onComplete);
                }
            };
        }
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
        this.isMultiplayer = false;
        this.playerId = null;
        this.roomId = null;
        this.opponents.clear();
    }
    
    handleDisconnection() {
        if (this.isMultiplayer && this.reconnectAttempts < this.maxReconnectAttempts) {
            console.log(`Attempting to reconnect... (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.reconnectAttempts++;
                this.connect().catch(() => {
                    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                        this.handleConnectionLost();
                    }
                });
            }, this.reconnectDelay * this.reconnectAttempts);
        }
    }
    
    handleConnectionError() {
        this.showNotification('Connection failed. Please check your internet connection.', 'error');
    }
    
    handleConnectionLost() {
        this.showNotification('Lost connection to server. Returning to main menu.', 'error');
        this.exitMultiplayer();
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
                this.isMultiplayer = true;
                this.updateGameStateFromServer(data.gameState);
                
                console.log(`Created room ${this.roomId} as ${this.playerId}`);
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
                this.isMultiplayer = true;
                this.updateGameStateFromServer(data.gameState);
                
                console.log(`Joined room ${this.roomId} as ${this.playerId}`);
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
                this.isMultiplayer = true;
                this.updateGameStateFromServer(data.gameState);
                
                console.log(`Quick matched into room ${this.roomId} as ${this.playerId}`);
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
        this.exitMultiplayer();
    }
    
    exitMultiplayer() {
        this.isMultiplayer = false;
        this.playerId = null;
        this.roomId = null;
        this.opponents.clear();
        this.hideMultiplayerUI();
        
        // Return to main menu using GUTS ScreenManager
        if (this.game.screenManager) {
            this.game.screenManager.showMainMenu();
        }
    }
    
    // =============================================
    // GAME STATE SYNCHRONIZATION
    // =============================================
    
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
        
        // Update UI
        this.updateMultiplayerUI(serverGameState);
        
        // Handle phase-specific updates
        this.handlePhaseUpdate(serverGameState);
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
    
    // =============================================
    // PLACEMENT SYNCHRONIZATION
    // =============================================
    
    submitPlacements() {
        if (!this.isMultiplayer || !this.socket) {
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
    
    syncPlacementPhase(gameState) {
        // Enable placement for local player
        if (this.game.phaseSystem && this.game.state.phase !== 'placement') {
            this.game.phaseSystem.startPlacementPhase();
        }
        
        // Update placement timer
        if (gameState.placementTimeRemaining > 0) {
            this.game.state.phaseTimeLeft = gameState.placementTimeRemaining;
        }
        
        // Show opponent readiness
        this.updateOpponentReadiness(gameState);
    }
    
    updateOpponentReadiness(gameState) {
        let readyCount = 0;
        let totalPlayers = gameState.players.length;
        
        gameState.players.forEach(player => {
            if (player.ready) readyCount++;
        });
        
        const waitingFor = totalPlayers - readyCount;
        if (waitingFor > 0) {
            this.updateWaitingStatus(`Waiting for ${waitingFor} player(s) to deploy...`);
        } else {
            this.updateWaitingStatus('All players ready! Battle starting...');
        }
    }
    
    // =============================================
    // BATTLE SYNCHRONIZATION
    // =============================================
    
    syncBattlePhase(gameState) {
        // Apply opponent placements to battlefield
        this.applyOpponentPlacements(gameState);
        
        // Start local battle simulation
        if (this.game.phaseSystem) {
            this.game.phaseSystem.startBattlePhase();
        }
        
        this.updateWaitingStatus('Battle in progress...');
    }
    
    applyOpponentPlacements(gameState) {
        if (!this.game.placementSystem) return;
        
        // Clear existing enemy placements
        this.game.placementSystem.enemyPlacements = [];
        
        // Apply placements from opponents
        gameState.players.forEach(player => {
            if (player.id !== this.playerId && player.armyPlacements) {
                player.armyPlacements.forEach(placement => {
                    this.createEnemyPlacementFromServer(placement, player);
                });
            }
        });
    }
    
    createEnemyPlacementFromServer(serverPlacement, opponent) {
        // Mirror the opponent's placement to our enemy side
        const mirroredGridPos = this.mirrorGridPosition(serverPlacement.gridPosition);
        
        const enemyPlacement = {
            placementId: `enemy_${opponent.id}_${serverPlacement.placementId}`,
            gridPosition: mirroredGridPos,
            unitType: serverPlacement.unitType,
            cells: serverPlacement.cells.map(cell => this.mirrorGridPosition(cell)),
            roundPlaced: this.game.state.round,
            isSquad: true,
            timestamp: Date.now()
        };
        
        // Create the actual units using GUTS systems
        if (this.game.unitCreationManager && this.game.gridSystem) {
            const worldPos = this.game.gridSystem.gridToWorld(mirroredGridPos.x, mirroredGridPos.z);
            const squadUnits = [];
            
            // Create units for the squad
            const unitPositions = this.game.squadManager?.calculateUnitPositions(
                mirroredGridPos, 
                this.game.squadManager.getSquadData(serverPlacement.unitType), 
                this.game.gridSystem
            ) || [{ x: worldPos.x, z: worldPos.z }];
            
            unitPositions.forEach(pos => {
                const entityId = this.game.unitCreationManager.create(
                    pos.x, 
                    this.game.unitCreationManager.getTerrainHeight(pos.x, pos.z), 
                    pos.z, 
                    serverPlacement.unitType, 
                    'enemy'
                );
                
                squadUnits.push({
                    entityId: entityId,
                    position: { x: pos.x, y: 0, z: pos.z }
                });
            });
            
            enemyPlacement.squadUnits = squadUnits;
        }
        
        this.game.placementSystem.enemyPlacements.push(enemyPlacement);
    }
    
    mirrorGridPosition(gridPos) {
        // Mirror position from opponent's side to our enemy side
        const gridSize = this.game.gridSystem?.gridSize || 32;
        return {
            x: gridSize - 1 - gridPos.x,
            z: gridPos.z
        };
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
    
    handlePlayerJoined(data) {
        this.showNotification(`${data.player.name} joined the game!`, 'info');
        
        // Start game if room is now full
        if (data.gameState.players.length === data.gameState.maxPlayers && 
            data.gameState.gameState === 'waiting') {
            this.showNotification('Game starting!', 'success');
            
            // Make sure we're on the game screen
            this.transitionToGameScreen();
            
            // Initialize game systems using GUTS
            if (this.game.uiSystem) {
                this.game.uiSystem.start();
            }
        }
    }
    
    handlePlayerLeft(data) {
        const opponent = this.opponents.get(data.playerId);
        const playerName = opponent ? opponent.name : 'Player';
        this.showNotification(`${playerName} left the game`, 'warning');
        
        if (data.gameState.gameState !== 'waiting') {
            this.showNotification('Game ended due to player disconnect', 'error');
            setTimeout(() => this.exitMultiplayer(), 3000);
        }
    }
    
    handleBattleResolved(data) {
        const results = data.battleResults;
        
        if (results.winner === this.playerId) {
            this.showNotification('Victory! You won this round!', 'success');
        } else {
            this.showNotification('Defeat! Better luck next round!', 'warning');
        }
        
        // Update health display
        const myResults = results.playerResults[this.playerId];
        if (myResults && this.game.teamHealthSystem) {
            this.game.teamHealthSystem.setPlayerHealth(myResults.healthRemaining);
        }
    }
    
    handleGameEnded(data) {
        const finalWinner = data.winner;
        
        if (finalWinner === this.playerId) {
            this.showNotification('🎉 GAME WON! Congratulations! 🎉', 'victory');
        } else {
            const winnerName = this.opponents.get(finalWinner)?.name || 'Opponent';
            this.showNotification(`Game Over! ${winnerName} wins!`, 'defeat');
        }
        
        setTimeout(() => {
            this.showFinalStats(data.finalStats);
        }, 2000);
    }
    
    handleRoomClosed(data) {
        this.showNotification(`Room closed: ${data.reason}`, 'error');
        this.exitMultiplayer();
    }
    
    // =============================================
    // UI MANAGEMENT
    // =============================================
    
    initializeUI() {
        // Create multiplayer UI elements integrated with existing GUTS UI
        this.createMultiplayerElements();
        this.addMultiplayerStyles();
    }
    
    handleMultiplayerModeSelection(mode) {
        this.showMultiplayerSetup(mode);
    }
    
    showMultiplayerSetup(mode) {
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
                await this.startMultiplayerCreateRoom(getPlayerName(), mode.maxPlayers, dialog);
            });
        }

        if (joinRoomBtn) {
            joinRoomBtn.addEventListener('click', async () => {
                const roomId = roomIdInput.value.trim().toUpperCase();
                if (roomId) {
                    await this.startMultiplayerJoinRoom(roomId, getPlayerName(), dialog);
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
    
    async startMultiplayerQuickMatch(playerName, dialog) {
        try {
            this.showLoadingInDialog(dialog, 'Finding opponent...');
            await this.connect();
            await this.quickMatch(playerName);
            document.body.removeChild(dialog);
            
            // Transition to game screen
            this.transitionToGameScreen();
        } catch (error) {
            console.error('Quick match failed:', error);
            this.showErrorInDialog(dialog, 'Failed to find match. Please try again.');
        }
    }
    
    async startMultiplayerCreateRoom(playerName, maxPlayers, dialog) {
        try {
            this.showLoadingInDialog(dialog, 'Creating room...');
            await this.connect();
            const result = await this.createRoom(playerName, maxPlayers);
            document.body.removeChild(dialog);
            
            // Show room ID and transition to waiting
            this.showRoomCreatedDialog(result.roomId);
            
        } catch (error) {
            console.error('Room creation failed:', error);
            this.showErrorInDialog(dialog, 'Failed to create room. Please try again.');
        }
    }
    
    async startMultiplayerJoinRoom(roomId, playerName, dialog) {
        try {
            this.showLoadingInDialog(dialog, 'Joining room...');
            await this.connect();
            await this.joinRoom(roomId, playerName);
            document.body.removeChild(dialog);
            
            // Transition to game screen
            this.transitionToGameScreen();
        } catch (error) {
            console.error('Failed to join room:', error);
            this.showErrorInDialog(dialog, `Failed to join room "${roomId}". Please check the Room ID and try again.`);
        }
    }
    
    // =============================================
    // SCREEN TRANSITION METHODS
    // =============================================
    
    transitionToGameScreen() {
        console.log('MultiplayerManager: Transitioning to game screen');
        
        // Use GUTS ScreenManager with EventManager pattern
        if (this.game.screenManager && this.game.screenManager.showGameScreen) {
            this.game.screenManager.showGameScreen();
        } else if (this.game.eventManager && this.game.eventManager.setScreen) {
            // Use EventManager directly if ScreenManager not available
            this.game.eventManager.setScreen('gameScreen');
        } else {
            // Fallback: manually switch screens
            this.switchToGameScreenManually();
        }
        
        // Initialize game for multiplayer
        this.initializeMultiplayerGame();
    }
    
    switchToGameScreenManually() {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        // Show game screen
        const gameScreen = document.getElementById('gameScreen');
        if (gameScreen) {
            gameScreen.classList.add('active');
        } else {
            console.error('Game screen not found! Make sure gameScreen element exists in your HTML.');
        }
    }
    
    initializeMultiplayerGame() {
        // Initialize game state for multiplayer
        if (this.game.state) {
            this.game.state.round = 1;
            this.game.state.phase = 'waiting';
            this.game.state.isPaused = false;
        }
        
        // Start game systems if available
        if (this.game.uiSystem && this.game.uiSystem.start) {
            this.game.uiSystem.start();
        }
        
        // Initialize other systems as needed
        console.log('Multiplayer game initialized, waiting for all players...');
    }
    
    showRoomCreatedDialog(roomId) {
        const dialog = document.createElement('div');
        dialog.className = 'multiplayer-setup-dialog';
        dialog.innerHTML = `
            <div class="setup-content">
                <h2>🏠 Room Created!</h2>
                <div style="background: rgba(0,255,0,0.1); border: 2px solid #00ff00; border-radius: 5px; padding: 1rem; margin: 1rem 0;">
                    <h3>Share this Room ID:</h3>
                    <div style="font-size: 2rem; color: #00ffff; margin: 1rem 0; letter-spacing: 2px;">${roomId}</div>
                </div>
                <p>Share this code with your friend so they can join your room!</p>
                <button id="continueToRoomBtn" class="btn btn-primary">🎮 CONTINUE TO ROOM</button>
                <button id="copyRoomIdBtn" class="btn btn-secondary">📋 COPY ROOM ID</button>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // Event listeners
        document.getElementById('continueToRoomBtn').addEventListener('click', () => {
            document.body.removeChild(dialog);
            this.transitionToGameScreen();
        });
        
        document.getElementById('copyRoomIdBtn').addEventListener('click', () => {
            navigator.clipboard.writeText(roomId).then(() => {
                const btn = document.getElementById('copyRoomIdBtn');
                const originalText = btn.textContent;
                btn.textContent = '✅ COPIED!';
                setTimeout(() => {
                    btn.textContent = originalText;
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
                btn.textContent = '✅ COPIED!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            });
        });
    }
    
    showLoadingInDialog(dialog, message) {
        const content = dialog.querySelector('.setup-content');
        content.innerHTML = `
            <div class="loading-spinner"></div>
            <p>${message}</p>
        `;
    }
    showErrorInDialog(dialog, errorMessage) {
        const content = dialog.querySelector('.setup-content');
        content.innerHTML = `
            <div class="error-message">❌ ${errorMessage}</div>
            <button onclick="this.parentElement.parentElement.parentElement.remove()" class="btn">Close</button>
        `;
    }
    
    createMultiplayerElements() {
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
    
    showNotification(message, type = 'info', duration = 4000) {
        const notificationContainer = document.getElementById('multiplayerNotifications');
        if (!notificationContainer) return;
        
        const notification = document.createElement('div');
        notification.className = `multiplayer-notification notification-${type}`;
        notification.textContent = message;
        
        notificationContainer.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentElement) {
                notification.parentElement.removeChild(notification);
            }
        }, duration);
    }
    
    updateMultiplayerUI(gameState) {
        // Update opponent info
        const opponent = gameState.players.find(p => p.id !== this.playerId);
        if (opponent) {
            const opponentName = document.getElementById('opponentName');
            const opponentHealth = document.getElementById('opponentHealth');
            const opponentGold = document.getElementById('opponentGold');
            
            if (opponentName) opponentName.textContent = opponent.name;
            if (opponentHealth) opponentHealth.textContent = opponent.health;
            if (opponentGold) opponentGold.textContent = opponent.gold;
        }
        
        // Show/hide HUD based on game state
        const hud = document.getElementById('multiplayerHUD');
        if (hud) {
            hud.style.display = (gameState.gameState !== 'waiting' && gameState.gameState !== 'ended') ? 'block' : 'none';
        }
    }
    
    updateWaitingStatus(message) {
        // Update battle log or notification system
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(message);
        }
    }
    
    hideMultiplayerUI() {
        const hud = document.getElementById('multiplayerHUD');
        if (hud) hud.style.display = 'none';
    }
    
    showFinalStats(finalStats) {
        const statsHTML = `
            <div class="multiplayer-final-stats">
                <h2>🏆 Final Results</h2>
                <div class="stats-grid">
                    ${Object.entries(finalStats).map(([playerId, stats]) => `
                        <div class="player-final-stats ${playerId === this.playerId ? 'my-stats' : ''}">
                            <h3>${stats.name} ${playerId === this.playerId ? '(You)' : ''}</h3>
                            <div>Rounds Won: ${stats.wins}</div>
                            <div>Final Health: ${stats.health}</div>
                            <div>Final Gold: ${stats.finalGold}</div>
                        </div>
                    `).join('')}
                </div>
                <button class="btn btn-primary" onclick="this.parentElement.remove(); window.APP.gameInstance.multiplayerManager.exitMultiplayer();">Return to Menu</button>
            </div>
        `;
        
        const overlay = document.createElement('div');
        overlay.className = 'multiplayer-stats-overlay';
        overlay.innerHTML = statsHTML;
        document.body.appendChild(overlay);
    }
    
    addMultiplayerStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Multiplayer UI Styles for GUTS Engine */
            .multiplayer-setup-dialog {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.9); display: flex; justify-content: center; align-items: center;
                z-index: 2000;
            }
            
            .setup-content {
                background: linear-gradient(145deg, #1a1a2e, #16213e);
                border: 2px solid #00ffff; border-radius: 10px; padding: 2rem;
                max-width: 500px; width: 90%; text-align: center; color: white;
            }
            
            .setup-content h2 { color: #00ffff; margin-bottom: 1rem; }
            
            .player-name-input { margin: 2rem 0; }
            .player-name-input label { display: block; margin-bottom: 0.5rem; color: #ccc; }
            .player-name-input input {
                width: 100%; padding: 0.8rem; border: 2px solid #333; border-radius: 5px;
                background: #111; color: white; font-size: 1rem;
            }
            .player-name-input input:focus { border-color: #00ffff; outline: none; }
            
            .room-join-section { margin-top: 1rem; display: flex; gap: 0.5rem; }
            .room-join-section input {
                flex: 1; padding: 0.8rem; border: 2px solid #333; border-radius: 5px;
                background: #111; color: white; text-transform: uppercase;
            }
            
            .opponent-info {
                background: rgba(0,0,0,0.8); border: 2px solid #ff4444;
                border-radius: 5px; padding: 1rem; color: white; min-width: 200px;
            }
            
            .opponent-info h4 { color: #ff4444; margin-bottom: 0.5rem; }
            .opponent-stats div { margin: 0.25rem 0; font-size: 0.9rem; }
            
            .multiplayer-notification {
                background: rgba(0,0,0,0.9); border: 2px solid; border-radius: 5px;
                padding: 1rem 2rem; margin: 0.5rem; font-weight: bold;
                animation: notificationSlide 0.3s ease-out;
            }
            
            .notification-info { border-color: #00ffff; color: #00ffff; }
            .notification-success { border-color: #00ff00; color: #00ff00; }
            .notification-warning { border-color: #ffff00; color: #ffff00; }
            .notification-error { border-color: #ff4444; color: #ff4444; }
            .notification-victory { 
                border-color: #00ff00; color: #00ff00; 
                animation: victoryGlow 1s ease-in-out infinite; 
            }
            .notification-defeat { border-color: #ff4444; color: #ff4444; }
            
            @keyframes notificationSlide {
                from { transform: translateX(-50%) translateY(-20px); opacity: 0; }
                to { transform: translateX(-50%) translateY(0); opacity: 1; }
            }
            
            @keyframes victoryGlow {
                0%, 100% { box-shadow: 0 0 5px #00ff00; }
                50% { box-shadow: 0 0 20px #00ff00, 0 0 30px #00ff00; }
            }
            
            .error-message {
                color: #ff4444; padding: 1rem; margin: 1rem 0;
                border: 1px solid #ff4444; border-radius: 5px;
                background: rgba(255, 68, 68, 0.1);
            }
            
            .loading-spinner {
                width: 40px; height: 40px; border: 3px solid #333;
                border-top: 3px solid #00ffff; border-radius: 50%;
                animation: spin 1s linear infinite; margin: 1rem auto;
            }
            
            .multiplayer-stats-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.9); display: flex; justify-content: center; align-items: center;
                z-index: 2000;
            }
            
            .multiplayer-final-stats {
                background: linear-gradient(145deg, #1a1a2e, #16213e);
                border: 2px solid #00ffff; border-radius: 10px; padding: 2rem;
                max-width: 600px; width: 90%; text-align: center; color: white;
            }
            
            .multiplayer-final-stats h2 { color: #00ffff; margin-bottom: 2rem; }
            
            .player-final-stats {
                background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
                border-radius: 5px; padding: 1rem; margin: 1rem;
            }
            
            .player-final-stats.my-stats {
                border-color: #00ff00; background: rgba(0,255,0,0.1);
            }
            
            .pvp { background: #440044; color: #ff44ff; }
        `;
        
        document.head.appendChild(style);
    }
    
    // =============================================
    // UPGRADE SYNCHRONIZATION
    // =============================================
    
    syncUpgradePhase(gameState) {
        this.showUpgradeSelection();
        this.updateWaitingStatus('Choose your upgrades!');
    }
    
    submitUpgrades(upgrades) {
        if (!this.isMultiplayer || !this.socket) {
            return false;
        }
        
        this.socket.emit('submit_upgrades', {
            upgrades: upgrades
        });
        
        this.showNotification('Upgrades selected! Waiting for opponent...', 'info');
        return true;
    }
    
    showUpgradeSelection() {
        const upgradeModal = document.createElement('div');
        upgradeModal.className = 'multiplayer-upgrade-modal';
        upgradeModal.innerHTML = `
            <div class="upgrade-content">
                <h2>⚡ Choose Your Upgrades</h2>
                <div class="upgrade-options">
                    <div class="upgrade-option" data-upgrade="damage">
                        <h3>🗡️ Combat Training</h3>
                        <p>+10% damage to all units</p>
                    </div>
                    <div class="upgrade-option" data-upgrade="health">
                        <h3>🛡️ Reinforced Armor</h3>
                        <p>+15% health to all units</p>
                    </div>
                    <div class="upgrade-option" data-upgrade="speed">
                        <h3>⚡ Tactical Mobility</h3>
                        <p>+20% movement speed</p>
                    </div>
                </div>
                <button id="confirmUpgrades" class="btn btn-primary">✅ Confirm Selection</button>
            </div>
        `;
        
        document.body.appendChild(upgradeModal);
        
        // Handle upgrade selection
        const selectedUpgrades = [];
        const upgradeOptions = upgradeModal.querySelectorAll('.upgrade-option');
        
        upgradeOptions.forEach(option => {
            option.addEventListener('click', () => {
                const upgrade = option.dataset.upgrade;
                if (selectedUpgrades.includes(upgrade)) {
                    selectedUpgrades.splice(selectedUpgrades.indexOf(upgrade), 1);
                    option.classList.remove('selected');
                } else if (selectedUpgrades.length < 2) {
                    selectedUpgrades.push(upgrade);
                    option.classList.add('selected');
                }
            });
        });
        
        document.getElementById('confirmUpgrades').addEventListener('click', () => {
            this.submitUpgrades(selectedUpgrades);
            document.body.removeChild(upgradeModal);
        });
    }
    
    syncGameEnd(gameState) {
        if (this.game.state) {
            this.game.state.phase = 'ended';
        }
    }
    
    // =============================================
    // INTEGRATION HOOKS FOR GUTS SYSTEMS
    // =============================================
    
    integrateWithSystems() {
        // Called after all systems are loaded
       // this.enhancePhaseSystem();
       // this.enhancePlacementSystem();
        
        // Hook into existing UI events
        this.integrateWithInputManager();
    }
    
    integrateWithInputManager() {
        // Override ready button behavior for multiplayer
        if (this.game.inputManager) {
            // Find and override the ready button event
            const readyButton = document.getElementById('readyButton');
            if (readyButton) {
                // Remove existing listeners and add multiplayer-aware one
                const newReadyButton = readyButton.cloneNode(true);
                readyButton.parentNode.replaceChild(newReadyButton, readyButton);
                
                newReadyButton.addEventListener('click', () => {
                    if (this.isInMultiplayerGame()) {
                        this.submitPlacements();
                    } else if (this.game.phaseSystem) {
                        this.game.phaseSystem.toggleReady();
                    }
                });
            }
        }
    }
    
    // =============================================
    // PUBLIC API METHODS
    // =============================================
    
    isInMultiplayerGame() {
        return this.isMultiplayer && this.roomId && this.playerId;
    }
    
    getMultiplayerStatus() {
        return {
            isMultiplayer: this.isMultiplayer,
            isConnected: this.isConnected,
            roomId: this.roomId,
            playerId: this.playerId,
            opponentCount: this.opponents.size,
            lastGameState: this.lastGameState,
            isAvailable: this.isAvailable
        };
    }
    
    requestGameStateUpdate() {
        if (this.socket && this.isConnected) {
            this.socket.emit('get_game_state');
        }
    }
    
    // =============================================
    // GUTS LIFECYCLE METHODS
    // =============================================
    
    // Called when scene is being destroyed
    dispose() {
        this.disconnect();
        
        // Remove UI elements
        const elementsToRemove = [
            'multiplayerHUD',
            'multiplayerNotifications'
        ];
        
        elementsToRemove.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.remove();
            }
        });
        
        // Remove multiplayer modes from GameModeManager
        if (this.game.gameModeManager && this.game.gameModeManager.modes) {
            delete this.game.gameModeManager.modes.multiplayer_1v1;
            delete this.game.gameModeManager.modes.multiplayer_quick;
        }
        
        console.log('MultiplayerManager disposed');
    }
    
    // Called when game systems are ready
    onSystemsReady() {
        // Integrate with systems after they're all loaded
        this.integrateWithSystems();
        console.log('MultiplayerManager integrated with GUTS systems');
    }
}