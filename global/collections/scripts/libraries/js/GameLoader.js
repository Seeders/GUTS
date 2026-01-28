/**
 * GameLoader - Scene loader for game scenes
 * Handles canvas setup and level-specific configuration
 * Assets are loaded by AssetLoader in the loading scene
 */
class GameLoader extends GUTS.BaseLoader {

    constructor(game) {
        super(game);
        // Store reference so game can access loader
        if (game) {
            game.loader = this;
        }
    }

    async load(){
        this.collections = this.game.getCollections();

        this.game.palette = this.collections.palettes && this.collections.configs.game.palette ? this.collections.palettes[this.collections.configs.game.palette] : null;
        this.isometric = this.collections.configs.game.isIsometric;
        const levelIndex = this.game.state.level;
        const reverseEnums = this.game.getReverseEnums();
        const levelKey = reverseEnums.levels[levelIndex];
        const level = this.collections.levels[levelKey];
        this.game.state.tileMapData = level?.tileMap;
        this.game.state.isometric = this.collections.configs.game.isIsometric;
        if (this.game.state.modifierSet && this.collections.modifierSets) {
            this.game.state.stats = this.collections.modifierSets[this.game.state.modifierSet];
            this.game.state.defaultStats = { ...this.game.state.stats };
        }

        // Setup canvas - should be available since scene interface loads before loader runs
        this.setupCanvas(this.collections.configs.game.canvasWidth, this.collections.configs.game.canvasHeight);

        // Load terrain images if not already loaded (needed when not using AssetLoader)
        let terrainImages = this.game.imageManager.getImages("levels", levelKey);
        if (!terrainImages || terrainImages.length === 0) {
            await this.game.imageManager.loadImages("levels", { [levelKey]: level });
            terrainImages = this.game.imageManager.getImages("levels", levelKey);
        }
        const terrainTypeNames = level?.tileMap?.terrainTypes || [];

        // Get cliff border terrain from cliffSet (if available)
        const world = this.collections.worlds?.[level?.world];
        const cliffSet = world?.cliffSet ? this.collections.cliffSets?.[world.cliffSet] : null;
        const cliffBorderTerrain = cliffSet?.borderTerrain || null;

        this.game.terrainTileMapper = new GUTS.TileMap({});

        this.game.terrainTileMapper.init(this.game.terrainCanvasBuffer, this.collections.configs.game.gridSize, terrainImages, this.isometric, { terrainTypeNames, cliffBorderTerrain });
    }

    /**
     * Setup canvas and related buffers.
     * Called when game scene loads - canvas should be in the DOM from the scene's interface.
     */
    setupCanvas(canvasWidth, canvasHeight) {
        this.canvas = document.getElementById("gameCanvas");
        if (!this.canvas) {
            console.warn('[GameLoader] Canvas not found - cannot setup');
            return;
        }

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
        const reverseEnums = this.game.getReverseEnums();
        const levelKey = reverseEnums.levels[this.game.state.level];
        const level = this.collections.levels[levelKey];
        this.terrainCanvasBuffer.width = this.collections.configs.game.gridSize * (level?.tileMap?.terrainMap?.[0]?.length || 32);
        this.terrainCanvasBuffer.height = this.collections.configs.game.gridSize * (level?.tileMap?.terrainMap?.length || 32);

        this.game.canvas = this.canvas;
        this.game.finalCtx = this.finalCtx;
        this.game.canvasBuffer = this.canvasBuffer;
        this.game.ctx = this.ctx;
        this.game.terrainCanvasBuffer = this.terrainCanvasBuffer;
    }
}
