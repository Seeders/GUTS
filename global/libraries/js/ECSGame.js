class ECSGame extends window.engine.BaseECSGame {
    constructor(app){
        super(app);   
        this.imageManager = new GUTS.ImageManager(this, 
            { 
                imageSize: this.getCollections().configs.game.imageSize, 
                palette: this.getCollections().configs.game.palette, 
                textures: this.getCollections().textures
            }
        );         
        this.state = new GUTS.GameState(this.getCollections());  
        this.sceneManager = new GUTS.SceneManager(this); 
        this.moduleManager = app.moduleManager;
        this.desyncDebugger = new GUTS.DesyncDebugger(this);
    }

    init() {    
        super.init();   
        this.imageManager.dispose();
    }
}