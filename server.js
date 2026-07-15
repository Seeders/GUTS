/**
 * Unified GUTS Server
 * Combines editor functionality and game server into a single deployment
 *
 * Usage:
 *   node server.js [port] [options]
 *
 * Options:
 *   --production, --prod, -p    Run in production mode (skips auto-build/watch)
 *
 * Examples:
 *   node server.js 8080 --prod   # Production on port 8080
 *   node server.js               # Development on port 8080
 */

const express = require('express');
const http = require('http');
const { Server: IOServer } = require('socket.io');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const vm = require('vm');
const { makeEditorGate } = require('./editor-auth');
const { createEditorApi } = require('./editor-api');

// CLI Arguments
const args = process.argv.slice(2);
const portArg = args.find(arg => !arg.startsWith('-'));
const PORT = portArg ? parseInt(portArg, 10) : 8080;
const isProduction = args.includes('--production') || args.includes('--prod') || args.includes('-p');

// Base directory for all file operations
const BASE_DIR = path.join(__dirname, '/');
const PROJS_DIR = path.join(BASE_DIR, 'projects');
const MODULES_DIR = path.join(BASE_DIR, 'global', 'collections');
const CACHE_DIR = path.join(__dirname, 'cache');


// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Attach Socket.IO for multiplayer games
const io = new IOServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 10e6 // 10MB max message size for save files
});
global.io = io;
global._io = io;

// Configure CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
}));

// Configure Express middleware.
//
// Capture the raw request body as req.rawBody while parsing JSON. A webhook that
// verifies a signature over the exact bytes it received (Stripe) needs those
// bytes, and the parser would otherwise be the only thing to read the stream.
const captureRawBody = (req, res, buf) => { if (buf && buf.length) req.rawBody = buf; };
app.use(bodyParser.json({ limit: '50mb', verify: captureRawBody }));
app.use(express.json({ limit: '10mb', verify: captureRawBody }));

// ===== PROJECT BACKENDS =====

/**
 * A project may ship a backend by exporting `mount(app, { base })` from
 * `projects/<Name>/backend.js`. We mount it under the same URL prefix the
 * project's client is served from, so a project's API lives alongside its
 * index.html and two projects can never collide over a route like /api.
 *
 * This runs before the static handler purely so a project can shadow a path if
 * it needs to; static would fall through for API routes anyway.
 */
function mountProjectBackends() {
    let projectNames = [];
    try {
        projectNames = fsSync.readdirSync(PROJS_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    } catch (error) {
        console.error('Could not read the projects directory:', error.message);
        return;
    }

    for (const projectName of projectNames) {
        const backendPath = path.join(PROJS_DIR, projectName, 'backend.js');
        if (!fsSync.existsSync(backendPath)) continue;

        try {
            const backend = require(backendPath);
            if (typeof backend.mount !== 'function') {
                console.warn(`${projectName}/backend.js has no mount() export; skipping.`);
                continue;
            }

            const base = `/projects/${projectName}`;
            const info = backend.mount(app, { base }) || {};
            console.log(`Mounted ${projectName} backend at ${info.routes || base + '/api'}`);
        } catch (error) {
            // One broken project must not take the whole server down with it.
            console.error(`Failed to mount ${projectName} backend:`, error.message);
        }
    }
}

mountProjectBackends();

/**
 * `secure` is a per-project storage category, a sibling of collections/:
 *
 *     projects/<Name>/secure/    databases, uploaded documents, anything private
 *
 * Any project gets one by creating the folder. Nothing inside is ever served:
 * it is reachable only through that project's own authenticated routes. We
 * serve the whole repo statically, so the door has to be shut here, before
 * express.static gets a look at it.
 *
 * It sits outside collections/ on purpose — the build treats the folder
 * structure under collections/ as the source of truth and inlines what it finds
 * into the client bundle, so a "secure" collection would compile straight into
 * the browser.
 *
 * For DogBoarding this folder holds the database and uploaded vet records,
 * which carry client home addresses and phone numbers.
 *
 * Also denied: the multer scratch directory at /uploads (raw uploaded bytes;
 * nothing fetches them by URL).
 *
 * NOT denied: /cache, which ImageManager legitimately fetches sprite atlases
 * from (global/.../ImageManager.js fetches `/cache/${prefix}.json`).
 */
const PRIVATE_PATHS = /^\/uploads(\/|$)|^\/projects\/[^/]+\/(secure|node_modules)(\/|$)/;

app.use((req, res, next) => {
    if (PRIVATE_PATHS.test(req.path)) {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    next();
});

/**
 * Editor authentication. The editor endpoints below can read, write and delete
 * arbitrary files under projects/ and compile the served bundle - unauthenticated
 * they are remote code execution. This gate fronts every editor surface (the
 * endpoints and the /projects/Editor page); games, static assets, the sprite
 * read endpoint, sockets and project backends pass through. Mounted before
 * express.static so it can gate the editor page too. See editor-auth.js for the
 * GUTS_EDITOR_PASSWORD / GUTS_EDITOR_USER config.
 */
app.use(makeEditorGate({ isProduction }));

// Serve static files from the entire repo
app.use(express.static(BASE_DIR, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.wasm')) {
            res.set('Content-Type', 'application/wasm');
        }
    }
}));

// ===== GAME SERVER FUNCTIONALITY =====

// Store for loaded game servers (one per project)
const gameServers = new Map();

/**
 * Load compiled game for a project
 */
function loadCompiledGame(projectName) {
    const projectPath = path.join(PROJS_DIR, projectName);
    const gamePath = path.join(projectPath, 'dist/server/game.js');

    if (!fsSync.existsSync(gamePath)) {
        console.log(`No compiled server game found for ${projectName}`);
        return null;
    }

    console.log(`Loading compiled game for ${projectName}...`);

    // Set up window-like global context for compiled code
    if (!global.window) global.window = global;

    // Set up CommonJS-like environment for webpack bundle
    global.module = { exports: {} };
    global.exports = global.module.exports;

    try {
        const gameCode = fsSync.readFileSync(gamePath, 'utf8');
        const gameScript = new vm.Script(gameCode);
        gameScript.runInThisContext();
        console.log(`Loaded compiled game for ${projectName}`);
        return true;
    } catch (error) {
        console.error(`Failed to load compiled game for ${projectName}:`, error);
        return null;
    }
}

/**
 * Initialize game server for a project
 */
async function initGameServer(projectName) {
    if (gameServers.has(projectName)) {
        return gameServers.get(projectName);
    }

    // Load the compiled game
    const loaded = loadCompiledGame(projectName);
    if (!loaded) {
        return null;
    }

    // Dynamic import of ServerEngine (ES module)
    const { default: ServerEngine } = await import('./engine/ServerEngine.js');

    // Merge server infrastructure classes into global.GUTS
    Object.assign(global.GUTS, {
        ServerEngine,
        getCollections: () => global.COMPILED_GAME?.collections
    });

    // Initialize the game server
    const gameServer = new ServerEngine();
    await gameServer.init(projectName);

    if (global.window.COMPILED_GAME && !global.window.COMPILED_GAME.initialized) {
        global.window.COMPILED_GAME.init(gameServer);
    }

    gameServers.set(projectName, gameServer);
    global.serverEngine = gameServer;

    console.log(`Game server initialized for ${projectName}`);
    return gameServer;
}

// ===== EDITOR FILESYSTEM ENDPOINTS =====
// The editor's read/write/list/delete endpoints, factored into a reusable,
// project-scoped module (editor-api.js). Mounted here in multi-project mode:
// project ids resolve under PROJS_DIR, exactly as before. The global editor gate
// (above) still guards them; confineDir defaults to PROJS_DIR so no request can
// escape projects/.
app.use('/', createEditorApi({
    projsDir: PROJS_DIR,
    modulesDir: MODULES_DIR,
    cacheDir: CACHE_DIR,
    baseDir: BASE_DIR,
    uploadsDir: path.join(BASE_DIR, 'uploads')
}));

// ===== GAME SERVER API ENDPOINTS =====

function getGameServer(projectName) {
    if (projectName) return gameServers.get(projectName);
    return gameServers.values().next().value;
}

app.get('/api/server-status', (req, res) => {
    const gameServer = getGameServer(req.query.project);
    if (!gameServer) {
        return res.json({ status: 'not_initialized', rooms: 0, activePlayers: 0 });
    }
    res.json({
        status: 'running',
        rooms: gameServer.gameRooms?.size || 0,
        activePlayers: Array.from(gameServer.gameRooms?.values() || [])
            .reduce((total, room) => total + room.players.size, 0)
    });
});

app.get('/api/rooms', (req, res) => {
    const gameServer = getGameServer(req.query.project);
    if (!gameServer) {
        return res.json([]);
    }
    const rooms = Array.from(gameServer.gameRooms?.entries() || [])
        .filter(([id, room]) => room.players.size > 0)
        .map(([id, room]) => ({
            id,
            playerCount: room.players.size,
            maxPlayers: room.maxPlayers,
            isActive: room.isActive
        }));
    if (rooms.length > 0) {
        console.log('[/api/rooms] Returning rooms:', rooms.map(r => r.id));
    }
    res.json(rooms);
});

app.get('/api/stats', (req, res) => {
    const gameServer = getGameServer(req.query.project);
    if (!gameServer || !gameServer.serverNetworkManager) {
        return res.json({ connectedPlayers: 0 });
    }
    const stats = gameServer.serverNetworkManager.getServerStats();
    res.json(stats);
});


// ===== START SERVER =====

async function startServer() {
    // Support --project=Name CLI arg (server stays generic); default to the
    // currently-active project, HeroArena, so `npm run server` works with no args.
    const projectArg = args.find(arg => arg.startsWith('--project='));
    const defaultProject = projectArg ? projectArg.split('=')[1] : 'HeroArena';

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║              GUTS Unified Server                          ║
╟───────────────────────────────────────────────────────────╢
║  Port:    ${String(PORT).padEnd(47)}║
║  Mode:    ${(isProduction ? 'Production' : 'Development').padEnd(47)}║
║  Project: ${defaultProject.padEnd(47)}║
╚═══════════════════════════════════════════════════════════╝
`);

    // Initialize game server for the specified project
    try {
        await initGameServer(defaultProject);
        console.log(`Game server ready for ${defaultProject}`);
    } catch (error) {
        console.error(`Failed to initialize game server for ${defaultProject}:`, error);
        // Continue anyway - editor will still work
    }

    // Skip auto-build - use `npm run build` separately
    console.log(`\nServer started without auto-build. Use 'npm run build' to build projects.`);

    server.listen(PORT, () => {
        console.log(`\nServer running on port ${PORT}`);
        console.log(`Editor: http://localhost:${PORT}/projects/Editor/index.html`);
        console.log(`Game:   http://localhost:${PORT}/projects/${defaultProject}/index.html`);
    });
}

// Start the server
startServer();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    for (const [name, gameServer] of gameServers) {
        try { gameServer.stop?.(); } catch (e) { /* noop */ }
    }
    try { io?.close(); } catch (e) { /* noop */ }
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
