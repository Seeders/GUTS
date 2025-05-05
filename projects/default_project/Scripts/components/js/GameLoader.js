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
        this.game.state.tileMapData = this.config.levels[this.game.state.level].tileMap;
        this.game.state.isometric = this.config.configs.game.isIsometric;
        if (this.game.state.modifierSet && this.config.modifierSets) {
            this.game.state.stats = this.config.modifierSets[this.game.state.modifierSet];
            this.game.state.defaultStats = { ...this.game.state.stats };
        }   

        this.game.skeletonUtils = new (this.game.libraryClasses.Three_SkeletonUtils)();

        this.setupCanvas(this.config.configs.game.canvasWidth, this.config.configs.game.canvasHeight);
        await this.loadAssets();

        this.game.translator = new (this.game.libraryClasses.CoordinateTranslator)(this.config.configs.game, this.config.levels[this.state.level].tileMap.terrainMap.length, this.isometric);
        this.game.spatialGrid = new (this.game.libraryClasses.SpatialGrid)(this.config.levels[this.state.level].tileMap.terrainMap.length, this.config.configs.game.gridSize);
        const terrainImages = this.game.imageManager.getImages("levels", this.state.level);

        // Use ModuleManager's script environment
        this.game.terrainTileMapper = new (this.game.libraryClasses.TileMap)(this, {}, {CanvasUtility: this.game.libraryClasses.CanvasUtility});
        this.game.terrainTileMapper.init(this.terrainCanvasBuffer, this.config.configs.game.gridSize, terrainImages, this.isometric);

        this.game.gameEntity = this.game.createEntityFromConfig('game', { gameConfig: this.config.configs.game, canvas: this.canvas, canvasBuffer: this.canvasBuffer, terrainCanvasBuffer: this.terrainCanvasBuffer, worldObjects: this.config.worldObjects, imageManager: this.game.imageManager, levelName: this.game.state.level, level: this.config.levels[this.game.state.level], palette: this.game.palette }, new THREE.Vector3());
        this.game.imageManager.dispose();    
        this.game.audioManager = this.game.gameEntity.getComponent('AudioManager');  
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
        this.terrainCanvasBuffer.width = this.config.configs.game.gridSize * this.config.levels[this.state.level].tileMap.terrainMap[0].length;
        this.terrainCanvasBuffer.height = this.config.configs.game.gridSize * this.config.levels[this.state.level].tileMap.terrainMap.length;

        this.game.canvas = this.canvas;
        this.game.finalCtx = this.finalCtx;
        this.game.canvasBuffer = this.canvasBuffer;
        this.game.ctx = this.ctx;
        this.game.terrainCanvasBuffer = this.terrainCanvasBuffer;
    }
    async loadAssets() {
        this.game.imageManager = new (this.game.libraryClasses.ImageManager)(this, { imageSize: this.config.configs.game.imageSize, palette: this.game.palette, textures:  this.game.config.textures}, {ShapeFactory: this.game.libraryClasses.ShapeFactory});    
        // Load all images
        for(let objectType in this.config) {
            await this.game.imageManager.loadImages(objectType, this.config[objectType]);
        }  
        this.game.modelManager = new (this.game.libraryClasses.ModelManager)(this, {}, {Three_SkeletonUtils: this.game.skeletonUtils, ShapeFactory: this.game.libraryClasses.ShapeFactory, palette: this.game.palette, textures: this.game.config.textures});
        
        for(let objectType in this.config) {
            await this.game.modelManager.loadModels(objectType, this.config[objectType]);
        }  
 
    }
}