class UISystem extends GUTS.BaseSystem {
    static services = ['showNotification'];

    constructor(game) {
        super(game);
        this.game.uiSystem = this;
        // Initialize subsystems
        GUTS.NotificationSystem.initialize();
        this.setupEventListeners();
    }

    init() {
    }

    setupEventListeners() {
        // Input handlers are now set up in InputSystem.init()
    }
    
    start() {
        this.game.call('initializeParticleSystem');
        this.game.call('initializeEffectsSystem');
        // Welcome messages
    }
    
    update() {
        const readyButton = document.getElementById('readyButton');
        if (this.game.state.phase === this.enums.gamePhase.placement) {
            readyButton.disabled = false;
            readyButton.textContent = this.game.state.playerReady ? 'Waiting for battle...' : 'Ready for Battle!';
        } else {
            readyButton.disabled = true;
            readyButton.textContent = 'Battle in Progress';
        }
    }    
    // Get reference to game state
    getGameState() { return this.game.state; }
}