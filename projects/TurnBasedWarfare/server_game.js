// ===== server.js =====
import express from 'express';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import vm from 'vm';

// Import server-specific classes (these are not in compiled game.js)
import ServerEngine from '../../engine/ServerEngine.js';
import ServerMatchmakingService from '../../global/libraries/js/ServerMatchmakingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load and execute compiled game files in Node.js context
function loadCompiledGame() {
    console.log('Loading compiled game files...');

    // Set up window-like global context for compiled code
    global.window = global;

    // Set up CommonJS-like environment for webpack bundle
    global.module = { exports: {} };
    global.exports = global.module.exports;

    // Load game_server.js (contains server-only compiled classes and collections)
    const gamePath = path.join(__dirname, 'dist/server/game.js');
    const gameCode = readFileSync(gamePath, 'utf8');
    const gameScript = new vm.Script(gameCode);
    gameScript.runInThisContext();

    console.log('✓ Loaded compiled game_server.js');

    // Merge server infrastructure classes into existing global.GUTS (populated by webpack bundle)
    // Don't overwrite global.GUTS - the webpack bundle already assigned game classes to it
    Object.assign(global.GUTS, {
        // Server infrastructure classes
        ServerEngine,
        // Don't override classes that came from the bundle (BaseECSGame, etc.)
        // Only add infrastructure that's not in the bundle
        ServerMatchmakingService,
        // Collections available from compiled game
        getCollections: () => global.COMPILED_GAME?.collections
    });

    console.log('✓ Game classes loaded and available in global.GUTS');
}

// Load compiled game
try {
    loadCompiledGame();
} catch (error) {
    console.error('Failed to load compiled game:', error);
    console.error('Make sure game.js exists in the project directory');
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
// First try compiled client, then fall back to source files
app.use(express.static(path.join(__dirname, 'dist/client')));
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
    const rooms = Array.from(gameServer.gameRooms.entries())
        .filter(([id, room]) => room.players.size > 0) // Only return rooms with players
        .map(([id, room]) => ({
            id,
            playerCount: room.players.size,
            maxPlayers: room.maxPlayers,
            isActive: room.isActive
        }));
    res.json(rooms);
});

// Initialize game server
const gameServer = new ServerEngine();
global.serverEngine = gameServer;

async function startServer() {
    try {
        // ServerEngine/ServerNetworkManager will pick up global.io instead of creating a new listener
        await gameServer.init('TurnBasedWarfare');
        if (global.window.COMPILED_GAME && !global.window.COMPILED_GAME.initialized) {
            global.window.COMPILED_GAME.init(gameServer);
        }
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
