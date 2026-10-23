/**
 * QuestWorldStateSystem - the shared world's memory (server), saved to saves/world.json.
 *
 *   flags    free-form keys quests and dialogue set ("ashcombe_ruler": "redd")
 *   quests   world quests' shared state (MmoQuestSystem's story quests keep it here)
 *   cells    lairs' and interiors' state (level locks, resets)
 *   rewards  rewards owed to participants who were offline when a quest finished
 *
 * Conditions (KdLogic) read it through kdCtx(actor); actions (kdRun) change it. Every
 * change bumps `rev`, raises onKdWorldChanged for the systems whose content carries
 * `when:` conditions, and sends MMO_WORLD (the flags and quest stages) to every client.
 *
 * Actions (run in order; `actor` is the player they're for, `npc` the speaker if any):
 *   {set: flag, to}  {inc: flag, by}  {start: quest, stage?}  {stage: [quest, n]}
 *   {done: [quest, objectiveId]}  {complete: quest}  {fail: quest}  {give: item, n}  {take: item, n}  {gold: n}  {xp: n}
 *   {say: text}  {toast: text}  {teleport: [x, z]}  {topic: key} (marks a once-only topic used)
 *   {noise: [x, z], r}  (creatures near it go and look)
 *
 * Built on the GUTS social kit's WorldStateSystem (the state, its flags, change batching, saving and
 * the action runner); the kd* services are its old names, kept for the systems that call them.
 *
 * The GUTS quests kit. A game extends it (`class MmoWorldStateSystem extends GUTS.QuestWorldStateSystem`) and overrides
 * what it does differently. It registers under the game's old names.
 */
class QuestWorldStateSystem extends GUTS.WorldStateSystem {
    static services = [
        ...GUTS.WorldStateSystem.services,
        'kdFlag',
        'kdSetFlag',
        'kdWorld',
        'kdCtx',
        'kdTest',
        'kdRun',
        'kdWorldChanged',
        'kdNpcSay',
        'kdTouch'
    ];

    static serviceDependencies = [
        'mmoRandomGear',
        'mmoSend',
        'mmoSessions',
        'mmoActor',
        'mmoToast',
        'mmoConfig',
        'mmoGiveItem',
        'mmoTakeItem',
        'mmoCountItem',
        'mmoAddMoney',
        'mmoAwardXp',
        'mmoTeleport',
        'mmoMarkDirty'
    ];

    constructor(game) {
        super(game);
        this.game.mmoWorldStateSystem = this;
        this.state = { version: 1, rev: 0, flags: {}, quests: {}, cells: {}, rewards: {} };
        game.kdWorldCtx = () => this.kdCtx(null);            // MmoGameSystem.kdOn: buildings' `when`
        const qs = () => this.game.mmoStorySystem;
        const on = (name, fn) => this.registerWorldAction(name, fn);
        on('start', (a, c) => qs()?.storyStart(a.start, c.actor, a.stage));
        on('stage', (a, c) => qs()?.storySetStage(a.stage[0], a.stage[1], c.actor));
        on('done', (a, c) => qs()?.storyDone(a.done[0], a.done[1], c.actor));
        on('complete', (a, c) => qs()?.storyEnd(a.complete, 'done', c.actor));
        on('fail', (a, c) => qs()?.storyEnd(a.fail, 'failed', c.actor));
        on('give', (a, c) => { if (c.actor) this.call.mmoGiveItem(c.actor, a.give, a.n || 1); });
        on('take', (a, c) => { if (c.actor) this.call.mmoTakeItem(c.actor, a.take, a.n || 1); });
        on('gold', (a, c) => { if (c.actor) this.call.mmoAddMoney(c.actor, a.gold); });
        on('loot', (a, c) => { const g = c.actor && this.call.mmoRandomGear(c.actor.level); if (g) this.call.mmoGiveItem(c.actor, g, 1); });     // a random piece of gear for your level
        on('xp', (a, c) => { if (c.actor) this.call.mmoAwardXp(c.actor, a.xp, 'quest'); });
        on('say', (a, c) => { if (c.npc) this.kdNpcSay(c.npc, a.say); });
        on('toast', (a, c) => { if (c.actor) this.call.mmoToast(c.actor, a.toast, 'info'); });
        on('teleport', (a, c) => { if (c.actor) this.call.mmoTeleport(c.actor, a.teleport[0], a.teleport[1], c.actor.facing); });
        on('skill', (a, c) => { if (c.actor) this.game.mmoSkillSystem?.mmoSkillUse(c.actor, a.skill[0], a.skill[1] || 5); });
        on('noise', (a) => this.game.mmoMobSystem?.mmoNoise(a.noise[0], a.noise[1], a.r || 600));
        on('topic', (a, c) => {
            const actor = c.actor;
            if (actor?.char) { (actor.char.topics = actor.char.topics || []).includes(a.topic) || actor.char.topics.push(a.topic); this.call.mmoMarkDirty(actor); }
        });
    }

    init() {
        if (!this.game.isServer) return;
        super.init();
        console.log(`[world] state: ${Object.keys(this.state.flags).length} flags, ${Object.keys(this.state.quests).length} world quests`);
    }

    // the kit's saving hooks: saves/world.json through the server's storage
    loadState() { return global.mmoStorage?.loadWorld?.() || null; }
    saveState(state) { if (this.game.isServer) global.mmoStorage?.saveWorld?.(state); }

    // ==================== STATE (the old names) ====================

    kdWorld() { return this.worldState(); }
    kdFlag(key) { return this.worldFlag(key); }
    kdSetFlag(key, value) { this.setWorldFlag(key, value); }
    /** Quiet bookkeeping (a cell's lock or clear time): save soon, tell nobody. */
    kdTouch() { this.touchWorldState(); }
    /** Something in the state changed (a flag, a quest stage): save soon, tell systems and clients. */
    kdWorldChanged(what = '') { this.worldStateChanged(what); }

    // ==================== CONDITIONS ====================

    /** The KdLogic context for a player (or the world alone when actor is null). */
    kdCtx(actor) {
        const st = this.state;
        const qs = this.game.mmoStorySystem;
        const c = actor?.char;
        return {
            flag: (k) => st.flags[k],
            quest: (id) => qs?.storyState?.(id, actor) || null,
            level: actor?.level,
            classId: c?.classId,
            race: c?.appearance?.race,
            hasItem: (id) => !!actor && this.call.mmoCountItem(actor, id) > 0,
            topic: (k) => !!c?.topics?.includes(k),
            skill: (id) => this.game.mmoGameSystem?.mmoSkill(c, id) ?? 15
        };
    }

    kdTest(cond, actor = null) { return GUTS.KdLogic.test(cond, this.kdCtx(actor)); }
    testWorldCondition(cond, ctx = {}) { return this.kdTest(cond, ctx.actor || null); }

    // ==================== ACTIONS ====================

    kdRun(actions, { actor = null, npc = null, quest = null } = {}) { this.runWorldActions(actions, { actor, npc, quest }); }

    /** An NPC speaks aloud: chat (and a speech bubble) for players within earshot. */
    kdNpcSay(npc, text, to = null) {
        const r = this.call.mmoConfig().sayRadius;
        const msg = { ch: 'npc', from: npc.name, id: npc.id, text };
        if (to) return this.call.mmoSend(to.socketId, 'MMO_CHAT', msg);
        for (const s of this.call.mmoSessions().values()) {
            const p = this.call.mmoActor(s.actorId);
            if (p && Math.hypot(p.x - npc.x, p.z - npc.z) <= r) this.call.mmoSend(s.socketId, 'MMO_CHAT', msg);
        }
    }

    // ==================== SYNC ====================

    /** What clients see: the flags and the world quests (journals show the ones you're in). */
    clientView() {
        const quests = {};
        for (const [id, q] of Object.entries(this.state.quests)) quests[id] = { stage: q.stage, status: q.status, progress: q.progress, log: q.log, participants: q.participants };
        return { rev: this.state.rev, flags: this.state.flags, quests };
    }

    onMmoPlayerEnter({ session }) {
        this.call.mmoSend(session.socketId, 'MMO_WORLD', this.clientView());
    }

    /** The kit gathered this tick's changes: statics, `when` content and clients follow. */
    onWorldStateChanged({ what }) {
        this.game.mmoGameSystem?.mmoWorldStaticsChanged(what);
        this.game.triggerEvent('onKdWorldChanged', { what });
        const view = this.clientView();
        for (const s of this.call.mmoSessions().values()) this.call.mmoSend(s.socketId, 'MMO_WORLD', view);
    }

    update() { if (this.game.isServer) super.update(); }

    save() { return this.saveWorldStateNow(); }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.QuestWorldStateSystem = QuestWorldStateSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.QuestWorldStateSystem = QuestWorldStateSystem; }
export default QuestWorldStateSystem;
export { QuestWorldStateSystem };
