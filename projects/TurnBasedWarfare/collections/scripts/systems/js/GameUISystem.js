class GameUISystem extends GUTS.BaseSystem {
    static services = [
        'leaveGame',
        'updateGoldDisplay'
    ];

    static serviceDependencies = [
        'getSaveData',
        'exportSaveFile',
        'leaveRoom',
        'showMainMenu',
        'initializeParticleSystem',
        'initializeEffectsSystem',
        'getPlayerGold',
        'getSurvivalWaveInfo',
        'getActivePlayerTeam',
        'startCelebration'
    ];

    constructor(game) {
        super(game);
        this.game.gameUISystem = this;
        this.game.uiSystem = this; // For compatibility with showNotification calls

        this.currentScreen = 'game';
        this.networkUnsubscribers = [];

        // Track last displayed values to avoid unnecessary DOM updates
        this._lastPhaseStatus = '';
        this._lastGold = -1;
        this._lastRound = -1;
        this._lastSide = -1;
    }

    init(params) {
        this.params = params || {};
        this.initializeUI();
    }

    initializeUI() {
        const gameUIHTML = `
            <div id="multiplayerHUD" style="display: none; position: absolute; top: 10px; right: 330px; z-index: 1000;">
                <div class="opponent-info">
                    <h4>Opponent</h4>
                    <div class="opponent-stats">
                        <div>Name: <span id="opponentName">-</span></div>
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

        document.body.insertAdjacentHTML('beforeend', gameUIHTML);
        this.setupGameMenuEvents();
    }

    setupGameMenuEvents() {
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
        try {
            const saveData = this.call.getSaveData();
            if (!saveData) {
                this.showNotification('Save system not available', 'error');
                return;
            }
            this.call.exportSaveFile( saveData);
            this.showNotification('Game saved! File downloaded.', 'success');
        } catch (error) {
            console.error('[GameUISystem] Error saving game:', error);
            this.showNotification('Failed to save game', 'error');
        }
    }

    async leaveGame() {
        console.log('[GameUISystem] leaveGame called');
        console.log('[GameUISystem] skirmishConfig:', this.game.state.skirmishConfig);

        if (this.game.hasService('leaveRoom')) {
            this.call.leaveRoom();
        }

        const menuBtn = document.getElementById('gameMenuBtn');
        if (menuBtn) {
            menuBtn.style.display = 'none';
        }

        const hud = document.getElementById('multiplayerHUD');
        if (hud) {
            hud.style.display = 'none';
        }

        const lobbyEl = document.getElementById('multiplayerLobby');
        const gameScreen = document.getElementById('gameScreen');
        if (lobbyEl) {
            lobbyEl.classList.remove('active');
        }
        if (gameScreen) {
            gameScreen.classList.remove('active');
        }

        this.currentScreen = null;

        // Check if this was a campaign mission
        const isCampaignMission = this.game.state.skirmishConfig?.isCampaignMission;
        console.log('[GameUISystem] isCampaignMission:', isCampaignMission);
        if (isCampaignMission) {
            // Use the stored game result (set by handleGameEnd)
            const lastGameResult = this.game.state.lastGameResult;
            const victory = lastGameResult?.isWinner ?? false;
            const nodeId = this.game.state.skirmishConfig?.missionNodeId;

            // Get scroll data if this was a scroll mission
            const isScrollMission = this.game.state.skirmishConfig?.isScrollMission;
            let scrollData = null;
            if (isScrollMission) {
                scrollData = {
                    rewardMultiplier: this.game.state.skirmishConfig?.rewardMultiplier || 1,
                    modifiers: this.game.state.skirmishConfig?.scrollModifiers || []
                };
            }

            // Store pending results for HomeBaseUISystem to pick up after scene switch
            // HomeBaseUISystem.onSceneLoad will detect this and process mission results
            this.game.state.pendingMissionResults = {
                victory,
                nodeId,
                scrollData,
                stats: {
                    round: lastGameResult?.totalRounds || this.game.state.round || 1,
                    goldEarned: 0,
                    unitsDeployed: 0,
                    unitsLost: 0
                },
                // Mark that we need to process mission results (not just display)
                needsProcessing: true
            };

            // Switch to campaign scene - HomeBaseUISystem.onSceneLoad will detect pending results
            console.log('[GameUISystem] Switching to campaign scene with pendingMissionResults:', this.game.state.pendingMissionResults);
            await this.game.switchScene('campaign');
            console.log('[GameUISystem] Campaign scene switch complete');
            return;
        }

        console.log('[GameUISystem] Switching to lobby scene');
        await this.game.switchScene('lobby');

        this.call.showMainMenu();
        if (!this.game.hasService('showMainMenu')) {
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

    onGameStarted(data) {
        this.currentScreen = 'game';

        document.getElementById('multiplayerLobby')?.classList.remove('active');
        document.getElementById('gameScreen')?.classList.add('active');

        this.showGameMenu();
    }

    start() {
        this.call.initializeParticleSystem();
        this.call.initializeEffectsSystem();
        this.showGameMenu();
    }

    update() {
        this.updatePhaseUI();
        this.updateGoldDisplay();
        this.updateRoundDisplay();
        this.updateSideDisplay();
    }

    updatePhaseUI() {
        const state = this.game.state;

        const phaseStatusEl = document.getElementById('phaseStatus');
        if (phaseStatusEl) {
            let newStatus = '';
            if (state.phase === this.enums.gamePhase.placement) {
                if (state.playerReady) {
                    newStatus = 'Army deployed! Waiting for opponent...';
                } else {
                    newStatus = 'Deploy your units and get ready!';
                }
            } else if (state.phase === this.enums.gamePhase.battle) {
                newStatus = 'Battle in progress! Watch your units fight!';
            }
            if (newStatus !== this._lastPhaseStatus) {
                this._lastPhaseStatus = newStatus;
                phaseStatusEl.textContent = newStatus;
            }
        }
    }

    updateGoldDisplay() {
        const goldDisplay = document.getElementById('playerGold');
        if (goldDisplay) {
            const gold = this.call.getPlayerGold();
            if (gold !== this._lastGold) {
                this._lastGold = gold;
                goldDisplay.textContent = gold;
            }
        }
    }

    updateRoundDisplay() {
        const roundNumberEl = document.getElementById('currentRound');
        if (roundNumberEl) {
            const round = this.game.state.round || 1;
            if (round !== this._lastRound) {
                this._lastRound = round;

                // For survival missions, show wave X/30 format
                if (this.game.state.isSurvivalMission && this.game.hasService('getSurvivalWaveInfo')) {
                    const waveInfo = this.call.getSurvivalWaveInfo();
                    roundNumberEl.textContent = `Wave ${waveInfo.currentWave}/${waveInfo.totalWaves}`;
                } else {
                    roundNumberEl.textContent = round;
                }
            }
        }
    }

    updateSideDisplay() {
        const sideDisplay = document.getElementById('playerSide');
        if (sideDisplay) {
            const myTeam = this.call.getActivePlayerTeam();
            const side = myTeam ?? 0;
            if (side !== this._lastSide) {
                this._lastSide = side;
                sideDisplay.textContent = side;
            }
        }
    }

    handleRoundResult(roundResult) {
        const state = this.game.state;
        state.phase = this.enums.gamePhase.ended;
    }

    onPlacementPhaseStart() {
        const state = this.game.state;
        state.phase = this.enums.gamePhase.placement;
        state.phaseTimeLeft = null;
        state.playerReady = false;
        state.enemyPlacementComplete = false;
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
        const firstUnit = victoriousUnits[0];
        const team = this.game.getComponent(firstUnit, "team");

        victoriousUnits.forEach(entityId => {
            this.call.startCelebration( entityId, team?.team);
        });
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

    dispose() {
        if (this.networkUnsubscribers) {
            this.networkUnsubscribers.forEach(unsubscribe => {
                if (typeof unsubscribe === 'function') {
                    unsubscribe();
                }
            });
            this.networkUnsubscribers = [];
        }

        // Clean up game menu event listeners
        const menuBtn = document.getElementById('gameMenuBtn');
        const menuModal = document.getElementById('gameMenuModal');
        const saveBtn = document.getElementById('gameMenuSaveBtn');
        const cancelBtn = document.getElementById('gameMenuCancelBtn');
        const optionsBtn = document.getElementById('gameMenuOptionsBtn');
        const leaveBtn = document.getElementById('gameMenuLeaveBtn');

        if (this.gameMenuHandlers) {
            if (menuBtn) menuBtn.removeEventListener('click', this.gameMenuHandlers.openMenu);
            if (saveBtn) saveBtn.removeEventListener('click', this.gameMenuHandlers.saveGame);
            if (cancelBtn) cancelBtn.removeEventListener('click', this.gameMenuHandlers.closeMenu);
            if (optionsBtn) optionsBtn.removeEventListener('click', this.gameMenuHandlers.showOptions);
            if (leaveBtn) leaveBtn.removeEventListener('click', this.gameMenuHandlers.confirmLeave);
            if (menuModal) menuModal.removeEventListener('click', this.gameMenuHandlers.closeOnBackground);
        }

        // Remove UI elements
        const elements = ['multiplayerHUD', 'multiplayerNotifications', 'gameMenuBtn', 'gameMenuModal'];
        elements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        this.gameMenuEventsSetup = false;
    }

    onSceneUnload() {
        this.dispose();
    }
}
