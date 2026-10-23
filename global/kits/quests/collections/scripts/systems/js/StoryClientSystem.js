/**
 * StoryClientSystem - the client's side of story quests (client only).
 *
 * Keeps the world view the server sends (MMO_WORLD: flags and world quests), builds the
 * journal (world quests you take part in, and your own player-scope quests on the
 * character), works out where each objective is (for the compass, the map and the
 * minimap), and draws the compass along the top of the screen.
 *
 * Objective positions: `at` if the objective has one; else talk -> the NPC, kill -> the
 * nearest camp of that mob (or the unique NPC), use -> the world object with that id,
 * retrieve -> world objects that give the item.
 *
 * The GUTS quests kit. A game extends it (`class MmoStoryClientSystem extends GUTS.StoryClientSystem`) and overrides
 * what it does differently. It registers under the game's old names.
 */
class StoryClientSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'mmoQuest',
        'mmoMob',
        'mmoNpc',
        'mmoItem',
        'mmoZones',
        'mmoFormatMoney'
    ];

    constructor(game) {
        super(game);
        this.game.mmoStoryClientSystem = this;
        this.world = { rev: 0, flags: {}, quests: {} };
        this._unsub = [];
        try { this.tracked = localStorage.getItem('kd.tracked') || null; } catch (e) { this.tracked = null; }
        game.kdWorldCtx = () => this.worldCtx();              // MmoGameSystem.kdOn: buildings' and decor's `when`
    }

    /** Conditions about the world alone (no player terms): what buildings and decor go by. */
    worldCtx() {
        return { flag: (k) => this.world.flags?.[k], quest: (id) => this.def(id) && (this.def(id).scope || 'world') === 'world' ? this.world.quests?.[id] || null : null };
    }

    get client() { return this.game.mmoClientSystem; }
    get hud() { return this.game.mmoHudSystem; }
    get ui() { return this.game.mmoUiSystem; }

    onSceneLoad() {
        const nm = this.game.clientNetworkManager;
        if (!nm) return;
        const on = (ev, fn) => this._unsub.push(nm.listen(ev, fn));
        on('MMO_WORLD', (d) => { this.world = d; this.game.mmoGameSystem?.mmoWorldStaticsChanged(); this.refresh(); });
        on('MMO_STORY', (d) => this.onStory(d));
    }

    onSceneUnload() {
        for (const u of this._unsub) { try { u(); } catch (e) { /* noop */ } }
        this._unsub = [];
        this.compass?.remove();
        this.compass = null;
    }

    refresh() {
        this.ui?.refreshOpen?.();
        this.hud?.refreshTracker?.();
        this.game.mmoClientSystem?.onWorldState?.();
    }

    // ==================== MODEL ====================

    def(id) { const d = this.call.mmoQuest(id); return d?.stages ? d : null; }
    stageOf(def, n) { return def?.stages.find(s => s.id === n) || null; }
    myName() { return this.client?.char?.name; }

    /** A quest's state as this player sees it. */
    state(id) {
        const def = this.def(id);
        if (!def) return null;
        if ((def.scope || 'world') === 'world') return this.world.quests?.[id] || null;
        return this.client?.char?.story?.[id] || null;
    }

    ctx() {
        const c = this.client?.char;
        return {
            flag: (k) => this.world.flags?.[k],
            quest: (id) => this.state(id),
            level: this.client?.self?.level ?? c?.level,
            classId: c?.classId,
            race: c?.appearance?.race,
            hasItem: (id) => (c?.bags || []).some(b => b?.id === id),
            topic: (k) => !!c?.topics?.includes(k),
            skill: (id) => this.game.mmoGameSystem?.mmoSkill(c, id) ?? 15
        };
    }
    test(cond) { return GUTS.KdLogic.test(cond, this.ctx()); }

    /** Journal entries: [{ id, def, q, active }], active ones first, then most recent. */
    journal() {
        const out = [];
        const me = this.myName();
        for (const [id, q] of Object.entries(this.world.quests || {})) {
            const def = this.def(id);
            if (def && q.participants?.includes(me)) out.push({ id, def, q });
        }
        for (const [id, q] of Object.entries(this.client?.char?.story || {})) {
            const def = this.def(id);
            if (def) out.push({ id, def, q });
        }
        for (const e of out) e.active = e.q.status === 'active';
        return out.sort((a, b) => (b.active - a.active) || ((b.q.log?.length || 0) - (a.q.log?.length || 0)));
    }

    /** The current stage's objectives: [{ o, i, label, done, have, need, pos }]. */
    objectives(id) {
        const def = this.def(id), q = this.state(id);
        if (!def || !q) return [];
        const st = this.stageOf(def, q.stage);
        return (st?.objectives || []).map((o, i) => ({ o, i })).filter(({ o }) => !o.when || this.test(o.when)).map(({ o, i }) => {
            const need = o.count || 1;
            const have = o.type === 'cond' ? (this.test(o.cond) ? 1 : 0) : Math.min(need, q.progress?.[`${q.stage}:${o.id ?? i}`] || 0);
            return { o, i, need, have, done: have >= need, label: this.label(o, have, need), pos: this.positionOf(o) };
        });
    }

    label(o, have, need) {
        const count = need > 1 ? `: ${have}/${need}` : '';
        if (o.label) return o.label + (o.type === 'kill' || o.type === 'retrieve' ? count : '');
        switch (o.type) {
            case 'kill': return `Defeat ${o.npc ? this.call.mmoNpc(o.npc)?.title : this.call.mmoMob(o.mob)?.title || o.mob}${count}`;
            case 'retrieve': return `Get ${this.call.mmoItem(o.item)?.title || o.item}${count}`;
            case 'talk': return `Speak with ${this.call.mmoNpc(o.npc)?.title || o.npc}`;
            case 'goto': return 'Travel to the marked place';
            case 'use': return 'Use the marked object';
            case 'choice': return 'Make your choice';
        }
        return 'Objective';
    }

    /** Where an objective is ({x, z}) or null: a place inside an interior you aren't in shows as its door. */
    positionOf(o) {
        const p = this.rawPositionOf(o), gs = this.game.mmoGameSystem, me = this.client?.pos;
        const it = p && gs?.mmoInteriorAt(p.x, p.z);
        if (it && me && gs.mmoInteriorAt(me.x, me.z) !== it) {
            const door = (this.call.mmoZones() || []).flatMap(z => z.nodes || []).find(n => n.id === `door:${it.id}`);
            return door ? { x: door.x, z: door.z } : { x: it.outside.x, z: it.outside.z };
        }
        return p;
    }

    rawPositionOf(o) {
        if (o.at) return { x: o.at[0], z: o.at[1] };
        const zones = this.game.mmoGameSystem?.mmoContentZones() || [];     // zones and interiors
        const me = this.client?.pos || { x: 0, z: 0 };
        const nearest = (pts) => {
            let best = null, bd = Infinity;
            for (const p of pts) { const d = Math.hypot(p.x - me.x, p.z - me.z); if (d < bd) { bd = d; best = p; } }
            return best && { x: best.x, z: best.z };
        };
        if (o.npc) {
            const live = [...(this.client?.actors?.values?.() || [])].find(v => v.info?.npc === o.npc);
            const last = live?.buf?.[live.buf.length - 1];
            if (last) return { x: last.x, z: last.z };
            const n = this.call.mmoNpc(o.npc);
            if (n?.x != null) return { x: n.x, z: n.z };
        }
        if (o.type === 'kill' && o.mob) return nearest(zones.flatMap(z => (z.mobCamps || []).filter(c => c.mob === o.mob).flatMap(c => c.packs)));
        if (o.type === 'use' && o.node) return nearest(zones.flatMap(z => (z.nodes || []).filter(n => n.id === o.node)));
        if (o.type === 'retrieve' && o.item) return nearest(zones.flatMap(z => (z.nodes || []).filter(n => n.item === o.item)));
        return null;
    }

    /** The quest whose markers show: the tracked one if still active, else the newest active. */
    trackedId() {
        const j = this.journal().filter(e => e.active);
        if (this.tracked && j.some(e => e.id === this.tracked)) return this.tracked;
        return j[0]?.id || null;
    }
    track(id) {
        this.tracked = id;
        try { localStorage.setItem('kd.tracked', id || ''); } catch (e) { /* noop */ }
        this.refresh();
    }

    /** Markers for the compass and maps: [{ x, z, quest, label, tracked }]. */
    markers() {
        const out = [], tid = this.trackedId();
        for (const e of this.journal()) {
            if (!e.active) continue;
            for (const ob of this.objectives(e.id)) if (!ob.done && ob.pos) out.push({ ...ob.pos, quest: e.id, label: ob.label, tracked: e.id === tid });
        }
        return out;
    }

    // ==================== NEWS ====================

    onStory(d) {
        const hud = this.hud, def = this.def(d.quest);
        if (!hud || !def) return;
        const st = this.stageOf(def, d.stage);
        switch (d.state) {
            case 'started':
                hud.sfx?.('confirm');
                hud.banner?.('Quest Started', def.title);
                hud.chatLine?.('system', `Quest started: ${def.title}`);
                if (!this.trackedId() || !this.tracked) this.track(d.quest);
                break;
            case 'stage':
                if (st?.log && !st.end) hud.lootFeed?.(`<span style="color:#ffd21f">Journal updated: ${hud.escape(def.title)}</span>`);
                break;
            case 'progress':
                hud.lootFeed?.(`<span style="color:#ffd21f">${hud.escape(d.text)}</span>`);
                break;
            case 'done':
                hud.sfx?.('promote');
                hud.banner?.('Quest Complete', def.title);
                hud.chatLine?.('system', `${def.title} completed.`);
                if (d.money) hud.chatLine?.('loot', `Received ${this.call.mmoFormatMoney(d.money)}.`);
                break;
            case 'failed':
                hud.banner?.('Quest Failed', def.title);
                hud.chatLine?.('system', `${def.title} failed.`);
                break;
        }
        this.refresh();
    }

    // ==================== SNEAKING ====================

    /** While sneaking: an eye under the compass, shut when unseen, opening as creatures notice you. */
    updateSneakEye() {
        const self = this.client?.self;
        let el = this.eye;
        if (!self?.sneak) { if (el) el.style.display = 'none'; return; }
        if (!el) {
            el = this.eye = document.createElement('div');
            el.style.cssText = 'position:fixed;left:50%;top:44px;transform:translateX(-50%);pointer-events:none;z-index:5;font:600 12px Georgia,serif;letter-spacing:.12em;text-shadow:0 1px 3px #000;text-align:center';
            document.body.appendChild(el);
        }
        el.style.display = '';
        const a = self.aware || 0;
        const [label, color, lid] = a >= 1 ? ['DETECTED', '#ff6a4a', 0] : a >= 0.35 ? ['NOTICED', '#ffcf40', 6] : ['HIDDEN', '#cfd8e0', 11];
        const html = `<svg width="46" height="22" viewBox="0 0 46 22"><path d="M3 11 Q23 -3 43 11 Q23 25 3 11Z" fill="none" stroke="${color}" stroke-width="2"/>` +
            `<circle cx="23" cy="11" r="5" fill="${color}"/><rect x="0" y="0" width="46" height="${lid}" fill="rgba(10,10,12,.85)"/></svg><div style="color:${color}">${label}</div>`;
        if (el._html !== html) { el._html = html; el.innerHTML = html; }
    }

    // ==================== COMPASS ====================

    static FOV = Math.PI * 0.6;          // the compass shows this much of the horizon

    buildCompass() {
        const el = document.createElement('div');
        el.id = 'kdCompass';
        el.style.cssText = 'position:fixed;left:50%;top:6px;transform:translateX(-50%);width:440px;height:32px;pointer-events:none;z-index:5;' +
            'background:linear-gradient(90deg,transparent,rgba(12,10,8,.72) 12%,rgba(12,10,8,.72) 88%,transparent);border-top:1px solid rgba(214,190,140,.35);border-bottom:1px solid rgba(214,190,140,.35);overflow:hidden;font:600 13px Georgia,serif;color:#e8dcc0';
        document.body.appendChild(el);
        this.compass = el;
        return el;
    }

    update() {
        if (!this.client?.pos || !this.game.mmoCameraSystem) return;
        const el = this.compass || this.buildCompass();
        const yaw = this.game.mmoCameraSystem.getCameraYaw?.() ?? this.client.pos.facing;
        const W = 440, half = StoryClientSystem.FOV / 2;
        const place = (ang) => {
            let a = ang - yaw;
            while (a > Math.PI) a -= Math.PI * 2;
            while (a < -Math.PI) a += Math.PI * 2;
            return Math.abs(a) > half ? null : W / 2 + a / half * (W / 2 - 14);
        };
        const items = [];
        // compass points: world -z is north (the map's top)
        for (const [t, ang] of [['N', -Math.PI / 2], ['E', 0], ['S', Math.PI / 2], ['W', Math.PI]]) {
            const x = place(ang);
            if (x != null) items.push(`<span style="position:absolute;left:${x}px;top:1px;transform:translateX(-50%);text-shadow:0 1px 2px #000;${t === 'N' ? 'color:#ffcf6a' : ''}">${t}</span>`);
        }
        for (let k = 0; k < 16; k++) {                                      // ticks between the points
            if (k % 4 === 0) continue;
            const x = place(-Math.PI / 2 + k * Math.PI / 8);
            if (x != null) items.push(`<span style="position:absolute;left:${x}px;top:6px;width:1px;height:${k % 2 ? 4 : 7}px;background:rgba(232,220,192,.45)"></span>`);
        }
        const me = this.client.pos;
        this._mkAccum = (this._mkAccum || 0) + (this.game.state?.deltaTime || 0.016);
        if (!this._mk || this._mkAccum > 0.5) { this._mkAccum = 0; this._mk = this.markers(); }
        for (const m of this._mk) {
            const x = place(Math.atan2(m.z - me.z, m.x - me.x));
            const d = Math.hypot(m.x - me.x, m.z - me.z);
            if (x == null) continue;
            const c = m.tracked ? '#ffd21f' : 'rgba(255,210,31,.45)';
            items.push(`<span title="${this.hud?.escape(m.label) || ''}" style="position:absolute;left:${x}px;top:${d < 400 ? 17 : 19}px;transform:translateX(-50%) rotate(45deg);width:${m.tracked ? 10 : 7}px;height:${m.tracked ? 10 : 7}px;background:${c};box-shadow:0 0 4px #000"></span>`);
        }
        const html = items.join('');
        if (el._html !== html) { el._html = html; el.innerHTML = html; }
        this.updateSneakEye();
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.StoryClientSystem = StoryClientSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.StoryClientSystem = StoryClientSystem; }
export default StoryClientSystem;
export { StoryClientSystem };
