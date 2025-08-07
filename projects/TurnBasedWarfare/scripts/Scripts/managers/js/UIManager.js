class UIManager {
    constructor(app) {
        this.game = app;
        this.game.uiManager = this;
        
        // Initialize subsystems
        GUTS.NotificationSystem.initialize();
        this.placement = new GUTS.PlacementSystem(app);
        this.battleLog = new GUTS.BattleLogSystem(app);
        this.statistics = new GUTS.StatisticsTracker(app);
        this.effects = new GUTS.EffectsSystem(app);
        this.inputManager = this.game.inputManager;
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Delegate to input handler
        this.inputManager.setup();
    }
    
    start() {
        this.statistics.startSession();
        this.game.shopManager.createShop();
        this.game.phaseManager.startPlacementPhase();
        this.effects.initialize();
        
        // Update UI every 100ms
        setInterval(() => this.updateUI(), 100);
        this.updateUI();
        
        // Welcome messages
        this.battleLog.addWelcomeMessages();
    }
    
    updateUI() {
        this.game.shopManager.updateShop();
        this.game.phaseManager.updateDisplay();
        this.statistics.updateDisplay();
        this.updateArmyLists();
        this.updateControls();
    }
    
    updateArmyLists() {
        // Delegate to army display system
        const armyDisplay = new GUTS.ArmyDisplaySystem(this);
        armyDisplay.update();
    }
    
    updateControls() {
        const readyButton = document.getElementById('readyButton');
        if (this.game.state.phase === 'placement') {
            readyButton.disabled = false;
            readyButton.textContent = this.game.state.playerReady ? 'Waiting for battle...' : 'Ready for Battle!';
        } else {
            readyButton.disabled = true;
            readyButton.textContent = 'Battle in Progress';
        }
    }
    
    // Expose subsystem methods
    addBattleLog(message, className = '') { this.battleLog.add(message, className); }
    toggleReady() { this.game.phaseManager.toggleReady(); }
    pauseGame() { this.game.phaseManager.pause(); }
    resumeGame() { this.game.phaseManager.resume(); }
    restartGame() { this.game.phaseManager.restart(); }
    
    // Get reference to game state
    getGameState() { return this.game.state; }
}
