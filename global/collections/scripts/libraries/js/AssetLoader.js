/**
 * AssetLoader - App loader that loads all game assets with progress display
 * Used as appLoaderLibrary to load assets before the scene system initializes
 */
class AssetLoader {
    constructor(game) {
        this.game = game;
        if (game) {
            game.loader = this;
        }
    }

    async load() {
        this.collections = this.game.getCollections();

        // Load the loading interface first
        this.loadInterface();

        // Initialize loading progress tracker
        this.progress = GUTS.LoadingProgress ? new GUTS.LoadingProgress() : null;
        if (this.progress) {
            this.countAssetsToLoad();
            this.progress.start();
        }

        // Load all assets
        await this.loadAssets();

        if (this.progress) {
            this.progress.complete();
        }

        // Mark assets as loaded so they won't be reloaded
        this.game.assetsLoaded = true;

        // Short delay to show 100% before transitioning
        await new Promise(resolve => setTimeout(resolve, 200));

        // Initialize the game (this will load the initial scene)
        if (this.game.init) {
            await this.game.init();
        }
    }

    /**
     * Load and inject the loading interface HTML/CSS
     */
    loadInterface() {
        const interfaceName = 'loading';
        const interfaceData = this.collections.interfaces?.[interfaceName];
        if (!interfaceData) {
            console.warn(`[AssetLoader] Interface '${interfaceName}' not found`);
            return;
        }

        const appContainer = this.game.engine?.applicationTarget || document.getElementById('appContainer');
        if (!appContainer) {
            console.warn('[AssetLoader] appContainer not found');
            return;
        }

        // Inject HTML
        if (interfaceData.html) {
            appContainer.innerHTML = interfaceData.html;
        }

        // Inject CSS
        const styleId = `interface-${interfaceName}-styles`;
        if (interfaceData.css && !document.getElementById(styleId)) {
            const styleSheet = document.createElement('style');
            styleSheet.id = styleId;
            styleSheet.textContent = interfaceData.css;
            document.head.appendChild(styleSheet);
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

            for (const cfg of Object.values(collection)) {
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

    async loadAssets() {
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
    }
}

// ES6 exports for webpack bundling
export default AssetLoader;
export { AssetLoader };
