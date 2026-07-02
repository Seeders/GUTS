class GameModeSystem extends GUTS.BaseSystem {
    static services = [
        'getSelectedMode',
        'setGameMode',
        'showMultiplayerConnect',
        'onMultiplayerConnected'
    ];

    static serviceDependencies = [
        'showCampaignSelect',
        'showSkirmishLobby',
        'handleMultiplayerModeSelection',
        'connectToServer',
        'travelToZone'
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
            adventure: {
                id: 'adventure',
                title: 'Adventure',
                icon: '🗡️',
                interfaceId: null,
                description: 'Descend into the ashlands — a dark action RPG',
                difficulty: 'Action RPG',
                difficultyClass: 'campaign',
                isMultiplayer: false,
                maxPlayers: 1,
                startingGold: 0,
                onStart: () => {
                    this.showClassSelect();
                }
            },
            campaign: {
                id: 'campaign',
                title: 'Campaign',
                icon: '🗺️',
                interfaceId: 'campaignSelect',
                description: 'Conquer the Atlas and build your legend',
                difficulty: 'Progressive',
                difficultyClass: 'campaign',
                isMultiplayer: false,
                maxPlayers: 1,
                startingGold: 100,
                onStart: (mode) => {
                    this.call.showCampaignSelect();
                }
            },
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
                // HeroArena: players start with 0 gold. Per-round income is granted by
                // AutobattlerEconomySystem.grantRoundIncome at the start of each prep phase.
                startingGold: 0,
                onStart: (mode) => {
                    this.call.showSkirmishLobby( mode);
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
                    this.call.handleMultiplayerModeSelection( mode);
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

    // ─── ARPG Adventure: class selection ─────────────────────────────────────

    getAdventureClasses() {
        // Classes collection is the source of truth (data/classes/*.json)
        const classes = this.collections.classes || {};
        const order = ['barbarian', 'soldier', 'archer', 'scout', 'apprentice', 'acolyte'];
        return order
            .filter(key => classes[key] && this.collections.units?.[classes[key].unitType])
            .map(key => {
                const cls = classes[key];
                const unit = this.collections.units[cls.unitType];
                return {
                    id: cls.unitType,
                    title: cls.title || unit.title || key,
                    icon: cls.icon || '⚔️',
                    theme: cls.theme || '',
                    hp: cls.baseLife ?? unit.hp,
                    damage: unit.damage,
                    str: cls.baseAttributes?.strength ?? 0,
                    dex: cls.baseAttributes?.dexterity ?? 0,
                    int: cls.baseAttributes?.intelligence ?? 0
                };
            });
    }

    showClassSelect() {
        // Remove any previous dialog
        document.getElementById('arpgClassSelectDialog')?.remove();

        const dialog = document.createElement('div');
        dialog.id = 'arpgClassSelectDialog';
        dialog.style.cssText = `
            position: fixed; inset: 0; z-index: 3000;
            background: rgba(5,3,2,.92); display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 1.2rem;
            font-family: Georgia, serif;`;

        const title = document.createElement('h2');
        title.textContent = 'CHOOSE YOUR CLASS';
        title.style.cssText = 'color:#d8c9a3; letter-spacing:6px; margin:0;';
        dialog.appendChild(title);

        const grid = document.createElement('div');
        grid.style.cssText = `
            display: grid; grid-template-columns: repeat(3, 220px); gap: 14px;`;
        dialog.appendChild(grid);

        for (const cls of this.getAdventureClasses()) {
            const card = document.createElement('div');
            card.className = 'arpg-class-card';
            card.style.cssText = `
                border: 2px solid #4a3a22; border-radius: 8px; padding: 14px;
                background: linear-gradient(160deg, #1a130c, #0c0806);
                color: #d8c9a3; cursor: pointer; text-align: center;
                transition: border-color .15s, transform .15s;`;
            card.innerHTML = `
                <div style="font-size:2.2rem;">${cls.icon}</div>
                <div style="font-size:1.15rem; letter-spacing:2px; margin:6px 0 2px;">${cls.title.toUpperCase()}</div>
                <div style="font-size:.72rem; color:#8d7a55; min-height:2.1em;">${cls.theme}</div>
                <div style="font-size:.75rem; margin-top:8px; display:flex; justify-content:space-around;">
                    <span title="Strength" style="color:#e06a5a;">STR ${cls.str}</span>
                    <span title="Dexterity" style="color:#7fca6a;">DEX ${cls.dex}</span>
                    <span title="Intelligence" style="color:#6a9fe0;">INT ${cls.int}</span>
                </div>
                <div style="font-size:.7rem; color:#8d7a55; margin-top:4px;">HP ${cls.hp} · DMG ${cls.damage}</div>`;
            card.addEventListener('mouseenter', () => {
                card.style.borderColor = '#f0cf70';
                card.style.transform = 'translateY(-3px)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.borderColor = '#4a3a22';
                card.style.transform = 'none';
            });
            card.addEventListener('click', () => {
                dialog.remove();
                this.startAdventure(cls.id);
            });
            grid.appendChild(card);
        }

        const cancel = document.createElement('button');
        cancel.textContent = 'Back';
        cancel.style.cssText = `
            padding:.55rem 2.2rem; background:#241a0e; color:#d8c9a3;
            border:1px solid #6b5432; border-radius:4px; cursor:pointer; letter-spacing:2px;`;
        cancel.addEventListener('click', () => dialog.remove());
        dialog.appendChild(cancel);

        document.body.appendChild(dialog);
    }

    startAdventure(classId) {
        this.setGameMode('adventure');
        this.game.state.adventureClassId = classId;

        // Fresh character: clear any prior run's progression
        this.game.state.savedCharacterSheet = null;
        this.game.state.savedInventory = null;
        this.game.state.savedEquipment = null;
        this.game.state.savedGold = null;
        this.game.state.generatedZones = null;
        this.game.state.discoveredWaypoints = null;
        this.game.state.quests = null;
        this.game.state.stashItems = null;
        this.game.state.act1Complete = false;

        // Begin in the town of Emberrest
        if (this.game.hasService('travelToZone')) {
            this.game.zoneSystem
                ? this.game.zoneSystem.travelToZone('emberrest')
                : this.call.travelToZone?.('emberrest');
            return;
        }

        // Fallback: direct level load
        const levelName = 'forest';
        this.game.state.level = this.enums?.levels?.[levelName] ?? 0;
        this.game.switchScene('adventure', {
            isAdventure: true,
            classId,
            selectedLevel: levelName,
            startingGold: 0
        });
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
                await this.call.connectToServer();

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
