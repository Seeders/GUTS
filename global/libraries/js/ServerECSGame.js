class ServerECSGame extends global.BaseECSGame {
    constructor(app) {
        super(app);
        this.state = new global.GUTS.GameState(this.getCollections());
        this.sceneManager = new global.GUTS.ServerSceneManager(this);
        this.moduleManager = app.moduleManager;
        this.desyncDebugger = new global.GUTS.DesyncDebugger(this);        
        this.serverEventManager = new global.GUTS.ServerEventManager(this);
        this.isServer = true;
    }


}

// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.ServerECSGame = ServerECSGame;
}

// ES6 exports for webpack bundling
export default ServerECSGame;
export { ServerECSGame };