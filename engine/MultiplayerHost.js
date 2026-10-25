/**
 * MultiplayerHost - the Node side of a persistent multiplayer world (the multiplayer kit).
 *
 * A game's server.js becomes a call to startMultiplayerServer with its own parts as options:
 *
 *   import { startMultiplayerServer } from 'guts/engine/MultiplayerHost.js';
 *   startMultiplayerServer({
 *       root: __dirname, name: 'age', title: 'Age of Defiance', port: 3002,
 *       beforeWorld: (collections, ctx) => { ... },     // put generated world data in place
 *       routes: (app, ctx) => { ... }                   // the game's own HTTP endpoints
 *   });
 *
 * What it does:
 *   - storage: JSON files under saves/ (REALM_SAVES or SAVES_DIR picks another folder), as
 *     global.netStorage { load(kind, key), save(kind, key, data), remove(kind, key) } and, for
 *     games written against it, global.mmoStorage { loadCharacter, saveCharacter, loadWorld,
 *     saveWorld, loadRun, saveRun }. Writes are atomic (a temp file, then a rename).
 *   - loads the compiled server bundle (dist/server/game.js) and boots one persistent room that is
 *     always running, on a fixed-step loop (tickRate, default 20 Hz)
 *   - sockets: a client's enterEvent (ENTER_WORLD) joins the room and reaches the game as
 *     `${prefix}ENTER`; once in, every event it sends is routed to the game's serverEventManager;
 *     a disconnect arrives as PLAYER_DISCONNECT. Sends are quiet (no per-message logging).
 *   - HTTP: the project's files (never saves, server code, tooling or dotfiles), dist/client, the
 *     engine's /engine and /global, the project editor, /api/server-status.
 *   - shutdown (SIGINT, SIGTERM): the game hears onServerShutdown, and NetWorldSystem saves everyone.
 *
 * Returns { app, server, io, engine, world, storage } once the world is up and listening.
 */
import express from 'express';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import path from 'path';
import vm from 'vm';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

import ServerEngine from './ServerEngine.js';
import ServerNetworkManager from '../global/collections/scripts/libraries/js/ServerNetworkManager.js';

const GUTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ==================== STORAGE ====================

/** JSON files: kind + key -> <dir>/<kind>/<key>.json; a kind without keys (world, run) -> <dir>/<kind>.json. */
export function createFileStorage(dir) {
    mkdirSync(dir, { recursive: true });
    const safe = (k) => String(k).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const file = (kind, key) => key == null ? path.join(dir, `${safe(kind)}.json`) : path.join(dir, safe(kind), `${safe(key)}.json`);
    return {
        dir,
        file,
        load(kind, key = null) {
            const f = file(kind, key);
            if (!existsSync(f)) return null;
            try { return JSON.parse(readFileSync(f, 'utf8')); }
            catch (e) { console.error(`[storage] bad ${kind} file`, f, e.message); return null; }
        },
        save(kind, key, data, pretty = true) {
            const f = file(kind, key);
            if (data == null) { if (existsSync(f)) unlinkSync(f); return; }
            mkdirSync(path.dirname(f), { recursive: true });
            writeFileSync(`${f}.tmp`, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
            renameSync(`${f}.tmp`, f);
        },
        remove(kind, key = null) {
            const f = file(kind, key);
            if (existsSync(f)) unlinkSync(f);
        }
    };
}

/** The older per-purpose API some games' systems call (global.mmoStorage), over a storage. */
export function legacyStorage(storage) {
    return {
        loadCharacter: (name) => storage.load('characters', name),
        saveCharacter: (name, data) => storage.save('characters', name, data),
        loadWorld: () => storage.load('world'),
        saveWorld: (data) => storage.save('world', null, data),
        loadRun: () => storage.load('run'),
        saveRun: (data) => storage.save('run', null, data, false)
    };
}

// ==================== NETWORK ====================

/**
 * Routes every connected client into the one persistent room (ServerNetworkManager is built
 * around small match rooms and logs every event; a world streams input at 20 Hz per player).
 * With the host's `games` (Diablo II's way): no persistent room, but games players make and join from a lobby,
 * each its own room (and world), gone when its last player leaves.
 */
export class WorldNetworkManager extends ServerNetworkManager {
    get hostOptions() { return this.engine.options || {}; }
    get host() { return this.engine.host; }

    setupEventHandlers() {
        const { room = 'world', prefix = 'MMO_', enterEvent = 'ENTER_WORLD' } = this.hostOptions;
        const games = this.host?.games;
        this.io.removeAllListeners('connection');
        this.io.on('connection', (socket) => {
            this.playerSockets.set(socket.id, { socket, inLobby: false });
            socket.on(enterEvent, (data) => {
                const info = this.playerSockets.get(socket.id);
                if (!info) return;
                if (games) {
                    if (!info.roomId) return socket.emit(`${prefix}ENTER_FAILED`, { error: 'Make or join a game first.' });
                } else if (info.roomId !== room) { socket.join(room); info.roomId = room; }
                this.routeEventToEngine(socket, `${prefix}ENTER`, data);
            });
            if (games) {
                socket.on('GAMES_LIST', () => socket.emit('GAMES_LIST', { games: games.list() }));
                socket.on('CREATE_GAME', async (data) => {
                    const info = this.playerSockets.get(socket.id);
                    if (!info || info.roomId || info.creating) return;
                    info.creating = true;
                    try {
                        const g = await games.create(data || {});
                        if (!this.playerSockets.has(socket.id)) return games.leftEmpty(g.id);       // (gone while it was being made)
                        this.joinGame(socket, g);
                    } catch (e) {
                        console.error('[games] could not make a game:', e);
                        socket.emit('GAME_ERROR', { error: e.userMessage || 'Could not make the game.' });
                    } finally { info.creating = false; }
                });
                socket.on('JOIN_GAME', (data) => {
                    const info = this.playerSockets.get(socket.id);
                    if (!info || info.roomId) return;
                    const g = games.get(data?.id);
                    if (!g) return socket.emit('GAME_ERROR', { error: 'That game has ended.' });
                    if (g.password && g.password !== (data?.password || '')) return socket.emit('GAME_ERROR', { error: 'Wrong password.', password: true });
                    if (g.players.size >= g.maxPlayers) return socket.emit('GAME_ERROR', { error: 'That game is full.' });
                    this.joinGame(socket, g);
                });
                socket.on('LEAVE_GAME', () => this.leaveGame(socket));
            }
            socket.onAny((eventName, data) => {
                if (eventName.startsWith('__') || eventName === enterEvent) return;
                if (games && /^(GAMES_LIST|CREATE_GAME|JOIN_GAME|LEAVE_GAME)$/.test(eventName)) return;
                if (!this.playerSockets.get(socket.id)?.roomId) return;          // not in the world yet
                this.routeEventToEngine(socket, eventName, data);
            });
            socket.on('disconnect', () => {
                if (games) this.leaveGame(socket);
                else if (this.playerSockets.get(socket.id)?.roomId) this.routeEventToEngine(socket, 'PLAYER_DISCONNECT', { playerId: socket.id });
                this.playerSockets.delete(socket.id);
            });
            socket.emit('CONNECTED', { playerId: socket.id, serverTime: Date.now() });
        });
    }

    joinGame(socket, g) {
        const info = this.playerSockets.get(socket.id);
        socket.join(g.id); info.roomId = g.id; g.players.add(socket.id);
        socket.emit('GAME_JOINED', { id: g.id, name: g.name, diff: g.diff, world: g.version });
    }

    /** Out of its game (left, or gone): the game saves the hero; the last one out ends it. */
    leaveGame(socket) {
        const info = this.playerSockets.get(socket.id), id = info?.roomId;
        if (!id) return;
        this.routeEventToEngine(socket, 'PLAYER_DISCONNECT', { playerId: socket.id });
        socket.leave(id); info.roomId = null;
        const g = this.host.games.get(id);
        if (g) { g.players.delete(socket.id); if (!g.players.size) this.host.games.leftEmpty(id); }
    }

    routeEventToEngine(socket, eventName, data) {
        const room = this.engine.gameRooms.get(this.playerSockets.get(socket.id)?.roomId);
        if (!room?.game?.serverEventManager) return;
        try {
            room.game.serverEventManager.emit(eventName, { playerId: socket.id, eventName, data, socket, networkManager: this });
        } catch (error) {
            console.error(`[world] error handling ${eventName}:`, error);
        }
    }

    sendToPlayer(playerId, eventName, data) {
        this.playerSockets.get(playerId)?.socket?.emit(eventName, data);
    }
}

// ==================== GAMES ====================

/**
 * Games as Diablo II's (the host's `games` option): each made by a player from the lobby (a name, a password if
 * they like, a difficulty) as a room of its own, its world its own (spec.world(meta): the room's collections, e.g.
 * the shared ones with a newly rolled land in them), ended when the last player leaves (spec.ended(id)).
 *   games: { maxPlayers = 8, world: async (meta) => collections, ended(id, meta) }
 */
function makeGames(spec, engine, ctx, name) {
    const all = new Map();
    const id = () => 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    return {
        list: () => [...all.values()].filter(g => g.ready).map(g => ({ id: g.id, name: g.name, players: g.players.size, max: g.maxPlayers, diff: g.diff, locked: !!g.password })),
        get: (gid) => all.get(gid)?.ready ? all.get(gid) : null,
        async create({ name: title, password = '', diff = 0 }) {
            const g = { id: id(), name: String(title || 'A game').slice(0, 32), password: String(password || '').slice(0, 32), diff: Math.max(0, Math.min(2, diff | 0)),
                players: new Set(), maxPlayers: spec.maxPlayers || 8, ready: false };
            g.version = g.id;
            all.set(g.id, g);
            try {
                const collections = await spec.world(g);
                const room = engine.createGameRoom(g.id, g.maxPlayers);
                room.meta = g;
                room.game.getCollections = () => collections;              // (its own world: before its systems first ask)
                room.isActive = true;
                await room.game.init(true);
            } catch (e) { all.delete(g.id); engine.gameRooms.delete(g.id); throw e; }
            g.ready = true;
            console.log(`[${name}] game ${g.id} "${g.name}" made (difficulty ${g.diff})`);
            return g;
        },
        leftEmpty(gid) {
            const g = all.get(gid);
            all.delete(gid);
            const room = engine.gameRooms.get(gid);
            if (room) {
                try { room.game?.triggerEvent?.('onServerShutdown', {}); } catch (e) { console.error(e); }
                room.isActive = false;
                engine.gameRooms.delete(gid);
            }
            try { spec.ended?.(gid, g); } catch (e) { console.error(e); }
            console.log(`[${name}] game ${gid} ended (the last one left)`);
        }
    };
}

// ==================== THE GAME BUNDLE ====================

export function loadCompiledGame(root, ServerEngineClass = ServerEngine) {
    global.window = global;
    global.module = { exports: {} };
    global.exports = global.module.exports;
    const gameCode = readFileSync(path.join(root, 'dist/server/game.js'), 'utf8');
    new vm.Script(gameCode).runInThisContext();
    Object.assign(global.GUTS, { ServerEngine: ServerEngineClass, getCollections: () => global.COMPILED_GAME?.collections });
}

// ==================== THE SERVER ====================

const DENY = /^\/(saves|saves_\w*|tools|node_modules|\.git|\.claude|server\.js|package(-lock)?\.json|[^/]*\.(log|md|tgz|env)$)/i;

/**
 * options:
 *   root         the project folder (required)
 *   name         a short name for logs ('age')          title  the game's name ('Age of Defiance')
 *   port         default PORT, else 8080 with --prod, else 3000
 *   room         the world room's id ('world')         maxPlayers  1000
 *   prefix       message prefix of the game's world system ('MMO_')    enterEvent  'ENTER_WORLD'
 *   tickRate     server ticks per second (20)
 *   saves        saves folder (default: REALM_SAVES or SAVES_DIR env, else 'saves')
 *   deny         extra RegExp of request paths never served
 *   static       extra [[urlPath, dir], ...] mounts
 *   io           socket.io server options (merged over CORS * and a 90 s ping timeout)
 *   editor       false: don't mount the project editor
 *   routes(app, ctx)          the game's own HTTP endpoints (before the static files)
 *   afterStatic(app, ctx)     after the static files, before the editor (a 404 for what they didn't have)
 *   beforeWorld(collections, ctx)   after the bundle and engine are up, before the room starts
 *   onReady(ctx)              the world is up and listening
 */
export async function startMultiplayerServer(options = {}) {
    const root = options.root;
    if (!root) throw new Error('startMultiplayerServer: options.root (the project folder) is required');
    const name = options.name || 'world', title = options.title || name;
    const isProduction = process.argv.some(a => a === '--production' || a === '-p' || a === '--prod');
    const port = Number(process.env.PORT) || options.port || (isProduction ? 8080 : 3000);
    const room = options.room || 'world';
    const tickRate = options.tickRate || 20;

    const storage = createFileStorage(path.resolve(root, options.saves || process.env.REALM_SAVES || process.env.SAVES_DIR || 'saves'));
    global.netStorage = storage;
    global.mmoStorage = legacyStorage(storage);

    try { loadCompiledGame(root); }
    catch (error) { console.error('Failed to load compiled game (run `npm run build` first):', error); process.exit(1); }

    const app = express();
    const server = createServer(app);
    if (!global._io) global._io = new IOServer(server, { cors: { origin: '*', methods: ['GET', 'POST'] }, pingInterval: 25000, pingTimeout: 90000, ...(options.io || {}) });
    global.io = global._io;

    const engine = new ServerEngine({ NetworkManager: WorldNetworkManager, fixedStep: true, room, prefix: options.prefix || 'MMO_', enterEvent: options.enterEvent || 'ENTER_WORLD' });
    global.serverEngine = engine;
    const ctx = { app, server, io: global.io, engine, storage, root, port, room, get world() { return engine.gameRooms.get(room) || null; }, get game() { return engine.gameRooms.get(room)?.game || null; } };
    engine.host = { games: options.games ? makeGames(options.games, engine, ctx, name) : null };
    ctx.games = engine.host.games;

    app.use((req, res, next) => DENY.test(req.path) || options.deny?.test(req.path) ? res.status(404).end() : next());
    await options.routes?.(app, ctx);
    app.get('/api/server-status', (req, res) => res.json({ status: 'running', connected: global.io?.engine?.clientsCount || 0,
        online: [...engine.gameRooms.values()].reduce((n, r) => n + (r.game?.netWorldSystem?.sessions?.size || 0), 0), games: ctx.games?.list().length }));
    app.use(express.static(root));
    app.use(express.static(path.join(root, 'dist/client')));
    app.use('/engine', express.static(path.join(GUTS_ROOT, 'engine')));
    app.use('/global', express.static(path.join(GUTS_ROOT, 'global')));
    for (const [url, dir] of options.static || []) app.use(url, express.static(path.isAbsolute(dir) ? dir : path.join(root, dir)));
    await options.afterStatic?.(app, ctx);
    if (options.editor !== false) {
        try {
            const { mountEditor } = createRequire(path.join(root, 'package.json'))('guts/editor-api');
            mountEditor(app, { base: '', projectRoot: root });
        } catch (err) { console.warn(`[${name}] editor not mounted:`, err.message); }
    }

    try {
        await engine.init(name);
        engine.tickRate = 1 / tickRate;
        if (global.window.COMPILED_GAME && !global.window.COMPILED_GAME.initialized) global.window.COMPILED_GAME.init(engine);
        await options.beforeWorld?.(global.COMPILED_GAME?.collections, ctx);
        if (!ctx.games) {
            const world = engine.createGameRoom(room, options.maxPlayers || 1000);
            world.isActive = true;
            await world.game.init(true);
            console.log(`[${name}] world room online`);
        } else console.log(`[${name}] games: made and joined from the lobby`);
        await new Promise(res => server.listen(port, res));
        console.log(`[${name}] ${title} running on http://localhost:${port}`);
        await options.onReady?.(ctx);
        await global.__gutsProbe?.(ctx);            // tools/probes: a check run against the live world
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }

    const shutdown = () => {
        console.log(`[${name}] shutting down — saving`);
        for (const r of engine.gameRooms.values()) try { r.game?.triggerEvent?.('onServerShutdown', {}); } catch (e) { console.error(e); }
        try { engine.stop?.(); } catch (e) { /* noop */ }
        try { global._io?.close(); } catch (e) { /* noop */ }
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1500).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', (error) => console.error('Uncaught Exception:', error));
    process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

    return { app, server, io: global.io, engine, world: ctx.world, storage };
}
