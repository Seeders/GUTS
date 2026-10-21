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

    // init() and every onSceneLoad() call setupButtonEvents(), and the DOM
    // survives when the next scene uses the same interface, so wire each
    // element once (a doubled listener opened two stacked Settings dialogs).
    _bindClickOnce(el, handler) {
        if (!el || el._inputSystemClickBound) return;
        el._inputSystemClickBound = true;
        el.addEventListener('click', handler);
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

        this._bindClickOnce(mainMenuPlayGameBtn, () => {
            this.call.showGameModeSelect();
        });
        this._bindClickOnce(mainMenuTutorialBtn, () => {
            alert('Tutorial coming soon! Check the battle log for basic instructions when you start playing.');
        });
        this._bindClickOnce(mainMenuSettingsBtn, () => {
            this.showSettingsModal();
        });
        this._bindClickOnce(mainMenuCreditsBtn, () => {
            alert('Auto Battle Arena\nDeveloped with Claude AI\n\nA tactical auto-battler game featuring strategic unit placement and AI opponents.');
        });

        this._bindClickOnce(gameModeBackBtn, () => {
            this.call.showMainMenu();
        });

        this._bindClickOnce(gamePauseBtn, () => {
            this.call.pauseGame();
        });
        this._bindClickOnce(gameExitBtn, () => {
            this.call.exitToMenu();
        });

        this._bindClickOnce(victoryMainMenuBtn, () => {
            // Use leaveGame to properly clean up multiplayer connection
            this.call.leaveGame();
        });

        this._bindClickOnce(defeatMainMenuBtn, () => {
            // Use leaveGame to properly clean up multiplayer connection
            this.call.leaveGame();
        });

        this._bindClickOnce(pausedResumeBtn, () => {
            this.call.resumeGame();
        });
        this._bindClickOnce(pausedRestartBtn, () => {
            this.call.restartGame();
        });
        this._bindClickOnce(pausedMainMenuBtn, () => {
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
        GUTS.UIKit.openSettings();
    }

    showModal(title, content, onClose = null) {
        const m = GUTS.UIKit.modal({ title, body: content, actions: [{ label: 'Close' }] });
        if (onClose) m.result.then(onClose);
        return m;
    }

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
