class UISystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.uiSystem = this;        
        // Initialize subsystems
        GUTS.NotificationSystem.initialize();
        this.setupEventListeners();
    }

    init() {
        this.game.gameManager.register('showNotification', this.showNotification.bind(this));
    }

    setupEventListeners() {
        // Delegate to input handler
        this.game.inputManager.setup();
    }
    
    start() {
        this.game.gameManager.call('initializeParticleSystem');
        this.game.gameManager.call('initializeEffectsSystem');
        // Welcome messages
    }
    
    update() {
        const readyButton = document.getElementById('readyButton');
        if (this.game.state.phase === 'placement') {
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
