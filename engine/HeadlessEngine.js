import BaseEngine from './BaseEngine.js';

/**
 * HeadlessEngine - Minimal simulation runner without rendering
 *
 * This engine is completely game-agnostic. It only:
 * - Initializes the game instance and loader
 * - Runs the tick loop
 * - Provides basic simulation control (pause/resume/stop)
 *
 * All game logic is handled by BaseECSGame and its systems.
 * No game-specific code belongs here.
 */
export default class HeadlessEngine extends BaseEngine {
    constructor() {
        super();
        this.isServer = true;
        this.isHeadless = true;
        this.tickRate = 1 / 20; // 20 TPS
        this.paused = false;
        this.running = false;
        this.maxTicks = 10000;
    }

    async init(projectName) {
        this.projectName = projectName;
        this.collections = await this.loadCollections(projectName);
        if (!this.collections) {
            throw new Error("Failed to load game configuration");
        }

        const config = this.collections.configs.headless || this.collections.configs.server;

        // Create game instance
        const appLibrary = config.appLibrary || 'HeadlessECSGame';
        this.gameInstance = new global.GUTS[appLibrary](this);

        // Use loader
        const loaderLibrary = config.appLoaderLibrary || 'HeadlessGameLoader';
        this.loader = new global.GUTS[loaderLibrary](this.gameInstance);
        await this.loader.load();

        console.log('[HeadlessEngine] Initialized');
    }

    async loadCollections(projectName) {
        if (global.COMPILED_GAME?.collections) {
            return global.COMPILED_GAME.collections;
        }

        // Fallback: Load from file system
        const fs = await import('fs');
        const path = await import('path');

        try {
            const configsPath = path.join(process.cwd(), 'projects', projectName, 'collections', 'Settings', 'configs');
            const collections = { configs: {} };

            if (fs.existsSync(configsPath)) {
                const configFiles = fs.readdirSync(configsPath).filter(f => f.endsWith('.json'));
                for (const file of configFiles) {
                    const configName = path.basename(file, '.json');
                    collections.configs[configName] = JSON.parse(fs.readFileSync(path.join(configsPath, file), 'utf8'));
                }
            }

            return collections;
        } catch (error) {
            console.error('Failed to load config:', error);
            throw error;
        }
    }

    /**
     * Run the simulation loop
     * @param {Object} options
     * @param {number} options.maxTicks - Maximum ticks to run
     * @param {Function} options.shouldStop - Optional function that returns true to stop
     */
    async run(options = {}) {
        const { maxTicks = this.maxTicks, shouldStop } = options;

        this.running = true;
        this.paused = false;
        let tickCount = 0;

        while (this.running && tickCount < maxTicks) {
            if (!this.paused && this.gameInstance?.update) {
                await this.gameInstance.update(this.tickRate);
            }
            tickCount++;

            if (shouldStop && shouldStop(this.gameInstance)) {
                break;
            }
        }

        this.running = false;
        return { tickCount };
    }

    stop() {
        super.stop();
        this.running = false;
    }

    pause() {
        this.paused = true;
    }

    resume() {
        this.paused = false;
    }

    getCurrentTime() {
        const [seconds, nanoseconds] = process.hrtime();
        return seconds * 1000 + nanoseconds / 1000000;
    }
}

export { HeadlessEngine };
