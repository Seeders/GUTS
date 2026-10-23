/**
 * QuestSystem - quests, experience and levelling (server only; the GUTS quests kit).
 *
 * Quest objectives (collections.quests):
 *   kill     { mob, count }   credited to the tapping player/party on a kill
 *   collect  { item, count }  counts the item in your bags (quest drops only
 *                             drop while you still need them)
 *   talk     { npc }          satisfied by turning the quest in at that NPC
 *   escort / use ...          ObjectiveSystem's
 *
 * Quest state lives on the character: char.quests[questId] = { progress: [] }
 * and char.completed = [questId...]. NPC markers (markerFor): available, in progress, ready.
 *
 * A game extends it (`class MmoQuestSystem extends GUTS.QuestSystem`) and overrides what it does
 * differently. It works through the game's world services (mmoSend, mmoMarkDirty, mmoToast,
 * mmoEmit, mmoQuest, mmoItem, mmoGiveItem, mmoTakeItem, mmoCountItem, mmoAddMoney, mmoXpToLevel,
 * mmoMobXp, mmoRecalcStats, mmoCreditedPlayers, mmoConfig): see the kit's README.
 */
class QuestSystem extends GUTS.BaseSystem {
    static services = [
        'mmoAwardXp',
        'mmoQuestsForNpc'
    ];

    static serviceDependencies = [
        'mmoConfig',
        'mmoQuest',
        'mmoItem',
        'mmoActor',
        'mmoEmit',
        'mmoSend',
        'mmoToast',
        'mmoMarkDirty',
        'mmoGiveItem',
        'mmoTakeItem',
        'mmoCountItem',
        'mmoAddMoney',
        'mmoRecalcStats',
        'mmoXpToLevel',
        'mmoMobXp',
        'mmoCreditedPlayers'
    ];

    constructor(game) {
        super(game);
        this.game.mmoQuestSystem = this;
    }

    get cfg() { return this.call.mmoConfig(); }

    init() {
        const bus = this.game.serverEventManager;
        if (!this.game.isServer || !bus) return;
        const actorOf = (e) => this.game.mmoWorldSystem?.mmoActor(this.game.mmoWorldSystem.sessions.get(e.playerId)?.actorId);
        bus.subscribe('MMO_QUEST_ACCEPT', (e) => { const a = actorOf(e); if (a) this.accept(a, e.data?.quest, e.data?.npc); });
        bus.subscribe('MMO_QUEST_TURNIN', (e) => { const a = actorOf(e); if (a) this.turnIn(a, e.data?.quest, e.data?.npc); });
        bus.subscribe('MMO_QUEST_ABANDON', (e) => { const a = actorOf(e); if (a) this.abandon(a, e.data?.quest); });
    }

    allQuests() { return this.collections.quests || {}; }

    // ==================== QUEST STATE ====================

    isComplete(actor, questId) {
        const def = this.call.mmoQuest(questId);
        const q = actor.char.quests[questId];
        if (!def || !q) return false;
        return def.objectives.every((o, i) => o.type === 'talk' || (q.progress[i] || 0) >= o.count);
    }

    canAccept(actor, questId) {
        const def = this.call.mmoQuest(questId);
        const c = actor.char;
        if (!def || c.quests[questId] || c.completed.includes(questId)) return false;
        if ((def.minLevel || 1) > actor.level) return false;
        if (def.classes && !def.classes.includes(c.classId)) return false;          // class quests
        return (def.requires || []).every(r => c.completed.includes(r));
    }

    /** Quest marker an NPC shows to a viewer: 0 none, 1 "!", 2 yellow "?", 3 grey "?". */
    markerFor(npcActor, viewer) {
        if (viewer.kind !== 'player' || !viewer.char) return 0;
        let marker = 0;
        for (const [id, def] of Object.entries(this.allQuests())) {
            const active = viewer.char.quests[id];
            if (active && def.turnIn === npcActor.npcId) {
                if (this.isComplete(viewer, id)) return 2;
                if (!marker) marker = 3;
            } else if (!active && def.giver === npcActor.npcId && this.canAccept(viewer, id)) {
                marker = 1;
            }
        }
        return marker;
    }

    /** Quest lists for an NPC's dialogue window. */
    mmoQuestsForNpc(npcId, actor) {
        const out = { available: [], active: [], complete: [] };
        for (const [id, def] of Object.entries(this.allQuests())) {
            const active = actor.char.quests[id];
            if (active && def.turnIn === npcId) {
                (this.isComplete(actor, id) ? out.complete : out.active).push(id);
            } else if (!active && def.giver === npcId && this.canAccept(actor, id)) {
                out.available.push(id);
            }
        }
        return out;
    }

    accept(actor, questId, npcId) {
        const def = this.call.mmoQuest(questId);
        if (!def || def.giver !== npcId) return;
        if (!this.nearNpc(actor, npcId)) return;
        if (!this.canAccept(actor, questId)) return;
        if (Object.keys(actor.char.quests).length >= 20) return this.call.mmoToast(actor, 'Your quest log is full.', 'error');
        actor.char.quests[questId] = { progress: def.objectives.map(() => 0) };
        this.refreshCollect(actor);
        this.call.mmoMarkDirty(actor);
        this.call.mmoSend(actor.socketId, 'MMO_QUEST_UPDATE', { quest: questId, state: 'accepted' });
    }

    abandon(actor, questId) {
        if (!actor.char.quests[questId]) return;
        delete actor.char.quests[questId];
        this.call.mmoMarkDirty(actor);
        this.call.mmoSend(actor.socketId, 'MMO_QUEST_UPDATE', { quest: questId, state: 'abandoned' });
    }

    turnIn(actor, questId, npcId) {
        const def = this.call.mmoQuest(questId);
        if (!def || def.turnIn !== npcId || !actor.char.quests[questId]) return;
        if (!this.nearNpc(actor, npcId)) return;
        if (!this.isComplete(actor, questId)) return;

        const rewards = def.rewards || {};
        const itemSlotsNeeded = (rewards.items || []).length;
        if (actor.char.bags.length + itemSlotsNeeded > this.cfg.bagSize) return this.call.mmoToast(actor, 'Inventory is full.', 'error');

        def.objectives.forEach((o) => {
            if (o.type === 'collect' && this.call.mmoItem(o.item)?.kind === 'quest') this.call.mmoTakeItem(actor, o.item, o.count);
        });
        delete actor.char.quests[questId];
        actor.char.completed.push(questId);

        if (rewards.gold) this.call.mmoAddMoney(actor, rewards.gold);
        for (const it of rewards.items || []) this.call.mmoGiveItem(actor, it, 1);
        this.call.mmoSend(actor.socketId, 'MMO_QUEST_UPDATE', { quest: questId, state: 'completed', xp: rewards.xp || 0, money: rewards.gold || 0 });
        if (rewards.xp) this.mmoAwardXp(actor, rewards.xp, 'quest');
        this.call.mmoMarkDirty(actor);
    }

    nearNpc(actor, npcId) {
        const npc = this.game.mmoNpcSystem?.npcActor(npcId);
        return !!npc && Math.hypot(npc.x - actor.x, npc.z - actor.z) <= this.cfg.talkRange + 80;
    }

    // ==================== PROGRESS ====================

    onMmoKill({ victim }) {
        if (victim.kind !== 'mob' || victim.tapper == null) return;
        const credited = this.call.mmoCreditedPlayers(victim);
        const n = credited.length;
        for (const p of credited) {
            if (!p.char) continue;
            // XP: split across the group with a small group bonus.
            const base = this.call.mmoMobXp(victim.level, p.level, victim.elite);
            const xp = n > 1 ? Math.round(base / n * (1 + 0.1 * (n - 1))) : base;
            if (xp > 0 && !p.dead) this.mmoAwardXp(p, xp, 'kill', victim.id);

            // Kill objectives
            for (const [qid, q] of Object.entries(p.char.quests)) {
                const def = this.call.mmoQuest(qid);
                def?.objectives.forEach((o, i) => {
                    if (o.type !== 'kill' || o.mob !== victim.mobId) return;
                    if ((q.progress[i] || 0) >= o.count) return;
                    q.progress[i] = (q.progress[i] || 0) + 1;
                    this.progressMsg(p, qid, `${victim.name} slain: ${q.progress[i]}/${o.count}`);
                });
            }
        }
    }

    onMmoItemsChanged({ actor }) {
        if (actor?.char) this.refreshCollect(actor, true);
    }

    refreshCollect(actor, announce = false) {
        for (const [qid, q] of Object.entries(actor.char.quests)) {
            const def = this.call.mmoQuest(qid);
            def?.objectives.forEach((o, i) => {
                if (o.type !== 'collect') return;
                const have = Math.min(o.count, this.call.mmoCountItem(actor, o.item));
                if (have !== q.progress[i]) {
                    const up = have > (q.progress[i] || 0);
                    q.progress[i] = have;
                    if (announce && up) this.progressMsg(actor, qid, `${this.call.mmoItem(o.item)?.title}: ${have}/${o.count}`);
                }
            });
        }
        this.call.mmoMarkDirty(actor);
    }

    needsItem(actor, itemId) {
        for (const [qid, q] of Object.entries(actor.char?.quests || {})) {
            const def = this.call.mmoQuest(qid);
            if (def?.objectives.some((o, i) => o.type === 'collect' && o.item === itemId && this.call.mmoCountItem(actor, itemId) < o.count)) return true;
        }
        return false;
    }

    progressMsg(actor, questId, text) {
        this.call.mmoMarkDirty(actor);
        const complete = this.isComplete(actor, questId);
        this.call.mmoSend(actor.socketId, 'MMO_QUEST_UPDATE', { quest: questId, state: complete ? 'objectivesDone' : 'progress', text });
    }

    // ==================== EXPERIENCE ====================

    mmoAwardXp(actor, amount, source = 'kill', fromId = null) {
        const c = actor.char;
        if (!c || amount <= 0) return;
        if (actor.level >= this.cfg.maxLevel) return;
        amount = Math.round(amount * (1 + (this.game.mmoCombatSystem?.statSum(actor, 'xpGain') || 0)));   // e.g. a racial
        c.xp += amount;
        this.call.mmoEmit({ t: 'xp', d: actor.id, v: amount, src: source, from: fromId }, actor.x, actor.z, actor.id);
        while (actor.level < this.cfg.maxLevel && c.xp >= this.call.mmoXpToLevel(actor.level)) {
            c.xp -= this.call.mmoXpToLevel(actor.level);
            actor.level++;
            c.level = actor.level;
            this.call.mmoRecalcStats(actor, true);
            this.call.mmoEmit({ t: 'lvl', id: actor.id, l: actor.level }, actor.x, actor.z);
            this.call.mmoSend(actor.socketId, 'MMO_LEVEL_UP', { level: actor.level, newSpells: this.newSpellsAt(actor) });
            this.game.triggerEvent('onMmoLevelUp', { actor });
        }
        if (actor.level >= this.cfg.maxLevel) c.xp = 0;
        this.call.mmoMarkDirty(actor);
    }

    newSpellsAt(actor) {
        const cls = this.collections.classes?.[actor.classId];
        return (cls?.spells || []).filter(id => this.collections.spells?.[id]?.learnLevel === actor.level);
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.QuestSystem = QuestSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.QuestSystem = QuestSystem; }
export default QuestSystem;
export { QuestSystem };
