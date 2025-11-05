// ===== server.js =====
import express from 'express';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Import server-specific classes
import ServerEngine from '../../engine/ServerEngine.js';
import ServerModuleManager from '../../engine/ServerModuleManager.js';
import BaseECSGame from '../../global/libraries/js/BaseECSGame.js';
import ServerSceneManager from '../../global/libraries/js/ServerSceneManager.js';
import GameState from '../../global/libraries/js/GameState.js';
import GameRoom from '../../global/libraries/js/GameRoom.js';
import ServerNetworkManager from '../../global/libraries/js/ServerNetworkManager.js';
import DesyncDebugger from './scripts/Scripts/libraries/js/DesyncDebugger.js';
import ServerMatchmakingService from '../../global/libraries/js/ServerMatchmakingService.js';
import MinHeap from './scripts/Scripts/libraries/js/MinHeap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Make classes globally available (similar to how client uses window.GUTS)
global.GUTS = {
    ServerEngine,
    ServerModuleManager, 
    BaseECSGame,
    ServerSceneManager,
    GameState,
    GameRoom,
    ServerNetworkManager,
    ServerMatchmakingService,
    MinHeap,
    DesyncDebugger
};

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

// Initialize game server
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
