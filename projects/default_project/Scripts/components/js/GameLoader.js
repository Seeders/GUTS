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

        this.isometric = this.config.configs.game.isIsometric;
        this.game.state.tileMapData = this.config.levels[this.game.state.level].tileMap;
        this.game.state.isometric = this.config.configs.game.isIsometric;
        if (this.game.state.modifierSet && this.config.modifierSets) {
            this.game.state.stats = this.config.modifierSets[this.game.state.modifierSet];
            this.game.state.defaultStats = { ...this.game.state.stats };
        }   


        await this.loadAssets();

        this.game.translator = new (this.game.libraryClasses.CoordinateTranslator)(this.config.configs.game, this.config.levels[this.state.level].tileMap.terrainMap.length, this.isometric);
        this.game.spatialGrid = new (this.game.libraryClasses.SpatialGrid)(this.config.levels[this.state.level].tileMap.terrainMap.length, this.config.configs.game.gridSize);
        const terrainImages = this.game.imageManager.getImages("levels", this.state.level);

        this.setupCanvas(this.config.configs.game.canvasWidth, this.config.configs.game.canvasHeight);
        // Use ModuleManager's script environment
        this.game.terrainTileMapper = new (this.game.libraryClasses.TileMap)(this, {}, {CanvasUtility: this.game.libraryClasses.CanvasUtility});
        this.game.terrainTileMapper.init(this.terrainCanvasBuffer, this.config.configs.game.gridSize, terrainImages, this.isometric);
        
        this.gameEntity = this.game.createEntityFromConfig(0, 0, 'game', { gameConfig: this.config.configs.game, canvas: this.canvas, canvasBuffer: this.canvasBuffer, terrainCanvasBuffer: this.terrainCanvasBuffer, environment: this.config.environment, imageManager: this.game.imageManager, levelName: this.game.state.level, level: this.config.levels[this.game.state.level] });
        this.game.imageManager.dispose();      
    }

    getProject() {
        return this.gameEntity;
    }
    setupCanvas(canvasWidth, canvasHeight) {
        this.canvas = document.getElementById("gameCanvas");
        this.finalCtx = this.canvas.getContext("2d");
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
        this.game.imageManager = new (this.game.libraryClasses.ImageManager)(this, { imageSize: this.config.configs.game.imageSize}, {ShapeFactory: this.game.libraryClasses.ShapeFactory});    
        // Load all images
        for(let objectType in this.config) {
            console.log('loading', objectType);
            await this.game.imageManager.loadImages(objectType, this.config[objectType]);
        }  
    }
}