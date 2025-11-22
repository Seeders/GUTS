class GameLoader extends GUTS.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }

    init() {}
    
    async load(){
        this.collections = this.game.getCollections();        
        this.collections.configs.game.canvasWidth = window.outerWidth;
        this.collections.configs.game.canvasHeight = window.outerHeight;
        this.game.palette = this.collections.palettes && this.collections.configs.game.palette ? this.collections.palettes[this.collections.configs.game.palette] : null;
        this.isometric = this.collections.configs.game.isIsometric;
        this.game.state.tileMapData = this.collections.levels[this.game.state.level].tileMap;
        this.game.state.isometric = this.collections.configs.game.isIsometric;
        if (this.game.state.modifierSet && this.collections.modifierSets) {
            this.game.state.stats = this.collections.modifierSets[this.game.state.modifierSet];
            this.game.state.defaultStats = { ...this.game.state.stats };
        }   

        this.setupCanvas(this.collections.configs.game.canvasWidth, this.collections.configs.game.canvasHeight);
        await this.loadAssets();

        this.game.translator = new GUTS.CoordinateTranslator(this.collections.configs.game, this.collections.levels[this.game.state.level].tileMap.terrainMap.length, this.isometric);
        this.game.spatialGrid = new GUTS.SpatialGrid(this.collections.levels[this.game.state.level].tileMap.terrainMap.length, this.collections.configs.game.gridSize);
        const terrainImages = this.game.imageManager.getImages("levels", this.game.state.level);

        // Use ModuleManager's script environment
        this.terrainTileMapper = new GUTS.TileMap({});
        this.game.terrainTileMapper.init(this.terrainCanvasBuffer, this.collections.configs.game.gridSize, terrainImages, this.isometric);

        this.game.gameEntity = this.game.createEntityFromCollections('game', { gameConfig: this.collections.configs.game, canvas: this.canvas, canvasBuffer: this.canvasBuffer, terrainCanvasBuffer: this.terrainCanvasBuffer, worldObjects: this.collections.worldObjects, imageManager: this.game.imageManager, levelName: this.game.state.level, level: this.collections.levels[this.game.state.level], palette: this.game.palette }, new THREE.Vector3());
        this.game.imageManager.dispose();    
        this.game.audioManager = this.game.gameEntity.getComponent('AudioManager');  
    }

    getProject() {
        return this.game.gameEntity;
    }
    setupCanvas(canvasWidth, canvasHeight) {
        this.canvas = document.getElementById("gameCanvas");
        if(this.game.getCollections().configs.game.is3D){
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
        this.terrainCanvasBuffer.width = this.collections.configs.game.gridSize * this.collections.levels[this.game.state.level].tileMap.terrainMap[0].length;
        this.terrainCanvasBuffer.height = this.collections.configs.game.gridSize * this.collections.levels[this.game.state.level].tileMap.terrainMap.length;

        this.game.canvas = this.canvas;
        this.game.finalCtx = this.finalCtx;
        this.game.canvasBuffer = this.canvasBuffer;
        this.game.ctx = this.ctx;
        this.game.terrainCanvasBuffer = this.terrainCanvasBuffer;
    }
    async loadAssets() {
        this.game.imageManager = new GUTS.ImageManager(this.game.app, { imageSize: this.collections.configs.game.imageSize, palette: this.game.palette, textures:  this.game.getCollections().textures}, {ShapeFactory: GUTS.ShapeFactory});    
        // Load all images
        for(let objectType in this.collections) {
            await this.game.imageManager.loadImages(objectType, this.collections[objectType]);
        }  
        this.game.modelManager = new GUTS.ModelManager(this.game.app, {}, { ShapeFactory: GUTS.ShapeFactory, palette: this.game.palette, textures: this.game.getCollections().textures});
        
        for(let objectType in this.collections) {
            await this.game.modelManager.loadModels(objectType, this.collections[objectType]);
        }  
 
    }
}