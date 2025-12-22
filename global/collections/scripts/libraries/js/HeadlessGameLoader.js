/**
 * HeadlessGameLoader - Minimal game loader for headless simulation
 *
 * Unlike GameLoader (client) which loads images, models, and sets up canvas,
 * this loader only initializes the game state and ECS systems.
 * No visual assets are needed for headless simulation.
 */
class HeadlessGameLoader extends GUTS.BaseLoader {
    constructor(game) {
        this.game = game;
    }

    async load() {
        this.collections = this.game.getCollections();

        // Use headless config if available
        const config = this.collections.configs.headless || this.collections.configs.server;

        // Initialize game palette reference (some systems may check this)
        this.game.palette = this.collections.palettes?.[config?.palette] || null;

        // Set up initial game state
        const levelIndex = this.game.state?.level || 0;
        const reverseEnums = this.game.getReverseEnums();
        const levelKey = reverseEnums.levels?.[levelIndex];
        const level = this.collections.levels?.[levelKey];

        if (level?.tileMap) {
            this.game.state.tileMapData = level.tileMap;
        }

        this.game.state.isometric = config?.isIsometric || false;

        // Initialize the game with server=true (no DOM dependencies)
        await this.game.init(true, config);

        console.log('[HeadlessGameLoader] Game loaded successfully');
    }
}

// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.HeadlessGameLoader = HeadlessGameLoader;
}

// ES6 exports for webpack bundling
export default HeadlessGameLoader;
export { HeadlessGameLoader };
