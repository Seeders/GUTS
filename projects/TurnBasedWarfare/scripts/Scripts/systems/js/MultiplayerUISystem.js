class MultiplayerUISystem extends GUTS.BaseSystem {
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

        // Network event cleanup tracking
        this.networkUnsubscribers = [];
    }

    // GUTS Manager Interface
    init(params) {
        this.params = params || {};
        this.initializeUI();
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

            <div id="multiplayerNotifications">
                <!-- Notifications appear here -->
            </div>

            <!-- Game Menu Button -->
            <button id="gameMenuBtn">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="12" cy="5" r="1"></circle>
                    <circle cx="12" cy="19" r="1"></circle>
                </svg>
            </button>

            <!-- Game Menu Modal -->
            <div id="gameMenuModal" class="modal">
                <div class="game-menu-content">
                    <h2>Game Menu</h2>

                    <div class="game-menu-buttons">
                        <button id="gameMenuSaveBtn" class="game-menu-btn save">
                            Save Game
                        </button>

                        <button id="gameMenuOptionsBtn" class="game-menu-btn options">
                            Options
                        </button>

                        <button id="gameMenuLeaveBtn" class="game-menu-btn leave">
                            Leave Game
                        </button>

                        <button id="gameMenuCancelBtn" class="game-menu-btn cancel">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', multiplayerHTML);
        this.setupGameMenuEvents();
    }

    setupGameMenuEvents() {
        // Only set up once to prevent duplicate event listeners
        if (this.gameMenuEventsSetup) {
            return;
        }
        this.gameMenuEventsSetup = true;

        const menuBtn = document.getElementById('gameMenuBtn');
        const menuModal = document.getElementById('gameMenuModal');
        const saveBtn = document.getElementById('gameMenuSaveBtn');
        const optionsBtn = document.getElementById('gameMenuOptionsBtn');
        const leaveBtn = document.getElementById('gameMenuLeaveBtn');
        const cancelBtn = document.getElementById('gameMenuCancelBtn');

        // Store bound handlers for cleanup
        this.gameMenuHandlers = {
            openMenu: () => {
                menuModal.style.display = 'flex';
            },
            closeMenu: () => {
                menuModal.style.display = 'none';
            },
            saveGame: () => {
                this.saveGame();
                menuModal.style.display = 'none';
            },
            showOptions: () => {
                this.showNotification('Options menu coming soon!', 'info');
                menuModal.style.display = 'none';
            },
            confirmLeave: () => {
                if (confirm('Are you sure you want to leave the game?')) {
                    this.leaveGame();
                    menuModal.style.display = 'none';
                }
            },
            closeOnBackground: (e) => {
                if (e.target === menuModal) {
                    menuModal.style.display = 'none';
                }
            }
        };

        // Add event listeners
        if (menuBtn) {
            menuBtn.addEventListener('click', this.gameMenuHandlers.openMenu);
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', this.gameMenuHandlers.saveGame);
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', this.gameMenuHandlers.closeMenu);
        }

        if (optionsBtn) {
            optionsBtn.addEventListener('click', this.gameMenuHandlers.showOptions);
        }

        if (leaveBtn) {
            leaveBtn.addEventListener('click', this.gameMenuHandlers.confirmLeave);
        }

        if (menuModal) {
            menuModal.addEventListener('click', this.gameMenuHandlers.closeOnBackground);
        }
    }

    saveGame() {
        if (!this.game.saveManager) {
            this.showNotification('Save system not available', 'error');
            return;
        }

        try {
            // Get save data and export as file
            const saveData = this.game.saveManager.getSaveData();
            this.game.saveManager.exportSaveFile(saveData);
            this.showNotification('Game saved! File downloaded.', 'success');
        } catch (error) {
            console.error('[MultiplayerUISystem] Error saving game:', error);
            this.showNotification('Failed to save game', 'error');
        }
    }

    async leaveGame() {
        // Send leave room event to server
        if (this.game.networkManager) {
            this.game.networkManager.leaveRoom();
        }

        // Hide game menu button
        const menuBtn = document.getElementById('gameMenuBtn');
        if (menuBtn) {
            menuBtn.style.display = 'none';
        }

        // Hide multiplayer HUD
        const hud = document.getElementById('multiplayerHUD');
        if (hud) {
            hud.style.display = 'none';
        }

        // Hide all game screens
        const lobbyEl = document.getElementById('multiplayerLobby');
        const gameScreen = document.getElementById('gameScreen');
        if (lobbyEl) {
            lobbyEl.classList.remove('active');
        }
        if (gameScreen) {
            gameScreen.classList.remove('active');
        }

        // Reset current screen state
        this.currentScreen = null;
        this.roomId = null;

        // Switch back to lobby scene - this cleans up game systems
        await this.game.switchScene('lobby');

        // Return to main menu (stay connected to server)
        if (this.game.screenManager?.showMainMenu) {
            this.game.screenManager.showMainMenu();
        } else {
            // Fallback: reload page if screenManager not available
            window.location.reload();
        }
    }

    showGameMenu() {
        const menuBtn = document.getElementById('gameMenuBtn');
        if (menuBtn) {
            menuBtn.style.display = 'block';
        }
    }

    hideGameMenu() {
        const menuBtn = document.getElementById('gameMenuBtn');
        if (menuBtn) {
            menuBtn.style.display = 'none';
        }
    }

    handleMultiplayerModeSelection(mode) {
        // Create setup dialog for multiplayer
        const setupDialog = document.createElement('div');
        setupDialog.className = 'multiplayer-setup-dialog modal';

        const interfaceConfig = this.game.getCollections().interfaces[mode.interfaceId]
        setupDialog.innerHTML = interfaceConfig?.html || `Interface ${mode.interfaceId} not found`;

        document.body.appendChild(setupDialog);
        this.setupMultiplayerDialogEvents(setupDialog, mode);

        // Start fetching and displaying available rooms
        this.startLobbyRefresh(setupDialog, mode);
    }

    setupMultiplayerDialogEvents(dialog, mode) {
        const playerNameInput = dialog.querySelector('#playerName');
        const quickMatchBtn = dialog.querySelector('#quickMatchBtn');
        const createRoomBtn = dialog.querySelector('#createRoomBtn');
        const refreshRoomsBtn = dialog.querySelector('#refreshRoomsBtn');
        const cancelBtn = dialog.querySelector('#cancelMultiplayerBtn');

        const getPlayerName = () => playerNameInput.value.trim() || 'Player';

        if (quickMatchBtn) {
            quickMatchBtn.addEventListener('click', () => {
                this.stopLobbyRefresh();
                this.game.networkManager.startQuickMatch(getPlayerName());
                dialog.remove();
            });
        }

        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', () => {
                this.stopLobbyRefresh();
                this.game.networkManager.createRoom(getPlayerName(), mode.maxPlayers);
                dialog.remove();
            });
        }

        if (refreshRoomsBtn) {
            refreshRoomsBtn.addEventListener('click', () => {
                this.fetchAndDisplayRooms(dialog, mode, getPlayerName);
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.stopLobbyRefresh();
                dialog.remove();
            });
        }

        playerNameInput.focus();
        playerNameInput.select();
    }

    startLobbyRefresh(dialog, mode) {
        const playerNameInput = dialog.querySelector('#playerName');
        const getPlayerName = () => playerNameInput.value.trim() || 'Player';

        // Fetch rooms immediately
        this.fetchAndDisplayRooms(dialog, mode, getPlayerName);

        // Set up auto-refresh every 3 seconds
        this.lobbyRefreshInterval = setInterval(() => {
            this.fetchAndDisplayRooms(dialog, mode, getPlayerName);
        }, 3000);
    }

    stopLobbyRefresh() {
        if (this.lobbyRefreshInterval) {
            clearInterval(this.lobbyRefreshInterval);
            this.lobbyRefreshInterval = null;
        }
        // Reset flags for next time lobby is opened
        this.hasLoadedRooms = false;
        this.hasShownError = false;
    }

    async fetchAndDisplayRooms(dialog, mode, getPlayerName) {
        const loadingIndicator = dialog.querySelector('#roomsLoadingIndicator');
        const tableBody = dialog.querySelector('#roomsTableBody');

        try {
            // Only show loading indicator on first load
            if (loadingIndicator && !this.hasLoadedRooms) {
                loadingIndicator.style.display = 'block';
            }

            // Fetch rooms from server
            const response = await fetch('/api/rooms');
            if (!response.ok) {
                throw new Error('Failed to fetch rooms');
            }

            const rooms = await response.json();

            // Hide loading indicator
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
                this.hasLoadedRooms = true;
            }

            if (tableBody) {
                // Filter for available rooms (waiting for players)
                // Show rooms that:
                // 1. Have at least one player (playerCount > 0)
                // 2. Have space for more players (playerCount < maxPlayers)
                // 3. Haven't started yet (!isActive)
                const availableRooms = rooms.filter(room =>
                    room.playerCount > 0 &&
                    room.playerCount < room.maxPlayers &&
                    !room.isActive
                );

                if (availableRooms.length === 0) {
                    // Only update if content changed
                    const emptyRow = tableBody.querySelector('.empty-room-row');
                    if (!emptyRow) {
                        tableBody.innerHTML = `
                            <tr class="empty-room-row">
                                <td colspan="4" style="padding: 2rem; text-align: center; color: #888;">
                                    No available games. Create one to get started!
                                </td>
                            </tr>
                        `;
                    }
                } else {
                    // Remove empty row if it exists
                    const emptyRow = tableBody.querySelector('.empty-room-row');
                    if (emptyRow) {
                        emptyRow.remove();
                    }

                    // Get existing room IDs
                    const existingRows = new Map();
                    tableBody.querySelectorAll('tr[data-room-id]').forEach(row => {
                        existingRows.set(row.getAttribute('data-room-id'), row);
                    });

                    // Update or add rooms
                    availableRooms.forEach(room => {
                        const existingRow = existingRows.get(room.id);
                        const statusText = room.playerCount === 0 ? 'Waiting' : `${room.playerCount}/${room.maxPlayers} Players`;
                        const statusColor = room.playerCount === 0 ? '#ffaa00' : '#00aaff';

                        if (existingRow) {
                            // Update existing row only if data changed
                            const playerCountCell = existingRow.children[1];
                            const statusCell = existingRow.children[2];

                            if (playerCountCell.textContent !== `${room.playerCount}/${room.maxPlayers}`) {
                                playerCountCell.textContent = `${room.playerCount}/${room.maxPlayers}`;
                            }

                            if (statusCell.textContent !== statusText) {
                                statusCell.textContent = statusText;
                                statusCell.style.color = statusColor;
                            }

                            // Mark as processed
                            existingRows.delete(room.id);
                        } else {
                            // Add new room row
                            const row = document.createElement('tr');
                            row.setAttribute('data-room-id', room.id);
                            row.style.borderBottom = '1px solid #333';
                            row.style.transition = 'background 0.2s';
                            row.onmouseenter = () => row.style.background = '#2a2a2a';
                            row.onmouseleave = () => row.style.background = 'transparent';

                            row.innerHTML = `
                                <td style="padding: 1rem; color: #fff; font-weight: bold;">${room.id}</td>
                                <td style="padding: 1rem; text-align: center; color: #aaa;">${room.playerCount}/${room.maxPlayers}</td>
                                <td style="padding: 1rem; text-align: center; color: ${statusColor};">${statusText}</td>
                                <td style="padding: 1rem; text-align: center;">
                                    <button class="join-room-btn" data-room-id="${room.id}"
                                        style="padding: 0.5rem 1.5rem; background: #00aa00; border: none; color: white; cursor: pointer; border-radius: 4px; font-weight: bold;">
                                        Join
                                    </button>
                                </td>
                            `;

                            // Add click handler for join button
                            const joinBtn = row.querySelector('.join-room-btn');
                            joinBtn.addEventListener('click', () => {
                                const roomId = joinBtn.getAttribute('data-room-id');
                                const playerName = getPlayerName();
                                this.stopLobbyRefresh();
                                this.game.networkManager.joinRoom(roomId, playerName);
                                dialog.remove();
                            });

                            tableBody.appendChild(row);
                        }
                    });

                    // Remove rows for rooms that no longer exist
                    existingRows.forEach(row => {
                        row.remove();
                    });
                }
            }
        } catch (error) {
            console.error('Error fetching rooms:', error);
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
            if (tableBody && !this.hasShownError) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="4" style="padding: 2rem; text-align: center; color: #ff4444;">
                            Error loading rooms. Please try again.
                        </td>
                    </tr>
                `;
                this.hasShownError = true;
            }
        }
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
    leaveRoom() {
        this.game.networkManager.leaveRoom();
        this.exitToMainMenu();
    }


    setupEventListeners() {
        // Store bound handlers to enable proper cleanup
        if (!this.boundHandlers) {
            this.boundHandlers = {
                readyClick: this.toggleReady.bind(this),
                leaveClick: this.leaveRoom.bind(this),
                loadGameClick: this.openLoadGameDialog.bind(this),
                loadGameFileChange: this.handleLoadGameFile.bind(this)
            };
        }

        // Clean up any existing listeners
        const readyBtn = document.getElementById('player1ReadyBtn');
        const leaveBtn = document.getElementById('leaveLobbyBtn');
        const loadGameBtn = document.getElementById('loadGameBtn');
        const loadGameFileInput = document.getElementById('loadGameFileInput');

        if (readyBtn) {
            // Remove old listener if it exists
            readyBtn.removeEventListener('click', this.boundHandlers.readyClick);
            // Add new listener
            readyBtn.addEventListener('click', this.boundHandlers.readyClick);
        }

        if (leaveBtn) {
            leaveBtn.removeEventListener('click', this.boundHandlers.leaveClick);
            leaveBtn.addEventListener('click', this.boundHandlers.leaveClick);
        }

        if (loadGameBtn) {
            loadGameBtn.removeEventListener('click', this.boundHandlers.loadGameClick);
            loadGameBtn.addEventListener('click', this.boundHandlers.loadGameClick);
        }

        if (loadGameFileInput) {
            loadGameFileInput.removeEventListener('change', this.boundHandlers.loadGameFileChange);
            loadGameFileInput.addEventListener('change', this.boundHandlers.loadGameFileChange);
        }
    }

    openLoadGameDialog() {
        const fileInput = document.getElementById('loadGameFileInput');
        if (fileInput) {
            fileInput.click();
        }
    }

    async handleLoadGameFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const saveData = await this.game.saveManager.importSaveFile(file);

            if (!saveData) {
                this.showNotification('Invalid save file', 'error');
                return;
            }

            // Send save data to server (host only)
            this.game.networkManager.uploadSaveData(saveData, (success, response) => {
                if (success) {
                    this.showNotification(`Save uploaded: ${saveData.saveName || 'Unknown'}. Game will load this save.`, 'success', 5000);

                    // Update level selector to match save
                    if (saveData.level) {
                        const levelSelect = document.getElementById('levelSelect');
                        if (levelSelect) {
                            levelSelect.value = saveData.level;
                            this.selectedLevel = saveData.level;
                        }
                    }
                } else {
                    this.showNotification('Failed to upload save: ' + (response?.error || 'Unknown error'), 'error');
                }
            });

        } catch (error) {
            console.error('[MultiplayerUISystem] Error loading save file:', error);
            this.showNotification('Failed to load save file: ' + error.message, 'error');
        }

        // Reset file input so same file can be selected again
        event.target.value = '';
    }

    showLobby(gameState, roomId) {
        this.currentScreen = 'lobby';
        this.roomId = roomId;

        // Show lobby screen
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById('multiplayerLobby').classList.add('active');

        // Show game menu button in lobby
        this.showGameMenu();

        // Populate level selector
        this.populateLevelSelector();

        this.updateLobby(gameState);
    }

    populateLevelSelector() {
        const levelSelect = document.getElementById('levelSelect');
        if (!levelSelect) return;

        // Get levels from collections
        const collections = this.game.getCollections();
        const levels = collections?.levels || {};

        // Clear existing options
        levelSelect.innerHTML = '';

        // Add options for each level
        for (const [levelId, levelData] of Object.entries(levels)) {
            const option = document.createElement('option');
            option.value = levelId;
            option.textContent = levelData.title || levelId;
            levelSelect.appendChild(option);
        }

        // Store selected level
        this.selectedLevel = levelSelect.value;
        levelSelect.addEventListener('change', (e) => {
            this.selectedLevel = e.target.value;
        });
    }

    getSelectedLevel() {
        return this.selectedLevel || 'level1';
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

            // Show/hide load game button (only for host)
            const loadGameBtn = document.getElementById('loadGameBtn');
            if (loadGameBtn) {
                loadGameBtn.style.display = myPlayer?.isHost ? 'inline-block' : 'none';
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

        // Set up event listeners after DOM is updated
        this.setupEventListeners();
    }

    onGameStarted(data) {

        this.currentScreen = 'game';

        // Hide lobby, show game
        document.getElementById('multiplayerLobby')?.classList.remove('active');
        document.getElementById('gameScreen')?.classList.add('active');

        // Show game menu button when game starts
        this.showGameMenu();
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
        this.game.gameManager.call('initializeParticleSystem');
        this.game.gameManager.call('initializeEffectsSystem');
    }

    async exitToMainMenu() {
        this.currentScreen = null;
        this.roomId = null;
        this.isHost = false;
        this.gameState = null;

        // Hide game menu button
        this.hideGameMenu();

        // Switch back to lobby scene - this cleans up game systems
        await this.game.switchScene('lobby');

        if (this.game.screenManager?.showMainMenu) {
            this.game.screenManager.showMainMenu();
        } else {
            window.location.reload();
        }
    }

 
    dispose() {
        if (this.networkUnsubscribers) {
            this.networkUnsubscribers.forEach(unsubscribe => {
                if (typeof unsubscribe === 'function') {
                    unsubscribe();
                }
            });
            this.networkUnsubscribers = [];
        }
    }
    onPlacementPhaseStart() {
        const state = this.game.state;
        state.phase = 'placement';
        state.phaseTimeLeft = null; // No timer in multiplayer
        state.playerReady = false;
        state.enemyPlacementComplete = false; // Actually opponent placement
        state.roundEnding = false;          
    }
    
    onBattleEnd() {


        const entitiesToDestroy = new Set();

        [
            "corpse"
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
        
        
    }
       
    startVictoryCelebration(victoriousUnits) {
        // Determine which team won
        const firstUnit = victoriousUnits[0];
        const team = this.game.getComponent(firstUnit, "team");
        const teamType = team?.team || 'player';

        victoriousUnits.forEach(entityId => {
            this.game.gameManager.call('startCelebration', entityId, teamType);
        });
    }

    update() {
        this.updatePhaseUI();
        this.updateGoldDisplay();
        this.updateRoundDisplay();
        this.updateSideDisplay();
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
   
}