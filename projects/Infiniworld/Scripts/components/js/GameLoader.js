class GameLoader extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }

    init() {}
    
    async load({config}){
        this.config = config;        
        this.config.configs.game.canvasWidth = window.outerWidth;
        this.config.configs.game.canvasHeight = window.outerHeight;
        this.state = new (this.game.libraryClasses.GameState)(this.config);  
        this.game.state = this.state;
        this.game.palette = this.config.palettes && this.config.configs.game.palette ? this.config.palettes[this.config.configs.game.palette] : null;
        this.isometric = this.config.configs.game.isIsometric;
        if (this.game.state.modifierSet && this.config.modifierSets) {
            this.game.state.stats = this.config.modifierSets[this.game.state.modifierSet];
            this.game.state.defaultStats = { ...this.game.state.stats };
        }   
        this.game.skeletonUtils = new (this.game.libraryClasses.Three_SkeletonUtils)();

        this.setupCanvas(this.config.configs.game.canvasWidth, this.config.configs.game.canvasHeight);
        await this.loadAssets();

      
        // Use ModuleManager's script environment
    
        this.game.gameEntity = this.game.createEntityFromConfig(0, 0, 'game', { gameConfig: this.config.configs.game, canvas: this.canvas, canvasBuffer: this.canvasBuffer, terrainCanvasBuffer: this.terrainCanvasBuffer, worldObjects: this.config.worldObjects, levelName: this.game.state.level, level: this.config.levels[this.game.state.level], palette: this.game.palette });
 
        this.game.audioManager = this.game.gameEntity.getComponent('AudioManager');  

        this.player = this.game.spawn(0, 0, "player",
            { spawnType: 'knight', objectType: 'enemies', setDirection: 1 });
        console.log('spawned knight');
        this.player.position.y += 50;
        this.player.placed = true;
        this.game.player = this.player;
    }

    getProject() {
        return this.game.gameEntity;
    }
    setupCanvas(canvasWidth, canvasHeight) {
        this.canvas = document.getElementById("gameCanvas");
        if(this.game.config.configs.game.is3D){
            this.finalCtx = this.canvas.getContext("webgl2");
        } else {
            this.finalCtx = this.canvas.getContext("2d");
        }
        this.canvasBuffer = document.createElement("canvas");
        this.ctx = this.canvasBuffer.getContext("2d");
        this.canvasBuffer.setAttribute('width', canvasWidth);
        this.canvasBuffer.setAttribute('height', canvasHeight);
        this.canvas.setAttribute('width', canvasWidth);
        this.canvas.setAttribute('height', canvasHeight);  
        
        this.terrainCanvasBuffer = document.createElement('canvas');

        this.game.canvas = this.canvas;
        this.game.finalCtx = this.finalCtx;
        this.game.canvasBuffer = this.canvasBuffer;
        this.game.ctx = this.ctx;
        this.game.terrainCanvasBuffer = this.terrainCanvasBuffer;
    }
    async loadAssets() {     
        this.game.modelManager = new (this.game.libraryClasses.ModelManager)(this,{Three_SkeletonUtils: this.game.skeletonUtils, ShapeFactory: this.game.libraryClasses.ShapeFactory, palette: this.game.palette, textures: this.game.config.textures});    
        for(let objectType in this.config) {
            
            await this.game.modelManager.loadModels(objectType, this.config[objectType]);
        }  
 
        console.log("loaded all Models");
    }
}