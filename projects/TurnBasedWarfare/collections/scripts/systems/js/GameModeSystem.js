class GameModeSystem extends GUTS.BaseSystem {
    static services = [
        'getSelectedMode',
        'setGameMode',
        'showMultiplayerConnect',
        'onMultiplayerConnected'
    ];

    constructor(game) {
        super(game);
        this.game.gameModeSystem = this;
        this.selectedGameMode = null;
        this.modes = null;
        this.multiplayerModes = null;
    }

    init() {
    }

    onSceneLoad() {
        this.modes = this.initializeSinglePlayerModes();
        this.multiplayerModes = this.initializeMultiplayerModes();
        this.setupUI();
    }

    initializeSinglePlayerModes() {
        return {
            skirmish: {
                id: 'skirmish',
                title: 'Skirmish',
                icon: '🤖',
                interfaceId: 'skirmishLobby',
                description: 'Battle against an AI opponent',
                difficulty: 'vs AI',
                difficultyClass: 'pve',
                isMultiplayer: false,
                maxPlayers: 1,
                startingGold: 100,
                onStart: (mode) => {
                    this.game.call('showSkirmishLobby', mode);
                }
            }
        };
    }

    initializeMultiplayerModes() {
        return {
            arena: {
                id: 'arena',
                title: 'Arena',
                icon: '⚔️',
                interfaceId: 'createOrJoinRoom',
                description: 'Battle against another player in real-time strategic combat',
                difficulty: 'Player vs Player',
                difficultyClass: 'pvp',
                isMultiplayer: true,
                maxPlayers: 2,
                startingGold: 100,
                onStart: (mode) => {
                    this.game.call('handleMultiplayerModeSelection', mode);
                }
            }
        };
    }

    setupUI() {
        const modeGrid = document.getElementById('modeGrid');
        if (!modeGrid) return;

        modeGrid.innerHTML = '';

        // Create Single Player section
        const singlePlayerHeader = document.createElement('div');
        singlePlayerHeader.className = 'mode-section-header';
        singlePlayerHeader.innerHTML = '<h3>Single Player</h3>';
        modeGrid.appendChild(singlePlayerHeader);

        Object.values(this.modes).forEach(mode => {
            const card = this.createModeCard(mode);
            modeGrid.appendChild(card);
        });

        // Create Multiplayer section
        const multiplayerHeader = document.createElement('div');
        multiplayerHeader.className = 'mode-section-header';
        multiplayerHeader.innerHTML = '<h3>Multiplayer</h3>';
        modeGrid.appendChild(multiplayerHeader);

        // Create a single "Multiplayer" card that leads to connection screen
        const multiplayerCard = document.createElement('div');
        multiplayerCard.className = 'mode-card';
        multiplayerCard.dataset.mode = 'multiplayer';
        multiplayerCard.innerHTML = `
            <div class="mode-icon">🌐</div>
            <div class="mode-title">Online</div>
            <div class="mode-description">Connect to play against other players online</div>
            <div class="mode-difficulty pvp">Player vs Player</div>
        `;
        multiplayerCard.addEventListener('click', () => this.showMultiplayerConnect());
        modeGrid.appendChild(multiplayerCard);
    }

    createModeCard(mode) {
        const card = document.createElement('div');
        card.className = 'mode-card';
        card.dataset.mode = mode.id;

        card.innerHTML = `
            <div class="mode-icon">${mode.icon}</div>
            <div class="mode-title">${mode.title}</div>
            <div class="mode-description">${mode.description}</div>
            <div class="mode-difficulty ${mode.difficultyClass}">${mode.difficulty}</div>
        `;

        card.addEventListener('click', () => this.selectMode(mode.id));

        return card;
    }

    showMultiplayerConnect() {
        // Show connection dialog
        const connectDialog = document.createElement('div');
        connectDialog.className = 'multiplayer-connect-dialog modal';
        connectDialog.id = 'multiplayerConnectDialog';
        connectDialog.innerHTML = `
            <div class="setup-content" style="background: #1a1a1a; padding: 2rem; border: 2px solid #444; border-radius: 10px; color: white; max-width: 400px; margin: 0 auto;">
                <h2 style="text-align: center; margin-bottom: 1.5rem;">🌐 Connect to Server</h2>

                <div class="player-name-input" style="margin-bottom: 1.5rem; text-align: center;">
                    <label for="mpPlayerName" style="display: block; margin-bottom: 0.5rem;">Your Name:</label>
                    <input type="text" id="mpPlayerName" placeholder="Enter your name" maxlength="20" value="Player"
                            style="padding: 0.75rem; width: 80%; border: 1px solid #666; background: #333; color: white; border-radius: 4px; font-size: 1.1rem;">
                </div>

                <div id="mpConnectStatus" style="text-align: center; margin-bottom: 1rem; min-height: 24px; color: #888;"></div>

                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <button id="mpConnectBtn" class="btn btn-primary"
                            style="padding: 0.75rem 2rem; background: #00aa00; border: none; color: white; cursor: pointer; border-radius: 5px; font-weight: bold; font-size: 1.1rem;">
                        Connect
                    </button>
                    <button id="mpCancelBtn" class="btn btn-secondary"
                            style="padding: 0.75rem 1.5rem; background: #666; border: none; color: white; cursor: pointer; border-radius: 5px;">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(connectDialog);

        const playerNameInput = connectDialog.querySelector('#mpPlayerName');
        const connectBtn = connectDialog.querySelector('#mpConnectBtn');
        const cancelBtn = connectDialog.querySelector('#mpCancelBtn');
        const statusEl = connectDialog.querySelector('#mpConnectStatus');

        playerNameInput.focus();
        playerNameInput.select();

        connectBtn.addEventListener('click', async () => {
            const playerName = playerNameInput.value.trim() || 'Player';
            statusEl.textContent = 'Connecting to server...';
            statusEl.style.color = '#ffaa00';
            connectBtn.disabled = true;

            try {
                // Store player name for later use
                this.game.state.playerName = playerName;

                // Connect to server via ClientNetworkSystem service
                // This establishes the socket connection and gets player ID
                await this.game.call('connectToServer');

                statusEl.textContent = 'Connected!';
                statusEl.style.color = '#00ff00';

                // Short delay to show success message
                setTimeout(() => {
                    connectDialog.remove();
                    this.onMultiplayerConnected(playerName);
                }, 500);
            } catch (error) {
                statusEl.textContent = 'Connection failed: ' + (error.message || 'Unknown error');
                statusEl.style.color = '#ff4444';
                connectBtn.disabled = false;
            }
        });

        cancelBtn.addEventListener('click', () => {
            connectDialog.remove();
        });

        // Allow Enter key to connect
        playerNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                connectBtn.click();
            }
        });
    }

    onMultiplayerConnected(playerName) {
        // Set the arena game mode for multiplayer
        const arenaMode = this.multiplayerModes.arena;
        this.setGameMode(arenaMode.id);

        // Store player name in game state
        this.game.state.playerName = playerName;

        // Transition to the online lobby scene where chat and games list are prominent
        this.game.switchScene('onlineLobby');
    }

    selectMode(modeId) {
        // Remove previous selection
        document.querySelectorAll('.mode-card').forEach(card => {
            card.classList.remove('selected');
        });

        // Add selection to clicked card
        const selectedCard = document.querySelector(`[data-mode="${modeId}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
            this.setGameMode(modeId);
            const modeConfig = this.getModeConfig(modeId);
            if (modeConfig && modeConfig.onStart) {
                modeConfig.onStart(modeConfig);
            }
        }
    }

    setGameMode(modeId) {
        this.selectedGameMode = modeId;
        // Store mode config in game.state so it persists across scenes
        // Check both single player and multiplayer modes
        const mode = (this.modes && this.modes[modeId]) || (this.multiplayerModes && this.multiplayerModes[modeId]);
        if (mode) {
            this.game.state.gameMode = {
                id: mode.id,
                title: mode.title,
                description: mode.description,
                isMultiplayer: mode.isMultiplayer,
                maxPlayers: mode.maxPlayers,
                startingGold: mode.startingGold
            };
        }
    }

    getSelectedMode() {
        // Return from game.state (works across scenes without needing modes initialized)
        return this.game.state.gameMode || null;
    }

    getModeConfig(modeId) {
        // Check both single player and multiplayer modes
        if (this.modes && this.modes[modeId]) {
            return this.modes[modeId];
        }
        if (this.multiplayerModes && this.multiplayerModes[modeId]) {
            return this.multiplayerModes[modeId];
        }
        return null;
    }

    onSceneUnload() {
        const modeGrid = document.getElementById('modeGrid');
        if (modeGrid) {
            modeGrid.innerHTML = '';
        }
        this.modes = null;
        this.multiplayerModes = null;
    }
}
