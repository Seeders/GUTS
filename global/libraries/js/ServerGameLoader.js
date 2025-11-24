class ServerGameLoader {
    constructor(game) {
        this.game = game;
    }
    
    async load() {
        this.collections = this.game.getCollections();
        console.log('Server game loader initialized');
        
        // Initialize any server-specific systems
        this.game.init();
        // No canvas or image loading needed on server
        // Just load the scene
        this.game.sceneManager.load(this.collections.configs.game.initialScene);
        
        
        console.log('Server game loaded successfully');
    }
}