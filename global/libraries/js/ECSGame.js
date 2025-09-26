class ECSGame extends BaseECSGame {
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
        this.desyncDebugger = new DesyncDebugger(this);
    }

    init() {       
        this.imageManager.dispose();
    }
}