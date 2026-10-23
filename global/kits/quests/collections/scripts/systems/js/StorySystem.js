/**
 * StorySystem - stage quests (server). See KINGDOM.md "Quests".
 *
 * A story quest is a quest def with `stages`. World-scope quests (the default) have one
 * shared state in MmoWorldStateSystem (state.quests[id]); player-scope quests (misc,
 * radiant) live on the character (char.story[id]). Either way the state is
 *   { stage, status: active|done|failed, progress: { "<stage>:<objective>": n },
 *     log: [stage ids reached], participants: [names] (world scope) }
 *
 * Objectives (stage.objectives[i]; `id` defaults to the index, `when` hides it in some branches):
 *   goto      { at: [x, z], r }          a participant comes within r
 *   kill      { mob | npc, count }       credited kills of that mob (or the unique npc)
 *   retrieve  { item, count }            a participant carries them
 *   talk      { npc }                    done by a dialogue action {done: [quest, id]}
 *   use       { node }                   a participant uses that world object
 *   choice                               only a dialogue action moves the quest on
 *   cond      { cond }                   the condition holds
 * A stage moves on to `next` (a stage id, or [{when, to}, ...]) once every required
 * objective is done; `onEnter` actions run on arrival; `end: complete|fail` closes it.
 * Rewards on the end stage go to every participant (offline ones collect at login).
 *
 * Discovery (KINGDOM.md "Discovery"):
 *   zone.triggers [{ id, at: [x, z], r, when, actions, once: 'world' | 'player' | false }]
 *                 fire as a player walks in
 *   npc.barks     [{ id, r, when, lines: [[speaker npcId | 'self', text], ...], actions, once }]
 *                 talk overheard by passers-by (spoken aloud, a line every few seconds);
 *                 the actions run for the listener. once: 'player' (default) | 'world' | false
 *   item.read / node.read  { title, text, actions }  a note or book: MMO_READ -> MMO_BOOK
 *
 * The GUTS quests kit. A game extends it (`class MmoStorySystem extends GUTS.StorySystem`) and overrides
 * what it does differently. It registers under the game's old names.
 */
class StorySystem extends GUTS.BaseSystem {
    static services = [
        'storyState',
        'storyStart',
        'storySetStage',
        'storyEnd',
        'storyDone',
        'storyEvent'
    ];

    static serviceDependencies = [
        'mmoContentZones',
        'mmoConfig',
        'mmoQuest',
        'mmoActor',
        'mmoSend',
        'mmoSessions',
        'mmoSessionByName',
        'mmoToast',
        'mmoMarkDirty',
        'mmoGiveItem',
        'mmoCountItem',
        'mmoAddMoney',
        'mmoAwardXp',
        'mmoCreditedPlayers',
        'kdWorld',
        'kdRun',
        'kdTest',
        'kdWorldChanged',
        'kdFlag',
        'kdSetFlag',
        'kdNpcSay',
        'mmoZones',
        'mmoNpc',
        'mmoItem',
        'mmoNow',
        'mmoInteriors',
        'mmoRadiantJobs'
    ];

    static SHARE_RADIUS = 1500;      // players this close to a world quest's advance join it

    constructor(game) {
        super(game);
        this.game.mmoStorySystem = this;
        this._condAccum = 0;
        this._barking = new Map();       // `${npcId}.${barkId}` -> when it may play again (repeatable barks)
    }

    init() {
        const bus = this.game.serverEventManager;
        if (!this.game.isServer || !bus) return;
        const actorOf = (e) => this.game.mmoWorldSystem?.mmoActor(this.game.mmoWorldSystem.sessions.get(e.playerId)?.actorId);
        bus.subscribe('MMO_READ', (e) => { const a = actorOf(e); if (a) this.readItem(a, e.data?.item); });
    }

    defs() {
        if (!this._defs) {
            this._defs = {};
            for (const [id, d] of Object.entries(this.collections.quests || {})) if (d.stages) this._defs[id] = d;
        }
        return this._defs;
    }
    def(id) {
        if (typeof id === 'string' && id.startsWith('rad:')) return this.call.mmoQuest(id);       // a board's job (MmoGameSystem.radiantDef)
        return this.defs()[id] || null;
    }
    stageOf(def, n) { return def?.stages.find(s => s.id === n) || null; }
    isWorld(def) { return (def?.scope || 'world') === 'world'; }

    // ==================== STATE ====================

    /** A quest's state as `actor` sees it (world quests: the shared one). */
    storyState(id, actor = null) {
        const def = this.def(id);
        if (!def) return null;
        if (this.isWorld(def)) return this.call.kdWorld().quests[id] || null;
        return actor?.char?.story?.[id] || null;
    }

    holder(def, id, actor, create = false) {
        if (this.isWorld(def)) {
            const qs = this.call.kdWorld().quests;
            if (!qs[id] && create) qs[id] = { stage: 0, status: 'active', progress: {}, log: [], participants: [] };
            return qs[id] || null;
        }
        if (!actor?.char) return null;
        const story = actor.char.story = actor.char.story || {};
        if (!story[id] && create) story[id] = { stage: 0, status: 'active', progress: {}, log: [], since: Date.now() / 1000 };
        return story[id] || null;
    }

    changed(def, actor) {
        if (this.isWorld(def)) this.call.kdWorldChanged('q');
        else if (actor) this.call.mmoMarkDirty(actor);
    }

    /** Players who join a world quest's advance: the one who did it and everyone near them. */
    join(q, actor) {
        if (!q.participants || !actor?.char) return;
        const add = (a) => { if (a?.char && !q.participants.includes(a.char.name)) q.participants.push(a.char.name); };
        add(actor);
        for (const s of this.call.mmoSessions().values()) {
            const p = this.call.mmoActor(s.actorId);
            if (p && p !== actor && Math.hypot(p.x - actor.x, p.z - actor.z) <= StorySystem.SHARE_RADIUS) add(p);
        }
    }

    /** The players a quest's news and rewards go to (online ones as actors). */
    audience(def, q, actor) {
        if (!this.isWorld(def)) return actor ? [actor] : [];
        const out = [];
        for (const name of q.participants || []) {
            const s = this.call.mmoSessionByName(name);
            const a = s && this.call.mmoActor(s.actorId);
            if (a) out.push(a);
        }
        return out;
    }

    // ==================== FLOW ====================

    storyStart(id, actor, stage) {
        const def = this.def(id);
        if (!def) return console.warn('[story] no quest', id);
        const existing = this.holder(def, id, actor);
        if (existing && existing.status !== 'active') return;              // finished: never restarts
        if (existing) { this.join(existing, actor); return this.changed(def, actor); }
        const q = this.holder(def, id, actor, true);
        this.join(q, actor);
        this.storySetStage(id, stage ?? def.stages[0].id, actor, true);
    }

    storySetStage(id, n, actor, starting = false) {
        const def = this.def(id);
        const st = this.stageOf(def, n);
        if (!def || !st) return console.warn('[story] no stage', id, n);
        let q = this.holder(def, id, actor);
        if (!q) { this.storyStart(id, actor, n); return; }
        if (q.status !== 'active') return;
        this.join(q, actor);
        q.stage = n;
        if (!q.log.includes(n)) q.log.push(n);
        this.changed(def, actor);
        for (const a of this.audience(def, q, actor)) {
            this.call.mmoSend(a.socketId, 'MMO_STORY', { quest: id, stage: n, state: starting ? 'started' : 'stage', text: starting ? def.title : null });
        }
        this.call.kdRun(st.onEnter, { actor, quest: id });
        if (q.status !== 'active' || q.stage !== n) return;                 // onEnter moved it on
        if (actor?.char) this.storyEvent('items', {}, actor);                // things already in your bags count at once
        if (st.end) return this.storyEnd(id, st.end === 'fail' ? 'failed' : 'done', actor);
        this.checkStage(id, actor);
    }

    storyEnd(id, status, actor) {
        const def = this.def(id);
        const q = def && this.holder(def, id, actor);
        if (!q || q.status !== 'active') return;
        q.status = status;
        q.endedAt = Date.now() / 1000;
        this.changed(def, actor);
        const rewards = status === 'done' ? (this.stageOf(def, q.stage)?.rewards || def.rewards) : null;
        const online = this.audience(def, q, actor);
        for (const a of online) {
            if (rewards) this.give(a, rewards);
            this.call.mmoSend(a.socketId, 'MMO_STORY', { quest: id, stage: q.stage, state: status, xp: rewards?.xp || 0, money: rewards?.gold || 0 });
        }
        if (rewards && this.isWorld(def)) {                                  // offline participants collect at login
            const owed = this.call.kdWorld().rewards;
            const here = new Set(online.map(a => a.char.name));
            for (const name of q.participants) if (!here.has(name)) (owed[name] = owed[name] || []).push({ quest: id, ...rewards });
        }
    }

    give(actor, r) {
        if (r.gold) this.call.mmoAddMoney(actor, r.gold);
        for (const it of r.items || []) this.call.mmoGiveItem(actor, it, 1);
        if (r.xp) this.call.mmoAwardXp(actor, Math.round(r.xp * 0.2), 'quest');        // skills level you; a quest gives a nudge
        this.call.mmoMarkDirty(actor);
    }

    onMmoPlayerEnter({ actor }) {
        const owed = this.call.kdWorld().rewards;
        const list = actor?.char && owed[actor.char.name];
        if (!list?.length) return;
        delete owed[actor.char.name];
        this.call.kdWorldChanged('rewards');
        for (const r of list) {
            this.give(actor, r);
            this.call.mmoToast(actor, `While you were away, ${this.def(r.quest)?.title || 'a quest'} was finished. Your share is yours.`, 'info');
        }
    }

    // ==================== OBJECTIVES ====================

    key(stage, o, i) { return `${stage}:${o.id ?? i}`; }

    /** The objectives showing at a quest's current stage (their `when` holds). */
    objectives(def, q, actor) {
        const st = this.stageOf(def, q.stage);
        return (st?.objectives || []).map((o, i) => ({ o, i })).filter(({ o }) => !o.when || this.call.kdTest(o.when, actor));
    }

    need(o) { return o.count || 1; }

    /** Mark an objective done (a dialogue action: {done: [quest, objectiveId]}). */
    storyDone(id, objId, actor) {
        const def = this.def(id);
        const q = def && this.holder(def, id, actor);
        if (!q || q.status !== 'active') return;
        const st = this.stageOf(def, q.stage);
        const i = (st?.objectives || []).findIndex((o, k) => String(o.id ?? k) === String(objId));
        if (i < 0) return;
        const o = st.objectives[i];
        q.progress[this.key(q.stage, o, i)] = this.need(o);
        this.join(q, actor);
        this.changed(def, actor);
        this.checkStage(id, actor);
    }

    /** Something happened that objectives listen for: kill / use / goto / item. */
    storyEvent(type, data, actor) {
        const jobs = Object.keys(actor?.char?.story || {}).filter(id => id.startsWith('rad:')).map(id => [id, this.def(id)]).filter(([, d]) => d);
        for (const [id, def] of [...Object.entries(this.defs()), ...jobs]) {
            const q = this.holder(def, id, actor);
            if (!q || q.status !== 'active') continue;
            let moved = false;
            for (const { o, i } of this.objectives(def, q, actor)) {
                const k = this.key(q.stage, o, i), have = q.progress[k] || 0, need = this.need(o);
                if (have >= need) continue;
                let v = have;
                if (type === 'kill' && o.type === 'kill' && ((o.mob && o.mob === data.mobId) || (o.npc && o.npc === data.npcId))) v = have + 1;
                else if (type === 'use' && o.type === 'use' && o.node === data.node) v = need;
                else if (type === 'move' && o.type === 'goto' && o.at && Math.hypot(actor.x - o.at[0], actor.z - o.at[1]) <= (o.r || 250)) v = need;
                else if (type === 'items' && o.type === 'retrieve') v = Math.min(need, this.call.mmoCountItem(actor, o.item));
                else if (type === 'cleared' && o.type === 'clear' && o.interior === data.interior && this.interiorCleared(o.interior, q.since || 0)) v = need;
                if (v !== have) {
                    q.progress[k] = v;
                    moved = true;
                    this.join(q, actor);
                    if (o.type === 'kill' || o.type === 'retrieve') {
                        for (const a of this.audience(def, q, actor)) this.call.mmoSend(a.socketId, 'MMO_STORY', { quest: id, state: 'progress', text: `${o.label || 'Objective'}: ${v}/${need}` });
                    }
                }
            }
            if (moved) { this.changed(def, actor); this.checkStage(id, actor); }
        }
    }

    /** Move on when the stage's required objectives are done. */
    checkStage(id, actor) {
        const def = this.def(id);
        const q = def && this.holder(def, id, actor);
        if (!q || q.status !== 'active') return;
        const st = this.stageOf(def, q.stage);
        if (!st || st.end || st.next == null) return;
        const objs = this.objectives(def, q, actor);
        if (objs.some(({ o }) => o.type === 'choice')) return;
        const done = ({ o, i }) => o.optional || (o.type === 'cond' ? this.call.kdTest(o.cond, actor) : (q.progress[this.key(q.stage, o, i)] || 0) >= this.need(o));
        if (!objs.every(done)) return;
        const to = Array.isArray(st.next) ? st.next.find(b => !b.when || this.call.kdTest(b.when, actor))?.to : st.next;
        if (to != null) this.storySetStage(id, to, actor);
    }

    // ==================== HOOKS ====================

    onMmoKill({ victim }) {
        if (victim.kind !== 'mob' && victim.kind !== 'npc') return;
        const players = victim.tapper != null ? this.call.mmoCreditedPlayers(victim) : [];
        for (const p of players) if (p.char) this.storyEvent('kill', { mobId: victim.mobId, npcId: victim.npcId }, p);
    }

    onMmoItemsChanged({ actor }) { if (actor?.char) this.storyEvent('items', {}, actor); }

    /** Where players stand matters (goto objectives, triggers, overheard talk): checked for everyone
     *  once a second, so arriving by door, flight or teleport counts as much as walking in. */
    checkPlaces() {
        for (const s of this.call.mmoSessions().values()) {
            const actor = this.call.mmoActor(s.actorId);
            if (!actor?.char || actor.dead) continue;
            this.storyEvent('move', {}, actor);
            this.checkTriggers(actor);
            this.checkBarks(actor);
        }
    }

    // ==================== DISCOVERY ====================

    /** Has this once-only thing (trigger, bark) already happened for the actor / the world? */
    spent(once, key, actor) {
        if (once === 'world') return !!this.call.kdFlag(`once:${key}`);
        if (once) return !!actor.char.topics?.includes(`once:${key}`);
        return false;
    }
    spend(once, key, actor) {
        if (once === 'world') this.call.kdSetFlag(`once:${key}`, 1);
        else if (once) this.call.kdRun([{ topic: `once:${key}` }], { actor });
    }

    triggers() {
        if (!this._triggers) this._triggers = this.call.mmoContentZones().flatMap(z => (z.triggers || []).map(t => ({ ...t, once: t.once ?? 'player' })));
        return this._triggers;
    }

    checkTriggers(actor) {
        for (const t of this.triggers()) {
            if (Math.hypot(actor.x - t.at[0], actor.z - t.at[1]) > (t.r || 300)) continue;
            if (this.spent(t.once, `trig:${t.id}`, actor)) continue;
            if (t.when && !this.call.kdTest(t.when, actor)) continue;
            this.spend(t.once, `trig:${t.id}`, actor);
            this.call.kdRun(t.actions, { actor });
        }
    }

    barkers() {
        if (!this._barkers) {
            this._barkers = [];
            for (const npcId of this.call.mmoContentZones().flatMap(z => z.npcs || [])) {
                const def = this.call.mmoNpc(npcId);
                for (const b of def?.barks || []) this._barkers.push({ npcId, ...b, once: b.once ?? 'player' });
            }
        }
        return this._barkers;
    }

    checkBarks(actor) {
        const now = this.call.mmoNow(), npcs = this.game.mmoNpcSystem;
        for (const b of this.barkers()) {
            const npc = npcs?.npcActor(b.npcId);
            if (!npc || Math.hypot(actor.x - npc.x, actor.z - npc.z) > (b.r || 350)) continue;
            const key = `bark:${b.npcId}.${b.id}`;
            if (this.spent(b.once, key, actor) || (this._barking.get(key) || 0) > now) continue;
            if (b.when && !this.call.kdTest(b.when, actor)) continue;
            this.spend(b.once, key, actor);
            const lines = b.lines || [];
            this._barking.set(key, now + lines.length * 4 + (b.cooldown || 90));      // nobody repeats themselves at once
            lines.forEach(([who, text], k) => setTimeout(() => {
                const speaker = who === 'self' ? npc : npcs.npcActor(who) || npc;
                this.call.kdNpcSay(speaker, text);
            }, k * 3500));
            if (b.actions) setTimeout(() => { if (actor.char) this.call.kdRun(b.actions, { actor, npc }); }, Math.max(0, lines.length - 1) * 3500 + 500);
        }
    }

    /** Read a note or book you carry: its text, and whatever reading it sets off. */
    readItem(actor, itemId) {
        const def = this.call.mmoItem(itemId);
        if (!def?.read || this.call.mmoCountItem(actor, itemId) < 1) return;
        this.call.mmoSend(actor.socketId, 'MMO_BOOK', { title: def.read.title || def.title, text: def.read.text });
        this.call.kdRun(def.read.actions, { actor });
    }

    /** A note or book lying in the world (node.read); `take` puts its item in your bags. */
    readNode(actor, node) {
        const r = node.read;
        this.call.mmoSend(actor.socketId, 'MMO_BOOK', { title: r.title || node.title, text: r.text });
        if (r.item && this.call.mmoCountItem(actor, r.item) < 1) this.call.mmoGiveItem(actor, r.item, 1);
        this.call.kdRun(r.actions, { actor });
    }

    onKdUse({ actor, node }) { if (actor?.char) this.storyEvent('use', { node }, actor); }

    /** Every camp of an interior cleared since `since` (seconds)? */
    interiorCleared(inId, since) {
        const it = this.call.mmoInteriors().find(q => q.id === inId), cells = this.call.kdWorld().cells;
        return !!it && it.mobCamps.every(c => (cells[c.id]?.clearedAt || 0) >= since);
    }

    /** A camp fell quiet: anyone with a job to clear its interior may be done. */
    onKdCampCleared({ camp }) {
        const it = this.call.mmoInteriors().find(q => q.mobCamps.some(c => c.id === camp));
        if (!it) return;
        for (const s of this.call.mmoSessions().values()) {
            const a = this.call.mmoActor(s.actorId);
            if (a?.char && Object.keys(a.char.story || {}).some(id => id.startsWith('rad:clear:'))) this.storyEvent('cleared', { interior: it.id }, a);
        }
    }

    // ==================== JOB BOARDS ====================

    /** A town's board: the jobs on offer (not ones you hold or have done lately) as talk options. */
    boardView(actor, node) {
        const story = actor.char.story || {};
        const offers = this.call.mmoRadiantJobs(node.board).filter(id => {
            const q = story[id];
            return !q || (q.status !== 'active' && Date.now() / 1000 - (q.endedAt || 0) > 1800);        // done jobs come back after a while
        }).slice(0, 4);
        return {
            line: offers.length ? 'Notices, nailed one over another. Some are fresh.' : 'Nothing new on the board. Come back later.',
            options: offers.map(id => ({ ref: id, text: this.def(id)?.title || id }))
        };
    }

    takeJob(actor, node, id) {
        if (!this.call.mmoRadiantJobs(node.board).includes(id)) return;
        const story = actor.char.story = actor.char.story || {};
        if (story[id]?.status === 'active') return;
        delete story[id];                                             // a job done before can be taken again
        this.storyStart(id, actor);
    }

    onKdWorldChanged() { this._condDue = true; }

    update() {
        if (!this.game.isServer) return;
        const dt = this.game.state.deltaTime || 0.05;
        this._placeAccum = (this._placeAccum || 0) + dt;
        if (this._placeAccum >= 1) { this._placeAccum = 0; this.checkPlaces(); }
        this._condAccum += dt;
        if (!this._condDue && this._condAccum < 2) return;            // cond objectives: on change, or every 2 s
        this._condDue = false;
        this._condAccum = 0;
        for (const [id, def] of Object.entries(this.defs())) {
            if (!def.stages.some(s => (s.objectives || []).some(o => o.type === 'cond'))) continue;
            if (this.isWorld(def)) { if (this.call.kdWorld().quests[id]?.status === 'active') this.checkStage(id, null); }
            else for (const s of this.call.mmoSessions().values()) { const a = this.call.mmoActor(s.actorId); if (a?.char?.story?.[id]?.status === 'active') this.checkStage(id, a); }
        }
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.StorySystem = StorySystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.StorySystem = StorySystem; }
export default StorySystem;
export { StorySystem };
