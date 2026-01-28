class UISystem extends GUTS.BaseSystem {
    static services = ['showNotification'];

    static serviceDependencies = [
        'initializeParticleSystem',
        'initializeEffectsSystem'
    ];

    constructor(game) {
        super(game);
        this.game.uiSystem = this;
        // Initialize subsystems
        GUTS.NotificationSystem.initialize();
        this.setupEventListeners();

        // Track last state to avoid unnecessary DOM updates
        this._lastReadyText = '';
        this._lastReadyDisabled = null;
    }

    init() {
    }

    setupEventListeners() {
        // Input handlers are now set up in InputSystem.init()
    }
    
    start() {
        this.call.initializeParticleSystem();
        this.call.initializeEffectsSystem();
        // Welcome messages
    }
    
    update() {
        const readyButton = document.getElementById('readyButton');
        if (!readyButton) return;

        let newDisabled, newText;
        if (this.game.state.phase === this.enums.gamePhase.placement) {
            newDisabled = false;
            newText = this.game.state.playerReady ? 'Waiting for battle...' : 'Ready for Battle!';
        } else {
            newDisabled = true;
            newText = 'Battle in Progress';
        }

        if (newDisabled !== this._lastReadyDisabled) {
            this._lastReadyDisabled = newDisabled;
            readyButton.disabled = newDisabled;
        }
        if (newText !== this._lastReadyText) {
            this._lastReadyText = newText;
            readyButton.textContent = newText;
        }
    }    
    // Get reference to game state
    getGameState() { return this.game.state; }
}