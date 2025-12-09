import BaseEngine from './BaseEngine.js';
import ServerNetworkManager from '../global/collections/scripts/libraries/js/ServerNetworkManager.js';

export default class ServerEngine extends BaseEngine {
    constructor() {
        super();
        this.isServer = true;
        this.players = new Map();
        this.gameRooms = new Map();
        this.tickRate = 1 / 20; // 20 TPS
        this.lastTick = 0;
        this.accumulator = 0;
        this.serverNetworkManager = null;
    }

    async init(projectName) {
        this.collections = await this.loadCollections(projectName);
        if (!this.collections) {
            console.error("Failed to load game configuration");
            return;
        }

        // Initialize network manager
        this.serverNetworkManager = new ServerNetworkManager(this);
        await this.serverNetworkManager.init();
        
        this.start();
    }

    async loadCollections(projectName) {
        // Use webpack-compiled collections from COMPILED_GAME
        if (global.COMPILED_GAME?.collections) {
            console.log('Using webpack-compiled collections');
            return global.COMPILED_GAME.collections;
        }

        // Fallback: Load from file system (for development without webpack build)
        console.log('Fallback: Loading collections from file system');
        const fs = await import('fs');
        const path = await import('path');

        try {
            const scriptsPath = path.join(process.cwd(), 'projects', projectName, 'collections');
            const configsPath = path.join(scriptsPath, 'Settings', 'configs');

            const collections = {
                configs: {}
            };

            // Load ALL config files from Settings/configs
            if (fs.existsSync(configsPath)) {
                const configFiles = fs.readdirSync(configsPath).filter(f => f.endsWith('.json'));
                for (const file of configFiles) {
                    const configName = path.basename(file, '.json');
                    const configPath = path.join(configsPath, file);
                    collections.configs[configName] = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                }
            }

            // Load objectTypeDefinitions from Settings/objectTypeDefinitions
            const defsPath = path.join(scriptsPath, 'Settings', 'objectTypeDefinitions');
            if (fs.existsSync(defsPath)) {
                const defFiles = fs.readdirSync(defsPath).filter(f => f.endsWith('.json'));
                collections.objectTypeDefinitions = defFiles.map(file =>
                    JSON.parse(fs.readFileSync(path.join(defsPath, file), 'utf8'))
                );
            }

            return collections;
        } catch (error) {
            console.error('Failed to load server config:', error);
            throw error;
        }
    }

    createGameRoom(roomId, maxPlayers = 4) {
        if (!this.gameRooms.has(roomId)) {
            console.log("GUTS", global.GUTS);
            console.log("NAME", this.collections.configs.server.appLibrary);
            console.log("APP", global.GUTS[this.collections.configs.server.appLibrary]);
            const gameInstance = new global.GUTS[this.collections.configs.server.appLibrary](this);
            const room = new global.GUTS.ServerGameRoom(this, roomId, gameInstance, maxPlayers);
            this.gameRooms.set(roomId, room);
            return room;
        }
        return this.gameRooms.get(roomId);
    }

    getRoom(roomId){
        return this.gameRooms.get(roomId);
    }

    gameLoop() {
        if (!this.running) return;
        
        const now = this.getCurrentTime();
        const deltaTime = (now - this.lastTick) / 1000;

        this.lastTick = now;
        
        this.accumulator += deltaTime;
        while (this.accumulator >= this.tickRate) {        
            this.tick();
            this.accumulator -= this.tickRate;
        }
        
        // Use setImmediate for next tick (Node.js specific)
        setImmediate(() => this.gameLoop());
    }

    tick() {
        // Update all active game rooms
        for (const [roomId, room] of this.gameRooms) {
            if (room.isActive) {
                room.update(this.tickRate);
            }
        }
        
        // Send updates to clients
        this.serverNetworkManager.broadcastGameStates();
    }

    start() {
        super.start();
        // Start the server game loop
        setImmediate(() => this.gameLoop());
    }

    stop() {
        super.stop();
        // No animation frame to cancel on server
    }

    getCurrentTime() {
        // Use process.hrtime for high precision on server
        const [seconds, nanoseconds] = process.hrtime();
        return seconds * 1000 + nanoseconds / 1000000;
    }
}