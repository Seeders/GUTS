/**
 * Simple loader for projects that don't need asset loading
 * Loads interface from config and initializes the app
 */
class SimpleLoader {
    constructor(game) {
        this.game = game;
        // Store reference so game can access loader later
        if (game) {
            game.loader = this;
        }
    }

    async load() {
        console.log('loading');
        // Load interface from config
        this.loadInterface();

        // Initialize the game (loaders are responsible for calling init)
        if (this.game.init) {
            await this.game.init();
        }
    }

    /**
     * Load and inject interface HTML/CSS from config
     */
    loadInterface() {
        const collections = this.game.getCollections ? this.game.getCollections() : this.game.engine?.collections;
        console.log(this.game);
        if (!collections) return;
        console.log('got collections');

        const config = collections.configs?.game;
        console.log('got config', config);
        const interfaceName = config?.interface;
        if (!interfaceName) return;

        console.log('loading interface', interfaceName);
        const interfaceData = collections.interfaces?.[interfaceName];
        if (!interfaceData) {
            console.warn(`[SimpleLoader] Interface '${interfaceName}' not found`);
            return;
        }

        const appContainer = this.game.engine?.applicationTarget || document.getElementById('appContainer');
        if (!appContainer) {
            console.warn('[SimpleLoader] appContainer not found');
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
     * Stub for setupCanvas - SimpleLoader doesn't set up canvas
     * GameLoader will handle this when game scene loads
     */
    setupCanvas() {
        // No-op - canvas setup is handled by scene-specific loaders
    }
}
