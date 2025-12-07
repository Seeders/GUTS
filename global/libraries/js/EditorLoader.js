/**
 * EditorLoader - Handles loading and setup for editor contexts
 * Mirrors GameLoader pattern for editors (TerrainMapEditor, SceneEditor, etc.)
 */
class EditorLoader {
    constructor(game) {
        this.game = game;
    }

    /**
     * Load and initialize the editor
     * @param {Object} options - Load options
     * @param {Array<string>} options.systems - System names to initialize
     * @param {string} [options.levelName] - Level name for terrain tile mapper (optional)
     */
    async load(options = {}) {
        const { systems = [], levelName } = options;

        this.collections = this.game.getCollections();
        this.game.palette = this.collections.palettes && this.collections.configs.game.palette
            ? this.collections.palettes[this.collections.configs.game.palette]
            : null;

        // Load assets (models)
        await this.loadAssets();

        // Initialize terrain tile mapper if level specified
        if (levelName) {
            await this.initTerrainTileMapper(levelName);
        }

        // Initialize game with systems
        this.game.init(false, {
            systems,
            managers: []
        });
    }

    /**
     * Load all model assets
     */
    async loadAssets() {
        this.game.modelManager = new GUTS.ModelManager(
            this.game.app,
            {},
            {
                ShapeFactory: GUTS.ShapeFactory,
                palette: this.game.palette,
                textures: this.game.getCollections().textures
            }
        );

        for (const objectType in this.collections) {
            await this.game.modelManager.loadModels(objectType, this.collections[objectType]);
        }
    }

    /**
     * Initialize terrain tile mapper for a specific level
     * @param {string} levelName - Name of the level
     */
    async initTerrainTileMapper(levelName) {
        const gameConfig = this.collections.configs?.game;
        if (!gameConfig) return;

        const level = this.collections.levels?.[levelName];
        if (!level) {
            console.warn(`[EditorLoader] Level '${levelName}' not found`);
            return;
        }

        // Create image manager for terrain images
        const imageManager = new GUTS.ImageManager(
            this.game.app,
            { imageSize: gameConfig.imageSize, palette: this.game.palette },
            { ShapeFactory: GUTS.ShapeFactory }
        );

        await imageManager.loadImages("levels", { level }, false, false);
        const terrainImages = imageManager.getImages("levels", "level");

        // Create terrain canvas buffer
        const terrainCanvasBuffer = document.createElement('canvas');
        if (level?.tileMap?.terrainMap && level.tileMap.terrainMap.length > 0) {
            terrainCanvasBuffer.width = gameConfig.gridSize * level.tileMap.terrainMap[0].length;
            terrainCanvasBuffer.height = gameConfig.gridSize * level.tileMap.terrainMap.length;
        } else if (level?.tileMap?.size) {
            const terrainSize = level.tileMap.size * gameConfig.gridSize;
            terrainCanvasBuffer.width = terrainSize;
            terrainCanvasBuffer.height = terrainSize;
        } else {
            terrainCanvasBuffer.width = 4096;
            terrainCanvasBuffer.height = 4096;
        }

        // Get terrain type names for dynamic index lookup
        const terrainTypeNames = level?.tileMap?.terrainTypes || [];

        // Initialize tile mapper (same as GameLoader)
        this.game.terrainTileMapper = new GUTS.TileMap({});
        this.game.terrainTileMapper.init(
            terrainCanvasBuffer,
            gameConfig.gridSize,
            terrainImages,
            gameConfig.isIsometric,
            { skipCliffTextures: false, terrainTypeNames }
        );

        console.log(`[EditorLoader] Initialized tile mapper for level: ${levelName}`);
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EditorLoader;
}

if (typeof GUTS !== 'undefined') {
    GUTS.EditorLoader = EditorLoader;
}

export default EditorLoader;
export { EditorLoader };
