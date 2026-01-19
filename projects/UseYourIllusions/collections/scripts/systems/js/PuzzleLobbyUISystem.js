/**
 * PuzzleLobbyUISystem - Main menu and level selection UI
 */
class PuzzleLobbyUISystem extends GUTS.BaseSystem {
    static services = [
        'showLevelSelect',
        'showMainMenu',
        'startLevel',
        'showVictoryScreen',
        'showDefeatScreen',
        'hideAllOverlays'
    ];

    constructor(game) {
        super(game);
        this.game.puzzleLobbyUISystem = this;
        this.availableLevels = [];
        this.currentScreen = 'mainMenu';
        this.boundEscapeHandler = null;
    }

    init() {
    }

    onSceneLoad(sceneData) {
        const sceneName = this.game.sceneManager.currentSceneName;

        // Clean up any previous handlers
        this.cleanupHandlers();

        // Always load available levels so loadNextLevel works from game scene
        this.loadAvailableLevels();

        if (sceneName === 'menu') {
            this.setupMainMenuHandlers();
            this.populateLevelGrid();
            this.showScreen('mainMenu');
        }

        if (sceneName === 'game') {
            this.setupGameScreenHandlers();
            this.showScreen('gameScreen');
        }
    }

    cleanupHandlers() {
        // Remove document-level event listeners
        if (this.boundEscapeHandler) {
            document.removeEventListener('keydown', this.boundEscapeHandler);
            this.boundEscapeHandler = null;
        }
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
            screen.style.display = '';
        });

        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenId;
        }
    }

    setupMainMenuHandlers() {
        document.getElementById('mainMenu_PlayGameBtn')?.addEventListener('click', () => {
            this.showLevelSelect();
        });

        document.getElementById('mainMenu_SettingsBtn')?.addEventListener('click', () => {
            this.showScreen('settingsScreen');
        });

        document.getElementById('levelSelect_BackBtn')?.addEventListener('click', () => {
            this.showScreen('mainMenu');
        });

        document.getElementById('settings_BackBtn')?.addEventListener('click', () => {
            this.showScreen('mainMenu');
        });

        this.setupSettingsHandlers();
    }

    setupSettingsHandlers() {
        const masterVolume = document.getElementById('masterVolume');
        const masterVolumeValue = document.getElementById('masterVolumeValue');
        if (masterVolume && masterVolumeValue) {
            masterVolume.addEventListener('input', (e) => {
                masterVolumeValue.textContent = `${e.target.value}%`;
            });
        }

        const musicVolume = document.getElementById('musicVolume');
        const musicVolumeValue = document.getElementById('musicVolumeValue');
        if (musicVolume && musicVolumeValue) {
            musicVolume.addEventListener('input', (e) => {
                musicVolumeValue.textContent = `${e.target.value}%`;
            });
        }

        const sfxVolume = document.getElementById('sfxVolume');
        const sfxVolumeValue = document.getElementById('sfxVolumeValue');
        if (sfxVolume && sfxVolumeValue) {
            sfxVolume.addEventListener('input', (e) => {
                sfxVolumeValue.textContent = `${e.target.value}%`;
            });
        }
    }

    setupGameScreenHandlers() {
        document.getElementById('resumeBtn')?.addEventListener('click', () => {
            this.hidePauseMenu();
        });

        document.getElementById('restartLevelBtn')?.addEventListener('click', () => {
            this.hidePauseMenu();
            this.restartCurrentLevel();
        });

        document.getElementById('returnToMenuBtn')?.addEventListener('click', () => {
            this.hidePauseMenu();
            this.returnToMainMenu();
        });

        document.getElementById('retryLevelBtn')?.addEventListener('click', () => {
            this.hideAllOverlays();
            this.restartCurrentLevel();
        });

        document.getElementById('defeatMenuBtn')?.addEventListener('click', () => {
            this.hideAllOverlays();
            this.returnToMainMenu();
        });

        // Use bound handler so we can remove it later
        this.boundEscapeHandler = (e) => {
            if (e.key === 'Escape' && this.currentScreen === 'gameScreen') {
                this.togglePauseMenu();
            }
        };
        document.addEventListener('keydown', this.boundEscapeHandler);
    }

    loadAvailableLevels() {
        const collections = this.game.getCollections();
        const levels = collections.levels || {};

        this.availableLevels = Object.keys(levels)
            .map(key => ({ id: key, ...levels[key] }))
            .filter(level => level.published !== false);

        console.log('[PuzzleLobbyUISystem] Loaded levels:', this.availableLevels.length, this.availableLevels.map(l => l.id));
    }

    populateLevelGrid() {
        const levelGrid = document.getElementById('levelGrid');
        if (!levelGrid) {
            console.log('[PuzzleLobbyUISystem] populateLevelGrid: levelGrid not found');
            return;
        }

        console.log('[PuzzleLobbyUISystem] populateLevelGrid: creating', this.availableLevels.length, 'level cards');

        levelGrid.innerHTML = '';

        this.availableLevels.forEach((level, index) => {
            const isLocked = index > 0;
            const isCompleted = false;

            const card = document.createElement('div');
            card.className = `level-card${isLocked ? ' locked' : ''}${isCompleted ? ' completed' : ''}`;
            card.dataset.levelId = level.id;

            card.innerHTML = `
                <div class="level-number">Level ${index + 1}</div>
                <div class="level-title">${level.title || `Mission ${index + 1}`}</div>
                <div class="level-description">${level.description || 'Navigate to the exit'}</div>
            `;

            if (!isLocked) {
                card.addEventListener('click', () => {
                    console.log('[PuzzleLobbyUISystem] Level card clicked:', level.id);
                    this.startLevel(level.id);
                });
            }

            levelGrid.appendChild(card);
        });
    }

    showLevelSelect() {
        this.showScreen('levelSelect');
    }

    showMainMenu() {
        this.showScreen('mainMenu');
    }

    startLevel(levelId) {
        console.log(`[PuzzleLobbyUISystem] Starting level: ${levelId}`);

        // Convert level ID to index for GameLoader
        const levelIndex = this.enums.levels?.[levelId] ?? 0;
        this.game.state.level = levelIndex;
        this.game.state.selectedLevel = levelId;

        this.game.switchScene('game');
    }

    returnToMainMenu() {
        this.game.switchScene('menu');
    }

    loadNextLevel() {
        const currentLevelId = this.game.call('getCurrentLevelId');
        const currentIndex = this.availableLevels.findIndex(l => l.id === currentLevelId);

        if (currentIndex >= 0 && currentIndex < this.availableLevels.length - 1) {
            const nextLevel = this.availableLevels[currentIndex + 1];
            this.startLevel(nextLevel.id);
        } else {
            this.returnToMainMenu();
        }
    }

    togglePauseMenu() {
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.classList.toggle('active');
            this.game.state.paused = pauseMenu.classList.contains('active');
        }
    }

    hidePauseMenu() {
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.classList.remove('active');
            this.game.state.paused = false;
        }
    }

    showVictoryScreen(stats = {}) {
        const overlay = document.getElementById('victoryOverlay');
        if (!overlay) return;

        // Update stats display
        const timeEl = document.getElementById('victoryTime');
        const illusionsEl = document.getElementById('victoryIllusions');

        if (timeEl) {
            timeEl.textContent = stats.timeFormatted || '0:00';
        }
        if (illusionsEl) {
            illusionsEl.textContent = stats.illusionsUsed ?? 0;
        }

        // Setup button handlers
        this.setupVictoryButtons();

        // Show the overlay
        overlay.classList.add('active');
    }

    setupVictoryButtons() {
        const nextBtn = document.getElementById('victoryNextLevelBtn');
        const retryBtn = document.getElementById('victoryRetryBtn');
        const menuBtn = document.getElementById('victoryMenuBtn');

        // Remove old listeners by cloning
        if (nextBtn && !nextBtn._hasHandler) {
            nextBtn._hasHandler = true;
            nextBtn.addEventListener('click', () => {
                this.hideAllOverlays();
                this.loadNextLevel();
            });
        }

        if (retryBtn && !retryBtn._hasHandler) {
            retryBtn._hasHandler = true;
            retryBtn.addEventListener('click', () => {
                this.hideAllOverlays();
                this.restartCurrentLevel();
            });
        }

        if (menuBtn && !menuBtn._hasHandler) {
            menuBtn._hasHandler = true;
            menuBtn.addEventListener('click', () => {
                this.hideAllOverlays();
                this.returnToMainMenu();
            });
        }
    }

    restartCurrentLevel() {
        const currentLevelId = this.game.state.selectedLevel;
        if (currentLevelId) {
            this.startLevel(currentLevelId);
        } else {
            this.returnToMainMenu();
        }
    }

    showDefeatScreen() {
        document.getElementById('defeatScreen')?.classList.add('active');
    }

    hideAllOverlays() {
        document.querySelectorAll('.pause-overlay, .puzzle-modal-overlay').forEach(overlay => {
            overlay.classList.remove('active');
        });
        this.game.state.paused = false;
    }

    onSceneUnload() {
        this.hideAllOverlays();
        this.cleanupHandlers();
    }

    dispose() {
        this.cleanupHandlers();
    }
}
