class ServerGameLoader extends GUTS.BaseLoader {
    constructor(game) {
        super();
        this.game = game;
    }
    
    async load() {
        this.collections = this.game.getCollections();
        console.log('Server game loader initialized');
        
        // Initialize any server-specific systems
        this.game.init(true);
        // No canvas or image loading needed on server
        // Just load the scene
        
        
        console.log('Server game loaded successfully');
    }
}