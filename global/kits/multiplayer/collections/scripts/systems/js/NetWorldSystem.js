/**
 * NetWorldSystem - the authoritative side of a persistent multiplayer world (server only).
 *
 * Owns:
 *   - sessions: one per connected client that has entered (enter, leave, resync), and saving the
 *     character each holds (on leave, every saveEvery seconds, at shutdown)
 *   - actors: everyone and everything in the world (an ECS entity with a transform, plus a plain
 *     record), spawned and despawned; nothing keeps pointing at a despawned actor's id (forgetActor)
 *   - movement: clients move their own actor and the server checks each step (speed, the game's
 *     canStep, what holds it still); a refused step is corrected back (CORRECT, with a sequence
 *     number so stale moves are dropped and a lost correction is said again)
 *   - interest-managed snapshots: each session gets, every 1/snapshotRate s, the actors within
 *     viewRadius: `add` (an actor's static info, again whenever its `ver` changes), `dyn` (a row of
 *     its moving parts) and `gone` (out of view)
 *   - events: emit(evt, x, z) is delivered once a tick to the sessions within view (or one actor)
 *
 * Messages are `${prefix}NAME` (static PREFIX, default 'NET_'): received ENTER, LOGOUT, MOVE, RESYNC
 * and PLAYER_DISCONNECT (MultiplayerHost routes them here); sent WELCOME, ENTER_FAILED, SNAPSHOT,
 * EVENTS, CORRECT, TOAST. Events raised for other systems (static EVENTS) default to onNetPlayerEnter,
 * onNetPlayerLeave, onNetActorDespawn, onNetActorMoved, onNetResync.
 *
 * Settings (configs/multiplayer.json, or override netConfig()): snapshotRate (10), viewRadius (1900),
 * saveEvery (60), runSpeed (190), moveSlack (1.4), moveSlop (25).
 *
 * A game extends it and overrides the hooks it needs:
 *   prepareCharacter(name, stored, data) -> { char } | { error }     new or loaded, migrated
 *   createSession(socketId, name, char, data) / spawnPlayer(session) -> actor
 *   welcomeInfo(session, actor, resync) / sendInitial(session) / beforeSave(session, actor)
 *   actorFields(spec) / forgetActor(id) / groundY(x, z) / canStep(actor, x0, z0, x1, z1)
 *   moveIgnored(actor) / moveRefusal(actor) / moveSpeed(actor) / afterMove(actor) / onTeleport(actor)
 *   visibleTo(actor, viewer) / staticInfo(actor, viewer) / dynRow(actor, viewer) / afterSnapshot(session, me)
 */
class NetWorldSystem extends GUTS.BaseSystem {
    static services = [
        'netActor', 'netActors', 'netSpawnActor', 'netDespawnActor', 'netNearbyActors', 'netGroundY',
        'netEmit', 'netSend', 'netToast', 'netMarkDirty', 'netSessionOf', 'netSessionByName', 'netSessions',
        'netTeleport', 'netNow'
    ];

    static PREFIX = 'NET_';
    static EVENTS = { enter: 'onNetPlayerEnter', leave: 'onNetPlayerLeave', despawn: 'onNetActorDespawn', moved: 'onNetActorMoved', resync: 'onNetResync' };
    static DEFAULTS = { snapshotRate: 10, viewRadius: 1900, saveEvery: 60, runSpeed: 190, moveSlack: 1.4, moveSlop: 25 };

    constructor(game) {
        super(game);
        this.game.netWorldSystem = this;
        this.sessions = new Map();     // socketId -> session
        this.actors = new Map();       // entityId -> actor
        this._eventQueue = [];         // [{x, z, evt, only}] flushed each tick
        this._snapAccum = 0;
        this._saveAccum = 0;
    }

    /** The settings: configs/multiplayer.json over the defaults (a game may override). */
    netConfig() {
        return this._netCfg ||= { ...NetWorldSystem.DEFAULTS, ...(this.collections.configs?.multiplayer || {}) };
    }
    msg(name) { return this.constructor.PREFIX + name; }
    ev(name) { return this.constructor.EVENTS[name]; }

    // ==================== LIFECYCLE ====================

    init() {
        const bus = this.game.serverEventManager;
        if (!this.game.isServer || !bus) return;
        bus.subscribe(this.msg('ENTER'), (e) => this.onEnter(e.playerId, e.data || {}));
        bus.subscribe('PLAYER_DISCONNECT', (e) => this.onLeave(e.playerId));
        bus.subscribe(this.msg('LOGOUT'), (e) => this.onLeave(e.playerId));
        bus.subscribe(this.msg('MOVE'), (e) => this.onMove(e.playerId, e.data || {}));
        bus.subscribe(this.msg('RESYNC'), (e) => this.onResync(e.playerId));
    }

    netNow() { return this.game.state.now || 0; }

    update() {
        if (!this.game.isServer) return;
        const dt = this.game.state.deltaTime || 0.05, now = this.netNow(), cfg = this.netConfig();
        // players stop "moving" if no step arrived recently (drives the walk animation)
        for (const s of this.sessions.values()) {
            const a = this.actors.get(s.actorId);
            if (a && a.moving && now - a.lastMoveAt > 0.25) a.moving = false;
        }
        this._snapAccum += dt;
        if (this._snapAccum >= 1 / cfg.snapshotRate) {
            this._snapAccum = 0;
            for (const s of this.sessions.values()) this.sendSnapshot(s);
        }
        this.flushEvents();
        this._saveAccum += dt;
        if (this._saveAccum >= cfg.saveEvery) { this._saveAccum = 0; this.saveAll(); }
    }

    onServerShutdown() { this.saveAll(); }

    // ==================== SESSIONS ====================

    onEnter(socketId, data) {
        if (this.sessions.has(socketId)) return;
        const name = this.sanitizeName(data.name);
        if (!name) return this.netSend(socketId, this.msg('ENTER_FAILED'), { error: 'Pick a name of 3–14 letters.' });
        if (this.netSessionByName(name)) return this.netSend(socketId, this.msg('ENTER_FAILED'), { error: `${name} is already in the world.` });
        const stored = this.loadCharacter(name);
        const r = this.prepareCharacter(name, stored, data);
        if (!r || r.error) return this.netSend(socketId, this.msg('ENTER_FAILED'), { error: r?.error || 'Could not enter.' });
        const session = this.createSession(socketId, name, r.char, data);
        this.sessions.set(socketId, session);
        const actor = this.spawnPlayer(session);
        actor.socketId = socketId;
        actor.char = session.char;
        session.actorId = actor.id;
        this.game.triggerEvent(this.ev('enter'), { session, actor });
        this.netSend(socketId, this.msg('WELCOME'), this.welcomeInfo(session, actor, false));
        this.sendInitial(session);
        this.logEnter?.(session, actor);
    }

    onLeave(socketId) {
        const s = this.sessions.get(socketId);
        if (!s) return;
        const a = this.actors.get(s.actorId);
        this.game.triggerEvent(this.ev('leave'), { session: s, actor: a });
        this.saveSession(s);
        if (a) this.netDespawnActor(a.id);
        this.sessions.delete(socketId);
        this.logLeave?.(s);
    }

    /** The client finished loading its world scene: everything again. */
    onResync(socketId) {
        const s = this.sessions.get(socketId);
        const a = s && this.actors.get(s.actorId);
        if (!a) return;
        s.known.clear();
        // the move count the server expects: a teleport while the client was still loading was never
        // heard, and every move after it would be thrown away as stale
        a.moveSeq = (a.moveSeq || 0) + 1;
        this.netSend(socketId, this.msg('WELCOME'), this.welcomeInfo(s, a, true));
        this.netSend(socketId, this.msg('CORRECT'), { x: a.x, z: a.z, facing: a.facing, seq: a.moveSeq, teleport: true });
        this.sendInitial(s);
        this.game.triggerEvent(this.ev('resync'), { session: s, actor: a });
    }

    sanitizeName(raw) {
        const n = String(raw || '').trim().replace(/[^A-Za-z]/g, '');
        if (n.length < 3 || n.length > 14) return null;
        return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
    }

    // ---- hooks: characters and sessions ----

    /** A character to enter with: the stored one, or a new one when the client asks to create. */
    prepareCharacter(name, stored, data) {
        if (stored && data.create) return { error: `The name ${name} is taken. Choose another.` };
        if (!stored && !data.create) return { error: `No character named ${name}. Create one first.` };
        return { char: stored || { version: 1, name, position: null, createdAt: Date.now() } };
    }

    createSession(socketId, name, char, data) {
        return { socketId, name, char, actorId: null, known: new Map(), charDirty: true, selfAccum: 0 };
    }

    spawnPlayer(session) {
        const p = session.char.position || { x: 0, z: 0, facing: 0 };
        return this.netSpawnActor({ kind: 'player', name: session.name, x: p.x, z: p.z, facing: p.facing || 0 });
    }

    welcomeInfo(session, actor, resync) {
        const w = { actorId: actor.id, name: session.name, now: this.netNow(), x: actor.x, z: actor.z, facing: actor.facing };
        if (resync) w.resync = true;
        return w;
    }

    /** After WELCOME (entering, resync): what the client needs first. */
    sendInitial(session) { this.sendSnapshot(session); }

    /** Just before a character is stored: its actor's state into it. */
    beforeSave(session, actor) {
        if (actor) session.char.position = { x: Math.round(actor.x), z: Math.round(actor.z), facing: +actor.facing.toFixed(3) };
    }

    // ---- storage (MultiplayerHost's global.netStorage) ----

    storage() { return global.netStorage || null; }
    loadCharacter(name) { return this.storage()?.load('characters', name) || null; }
    storeCharacter(name, char) { this.storage()?.save('characters', name, char); }

    saveSession(s) {
        this.beforeSave(s, this.actors.get(s.actorId));
        s.char.savedAt = Date.now();
        try { this.storeCharacter(s.name, s.char); }
        catch (e) { console.error('[world] save failed for', s.name, e.message); }
    }

    saveAll() { for (const s of this.sessions.values()) this.saveSession(s); }

    netSessions() { return this.sessions; }
    netSessionOf(actorId) {
        const a = this.actors.get(actorId);
        return a?.socketId ? this.sessions.get(a.socketId) || null : null;
    }
    netSessionByName(name) {
        const n = String(name || '').toLowerCase();
        for (const s of this.sessions.values()) if (s.name.toLowerCase() === n) return s;
        return null;
    }

    // ==================== ACTORS ====================

    /** spec: { kind, name, x, z, facing, speed?, ... } (actorFields adds the game's own fields). */
    netSpawnActor(spec) {
        const id = this.game.createEntity();
        const y = this.netGroundY(spec.x, spec.z);
        this.game.addComponent(id, 'transform', { position: { x: spec.x, y, z: spec.z }, rotation: { x: 0, y: spec.facing || 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
        const actor = {
            id, kind: spec.kind, name: spec.name,
            x: spec.x, y, z: spec.z, facing: spec.facing || 0,
            moving: false, lastMoveAt: 0, lastMoveTime: -999,
            speed: spec.speed || this.netConfig().runSpeed,
            ...this.actorFields(spec),
            ver: 1
        };
        this.actors.set(id, actor);
        return actor;
    }

    /** The game's own fields on a new actor (combat, appearance...). */
    actorFields(spec) { return {}; }

    netDespawnActor(id) {
        const a = this.actors.get(id);
        if (!a) return;
        this.game.triggerEvent(this.ev('despawn'), { actor: a });
        this.actors.delete(id);
        this.game.destroyEntity(id);
        for (const s of this.sessions.values()) s.known.delete(id);
        this.forgetActor(id);
        this.netEmit({ t: 'gone', id }, a.x, a.z);
    }

    /** Nothing keeps pointing at a despawned actor's id (ids are reused): targets and the like let go. */
    forgetActor(id) {
        for (const o of this.actors.values()) if (o.target === id) o.target = null;
    }

    netActor(id) { return id == null ? null : this.actors.get(id) || null; }
    netActors() { return this.actors; }

    netNearbyActors(x, z, radius, filter = null) {
        const out = [], r2 = radius * radius;
        for (const a of this.actors.values()) {
            const dx = a.x - x, dz = a.z - z;
            if (dx * dx + dz * dz > r2) continue;
            if (filter && !filter(a)) continue;
            out.push(a);
        }
        return out;
    }

    // ==================== MOVEMENT ====================

    netGroundY(x, z) { return this.groundY(x, z); }
    groundY(x, z) { return this.game.hasService('getTerrainHeightAtPosition') ? (this.game.call('getTerrainHeightAtPosition', x, z) || 0) : 0; }
    canStep(actor, x0, z0, x1, z1) { return true; }
    /** True: client moves are dropped without a word (something else is moving the actor). */
    moveIgnored(actor) { return false; }
    /** Why the actor may not move now (a correction follows), or null. */
    moveRefusal(actor) { return actor.dead ? 'dead' : null; }
    moveSpeed(actor) { return actor.speed; }
    /** A step was accepted (the actor's x, z, y are set). */
    afterMove(actor) { }
    /** A teleport moved the actor (before its transform is set). */
    onTeleport(actor) { }

    syncTransform(actor) {
        const t = this.game.getComponent(actor.id, 'transform');
        if (t) { t.position.x = actor.x; t.position.y = actor.y; t.position.z = actor.z; t.rotation.y = actor.facing; }
    }

    netTeleport(actor, x, z, facing = null) {
        actor.x = x; actor.z = z;
        actor.y = this.netGroundY(x, z);
        if (facing != null) actor.facing = facing;
        this.onTeleport(actor);
        this.syncTransform(actor);
        if (actor.socketId) {
            actor.moveSeq = (actor.moveSeq || 0) + 1;
            this.netSend(actor.socketId, this.msg('CORRECT'), { x, z, facing: actor.facing, seq: actor.moveSeq, teleport: true });
        }
    }

    /** A client's step: { x, z, f, seq }. Accepted, or corrected back. */
    onMove(socketId, d) {
        const s = this.sessions.get(socketId);
        const a = s && this.actors.get(s.actorId);
        if (!a) return;
        const now = this.netNow(), cfg = this.netConfig();
        const x = +d.x, z = +d.z, f = +d.f;
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        if (d.seq != null && a.moveSeq && d.seq < a.moveSeq) {           // stale: sent before a correction
            // still stale a second on: the client never heard the correction; say it again, or every
            // move it makes is thrown away and the server keeps the actor where it was
            if (now - (a._staleAt || 0) > 1) {
                a._staleAt = now;
                console.log(`[move] ${s.name} stale moves (seq ${d.seq} < ${a.moveSeq}): resending the correction`);
                this.netSend(socketId, this.msg('CORRECT'), { x: a.x, z: a.z, facing: a.facing, seq: a.moveSeq, teleport: true });
            }
            return;
        }
        if (this.moveIgnored(a)) return;
        if (Number.isFinite(f)) a.facing = f;
        const moved = Math.hypot(x - a.x, z - a.z);
        if (moved < 0.5) { this.syncTransform(a); return; }
        const reject = (why) => {
            const t = Date.now();                                        // (why: logged at most every 2 s an actor)
            if (!a._rejLog || t - a._rejLog > 2000) { a._rejLog = t; console.log(`[move] ${s.name} refused: ${why} at ${Math.round(a.x)},${Math.round(a.z)} -> ${Math.round(x)},${Math.round(z)}${this.refusalNote?.(a) || ''}`); }
            a.moveSeq = (a.moveSeq || 0) + 1;
            this.netSend(socketId, this.msg('CORRECT'), { x: a.x, z: a.z, facing: a.facing, seq: a.moveSeq });
        };
        const why = this.moveRefusal(a);
        if (why) return reject(why);
        const elapsed = Math.max(0.05, Math.min(1.0, now - (a.lastMoveAt || now - 0.1)));
        const allowed = this.moveSpeed(a) * elapsed * cfg.moveSlack + cfg.moveSlop;
        if (moved > allowed) return reject(`too far ${Math.round(moved)} > ${Math.round(allowed)}`);
        if (!this.canStep(a, a.x, a.z, x, z)) return reject('blocked');
        a.x = x; a.z = z;
        a.y = this.netGroundY(x, z);
        a.moving = true;
        a.lastMoveAt = now;
        a.lastMoveTime = now;
        this.afterMove(a);
        this.syncTransform(a);
        this.game.triggerEvent(this.ev('moved'), { actor: a });
    }

    // ==================== MESSAGES AND EVENTS ====================

    netSend(socketId, event, data) {
        this.engine?.serverNetworkManager?.sendToPlayer(socketId, event, data);
    }

    /** Queue an event for every session within view of (x, z), or only `onlyActorId`. */
    netEmit(evt, x, z, onlyActorId = null) {
        this._eventQueue.push({ evt, x, z, only: onlyActorId });
    }

    netToast(actorOrSocket, text, kind = 'info') {
        const socketId = typeof actorOrSocket === 'string' ? actorOrSocket : actorOrSocket?.socketId;
        if (socketId) this.netSend(socketId, this.msg('TOAST'), { text, kind });
    }

    /** The session's private state changed: sent with its next snapshot (afterSnapshot). */
    netMarkDirty(actor) {
        const s = this.netSessionOf(actor?.id);
        if (s) s.charDirty = true;
    }

    flushEvents() {
        if (!this._eventQueue.length) return;
        const r = this.netConfig().viewRadius, r2 = r * r;
        const queue = this._eventQueue;
        this._eventQueue = [];
        for (const s of this.sessions.values()) {
            const me = this.actors.get(s.actorId);
            if (!me) continue;
            let batch = null;
            for (const q of queue) {
                if (q.only != null) { if (q.only !== me.id) continue; }
                else { const dx = q.x - me.x, dz = q.z - me.z; if (dx * dx + dz * dz > r2) continue; }
                (batch || (batch = [])).push(q.evt);
            }
            if (batch) this.netSend(s.socketId, this.msg('EVENTS'), { now: this.netNow(), e: batch });
        }
    }

    // ==================== SNAPSHOTS ====================

    visibleTo(actor, viewer) { return true; }

    /** What a viewer is told of an actor once (and again when its `ver` changes). */
    staticInfo(a, viewer) { return { id: a.id, k: a.kind, n: a.name, v: a.ver }; }

    /** Bits of an actor's state for dynRow: 1 moving, 2 dead (a game adds its own above these). */
    flagsOf(a, viewer) { return (a.moving ? 1 : 0) | (a.dead ? 2 : 0); }

    /** An actor's moving parts, every snapshot: [id, x, z, facing, flags]. */
    dynRow(a, viewer) { return [a.id, Math.round(a.x), Math.round(a.z), +a.facing.toFixed(2), this.flagsOf(a, viewer)]; }

    sendSnapshot(s) {
        const me = this.actors.get(s.actorId);
        if (!me) return;
        const r = this.netConfig().viewRadius, r2 = r * r;
        const add = [], dyn = [], seen = new Set();
        for (const a of this.actors.values()) {
            const dx = a.x - me.x, dz = a.z - me.z;
            if (dx * dx + dz * dz > r2) continue;
            if (!this.visibleTo(a, me)) continue;
            seen.add(a.id);
            if (s.known.get(a.id) !== a.ver) { add.push(this.staticInfo(a, me)); s.known.set(a.id, a.ver); }
            dyn.push(this.dynRow(a, me));
        }
        const gone = [];
        for (const id of s.known.keys()) if (!seen.has(id)) gone.push(id);
        for (const id of gone) s.known.delete(id);
        this.netSend(s.socketId, this.msg('SNAPSHOT'), { now: this.netNow(), add, dyn, gone });
        this.afterSnapshot(s, me);
    }

    /** After each snapshot: the session's private state (a game sends its own). */
    afterSnapshot(session, me) { }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.NetWorldSystem = NetWorldSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.NetWorldSystem = NetWorldSystem; }
export default NetWorldSystem;
export { NetWorldSystem };
