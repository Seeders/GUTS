class LobbyUISystem extends GUTS.BaseSystem {
    static services = [
        'showLobby',
        'updateLobby',
        'getSelectedLevel',
        'handleMultiplayerModeSelection',
        'showSkirmishLobby'
    ];

    constructor(game) {
        super(game);
        this.game.lobbyUISystem = this;
        this.game.uiSystem = this; // For compatibility with showNotification calls

        this.currentScreen = null;
        this.roomId = null;
        this.config = {
            numBackgrounds: 5
        };

        this.networkUnsubscribers = [];
    }

    init(params) {
        this.params = params || {};
        this.initializeUI();
    }

    initializeUI() {
        let randomBG = Math.floor(Math.random() * (this.config.numBackgrounds + 1));
        document.body.classList.add(`bg${randomBG}`);

        const multiplayerHTML = `
            <div id="multiplayerNotifications">
                <!-- Notifications appear here -->
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', multiplayerHTML);
    }

    handleMultiplayerModeSelection(mode) {
        const setupDialog = document.createElement('div');
        setupDialog.className = 'multiplayer-setup-dialog modal';

        const interfaceConfig = this.collections.interfaces[mode.interfaceId];
        setupDialog.innerHTML = interfaceConfig?.html || `Interface ${mode.interfaceId} not found`;

        document.body.appendChild(setupDialog);
        this.setupMultiplayerDialogEvents(setupDialog, mode);

        this.startLobbyRefresh(setupDialog, mode);
    }

    setupMultiplayerDialogEvents(dialog, mode) {
        const playerNameInput = dialog.querySelector('#playerName');
        const quickMatchBtn = dialog.querySelector('#quickMatchBtn');
        const createRoomBtn = dialog.querySelector('#createRoomBtn');
        const refreshRoomsBtn = dialog.querySelector('#refreshRoomsBtn');
        const cancelBtn = dialog.querySelector('#cancelMultiplayerBtn');

        // Use the player name from connection dialog (stored in game.state)
        const storedPlayerName = this.game.state.playerName || 'Player';
        if (playerNameInput) {
            playerNameInput.value = storedPlayerName;
            // Hide the name input section since we already collected it
            const nameSection = playerNameInput.closest('.player-name-input');
            if (nameSection) {
                nameSection.style.display = 'none';
            }
        }

        const getPlayerName = () => storedPlayerName;

        if (quickMatchBtn) {
            quickMatchBtn.addEventListener('click', () => {
                this.stopLobbyRefresh();
                this.game.call('startQuickMatch', getPlayerName());
                dialog.remove();
            });
        }

        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', () => {
                this.stopLobbyRefresh();
                this.game.call('createRoom', getPlayerName(), mode.maxPlayers);
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
    }

    startLobbyRefresh(dialog, mode) {
        // Use the stored player name from game.state
        const storedPlayerName = this.game.state.playerName || 'Player';
        const getPlayerName = () => storedPlayerName;

        this.fetchAndDisplayRooms(dialog, mode, getPlayerName);

        this.lobbyRefreshInterval = setInterval(() => {
            this.fetchAndDisplayRooms(dialog, mode, getPlayerName);
        }, 3000);
    }

    stopLobbyRefresh() {
        if (this.lobbyRefreshInterval) {
            clearInterval(this.lobbyRefreshInterval);
            this.lobbyRefreshInterval = null;
        }
        this.hasLoadedRooms = false;
        this.hasShownError = false;
    }

    async fetchAndDisplayRooms(dialog, mode, getPlayerName) {
        const loadingIndicator = dialog.querySelector('#roomsLoadingIndicator');
        const tableBody = dialog.querySelector('#roomsTableBody');

        try {
            if (loadingIndicator && !this.hasLoadedRooms) {
                loadingIndicator.style.display = 'block';
            }

            const response = await fetch('/api/rooms');
            if (!response.ok) {
                throw new Error('Failed to fetch rooms');
            }

            const rooms = await response.json();

            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
                this.hasLoadedRooms = true;
            }

            if (tableBody) {
                const availableRooms = rooms.filter(room =>
                    room.playerCount > 0 &&
                    room.playerCount < room.maxPlayers &&
                    !room.isActive
                );

                if (availableRooms.length === 0) {
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
                    const emptyRow = tableBody.querySelector('.empty-room-row');
                    if (emptyRow) {
                        emptyRow.remove();
                    }

                    const existingRows = new Map();
                    tableBody.querySelectorAll('tr[data-room-id]').forEach(row => {
                        existingRows.set(row.getAttribute('data-room-id'), row);
                    });

                    availableRooms.forEach(room => {
                        const existingRow = existingRows.get(room.id);
                        const statusText = room.playerCount === 0 ? 'Waiting' : `${room.playerCount}/${room.maxPlayers} Players`;
                        const statusColor = room.playerCount === 0 ? '#ffaa00' : '#00aaff';

                        if (existingRow) {
                            const playerCountCell = existingRow.children[1];
                            const statusCell = existingRow.children[2];

                            if (playerCountCell.textContent !== `${room.playerCount}/${room.maxPlayers}`) {
                                playerCountCell.textContent = `${room.playerCount}/${room.maxPlayers}`;
                            }

                            if (statusCell.textContent !== statusText) {
                                statusCell.textContent = statusText;
                                statusCell.style.color = statusColor;
                            }

                            existingRows.delete(room.id);
                        } else {
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

                            const joinBtn = row.querySelector('.join-room-btn');
                            joinBtn.addEventListener('click', () => {
                                const roomId = joinBtn.getAttribute('data-room-id');
                                const playerName = getPlayerName();
                                this.stopLobbyRefresh();
                                this.game.call('joinRoom', roomId, playerName);
                                dialog.remove();
                            });

                            tableBody.appendChild(row);
                        }
                    });

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
        const btn = document.getElementById('player1ReadyBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Updating...';
        }
        this.game.call('toggleReady');
    }

    leaveRoom() {
        this.game.call('leaveRoom');
        this.exitToMainMenu();
    }

    setupEventListeners() {
        if (!this.boundHandlers) {
            this.boundHandlers = {
                readyClick: this.toggleReady.bind(this),
                leaveClick: this.leaveRoom.bind(this),
                loadGameClick: this.openLoadGameDialog.bind(this),
                loadGameFileChange: this.handleLoadGameFile.bind(this)
            };
        }

        const readyBtn = document.getElementById('player1ReadyBtn');
        const leaveBtn = document.getElementById('leaveLobbyBtn');
        const loadGameBtn = document.getElementById('loadGameBtn');
        const loadGameFileInput = document.getElementById('loadGameFileInput');

        if (readyBtn) {
            readyBtn.removeEventListener('click', this.boundHandlers.readyClick);
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
            const saveData = await this.game.call('importSaveFile', file);

            if (!saveData) {
                this.showNotification('Invalid save file', 'error');
                return;
            }

            this.game.call('uploadSaveData', saveData, (success, response) => {
                if (success) {
                    this.showNotification(`Save uploaded: ${saveData.saveName || 'Unknown'}. Game will load this save.`, 'success', 5000);

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
            console.error('[LobbyUISystem] Error loading save file:', error);
            this.showNotification('Failed to load save file: ' + error.message, 'error');
        }

        event.target.value = '';
    }

    showLobby(gameState, roomId) {
        this.currentScreen = 'lobby';
        this.roomId = roomId;

        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById('multiplayerLobby').classList.add('active');

        this.populateLevelSelector();
        this.updateLobby(gameState);
    }

    populateLevelSelector() {
        this._populateLevelSelect('levelSelect', (value) => {
            this.selectedLevel = value;
        });
    }

    /**
     * Shared level selector population
     */
    _populateLevelSelect(elementId, onChange) {
        const levelSelect = document.getElementById(elementId);
        if (!levelSelect) return;

        const levels = this.collections?.levels || {};

        levelSelect.innerHTML = '';

        for (const [levelId, levelData] of Object.entries(levels)) {
            const option = document.createElement('option');
            option.value = levelId;
            option.textContent = levelData.title || levelId;
            levelSelect.appendChild(option);
        }

        onChange(levelSelect.value);
        levelSelect.addEventListener('change', (e) => {
            onChange(e.target.value);
        });
    }

    getSelectedLevel() {
        return this.selectedLevel;
    }

    updateLobby(gameState) {
        if (!gameState) return;

        const myPlayerId = this.game.clientNetworkManager.playerId;

        const lobbyRoomId = document.getElementById('lobbyRoomId');
        if (lobbyRoomId) {
            lobbyRoomId.textContent = this.roomId || '------';
        }

        const playerCount = document.getElementById('playerCount');
        if (playerCount) {
            playerCount.textContent = gameState.players?.length || 0;
        }

        if (gameState.players) {
            const myPlayer = gameState.players.find(p => p.id === myPlayerId);
            const opponent = gameState.players.find(p => p.id !== myPlayerId);

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
                const player2Info = document.getElementById('player2Info');
                if (player2Info) {
                    player2Info.style.display = 'none';
                }
            }

            const startBtn = document.getElementById('startGameBtn');
            if (startBtn && myPlayer?.isHost) {
                const allReady = gameState.players.every(p => p.ready);
                const canStart = gameState.players.length === 2 && allReady;

                startBtn.style.display = gameState.players.length === 2 ? 'block' : 'none';
                startBtn.disabled = !canStart;
                startBtn.textContent = allReady ? '⚡ COMMENCE WAR' : 'Waiting for Ready';
            }

            const loadGameBtn = document.getElementById('loadGameBtn');
            if (loadGameBtn) {
                loadGameBtn.style.display = myPlayer?.isHost ? 'inline-block' : 'none';
            }

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

        this.setupEventListeners();
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

    async exitToMainMenu() {
        this.currentScreen = null;
        this.roomId = null;

        this.game.call('showMainMenu');
        if (!this.game.hasService('showMainMenu')) {
            window.location.reload();
        }
    }

    // ==================== SKIRMISH LOBBY ====================

    showSkirmishLobby(mode) {
        this.currentScreen = 'skirmishLobby';
        this.skirmishMode = mode;
        this.skirmishSelectedTeam = 'left'; // Default to left team

        // Hide all screens and show skirmish lobby
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById('skirmishLobby').classList.add('active');

        // Populate level selector
        this.populateSkirmishLevelSelector();

        // Setup team selector
        this.setupTeamSelector();

        // Setup event listeners
        this.setupSkirmishEventListeners();
    }

    setupTeamSelector() {
        const leftCard = document.getElementById('teamLeftCard');
        const rightCard = document.getElementById('teamRightCard');
        const leftPlayer = document.getElementById('teamLeftPlayer');
        const rightPlayer = document.getElementById('teamRightPlayer');

        if (!leftCard || !rightCard) return;

        // Initialize with default selection (left)
        this.updateTeamSelection('left', leftCard, rightCard, leftPlayer, rightPlayer);

        leftCard.onclick = () => {
            this.skirmishSelectedTeam = 'left';
            this.updateTeamSelection('left', leftCard, rightCard, leftPlayer, rightPlayer);
        };

        rightCard.onclick = () => {
            this.skirmishSelectedTeam = 'right';
            this.updateTeamSelection('right', leftCard, rightCard, leftPlayer, rightPlayer);
        };
    }

    updateTeamSelection(selectedTeam, leftCard, rightCard, leftPlayer, rightPlayer) {
        if (selectedTeam === 'left') {
            leftCard.classList.add('selected');
            rightCard.classList.remove('selected');
            leftPlayer.textContent = '🎮 You';
            rightPlayer.textContent = '🤖 AI';
        } else {
            leftCard.classList.remove('selected');
            rightCard.classList.add('selected');
            leftPlayer.textContent = '🤖 AI';
            rightPlayer.textContent = '🎮 You';
        }
    }

    populateSkirmishLevelSelector() {
        this._populateLevelSelect('skirmishLevelSelect', (value) => {
            this.skirmishSelectedLevel = value;
        });
    }

    setupSkirmishEventListeners() {
        const backBtn = document.getElementById('skirmishBackBtn');
        const startBtn = document.getElementById('skirmishStartBtn');
        const loadBtn = document.getElementById('skirmishLoadBtn');
        const loadFileInput = document.getElementById('skirmishLoadFileInput');

        if (backBtn) {
            backBtn.onclick = () => {
                this.exitSkirmishLobby();
            };
        }

        if (startBtn) {
            startBtn.onclick = () => {
                this.startSkirmishGame();
            };
        }

        if (loadBtn) {
            loadBtn.onclick = () => {
                this.openSkirmishLoadDialog();
            };
        }

        if (loadFileInput) {
            loadFileInput.onchange = (event) => {
                this.handleSkirmishLoadFile(event);
            };
        }
    }

    openSkirmishLoadDialog() {
        const fileInput = document.getElementById('skirmishLoadFileInput');
        if (fileInput) {
            fileInput.click();
        }
    }

    async handleSkirmishLoadFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const saveData = await this.game.call('importSaveFile', file);
            console.log('[LobbyUISystem] Imported save file:', file.name, 'saveData:', saveData ? 'valid' : 'null');

            if (!saveData) {
                this.showNotification('Invalid save file', 'error');
                return;
            }

            console.log('[LobbyUISystem] Setting pendingSaveData, saveVersion:', saveData.saveVersion, 'level:', saveData.level, 'entities:', saveData.ecsData ? 'ecsData present' : (saveData.entities?.length || 0) + ' entities');
            // Store the save data to be loaded when the game starts
            this.game.pendingSaveData = saveData;

            // Update level selector to match the save
            if (saveData.level) {
                const levelSelect = document.getElementById('skirmishLevelSelect');
                if (levelSelect) {
                    levelSelect.value = saveData.level;
                    this.skirmishSelectedLevel = saveData.level;
                }
            }

            this.showNotification(`Save loaded: ${saveData.saveName || file.name}. Click START BATTLE to continue.`, 'success', 5000);

        } catch (error) {
            console.error('[LobbyUISystem] Error loading save file:', error);
            this.showNotification('Failed to load save file: ' + error.message, 'error');
        }

        event.target.value = '';
    }

    exitSkirmishLobby() {
        this.currentScreen = null;
        // Go back to mode selection
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById('gameModeSelect').classList.add('active');
    }

    startSkirmishGame() {
        console.log('[LobbyUISystem] startSkirmishGame called, pendingSaveData:', this.game.pendingSaveData ? 'present' : 'null');
        // Store skirmish configuration in game state
        this.game.state.skirmishConfig = {
            isSkirmish: true,
            selectedLevel: this.skirmishSelectedLevel,
            selectedTeam: this.skirmishSelectedTeam || 'left',
            startingGold: this.skirmishMode?.startingGold || 100
        };

        // Store game mode
        this.game.state.gameMode = {
            id: 'skirmish',
            title: 'Skirmish',
            description: 'Battle against an AI opponent',
            isMultiplayer: false,
            maxPlayers: 1,
            startingGold: this.skirmishMode?.startingGold || 100
        };

        // Start the skirmish game via LocalGameController
        this.game.call('startSkirmishGame');
    }

    dispose() {
        this.stopLobbyRefresh();

        if (this.networkUnsubscribers) {
            this.networkUnsubscribers.forEach(unsubscribe => {
                if (typeof unsubscribe === 'function') {
                    unsubscribe();
                }
            });
            this.networkUnsubscribers = [];
        }
    }
}
