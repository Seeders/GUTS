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

// Load and execute compiled game files in Node.js context
function loadCompiledGame() {
    console.log('Loading compiled game files...');

    // Set up window-like global context for compiled code
    global.window = global;

    // Add window.addEventListener mock
    global.window.addEventListener = () => {};
    global.window.removeEventListener = () => {};

    // Create comprehensive DOM mocks for client libraries
    const mockElement = {
        setAttribute: () => {},
        getAttribute: () => null,
        removeAttribute: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        appendChild: () => {},
        removeChild: () => {},
        innerHTML: '',
        textContent: '',
        style: {},
        classList: {
            add: () => {},
            remove: () => {},
            contains: () => false,
            toggle: () => {}
        }
    };

    global.document = {
        createElement: () => ({ ...mockElement }),
        getElementById: () => mockElement,
        querySelector: () => mockElement,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        body: mockElement,
        head: {
            prepend: () => {},
            append: () => {},
            appendChild: () => {}
        }
    };

    // Mock other browser globals - use defineProperty to avoid read-only errors
    try {
        Object.defineProperty(global, 'navigator', {
            value: { userAgent: 'Node.js Server' },
            writable: true,
            configurable: true
        });
    } catch (e) {
        // navigator might already be defined, skip
    }

    try {
        Object.defineProperty(global, 'location', {
            value: { href: '', pathname: '' },
            writable: true,
            configurable: true
        });
    } catch (e) {
        // location might already be defined, skip
    }

    global.Image = class Image {};
    global.Audio = class Audio {};
    global.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {}
    };
    global.sessionStorage = global.localStorage;

    // Load game_server.js (contains server-only compiled classes and collections)
    const gamePath = path.join(__dirname, 'game_server.js');
    const gameCode = readFileSync(gamePath, 'utf8');
    const gameScript = new vm.Script(gameCode, {
        importModuleDynamically: async (specifier) => {
            // Mock dynamic imports for modules we can't load in Node.js
            console.log(`Skipping dynamic import: ${specifier}`);
            return { default: {} };
        }
    });
    gameScript.runInThisContext();

    console.log('✓ Loaded compiled game_server.js');

    // Make server classes and game classes available via global.GUTS
    global.GUTS = {
        // Server infrastructure classes
        ServerEngine,
        ServerModuleManager,
        BaseECSGame,
        ServerSceneManager,
        GameState,
        GameRoom,
        ServerNetworkManager,
        ServerMatchmakingService,
        MinHeap,
        DesyncDebugger,
        // Game classes from compiled bundle
        ...global.engine?.app?.appClasses,
        // Collections available from compiled game
        getCollections: () => global.COMPILED_GAME?.collections
    };

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
