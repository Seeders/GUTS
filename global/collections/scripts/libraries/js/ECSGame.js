class ECSGame extends GUTS.BaseECSGame {
    constructor(app){
        super(app);   
        this.imageManager = new GUTS.ImageManager(app,
            {
                imageSize: this.getCollections().configs.game.imageSize,
                palette: this.getCollections().configs.game.palette,
                textures: this.getCollections().textures,
                models: this.getCollections().models,
                animations: this.getCollections().animations
            }
        );         
        this.state = new GUTS.GameState(this.getCollections());  
        if(GUTS.DesyncDebugger){
            this.desyncDebugger = new GUTS.DesyncDebugger(this);
        }
    }

    init() {
        super.init();
        // Free up GPU memory from the temporary renderer used for sprite generation,
        // but keep loadedTextures which are needed at runtime
        this.imageManager.disposeRenderingResources();
    }
}

if(typeof ECSGame != 'undefined'){
    if (typeof window !== 'undefined') {
        window.ECSGame = ECSGame;
    }

    // Make available as ES module export (new for server)  
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ECSGame;
    }

    // Make available as ES6 export (also new for server)
    if (typeof exports !== 'undefined') {
        exports.default = ECSGame;
        exports.ECSGame = ECSGame;
    }
}