// ===== server.js =====
import express from 'express';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load and execute compiled game files in Node.js context
function loadCompiledGame() {
    console.log('Loading compiled game files...');

    // Set up window-like global context for compiled code
    global.window = global;
    global.document = {
        createElement: () => ({ setAttribute: () => {}, textContent: null }),
        head: { prepend: () => {}, append: () => {} },
        querySelector: () => null
    };

    // Load engine.js
    const enginePath = path.join(__dirname, 'engine.js');
    const engineCode = readFileSync(enginePath, 'utf8');
    const engineScript = new vm.Script(engineCode);
    engineScript.runInThisContext();

    console.log('✓ Loaded engine.js');

    // Load game.js (contains compiled classes and collections)
    const gamePath = path.join(__dirname, 'game.js');
    const gameCode = readFileSync(gamePath, 'utf8');
    const gameScript = new vm.Script(gameCode);
    gameScript.runInThisContext();

    console.log('✓ Loaded game.js');

    // Initialize the compiled game
    if (global.COMPILED_GAME && global.COMPILED_GAME.init) {
        // Create a mock engine object for initialization
        const mockEngine = {
            core: {
                getCollections: () => global.COMPILED_GAME.collections
            },
            moduleManager: {
                libraryClasses: {}
            }
        };
        global.COMPILED_GAME.init(mockEngine);
        console.log('✓ Initialized compiled game');
    }

    // Make classes available via global.GUTS
    global.GUTS = {
        ...global.engine,
        ...global.engine.app.appClasses,
        // Collections available from compiled game
        getCollections: () => global.COMPILED_GAME.collections
    };

    console.log('✓ Game classes loaded and available in global.GUTS');
}

// Load compiled game
try {
    loadCompiledGame();
} catch (error) {
    console.error('Failed to load compiled game:', error);
    console.error('Make sure game.js and engine.js exist in the project directory');
    process.exit(1);
}

// Set up Express server for serving client files (optional)
const app = express();
const server = createServer(app);

// Attach Socket.IO to the existing HTTP server and make it a singleton across hot restarts
if (!global._io) {
    global._io = new IOServer(server, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
    });
}
global.io = global._io; // also expose as global.io for convenience

// Serve static files (your client game files)
app.use(express.static(path.join(__dirname, './')));
app.use('/engine', express.static(path.join(__dirname, '../../engine')));
app.use('/global', express.static(path.join(__dirname, '../../global')));

// API endpoints
app.get('/api/server-status', (req, res) => {
    res.json({
        status: 'running',
        rooms: gameServer.gameRooms.size,
        activePlayers: Array.from(gameServer.gameRooms.values())
            .reduce((total, room) => total + room.players.size, 0)
    });
});

app.get('/api/rooms', (req, res) => {
    const rooms = Array.from(gameServer.gameRooms.entries()).map(([id, room]) => ({
        id,
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers,
        isActive: room.isActive
    }));
    res.json(rooms);
});

// Initialize game server using compiled ServerEngine
const ServerEngine = global.GUTS.ServerEngine;
const gameServer = new ServerEngine();
global.serverEngine = gameServer;

async function startServer() {
    try {
        // ServerEngine/ServerNetworkManager will pick up global.io instead of creating a new listener
        await gameServer.init('TurnBasedWarfare');
        console.log('GUTS Multiplayer Server started successfully');
        console.log('Game server running on port 3000');

        // Start HTTP server (Socket.IO is attached to this same server)
        server.listen(3000, () => {
            console.log('Web server (and Socket.IO) running on port 3000');
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    try { gameServer.stop?.(); } catch (e) { /* noop */ }
    try { global._io?.close(); } catch (e) { /* noop */ }
    server.close(() => process.exit(0));
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
