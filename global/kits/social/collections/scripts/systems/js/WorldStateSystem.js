/**
 * WorldStateSystem - the shared world's memory (where the game's rules run): flags quests and
 * dialogue set, and any sections a game adds (its quests, its places), saved and restored.
 *
 *   state   { version, rev, flags: {}, ...sections }   (configs/social.json "worldSections": the
 *           sections it starts with, e.g. ["quests", "cells"])
 *   flags   worldFlag(k), setWorldFlag(k, v) (a falsy v clears it), incWorldFlag(k, by)
 *
 * Every change bumps rev; changes are gathered and announced once per tick as onWorldStateChanged
 * { what: ['f:flagName', ...] } (send the world to clients, re-check `when` conditions...).
 * touchWorldState() marks quiet bookkeeping: saved, not announced.
 *
 * Actions: runWorldActions([{ set: 'k', to: 1 }, { inc: 'k', by: 2 }, { unset: 'k' }, ...], ctx) runs
 * each in order; an action is an object whose first known key names it, and registerWorldAction(name,
 * (action, ctx) => ...) adds kinds (give, take, gold, say...). An action with `when` runs only if
 * testWorldCondition(when, ctx) passes (override it, or set configs/social.json conditions to
 * GUTS.<a library with test(cond, ctx)>).
 *
 * Saving: loadState() / saveState(state) hooks; by default the game's services loadWorldState() and
 * saveWorldState(state) if it has them. Saved every saveEvery seconds (default 30) when changed, and
 * a few seconds after any change.
 */
class WorldStateSystem extends GUTS.BaseSystem {
    static services = ['worldFlag', 'setWorldFlag', 'incWorldFlag', 'worldState', 'worldStateChanged', 'touchWorldState', 'runWorldActions', 'registerWorldAction', 'testWorldCondition', 'saveWorldStateNow'];
    static serviceDependencies = ['loadWorldState', 'saveWorldState'];

    constructor(game) {
        super(game);
        this.game.worldStateSystem = this;
        this.state = { version: 1, rev: 0, flags: {} };
        this.actions = new Map();
        this._saveAccum = 0;
        this._dirty = false;
        this._changed = new Set();
        this.registerWorldAction('set', (a) => this.setWorldFlag(a.set, a.to ?? 1));
        this.registerWorldAction('inc', (a) => this.incWorldFlag(a.inc, a.by ?? 1));
        this.registerWorldAction('unset', (a) => this.setWorldFlag(a.unset, null));
    }

    get cfg() { return this.collections.configs?.social || {}; }

    init() {
        for (const k of this.cfg.worldSections || []) this.state[k] ||= {};
        const saved = this.loadState();
        if (saved) this.state = { ...this.state, ...saved };
    }

    // ==================== SAVING (hooks) ====================

    loadState() { return this.game.hasService('loadWorldState') ? this.call.loadWorldState() : null; }
    saveState(state) { if (this.game.hasService('saveWorldState')) this.call.saveWorldState(state); }

    saveWorldStateNow() {
        try { this.saveState(this.state); this._dirty = false; return true; }
        catch (e) { console.error('[world] save failed', e.message); return false; }
    }

    /** The server is stopping (MultiplayerHost): saved now. */
    onServerShutdown() { this.saveWorldStateNow(); }

    // ==================== STATE ====================

    worldState() { return this.state; }
    worldFlag(key) { return this.state.flags[key]; }

    setWorldFlag(key, value) {
        if (value === undefined || value === null || value === false || value === 0) {
            if (!(key in this.state.flags)) return;
            delete this.state.flags[key];
        } else {
            if (this.state.flags[key] === value) return;
            this.state.flags[key] = value;
        }
        this.worldStateChanged(`f:${key}`);
    }

    incWorldFlag(key, by = 1) { this.setWorldFlag(key, (Number(this.state.flags[key]) || 0) + by); }

    /** Something in the state changed: save soon, announce it this tick. */
    worldStateChanged(what = '') {
        this.state.rev++;
        this._dirty = true;
        this._changed.add(what);
    }

    /** Quiet bookkeeping: save soon, announce nothing. */
    touchWorldState() { this._dirty = true; }

    // ==================== ACTIONS AND CONDITIONS ====================

    registerWorldAction(name, fn) { this.actions.set(name, fn); }

    testWorldCondition(cond, ctx = {}) {
        if (cond == null) return true;
        if (typeof cond === 'function') return !!cond(ctx);
        const lib = this.cfg.conditions && GUTS[this.cfg.conditions];
        if (lib?.test) return lib.test(cond, ctx);
        if (typeof cond === 'object' && 'flag' in cond) return 'is' in cond ? this.worldFlag(cond.flag) === cond.is : !!this.worldFlag(cond.flag);
        return true;
    }

    runWorldActions(actions, ctx = {}) {
        for (const a of actions || []) {
            try {
                if (a.when !== undefined && !this.testWorldCondition(a.when, ctx)) continue;
                const name = Object.keys(a).find(k => this.actions.has(k));
                if (!name) { console.warn('[world] unknown action', JSON.stringify(a)); continue; }
                this.actions.get(name).call(this, a, ctx);
            } catch (e) { console.warn('[world] action failed', JSON.stringify(a), e.message); }
        }
    }

    // ==================== EACH TICK ====================

    update() {
        const dt = this.game.state.deltaTime || 0.05, every = this.cfg.saveEvery ?? 30;
        if (this._changed.size) {
            const what = [...this._changed];
            this._changed.clear();
            this.game.triggerEvent('onWorldStateChanged', { what });
            this._saveAccum = Math.max(this._saveAccum, every - 3);          // (saved in a few seconds)
        }
        this._saveAccum += dt;
        if (this._saveAccum >= every) {
            this._saveAccum = 0;
            if (this._dirty) this.saveWorldStateNow();
        }
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.WorldStateSystem = WorldStateSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.WorldStateSystem = WorldStateSystem; }
export default WorldStateSystem;
export { WorldStateSystem };
