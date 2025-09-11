import BaseEngine from './BaseEngine.js';
import ServerModuleManager from './ServerModuleManager.js';
import ServerNetworkManager from '../global/libraries/js/ServerNetworkManager.js';
import ServerEventManager from '../global/libraries/js/ServerEventManager.js';

export default class ServerEngine extends BaseEngine {
    constructor() {
        super();
        this.isServer = true;
        this.players = new Map();
        this.gameRooms = new Map();
        this.tickRate = 1 / 20; // 20 TPS
        this.lastTick = 0;
        this.serverNetworkManager = null;
        this.serverEventManager = null;
    }

    async init(projectName) {
        this.collections = await this.loadCollections(projectName);
        if (!this.collections) {
            console.error("Failed to load game configuration");
            return;
        }

        // Initialize ServerModuleManager (no DOM dependencies)
        this.moduleManager = new ServerModuleManager(this, this.collections);
        
        let projectConfig = this.collections.configs.server;
        if (projectConfig.libraries) {
            this.moduleManager.libraryClasses = await this.moduleManager.loadServerModules({ "server": projectConfig });
            global.GUTS = this.moduleManager.libraryClasses;
        }

        this.setupScriptEnvironment();
        this.preCompileScripts();
        
        // Initialize network manager
        this.serverEventManager = new ServerEventManager(this);
        this.serverNetworkManager = new ServerNetworkManager(this);
        await this.serverNetworkManager.init();
        
        this.start();
    }
    preCompileScripts() {
        for (let systemType in this.collections.systems) {
            const systemDef = this.collections.systems[systemType];
            if (systemDef.script) {
                this.moduleManager.compileScript(systemDef.script, systemType);
            }
        }
        for (let funcType in this.collections.functions) {
            const funcDef = this.collections.functions[funcType];
            this.moduleManager.compileFunction(funcDef.script, funcType);
        }
    }
    async loadCollections(projectName) {
        // Server: Load from file system using dynamic imports
        const fs = await import('fs');
        const path = await import('path');
        
        try {
            const configPath = path.join(process.cwd(), 'projects', projectName, 'config', `${projectName.toUpperCase().replace(/ /g, '_')}.json`);
            const configData = fs.readFileSync(configPath, 'utf8');
            const project = JSON.parse(configData);
            return project.objectTypes;
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
            this.simulationTime += this.tickRate;            
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
                room.game.state.simTime = this.simulationTime;
                room.game.state.simTick = (room.game.state.simTick || 0) + 1;
                room.update(this.tickRate, this.simulationTime);
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