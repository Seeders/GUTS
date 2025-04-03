class GameLoader {
    
    constructor(game) {
        this.game = game;
      
        this.game.state = new (this.libraryClasses.GameState)(this.config);  
 
        this.translator = new (this.libraryClasses.CoordinateTranslator)(this.config.configs.game, this.config.levels[this.state.level].tileMap.terrainMap.length, this.isometric);
        this.spatialGrid = new (this.libraryClasses.SpatialGrid)(this.config.levels[this.state.level].tileMap.terrainMap.length, this.config.configs.game.gridSize);
        const terrainImages = this.imageManager.getImages("levels", this.state.level);
        this.terrainTileMapper = new (this.libraryClasses.TileMap)(this, {}, {CanvasUtility: this.libraryClasses.CanvasUtility});
        this.terrainTileMapper.init(this.terrainCanvasBuffer, this.config.configs.game.gridSize, terrainImages, this.isometric);
        
        // Use ModuleManager's script environment

        this.gameEntity = this.game.createEntityFromConfig(0, 0, 'game', { gameConfig: this.config.configs.game, terrainCanvasBuffer: this.terrainCanvasBuffer, canvasBuffer: this.canvasBuffer, environment: this.config.environment, imageManager: this.imageManager, levelName: this.state.level, level: this.config.levels[this.state.level] });
    }

    getProject() {
        return this.gameEntity;
    }

    async loadAssets() {
        this.game.imageManager = new (this.libraryClasses.ImageManager)(this, {imageSize: this.config.configs.game.imageSize}, { ShapeFactory: this.libraryClasses.ShapeFactory});    
        // Load all images
        for(let objectType in this.config) {
            await this.imageManager.loadImages(objectType, this.config[objectType]);
        }  
    }
}