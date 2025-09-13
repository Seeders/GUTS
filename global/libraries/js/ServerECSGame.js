class ServerECSGame extends global.GUTS.BaseECSGame {
    constructor(app) {
        super(app);
        this.state = new global.GUTS.GameState(this.getCollections());
        this.sceneManager = new global.GUTS.ServerSceneManager(this);
        this.moduleManager = app.moduleManager;
        this.desyncDebugger = new global.GUTS.DesyncDebugger(this);
        this.isServer = true;
    }


}
      

if (typeof window !== 'undefined') {
    window.ServerECSGame = ServerECSGame;
}

// Make available as ES module export (new for server)  
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ServerECSGame;
}

// Make available as ES6 export (also new for server)
if (typeof exports !== 'undefined') {
    exports.default = ServerECSGame;
    exports.ServerECSGame = ServerECSGame;
}