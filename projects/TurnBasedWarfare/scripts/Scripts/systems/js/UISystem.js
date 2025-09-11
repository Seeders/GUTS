class UISystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.uiSystem = this;        
        // Initialize subsystems
        GUTS.NotificationSystem.initialize();       
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Delegate to input handler
        this.game.inputManager.setup();
    }
    
    start() {
        this.game.statisticsTrackingSystem.startSession();
        this.game.shopSystem.createShop();
        this.game.phaseSystem.startPlacementPhase();
        this.game.particleSystem.initialize(); 
        this.game.effectsSystem.initialize();                  
        // Welcome messages
        this.game.battleLogSystem.addWelcomeMessages();
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
