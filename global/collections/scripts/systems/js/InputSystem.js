class InputSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'leaveGame',
        'getWorldPositionFromMouse',
        'ui_handleCanvasClick',
        'rotateCamera',
        'toggleCameraMode',
        'getCameraMode',
        'showGameModeSelect',
        'showMainMenu',
        'pauseGame',
        'exitToMenu',
        'resumeGame',
        'restartGame',
        'handleUnitSelectionChange'
    ];

    constructor(game) {
        super(game);
        this.game.inputSystem = this;
        this.keyStates = {};
        this.mouseState = { x: 0, y: 0, pressed: false };
        this.shortcuts = new Map();

    }

    init() {
        this.setupButtonEvents();
        this.setupKeyboardEvents();
        this.setupMouseTracking();
        this.setupDefaultShortcuts();
    }

    onSceneLoad() {
        // Setup all button events on scene load since DOM elements are recreated when switching scenes
        // (SceneManager.loadSceneInterface replaces appContainer.innerHTML, destroying old elements)
        this.setupButtonEvents();
        // Setup canvas events on scene load since canvas may not exist during init()
        // (InputSystem is reused across scenes, but gameCanvas only exists in game scene)
        this.setupCanvasEvents();
        // Setup game-specific button events (camera rotation, etc.)
        this.setupGameButtons();
        // Setup victory/defeat buttons (may not exist during init() if interface loads later)
        this.setupResultButtons();
    }

    setupResultButtons() {
        const victoryMainMenuBtn = document.getElementById('victory_MainMenuBtn');
        const defeatMainMenuBtn = document.getElementById('defeat_MainMenuBtn');

        console.log('[InputSystem] setupResultButtons - victory button:', victoryMainMenuBtn, 'defeat button:', defeatMainMenuBtn);

        if (victoryMainMenuBtn && !victoryMainMenuBtn._clickHandlerAttached) {
            victoryMainMenuBtn._clickHandlerAttached = true;
            victoryMainMenuBtn.addEventListener('click', () => {
                console.log('[InputSystem] Victory button clicked, calling leaveGame');
                this.call.leaveGame();
            });
        }

        if (defeatMainMenuBtn && !defeatMainMenuBtn._clickHandlerAttached) {
            defeatMainMenuBtn._clickHandlerAttached = true;
            defeatMainMenuBtn.addEventListener('click', () => {
                console.log('[InputSystem] Defeat button clicked, calling leaveGame');
                this.call.leaveGame();
            });
        }
    }

    setupCanvasEvents() {
        // Clean up any existing canvas listeners first
        this.cleanupCanvasEvents();

        const canvas = document.getElementById('gameCanvas');
        if (!canvas) return;

        this._currentCanvas = canvas;
        this._canvasClickHandler = (event) => {
            // Get world position from screen coordinates
            const worldPos = this.call.getWorldPositionFromMouse( event.clientX, event.clientY);
            if (!worldPos) return;

            const modifiers = {
                shift: event.shiftKey,
                ctrl: event.ctrlKey,
                alt: event.altKey
            };

            // Forward to GameInterfaceSystem
            this.call.ui_handleCanvasClick( worldPos.x, worldPos.z, modifiers, (result) => {
                this.game.triggerEvent('onInputResult', result);
            });
        };

        canvas.addEventListener('click', this._canvasClickHandler);

        // Note: Right-click (contextmenu) is handled by UnitOrderUISystem
        // which manages its own canvas listener based on isTargeting state
    }

    cleanupCanvasEvents() {
        if (this._currentCanvas && this._canvasClickHandler) {
            this._currentCanvas.removeEventListener('click', this._canvasClickHandler);
        }
        this._currentCanvas = null;
        this._canvasClickHandler = null;
    }

    setupGameButtons() {
        // Camera rotation buttons - only exist in game scene
        const rotateCameraLeftBtn = document.getElementById('rotateCameraLeftBtn');
        const rotateCameraRightBtn = document.getElementById('rotateCameraRightBtn');
        rotateCameraLeftBtn?.addEventListener('click', () => {
            this.call.rotateCamera( 'left');
        });
        rotateCameraRightBtn?.addEventListener('click', () => {
            this.call.rotateCamera( 'right');
        });

        // Camera mode toggle button
        const toggleCameraModeBtn = document.getElementById('toggleCameraModeBtn');
        toggleCameraModeBtn?.addEventListener('click', () => {
            this.call.toggleCameraMode();
            // Update button appearance based on mode
            const mode = this.call.getCameraMode();
            toggleCameraModeBtn.classList.toggle('active', mode === 'free');
            toggleCameraModeBtn.title = mode === 'free' ? 'Switch to game camera' : 'Switch to free camera';
        });
    }

    setupButtonEvents() {
        const mainMenuPlayGameBtn = document.getElementById('mainMenu_PlayGameBtn');
        const mainMenuTutorialBtn = document.getElementById('mainMenu_TutorialBtn');
        const mainMenuSettingsBtn = document.getElementById('mainMenu_SettingsBtn');
        const mainMenuCreditsBtn = document.getElementById('mainMenu_CreditsBtn');

        const gameModeBackBtn = document.getElementById('gameMode_BackBtn');

        const gamePauseBtn = document.getElementById('game_PauseBtn');
        const gameExitBtn = document.getElementById('game_ExitBtn');


        const victoryMainMenuBtn = document.getElementById('victory_MainMenuBtn');
        const defeatMainMenuBtn = document.getElementById('defeat_MainMenuBtn');


        const pausedResumeBtn = document.getElementById('paused_ResumeBtn');
        const pausedRestartBtn = document.getElementById('paused_RestartBtn');
        const pausedMainMenuBtn = document.getElementById('paused_MainMenuBtn');

        mainMenuPlayGameBtn?.addEventListener('click', () => {
            this.call.showGameModeSelect();
        });
        mainMenuTutorialBtn?.addEventListener('click', () => {
            alert('Tutorial coming soon! Check the battle log for basic instructions when you start playing.');
        });
        mainMenuSettingsBtn?.addEventListener('click', () => {
            this.showSettingsModal();
        });
        mainMenuCreditsBtn?.addEventListener('click', () => {
            alert('Auto Battle Arena\nDeveloped with Claude AI\n\nA tactical auto-battler game featuring strategic unit placement and AI opponents.');
        });

        gameModeBackBtn?.addEventListener('click', () => {
            this.call.showMainMenu();
        });

        gamePauseBtn?.addEventListener('click', () => {
            this.call.pauseGame();
        });
        gameExitBtn?.addEventListener('click', () => {
            this.call.exitToMenu();
        });

        victoryMainMenuBtn?.addEventListener('click', () => {
            // Use leaveGame to properly clean up multiplayer connection
            this.call.leaveGame();
        });

        defeatMainMenuBtn?.addEventListener('click', () => {
            // Use leaveGame to properly clean up multiplayer connection
            this.call.leaveGame();
        });

        pausedResumeBtn?.addEventListener('click', () => {
            this.call.resumeGame();
        });
        pausedRestartBtn?.addEventListener('click', () => {
            this.call.restartGame();
        });
        pausedMainMenuBtn?.addEventListener('click', () => {
            this.call.showMainMenu();
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
        document.addEventListener('mousedown', (event) => {
            this.mouseState.pressed = true;
        });

        document.addEventListener('mouseup', (event) => {
            this.mouseState.pressed = false;
        });

        document.addEventListener('mousemove', (event) => {
            this.mouseState.x = event.clientX;
            this.mouseState.y = event.clientY;
        });
    }

    setupDefaultShortcuts() {
        // Define keyboard shortcuts
        this.shortcuts.set('Escape', () => this.handleEscapeKey());
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
        this.cancelSelectedUnit();
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
        return false;
    }


    updateMousePosition(event) {
        this.mouseState.x = event.clientX;
        this.mouseState.y = event.clientY;
    }


    cancelSelectedUnit() {
        const state = this.game.state;
        if (state.selectedUnitType) {
            document.querySelectorAll('.selected').forEach(selected => {
                selected.classList.remove('selected');
            });
            state.selectedUnitType = null;
            this.call.handleUnitSelectionChange();
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
            if (window.screenSystem) {
                window.screenSystem.showMainMenu();
            }
        }
    }

    showSettingsModal() {
        // Use the unified settings overlay instead of a custom modal
        const overlay = document.getElementById('settingsOverlay');
        if (overlay) {
            overlay.classList.add('active');
        }
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

    onSceneUnload() {
        // Clean up canvas event listeners
        this.cleanupCanvasEvents();

        // Clear key states
        this.keyStates = {};
        this.mouseState = { x: 0, y: 0, pressed: false };

        // Remove modal styles if they exist
        const modalStyles = document.querySelector('#modal-styles');
        if (modalStyles) {
            modalStyles.remove();
        }

        const openModals = document.querySelectorAll('.game-modal');
        openModals.forEach(modal => modal.remove());
    }
}
