/**
 * PuzzleLobbyUISystem - Main menu and level selection UI
 */
class PuzzleLobbyUISystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'getCurrentLevelId',
        'pauseGame',
        'playMusic',
        'setMasterVolume',
        'setMusicVolume',
        'setSfxVolume',
        'stopAllSounds',
        'unpauseGame'
    ];

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
            // Clear saved game state (but keep audio settings)
            localStorage.removeItem('useYourIllusions_saveData');

            this.setupMainMenuHandlers();
            this.populateLevelGrid();
            this.showScreen('mainMenu');

            // Setup one-time click handler to start menu music (AudioContext requires user interaction)
            this.setupMenuMusicStarter(sceneData);
        }

        if (sceneName === 'game') {
            this.setupGameScreenHandlers();
            this.showScreen('gameScreen');
        }
    }

    setupMenuMusicStarter(sceneData) {
        if (!sceneData?.backgroundMusicSound) return;

        const startMusic = () => {
            console.log('[PuzzleLobbyUISystem] User interaction detected, starting menu music');
            this.call.playMusic( sceneData.backgroundMusicSound, { loop: true, fadeInTime: 1 });
            document.removeEventListener('click', startMusic);
            document.removeEventListener('keydown', startMusic);
        };

        document.addEventListener('click', startMusic, { once: true });
        document.addEventListener('keydown', startMusic, { once: true });
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
            // Always show intro story before starting the game
            this.showIntroStory();
        });

        document.getElementById('mainMenu_SettingsBtn')?.addEventListener('click', () => {
            this.showSettingsOverlay();
        });

        document.getElementById('levelSelect_BackBtn')?.addEventListener('click', () => {
            this.showScreen('mainMenu');
        });

        document.getElementById('settingsBackBtn')?.addEventListener('click', () => {
            this.hideSettingsOverlay();
        });

        // Intro story continue button - go straight to level 1
        document.getElementById('introStory_ContinueBtn')?.addEventListener('click', () => {
            // Start the first level directly
            if (this.availableLevels.length > 0) {
                this.startLevel(this.availableLevels[0].id);
            }
        });

        // Setup volume controls (shared with game scene)
        this.setupVolumeControls();

        // ESC key to close settings overlay in menu
        this.boundEscapeHandler = (e) => {
            if (e.key === 'Escape') {
                const settingsOverlay = document.getElementById('settingsOverlay');
                if (settingsOverlay?.classList.contains('active')) {
                    this.hideSettingsOverlay();
                }
            }
        };
        document.addEventListener('keydown', this.boundEscapeHandler);
    }

    showSettingsOverlay() {
        const overlay = document.getElementById('settingsOverlay');
        if (overlay) {
            overlay.classList.add('active');
        }
    }

    hideSettingsOverlay() {
        const overlay = document.getElementById('settingsOverlay');
        if (overlay) {
            overlay.classList.remove('active');
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

        // Setup volume controls (shared with menu scene)
        this.setupVolumeControls();

        // Use bound handler so we can remove it later
        this.boundEscapeHandler = (e) => {
            if (e.key === 'Escape' && this.currentScreen === 'gameScreen') {
                this.togglePauseMenu();
            }
        };
        document.addEventListener('keydown', this.boundEscapeHandler);
    }

    setupVolumeControls() {
        // Load saved settings
        const savedSettings = this.loadVolumeSettings();

        // Master volume
        const masterSlider = document.getElementById('masterVolumeSlider');
        const masterValue = document.getElementById('masterVolumeValue');
        if (masterSlider) {
            masterSlider.value = savedSettings.master;
            if (masterValue) masterValue.textContent = `${savedSettings.master}%`;
            this.call.setMasterVolume( savedSettings.master / 100);

            masterSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                if (masterValue) masterValue.textContent = `${value}%`;
                this.call.setMasterVolume( value / 100);
                this.saveVolumeSettings();
            });
        }

        // Music volume
        const musicSlider = document.getElementById('musicVolumeSlider');
        const musicValue = document.getElementById('musicVolumeValue');
        if (musicSlider) {
            musicSlider.value = savedSettings.music;
            if (musicValue) musicValue.textContent = `${savedSettings.music}%`;
            this.call.setMusicVolume( savedSettings.music / 100);

            musicSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                if (musicValue) musicValue.textContent = `${value}%`;
                this.call.setMusicVolume( value / 100);
                this.saveVolumeSettings();
            });
        }

        // SFX volume
        const sfxSlider = document.getElementById('sfxVolumeSlider');
        const sfxValue = document.getElementById('sfxVolumeValue');
        if (sfxSlider) {
            sfxSlider.value = savedSettings.sfx;
            if (sfxValue) sfxValue.textContent = `${savedSettings.sfx}%`;
            this.call.setSfxVolume( savedSettings.sfx / 100);

            sfxSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                if (sfxValue) sfxValue.textContent = `${value}%`;
                this.call.setSfxVolume( value / 100);
                this.saveVolumeSettings();
            });
        }
    }

    loadVolumeSettings() {
        try {
            const saved = localStorage.getItem('audioSettings');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[PuzzleLobbyUISystem] Failed to load volume settings:', e);
        }
        return { master: 100, music: 25, sfx: 100 };
    }

    saveVolumeSettings() {
        const settings = {
            master: parseInt(document.getElementById('masterVolumeSlider')?.value || 100),
            music: parseInt(document.getElementById('musicVolumeSlider')?.value || 100),
            sfx: parseInt(document.getElementById('sfxVolumeSlider')?.value || 100)
        };
        try {
            localStorage.setItem('audioSettings', JSON.stringify(settings));
        } catch (e) {
            console.warn('[PuzzleLobbyUISystem] Failed to save volume settings:', e);
        }
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

    showIntroStory() {
        this.showScreen('introStory');
    }

    startLevel(levelId) {
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
        const currentLevelId = this.call.getCurrentLevelId();
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
            if (pauseMenu.classList.contains('active')) {
                this.call.pauseGame();
            } else {
                this.call.unpauseGame();
            }
        }
    }

    hidePauseMenu() {
        const pauseMenu = document.getElementById('pauseMenu');
        if (pauseMenu) {
            pauseMenu.classList.remove('active');
            this.call.unpauseGame();
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
        console.log(`[PuzzleLobbyUISystem] restartCurrentLevel called, selectedLevel: ${currentLevelId}`);
        if (currentLevelId) {
            // Force interface to reload by clearing the marker
            const appContainer = document.getElementById('appContainer');
            if (appContainer) {
                delete appContainer.dataset.currentInterface;
            }

            this.startLevel(currentLevelId);
        } else {
            console.warn('[PuzzleLobbyUISystem] No selectedLevel, returning to main menu');
            this.returnToMainMenu();
        }
    }

    showDefeatScreen(defeatInfo = {}) {
        console.log(`[PuzzleLobbyUISystem] showDefeatScreen called at ${this.game.state.now}`, defeatInfo);
        console.log(`[PuzzleLobbyUISystem] isPaused before pauseGame: ${this.game.state.isPaused}`);

        const defeatScreen = document.getElementById('defeatScreen');
        if (!defeatScreen) {
            console.log(`[PuzzleLobbyUISystem] ERROR: defeatScreen element not found!`);
            return;
        }

        // Pause the game
        this.call.pauseGame();
        console.log(`[PuzzleLobbyUISystem] isPaused after pauseGame: ${this.game.state.isPaused}`);

        // Stop all sound effects (guard attacks, etc.)
        this.call.stopAllSounds();

        // Unlock mouse so player can click UI buttons
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }

        // Update title
        const titleEl = document.getElementById('defeatTitle');
        if (titleEl) {
            titleEl.textContent = defeatInfo.title || 'Game Over';
        }

        // Update message
        const messageEl = document.getElementById('defeatMessage');
        if (messageEl) {
            messageEl.textContent = defeatInfo.message || 'You have been defeated.';
        }

        // Update icon
        const iconEl = document.getElementById('defeatIcon');
        if (iconEl) {
            iconEl.innerHTML = defeatInfo.icon || '&#128128;';
        }

        // Show the screen
        defeatScreen.classList.add('active');
    }

    hideAllOverlays() {
        console.log(`[PuzzleLobbyUISystem] hideAllOverlays called, isPaused: ${this.game.state.isPaused}`);
        document.querySelectorAll('.pause-overlay, .puzzle-modal-overlay').forEach(overlay => {
            overlay.classList.remove('active');
        });
        this.call.unpauseGame();
        console.log(`[PuzzleLobbyUISystem] hideAllOverlays after unpause, isPaused: ${this.game.state.isPaused}`);
    }

    onSceneUnload() {
        // Remove overlays without trying to unpause (pause state is reset by PauseSystem)
        document.querySelectorAll('.pause-overlay, .puzzle-modal-overlay').forEach(overlay => {
            overlay.classList.remove('active');
        });
        this.cleanupHandlers();
    }

    dispose() {
        this.cleanupHandlers();
    }
}
