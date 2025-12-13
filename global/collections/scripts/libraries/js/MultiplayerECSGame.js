class MultiplayerECSGame extends GUTS.ECSGame {
    constructor(app) {
        super(app);
        this.clientNetworkManager = new GUTS.ClientNetworkManager(this);
        this.isMultiplayer = true;
        this.isConnected = false;
        this.isServer = false;
    }

    async init() {
        super.init();
        
        // Check if this is a multiplayer game
        const config = this.getCollections().configs.game;
        if (config.isMultiplayer && !this.app.isServer) {
            console.log('Initializing multiplayer client...');
            
            // Connect to server
            try {
                await this.clientNetworkManager.connect(config.networkConfig?.serverUrl);
                this.isConnected = true;
                console.log('Connected to multiplayer server');
                
     
                
                // Show multiplayer UI
                this.showMultiplayerUI();
                
            } catch (error) {
                console.error('Failed to connect to server:', error);
                this.handleConnectionError(error);
            }
        }
    }

    showMultiplayerUI() {
        // Show the join room UI
        const joinUI = document.getElementById('joinUI');
        const multiplayerUI = document.getElementById('multiplayerUI');
        
        if (joinUI) {
            joinUI.style.display = 'block';
        }
        if (multiplayerUI) {
            multiplayerUI.style.display = 'none';
        }
    }

    handleConnectionError(error) {
        // Show error message to user
        const errorUI = document.getElementById('connectionError') || this.createErrorUI();
        errorUI.textContent = `Connection failed: ${error.message}`;
        errorUI.style.display = 'block';
    }

    createErrorUI() {
        const errorDiv = document.createElement('div');
        errorDiv.id = 'connectionError';
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: red;
            color: white;
            padding: 10px;
            border-radius: 5px;
            z-index: 9999;
        `;
        document.body.appendChild(errorDiv);
        return errorDiv;
    }

}