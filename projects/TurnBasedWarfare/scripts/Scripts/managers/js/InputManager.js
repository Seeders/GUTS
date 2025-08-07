class InputManager {
    constructor(app) {
        this.game = app;
        this.game.inputManager = this;
        this.keyStates = {};
        this.mouseState = { x: 0, y: 0, pressed: false };
        this.shortcuts = new Map();
        this.setupDefaultShortcuts();
    }
    
    setup() {
        this.setupCanvasEvents();
        this.setupButtonEvents();
        this.setupKeyboardEvents();
        this.setupMouseTracking();
    }
    
    setupCanvasEvents() {
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) return;
        
        canvas.addEventListener('click', (event) => {
            this.game.uiManager.placement.handleCanvasClick(event);
        });
        
        canvas.addEventListener('contextmenu', (event) => {
            event.preventDefault(); // Prevent right-click menu
            this.handleRightClick(event);
        });
        
        canvas.addEventListener('mousemove', (event) => {
            this.updateMousePosition(event);
            this.handleCanvasHover(event);
        });
    }
    
    setupButtonEvents() {
        // Ready button
        const readyButton = document.getElementById('readyButton');
        if (readyButton) {
            readyButton.addEventListener('click', () => {
                this.game.uiManager.toggleReady();
            });
        }
        
        // Start game button
        // const startButton = document.getElementById('startGameBtn');
        // if (startButton) {
        //     startButton.addEventListener('click', () => {
        //         this.game.uiManager.getGameState().isPaused = false;
        //         this.game.uiManager.start();
        //     });
        // }

        const mainMenuPlayGameBtn = document.getElementById('mainMenu_PlayGameBtn');
        const mainMenuTutorialBtn = document.getElementById('mainMenu_TutorialBtn');
        const mainMenuSettingsBtn = document.getElementById('mainMenu_SettingsBtn');
        const mainMenuCreditsBtn = document.getElementById('mainMenu_CreditsBtn');

        const gameModeStartBtn = document.getElementById('gameMode_StartBtn');
        const gameModeBackBtn = document.getElementById('gameMode_BackBtn');

        const gamePauseBtn = document.getElementById('game_PauseBtn');
        const gameExitBtn = document.getElementById('game_ExitBtn');
        
        
        const victoryNextRoundBtn = document.getElementById('victory_NextRoundBtn');
        const victoryRestartBtn = document.getElementById('victory_RestartBtn');
        const victoryMainMenuBtn = document.getElementById('victory_MainMenuBtn');

        
        const defeatRetryBtn = document.getElementById('defeat_RetryBtn');
        const defeatChangeModeBtn = document.getElementById('defeat_ChangeModeBtn');
        const defeatMainMenuBtn = document.getElementById('defeat_MainMenuBtn');

        
        const pausedResumeBtn = document.getElementById('paused_ResumeBtn');
        const pausedRestartBtn = document.getElementById('paused_RestartBtn');
        const pausedMainMenuBtn = document.getElementById('paused_MainMenuBtn');

        mainMenuPlayGameBtn?.addEventListener('click', () => {
            this.game.screenManager.showGameModeSelect();
        });
        mainMenuTutorialBtn?.addEventListener('click', () => {
            this.game.menuManager.showTutorial();
        });
        mainMenuSettingsBtn?.addEventListener('click', () => {
            this.showSettingsModal();
        });
        mainMenuCreditsBtn?.addEventListener('click', () => {
            this.game.menuManager.showCredits();
        });

        gameModeStartBtn?.addEventListener('click', () => {
            this.game.gameManager.startSelectedMode();
        });
        gameModeBackBtn?.addEventListener('click', () => {
            this.game.screenManager.showMainMenu();
        });

        gamePauseBtn?.addEventListener('click', () => {
            this.game.gameManager.pauseGame();
        });
        gameExitBtn?.addEventListener('click', () => {
            this.game.gameManager.exitToMenu();
        });

        victoryNextRoundBtn?.addEventListener('click', () => {
            this.game.gameManager.continueGame();
        });
        victoryRestartBtn?.addEventListener('click', () => {
            this.game.gameManager.restartGame();
        });
        victoryMainMenuBtn?.addEventListener('click', () => {
            this.game.screenManager.showMainMenu();
        });

        defeatRetryBtn?.addEventListener('click', () => {
            this.game.gameManager.restartGame();
        });
        defeatChangeModeBtn?.addEventListener('click', () => {
            this.game.screenManager.showGameModeSelect();
        });
        defeatMainMenuBtn?.addEventListener('click', () => {
            this.game.screenManager.showMainMenu();
        });

        pausedResumeBtn?.addEventListener('click', () => {
            this.game.gameManager.resumeGame();
        });
        pausedRestartBtn?.addEventListener('click', () => {
            this.game.gameManager.restartGame();
        });
        pausedMainMenuBtn?.addEventListener('click', () => {
            this.game.screenManager.showMainMenu();
        });



    }
    
    setupKeyboardEvents() {
        document.addEventListener('keydown', (event) => {
            this.keyStates[event.code] = true;
            this.handleKeyDown(event);
        });
        
        document.addEventListener('keyup', (event) => {
            this.keyStates[event.code] = false;
            this.handleKeyUp(event);
        });
        
        // Prevent default browser shortcuts that might interfere
        document.addEventListener('keydown', (event) => {
            if (this.shouldPreventDefault(event)) {
                event.preventDefault();
            }
        });
    }
    
    setupMouseTracking() {
        document.addEventListener('mousemove', (event) => {
            this.mouseState.x = event.clientX;
            this.mouseState.y = event.clientY;
        });
        
        document.addEventListener('mousedown', (event) => {
            this.mouseState.pressed = true;
        });
        
        document.addEventListener('mouseup', (event) => {
            this.mouseState.pressed = false;
        });
    }
    
    setupDefaultShortcuts() {
        // Define keyboard shortcuts
        this.shortcuts.set('Escape', () => this.handleEscapeKey());
        this.shortcuts.set('KeyH', () => this.showHelpModal());
        this.shortcuts.set('KeyP', () => this.game.uiManager.pauseGame());
        this.shortcuts.set('Space', () => this.handleSpaceKey());
        this.shortcuts.set('KeyR+Control', () => this.game.uiManager.restartGame());
        this.shortcuts.set('F1', () => this.showHelpModal());
        this.shortcuts.set('KeyS+Control', () => this.handleSaveGame());
        this.shortcuts.set('Digit1', () => this.selectUnitShortcut(0));
        this.shortcuts.set('Digit2', () => this.selectUnitShortcut(1));
        this.shortcuts.set('Digit3', () => this.selectUnitShortcut(2));
        this.shortcuts.set('Digit4', () => this.selectUnitShortcut(3));
    }
    
    handleKeyDown(event) {
        const shortcutKey = this.getShortcutKey(event);
        const shortcutHandler = this.shortcuts.get(shortcutKey);
        
        if (shortcutHandler) {
            event.preventDefault();
            shortcutHandler();
        }
        
        // Handle continuous key press actions
        this.handleContinuousKeys(event);
    }
    
    handleKeyUp(event) {
        // Handle key release actions if needed
        this.handleKeyRelease(event);
    }
    
    getShortcutKey(event) {
        let key = event.code;
        if (event.ctrlKey) key += '+Control';
        if (event.shiftKey) key += '+Shift';
        if (event.altKey) key += '+Alt';
        return key;
    }
    
    handleEscapeKey() {
        const pauseMenu = document.getElementById('pauseMenu');
        
        if (this.game.uiManager.getGameState().currentScreen === 'gameScreen') {
            this.game.uiManager.pauseGame();
        } else if (pauseMenu && pauseMenu.style.display === 'flex') {
            this.game.uiManager.resumeGame();
        }
    }
    
    handleSpaceKey() {
        const state = this.game.uiManager.getGameState();
        if (state.phase === 'placement') {
            this.game.uiManager.toggleReady();
        }
    }
    
    handleSaveGame() {
        // Trigger save game functionality
        this.game.uiManager.statistics.saveSessionStats();
        GUTS.NotificationSystem.show('Game saved!', 'success', 2000);
    }
    
    selectUnitShortcut(index) {
        const unitCards = document.querySelectorAll('.unit-card');
        if (unitCards[index] && !unitCards[index].classList.contains('disabled')) {
            unitCards[index].click();
        }
    }
    
    handleContinuousKeys(event) {
        // Handle keys that should trigger repeatedly while held
        if (this.keyStates['ArrowUp']) {
            this.scrollBattleLog(-1);
        }
        if (this.keyStates['ArrowDown']) {
            this.scrollBattleLog(1);
        }
    }
    
    handleKeyRelease(event) {
        // Handle specific key release events
        switch (event.code) {
            case 'Tab':
                this.cycleThroughUnits();
                break;
        }
    }
    
    shouldPreventDefault(event) {
        // Prevent certain browser shortcuts
        if (event.ctrlKey && event.code === 'KeyR') return true;
        if (event.ctrlKey && event.code === 'KeyS') return true;
        if (event.code === 'F5') return true;
        if (event.code === 'F1') return true;
        return false;
    }
    
    handleRightClick(event) {
        // Handle right-click on canvas (e.g., cancel selection)
        const state = this.game.uiManager.getGameState();
        if (state.selectedUnitType) {
            state.selectedUnitType = null;
            document.querySelectorAll('.unit-card').forEach(card => {
                card.classList.remove('selected');
            });
            this.game.uiManager.battleLog.add('Selection cancelled');
        }
    }
    
    updateMousePosition(event) {
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        this.mouseState.canvasX = event.clientX - rect.left;
        this.mouseState.canvasY = event.clientY - rect.top;
    }
    
    handleCanvasHover(event) {
        // Show placement preview or hover effects
        const state = this.game.uiManager.getGameState();
        if (state.phase === 'placement' && state.selectedUnitType) {
            this.showPlacementPreview(event);
        }
    }
    
    showPlacementPreview(event) {
        // Visual preview of unit placement (could integrate with effects system)
        const worldPos = this.game.uiManager.placement.getWorldPositionFromMouse(event);
        if (worldPos && this.game.uiManager.placement.isValidPlayerPlacement(worldPos)) {
            // Show valid placement indicator
            document.body.style.cursor = 'crosshair';
        } else {
            // Show invalid placement indicator
            document.body.style.cursor = 'not-allowed';
        }
    }
    
    cycleThroughUnits() {
        const unitCards = document.querySelectorAll('.unit-card:not(.disabled)');
        const currentSelected = document.querySelector('.unit-card.selected');
        
        if (unitCards.length === 0) return;
        
        let nextIndex = 0;
        if (currentSelected) {
            const currentIndex = Array.from(unitCards).indexOf(currentSelected);
            nextIndex = (currentIndex + 1) % unitCards.length;
        }
        
        unitCards[nextIndex].click();
    }
    
    scrollBattleLog(direction) {
        const battleLog = document.getElementById('battleLog');
        if (battleLog) {
            battleLog.scrollTop += direction * 20;
        }
    }
    
    handleMainMenuAction() {
        if (confirm('Return to main menu? Current progress will be lost.')) {
            // Trigger main menu navigation
            if (window.screenManager) {
                window.screenManager.showMainMenu();
            }
        }
    }
    
    showSettingsModal() {
        const settingsContent = `
            <h3>⚙️ GAME SETTINGS</h3>
            <div class="settings-section">
                <h4>Graphics</h4>
                <label><input type="checkbox" id="particles-enabled" checked> Particle Effects</label>
                <label><input type="checkbox" id="screen-shake" checked> Screen Shake</label>
                <label><input type="range" id="particle-density" min="0.5" max="2" step="0.1" value="1"> Particle Density</label>
            </div>
            <div class="settings-section">
                <h4>Audio</h4>
                <label><input type="checkbox" id="sound-effects" checked> Sound Effects</label>
                <label><input type="range" id="volume" min="0" max="1" step="0.1" value="0.7"> Volume</label>
            </div>
            <div class="settings-section">
                <h4>Controls</h4>
                <p><strong>ESC</strong> - Pause/Resume</p>
                <p><strong>H</strong> - Help</p>
                <p><strong>Space</strong> - Ready</p>
                <p><strong>1-4</strong> - Select Units</p>
                <p><strong>Ctrl+R</strong> - Restart</p>
            </div>
        `;
        
        this.showModal('Settings', settingsContent, () => {
            this.applySettings();
        });
    }
    
    applySettings() {
        // Apply settings from modal
        const particlesEnabled = document.getElementById('particles-enabled')?.checked ?? true;
        const screenShake = document.getElementById('screen-shake')?.checked ?? true;
        const particleDensity = document.getElementById('particle-density')?.value ?? 1;
        const soundEffects = document.getElementById('sound-effects')?.checked ?? true;
        const volume = document.getElementById('volume')?.value ?? 0.7;
        
        // Save to localStorage
        localStorage.setItem('gameSettings', JSON.stringify({
            particlesEnabled,
            screenShake,
            particleDensity,
            soundEffects,
            volume
        }));
        
        GUTS.NotificationSystem.show('Settings saved!', 'success');
    }
    
    showHelpModal() {
        const helpContent = `
            <h3>🎮 CONTROLS</h3>
            <div class="help-section">
                <p><strong>ESC</strong> - Pause/Resume game</p>
                <p><strong>H or F1</strong> - Show this help</p>
                <p><strong>P</strong> - Pause game</p>
                <p><strong>Space</strong> - Ready for battle</p>
                <p><strong>Ctrl+R</strong> - Restart game</p>
                <p><strong>Ctrl+S</strong> - Save game</p>
                <p><strong>1-4</strong> - Quick select units</p>
                <p><strong>Tab</strong> - Cycle through units</p>
                <p><strong>Right Click</strong> - Cancel selection</p>
            </div>
            
            <h3>📋 HOW TO PLAY</h3>
            <div class="help-section">
                <p>1. <strong>Select units</strong> from the shop by clicking or using number keys</p>
                <p>2. <strong>Place units</strong> on your side of the battlefield (left half)</p>
                <p>3. <strong>Ready up</strong> when your army is prepared</p>
                <p>4. <strong>Watch the battle</strong> unfold automatically</p>
                <p>5. <strong>Earn gold</strong> from victories to build stronger armies</p>
            </div>
            
            <h3>💡 STRATEGY TIPS</h3>
            <div class="help-section">
                <p>• Balance offense and defense in your army</p>
                <p>• Position tanks in front to absorb damage</p>
                <p>• Place ranged units behind melee fighters</p>
                <p>• Spread units to avoid area damage</p>
                <p>• Save some gold for emergency purchases</p>
                <p>• Adapt your strategy based on enemy composition</p>
            </div>
        `;
        
        this.showModal('Game Help', helpContent);
    }
    
    showModal(title, content, onClose = null) {
        const modal = document.createElement('div');
        modal.className = 'game-modal';
        modal.innerHTML = `
            <div class="modal-backdrop"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h2>${title}</h2>
                    <button class="modal-close" type="button">&times;</button>
                </div>
                <div class="modal-body">${content}</div>
            </div>
        `;
        
        const closeBtn = modal.querySelector('.modal-close');
        const backdrop = modal.querySelector('.modal-backdrop');
        
        const closeModal = () => {
            if (document.body.contains(modal)) {
                document.body.removeChild(modal);
                if (onClose) onClose();
            }
        };
        
        closeBtn.addEventListener('click', closeModal);
        backdrop.addEventListener('click', closeModal);
        
        // Close on ESC key
        const escHandler = (event) => {
            if (event.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        document.body.appendChild(modal);
        this.addModalCSS();
    }
    
    addModalCSS() {
        if (document.querySelector('#modal-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'modal-styles';
        style.textContent = `
            .game-modal {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                z-index: 2000; display: flex; justify-content: center; align-items: center;
            }
            
            .modal-backdrop {
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(3px);
            }
            
            .modal-content {
                position: relative; background: linear-gradient(145deg, #1a1a2e, #16213e);
                border: 2px solid #00ffff; border-radius: 10px; max-width: 600px;
                width: 90%; max-height: 80%; overflow-y: auto;
                animation: modalAppear 0.3s ease-out;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            }
            
            @keyframes modalAppear {
                from { transform: scale(0.9); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
            }
            
            .modal-header {
                padding: 1rem; border-bottom: 1px solid #333;
                display: flex; justify-content: space-between; align-items: center;
                background: rgba(0, 255, 255, 0.1);
            }
            
            .modal-header h2 { color: #00ffff; margin: 0; }
            
            .modal-close {
                background: none; border: none; color: #ccc; font-size: 1.5rem;
                cursor: pointer; padding: 0; width: 30px; height: 30px;
                display: flex; align-items: center; justify-content: center;
                border-radius: 50%; transition: all 0.2s;
            }
            
            .modal-close:hover { 
                color: #ff4444; background: rgba(255, 68, 68, 0.1); 
            }
            .modal-body {
                padding: 1.5rem; color: #ccc; line-height: 1.6;
            }
            
            .modal-body h3 { 
                color: #00ffff; margin-top: 1.5rem; margin-bottom: 0.8rem;
                border-bottom: 1px solid #333; padding-bottom: 0.5rem;
            }
            
            .modal-body h4 {
                color: #ffff88; margin-top: 1rem; margin-bottom: 0.5rem;
            }
            
            .modal-body p { margin-bottom: 0.6rem; }
            .modal-body strong { color: #ffff00; }
            
            .help-section {
                margin-bottom: 1rem; padding-left: 1rem;
            }
            
            .settings-section {
                margin-bottom: 1.5rem; padding: 1rem;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 5px;
            }
            
            .settings-section label {
                display: block; margin-bottom: 0.8rem;
                color: #ccc; cursor: pointer;
            }
            
            .settings-section input[type="checkbox"] {
                margin-right: 0.5rem; accent-color: #00ffff;
            }
            
            .settings-section input[type="range"] {
                width: 100%; margin-top: 0.3rem;
                accent-color: #00ffff;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Utility methods
    isKeyPressed(keyCode) {
        return this.keyStates[keyCode] || false;
    }
    
    getMousePosition() {
        return { ...this.mouseState };
    }
    
    addCustomShortcut(keyCombo, handler) {
        this.shortcuts.set(keyCombo, handler);
    }
    
    removeShortcut(keyCombo) {
        this.shortcuts.delete(keyCombo);
    }
}
