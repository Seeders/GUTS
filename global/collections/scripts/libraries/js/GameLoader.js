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

        // Check if this is a scene load (game already initialized) vs app startup
        // If sceneManager has a loaded scene, we're being called as a scene loader
        const isSceneLoad = this.game.sceneManager?.hasLoadedScene();

        // Initialize loading progress tracker
        this.progress = GUTS.LoadingProgress ? new GUTS.LoadingProgress() : null;
        if (this.progress) {
            this.countAssetsToLoad();
            this.progress.start();
        }

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

        await this.loadAssets();
        const terrainImages = this.game.imageManager.getImages("levels", levelKey);
        const terrainTypeNames = level?.tileMap?.terrainTypes || [];

        // Get cliff border terrain from cliffSet (if available)
        const world = this.collections.worlds?.[level?.world];
        const cliffSet = world?.cliffSet ? this.collections.cliffSets?.[world.cliffSet] : null;
        const cliffBorderTerrain = cliffSet?.borderTerrain || null;

        this.game.terrainTileMapper = new GUTS.TileMap({});

        this.game.terrainTileMapper.init(this.game.terrainCanvasBuffer, this.collections.configs.game.gridSize, terrainImages, this.isometric, { terrainTypeNames, cliffBorderTerrain });

        if (this.progress) {
            this.progress.complete();
        }

        // Initialize the game (loaders are responsible for calling init)
        if (!isSceneLoad) {
            await this.game.init(false);
        }
    }

    /**
     * Count assets that need to be loaded for progress tracking
     */
    countAssetsToLoad() {
        let textureCount = 0;
        let modelCount = 0;

        // Count textures
        if (this.collections.textures) {
            textureCount = Object.keys(this.collections.textures).length;
        }

        // Count models from all collections
        for (const objectType in this.collections) {
            const collection = this.collections[objectType];
            if (!collection || typeof collection !== 'object') continue;

            for (const [type, cfg] of Object.entries(collection)) {
                if (cfg?.render?.model) {
                    modelCount++;
                    // Count animation variants too
                    if (cfg.render?.animations) {
                        for (const variants of Object.values(cfg.render.animations)) {
                            modelCount += variants.length;
                        }
                    }
                }
            }
        }

        if (textureCount > 0) {
            this.progress.addPhase('textures', textureCount);
        }
        if (modelCount > 0) {
            this.progress.addPhase('models', modelCount);
        }
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
    async loadAssets() {
        // Skip loading if already loaded (scene transition vs app startup)
        if (this.game.assetsLoaded) {
            return;
        }

        // Load all images
        for (let objectType in this.collections) {
            await this.game.imageManager.loadImages(objectType, this.collections[objectType]);
        }

        // Load THREE.Texture objects from the textures collection
        if (this.collections.textures) {
            const onTextureProgress = this.progress ? () => this.progress.increment('textures') : null;
            await this.game.imageManager.loadTextures(this.collections.textures, onTextureProgress);
        }

        const onModelProgress = this.progress ? () => this.progress.increment('models') : null;
        for (let objectType in this.collections) {
            await this.game.modelManager.loadModels(objectType, this.collections[objectType], onModelProgress);
        }

        this.game.assetsLoaded = true;
    }
}