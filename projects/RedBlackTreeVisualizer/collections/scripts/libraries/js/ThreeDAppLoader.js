/**
 * 3DAppLoader - Simple loader for 3D applications without terrain/levels
 * Sets up canvas and initializes the game with scene management
 */
class ThreeDAppLoader extends GUTS.BaseLoader {

    constructor(game) {
        super(game);
        if (game) {
            game.loader = this;
        }
    }

    async load() {
        console.log('3DAppLoader: Starting load...');
        this.collections = this.game.getCollections();
        const config = this.collections.configs?.game;

        // Load interface HTML/CSS first
        this.loadInterface();

        // Setup canvas
        this.setupCanvas(config?.canvasWidth || 1280, config?.canvasHeight || 720);

        // Initialize game (this loads systems and starts the game loop)
        console.log('3DAppLoader: Calling game.init()...');
        await this.game.init(false);
        console.log('3DAppLoader: Game initialized');
    }

    loadInterface() {
        const config = this.collections.configs?.game;
        const interfaceName = config?.interface;
        if (!interfaceName) return;

        console.log('3DAppLoader: Loading interface', interfaceName);
        const interfaceData = this.collections.interfaces?.[interfaceName];
        if (!interfaceData) {
            console.warn(`[3DAppLoader] Interface '${interfaceName}' not found`);
            return;
        }

        const appContainer = this.game.engine?.applicationTarget || document.getElementById('appContainer');
        if (!appContainer) {
            console.warn('[3DAppLoader] appContainer not found');
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

    setupCanvas(canvasWidth, canvasHeight) {
        const canvas = document.getElementById("gameCanvas");
        if (!canvas) {
            console.warn('[3DAppLoader] Canvas not found');
            return;
        }

        console.log('3DAppLoader: Setting up canvas', canvasWidth, 'x', canvasHeight);

        // For 3D apps, we set up for WebGL
        canvas.setAttribute('width', canvasWidth);
        canvas.setAttribute('height', canvasHeight);

        // Store canvas reference on game
        this.game.canvas = canvas;
    }
}

// Register with GUTS namespace
if (typeof window !== 'undefined') {
    window.ThreeDAppLoader = ThreeDAppLoader;
}

if (typeof GUTS !== 'undefined') {
    GUTS.ThreeDAppLoader = ThreeDAppLoader;
}
