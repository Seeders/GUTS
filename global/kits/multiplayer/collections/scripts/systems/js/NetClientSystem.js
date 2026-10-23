/**
 * NetClientSystem - the client's mirror of a NetWorldSystem world (client only).
 *
 *   - connection: on scene load it listens for the world's messages (`${prefix}NAME`: WELCOME,
 *     SNAPSHOT, EVENTS, CORRECT, plus whatever messages() adds) and asks for everything (RESYNC);
 *     a disconnect calls onDisconnect()
 *   - clock: serverNow() follows the server's clock (snaps when far off, else drifts gently)
 *   - actors: a view per server actor (`actors`, by server id): its static info, a buffer of
 *     timed positions, and the local ECS entity drawing it (localId, made by createLocal)
 *   - interpolation: other actors are drawn RENDER_DELAY s in the past, between two buffered
 *     samples (sampleAt), so they move smoothly between snapshots
 *   - own movement: the client moves its own actor (`pos`) with walk(), and sendMoves() sends
 *     MOVE { x, z, f, seq } at ~20 Hz when it changed; a CORRECT from the server snaps `pos` back
 *     and adopts the new seq. When the straight line from the last sent point would cut a corner,
 *     the turning point is sent first.
 *
 * Fields other systems read: myId, actors, pos, ready. Services: netMyId, netActorView, netSend,
 * netServerNow, netLocalPos.
 *
 * A game extends it and overrides the hooks it needs:
 *   messages() -> { NAME: fn }         its own messages (beside the four above)
 *   onWelcomed(d) / onCorrected(d) / onDisconnect() / onNotConnected()
 *   newView(info) / needsRebuild(view, info) / applyRow(view, row, now) / afterSnapshot(d)
 *   createLocal(view, x, z, f) / destroyLocal(view) / onActorRemoved(view, id)
 *   onEvent(e)                         every event but 'gone' (which removes the actor)
 *   groundY(x, z) / canStep(x0, z0, x1, z1) / update() (default: sendMoves, then updateRemotes)
 */
class NetClientSystem extends GUTS.BaseSystem {
    static services = ['netMyId', 'netActorView', 'netSend', 'netServerNow', 'netLocalPos'];
    static PREFIX = 'NET_';
    static RENDER_DELAY = 0.12;      // seconds others are drawn in the past
    static BUFFER = 12;              // samples kept per actor
    static SEND_EVERY = 0.05;        // seconds between move messages

    constructor(game) {
        super(game);
        this.game.netClientSystem = this;
        this.myId = null;                 // our actor's server id
        this.actors = new Map();          // server id -> view
        this.serverClock = { server: 0, local: 0 };
        this._unsub = [];
        this.pos = { x: 0, z: 0, facing: 0 };
        this.moveSeq = 0;
        this._sendAccum = 0;
        this._lastSent = { x: 0, z: 0, f: 0 };
        this._movingNow = false;
        this.ready = false;
    }

    msg(name) { return this.constructor.PREFIX + name; }

    netMyId() { return this.myId; }
    netActorView(id) { return this.actors.get(id) || null; }
    netSend(event, data) { this.game.clientNetworkManager?.call(event, data); }
    netServerNow() { return this.serverNow(); }
    netLocalPos() { return this.pos; }

    // ==================== LIFECYCLE ====================

    onSceneLoad() {
        const nm = this.game.clientNetworkManager;
        if (!nm?.isConnected) return this.onNotConnected();
        const on = (ev, fn) => this._unsub.push(nm.listen(ev, fn));
        on(this.msg('WELCOME'), (d) => this.onWelcome(d));
        on(this.msg('SNAPSHOT'), (d) => this.onSnapshot(d));
        on(this.msg('EVENTS'), (d) => this.onEvents(d));
        on(this.msg('CORRECT'), (d) => this.onCorrect(d));
        for (const [name, fn] of Object.entries(this.messages())) on(name, fn);
        on('disconnect', () => this.onDisconnect());
        this.afterConnect();
        this.netSend(this.msg('RESYNC'), {});
    }

    onSceneUnload() {
        for (const u of this._unsub) { try { u(); } catch (e) { /* noop */ } }
        this._unsub = [];
        this.actors.clear();
        this.ready = false;
    }

    /** The game's own messages, by full name: { 'MMO_SELF': (d) => ... }. */
    messages() { return {}; }
    /** Listening, about to ask for everything (bind input, place scenery...). */
    afterConnect() { }
    onNotConnected() { }
    onDisconnect() { }

    // ==================== CLOCK ====================

    syncClock(serverNow) {
        const local = performance.now() / 1000;
        const est = this.serverClock.server + (local - this.serverClock.local);
        // snap if far off, otherwise drift gently (absorbs jitter)
        if (!this.serverClock.local || Math.abs(est - serverNow) > 0.5) this.serverClock = { server: serverNow, local };
        else this.serverClock = { server: est + (serverNow - est) * 0.1, local };
    }

    serverNow() {
        return this.serverClock.server + (performance.now() / 1000 - this.serverClock.local);
    }

    // ==================== MESSAGES ====================

    onWelcome(d) {
        this.myId = d.actorId;
        this.pos = { x: d.x, z: d.z, facing: d.facing || 0 };
        this._lastSent = { x: d.x, z: d.z, f: this.pos.facing };
        this.syncClock(d.now);
        this.ready = true;
        this.onWelcomed(d);
    }
    onWelcomed(d) { }

    /** A new actor's view. */
    newView(info) { return { id: info.id, info, buf: [], flags: 0, localId: null }; }
    /** New static info for a known actor: rebuild its local entity? */
    needsRebuild(v, info) { return false; }

    /** A dyn row onto its view: by default [id, x, z, facing, flags] into the buffer. */
    applyRow(v, row, now) {
        this.bufferSample(v, { t: now, x: row[1], z: row[2], f: row[3] });
        if (row[4] != null) v.flags = row[4];
    }

    bufferSample(v, sample) {
        v.buf.push(sample);
        if (v.buf.length > this.constructor.BUFFER) v.buf.shift();
    }

    onSnapshot(d) {
        this.syncClock(d.now);
        for (const info of d.add) {
            let v = this.actors.get(info.id);
            if (!v) { v = this.newView(info); this.actors.set(info.id, v); }
            else {
                const rebuild = this.needsRebuild(v, info);
                v.info = info;
                if (rebuild) { this.destroyLocal(v); v.createFailed = false; }
            }
        }
        for (const row of d.dyn) {
            const v = this.actors.get(row[0]);
            if (!v) continue;
            this.applyRow(v, row, d.now);
            if (v.localId == null && !v.createFailed) this.createLocal(v, row[1], row[2], row[3]);
        }
        for (const id of d.gone) this.removeActor(id);
        this.afterSnapshot(d);
    }
    afterSnapshot(d) { }

    removeActor(id) {
        const v = this.actors.get(id);
        if (v) this.destroyLocal(v);
        this.actors.delete(id);
        this.onActorRemoved(v, id);
    }
    onActorRemoved(v, id) { }

    onCorrect(d) {
        this.pos.x = d.x;
        this.pos.z = d.z;
        if (d.facing != null) this.pos.facing = d.facing;
        this.moveSeq = d.seq;
        this._lastSent = { x: d.x, z: d.z, f: this.pos.facing };
        this.onCorrected(d);
    }
    onCorrected(d) { }

    onEvents(d) {
        this.syncClock(d.now);
        for (const e of d.e) {
            if (e.t === 'gone') this.removeActor(e.id);            // despawned
            this.onEvent(e);
        }
    }
    onEvent(e) { }

    // ==================== LOCAL ENTITIES (hooks) ====================

    /** Make the local entity that draws a view (set v.localId; v.createFailed = true to stop retrying). */
    createLocal(v, x, z, f) { v.createFailed = true; }

    destroyLocal(v) {
        if (v.localId != null) { try { this.game.destroyEntity(v.localId); } catch (e) { /* already gone */ } }
        v.localId = null;
    }

    // ==================== DRAWING OTHERS ====================

    /** Where a view stands at server time rt, between its buffered samples: { x, z, f, y } or null. */
    sampleAt(v, rt) {
        const b = v.buf;
        if (!b.length) return null;
        let i = b.length - 1;
        while (i > 0 && b[i - 1].t > rt) i--;
        const p1 = b[i], p0 = b[i - 1] || p1;
        const span = p1.t - p0.t;
        const k = span > 0 ? Math.max(0, Math.min(1, (rt - p0.t) / span)) : 1;
        let df = p1.f - p0.f;
        while (df > Math.PI) df -= Math.PI * 2;
        while (df < -Math.PI) df += Math.PI * 2;
        let y = null;
        if (p0.y != null && p1.y != null) y = p0.y + (p1.y - p0.y) * k;
        else if (p1.y != null) y = p1.y;
        return { x: p0.x + (p1.x - p0.x) * k, z: p0.z + (p1.z - p0.z) * k, f: p0.f + df * k, y };
    }

    /** Every view's entity where it stands now: ours at `pos`, others interpolated. */
    updateRemotes() {
        const rt = this.serverNow() - this.constructor.RENDER_DELAY;
        for (const v of this.actors.values()) {
            if (v.localId == null) continue;
            const t = this.game.getComponent(v.localId, 'transform');
            if (!t) continue;
            const s = v.id === this.myId ? { x: this.pos.x, z: this.pos.z, f: this.pos.facing, y: null } : this.sampleAt(v, rt);
            if (!s) continue;
            t.position.x = s.x;
            t.position.z = s.z;
            t.position.y = s.y ?? this.groundY(s.x, s.z);
            t.rotation.y = s.f;
        }
    }

    // ==================== OWN MOVEMENT ====================

    groundY(x, z) { return this.game.hasService('getTerrainHeightAtPosition') ? (this.game.call('getTerrainHeightAtPosition', x, z) || 0) : 0; }
    canStep(x0, z0, x1, z1) { return true; }

    /**
     * Walk `pos` by fwd/strafe (-1..1, along pos.facing) at `speed` units/s, stopped by canStep:
     * sliding along what blocks one axis, and slipping sideways round a corner (a door jamb) toward
     * the side that opens up a little further ahead. Returns whether it moved.
     */
    walk(dt, fwd, strafe, speed) {
        if (!fwd && !strafe) return false;
        const f = this.pos.facing;
        let mx = Math.cos(f) * fwd - Math.sin(f) * strafe;
        let mz = Math.sin(f) * fwd + Math.cos(f) * strafe;
        const len = Math.hypot(mx, mz) || 1;
        mx = mx / len * speed * dt;
        mz = mz / len * speed * dt;
        const { x, z } = this.pos;
        if (this.canStep(x, z, x + mx, z + mz)) { this.pos.x += mx; this.pos.z += mz; }
        else if (Math.abs(mx) > 0.05 * Math.abs(mz) + 1e-3 && this.canStep(x, z, x + mx, z)) this.pos.x += mx;
        else if (Math.abs(mz) > 0.05 * Math.abs(mx) + 1e-3 && this.canStep(x, z, x, z + mz)) this.pos.z += mz;
        else {
            const step = Math.hypot(mx, mz), px = -mz / step, pz = mx / step;
            const ax = mx / step * 14, az = mz / step * 14;
            slip: for (const d of [4, 8, 12, 16, 20]) {
                for (const sgn of [1, -1]) {
                    const ox = x + px * d * sgn, oz = z + pz * d * sgn;
                    if (this.canStep(x, z, ox, oz) && this.canStep(ox, oz, ox + ax, oz + az)) {
                        const k = Math.min(1, step / d);
                        this.pos.x += px * d * sgn * k; this.pos.z += pz * d * sgn * k;
                        break slip;
                    }
                }
            }
        }
        return this.pos.x !== x || this.pos.z !== z;
    }

    /**
     * Steps to the server at ~20 Hz. The server checks the straight line from the last step it
     * accepted, so when that line would cut a corner (we slid round a door jamb) the turning point
     * goes first.
     */
    sendMoves(dt) {
        this._sendAccum += dt;
        let ls = this._lastSent;
        const move = (x, z) => this.netSend(this.msg('MOVE'), { x: +x.toFixed(1), z: +z.toFixed(1), f: +this.pos.facing.toFixed(3), seq: this.moveSeq });
        if (this._turnAt && (this._turnAt.x !== ls.x || this._turnAt.z !== ls.z) && !this.canStep(ls.x, ls.z, this.pos.x, this.pos.z)) {
            const p = this._turnAt;
            this._lastSent = ls = { x: p.x, z: p.z, f: this.pos.facing };
            move(p.x, p.z);
        }
        this._turnAt = { x: this.pos.x, z: this.pos.z };
        const changed = Math.hypot(this.pos.x - ls.x, this.pos.z - ls.z) > 0.5 || Math.abs(this.pos.facing - ls.f) > 0.02;
        if (changed && this._sendAccum >= this.constructor.SEND_EVERY) {
            this._sendAccum = 0;
            this._lastSent = { x: this.pos.x, z: this.pos.z, f: this.pos.facing };
            move(this.pos.x, this.pos.z);
        }
    }

    update() {
        if (!this.ready) return;
        this.sendMoves(this.game.state.deltaTime || 1 / 60);
        this.updateRemotes();
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.NetClientSystem = NetClientSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.NetClientSystem = NetClientSystem; }
export default NetClientSystem;
export { NetClientSystem };
