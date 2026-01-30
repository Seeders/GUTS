/**
 * VoxelLoader - Simple loader for voxel game
 * Loads interface and initializes game without level/enum dependencies
 */
class VoxelLoader {
    constructor(game) {
        this.game = game;
        if (game) {
            game.loader = this;
        }
    }

    async load() {
        console.log('VoxelLoader: Loading...');

        // Load interface HTML/CSS
        this.loadInterface();

        // Show the app container
        const appContainer = this.game.engine?.applicationTarget || document.getElementById('appContainer');
        if (appContainer) {
            appContainer.style.display = 'block';
        }

        // Initialize the game
        if (this.game.init) {
            await this.game.init();
        }

        console.log('VoxelLoader: Complete');
    }

    loadInterface() {
        const collections = this.game.getCollections ? this.game.getCollections() : this.game.engine?.collections;
        if (!collections) return;

        const config = collections.configs?.game;
        const interfaceName = config?.interface;
        if (!interfaceName) return;

        const interfaceData = collections.interfaces?.[interfaceName];
        if (!interfaceData) {
            console.warn(`[VoxelLoader] Interface '${interfaceName}' not found`);
            return;
        }

        const appContainer = this.game.engine?.applicationTarget || document.getElementById('appContainer');
        if (!appContainer) {
            console.warn('[VoxelLoader] appContainer not found');
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

    setupCanvas() {
        // No-op - canvas is in interface HTML
    }
}

GUTS.VoxelLoader = VoxelLoader;
