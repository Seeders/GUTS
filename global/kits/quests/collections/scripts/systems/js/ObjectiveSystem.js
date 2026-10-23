/**
 * ObjectiveSystem - world objects and escorts (server; the GUTS quests kit).
 *
 * Nodes (zone.nodes, placed by the zone designs): clickable world objects.
 *   item nodes    give a quest item to players whose quest needs it, then
 *                 vanish and respawn after `respawn` seconds
 *   portal nodes  move the player to { zone, at: [tileX, tileZ] } (dungeon doors)
 *   locks         a lock to pick (LOCKS: difficulty by name)
 *
 * Escort objectives ({ type: 'escort', npc, zone, path: [[tx, tz], ...],
 * ambush: [{ at, mob, count }], count: 1 }): while a player has the quest and
 * the objective is unfinished, their charge waits at the start of the path.
 * Walk up to it and it sets off, waiting whenever the player falls behind.
 * Reaching waypoint `at` springs that ambush (creatures that go for the
 * charge). Reaching the end completes the objective; if the charge dies the
 * player can start again from the beginning.
 *
 * A game extends it (`class MmoObjectiveSystem extends GUTS.ObjectiveSystem`) and overrides what
 * it does differently (interact: what a node does).
 */
class ObjectiveSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'mmoSkill',
        'mmoSkillUse',
        'mmoContentZones',
        'mmoConfig',
        'mmoZones',
        'mmoZone',
        'mmoQuest',
        'mmoNpc',
        'mmoMob',
        'mmoItem',
        'mmoActor',
        'mmoActors',
        'mmoSpawnActor',
        'mmoDespawnActor',
        'mmoGiveItem',
        'mmoTeleport',
        'mmoToast',
        'mmoEmit',
        'mmoSend',
        'mmoMarkDirty',
        'mmoAddThreat',
        'kdTest',
        'mmoNow'
    ];

    static ESCORT_SPEED = 115;
    static WAIT_DISTANCE = 480;      // the charge waits when its player is further than this
    static START_DISTANCE = 220;     // walk this close to a waiting charge to set off

    constructor(game) {
        super(game);
        this.game.mmoObjectiveSystem = this;
        this.escorts = new Map();    // `${charName}|${questId}` -> escort state
        this._scan = 0;
    }

    now() { return this.game.mmoWorldSystem?.mmoNow?.() ?? this.game.state.now ?? 0; }

    init() {
        const bus = this.game.serverEventManager;
        if (!this.game.isServer || !bus) return;
        const actorOf = (e) => this.game.mmoWorldSystem?.mmoActor(this.game.mmoWorldSystem.sessions.get(e.playerId)?.actorId);
        bus.subscribe('MMO_INTERACT', (e) => { const a = actorOf(e); if (a) this.interact(a, e.data?.id); });
        bus.subscribe('MMO_TALK', (e) => {                                  // a job taken from a board
            const a = actorOf(e), obj = a && this.call.mmoActor(e.data?.id);
            if (!obj || obj.kind !== 'node' || !obj.node.board || Math.hypot(obj.x - a.x, obj.z - a.z) > this.call.mmoConfig().talkRange + 60) return;
            this.game.mmoStorySystem?.takeJob(a, obj.node, e.data?.topic);
            this.call.mmoSend(a.socketId, 'MMO_DIALOG_CLOSE', { id: obj.id });
        });
    }

    postSceneLoad() {
        if (!this.game.isServer) return;
        let n = 0;
        this.nodeActors = new Map();      // node -> its actor (nodes with `when` come and go)
        for (const zone of this.call.mmoContentZones()) for (const node of zone.nodes || []) {
            if (node.when && !this.call.kdTest(node.when)) { this.nodeActors.set(node, null); continue; }
            this.spawnNode(node); n++;
        }
        console.log(`[objectives] ${n} world objects`);
    }


    // ==================== NODES ====================

    spawnNode(node) {
        const a = this.call.mmoSpawnActor({ kind: 'node', name: node.title, x: node.x, z: node.z, facing: node.facing || 0, level: 1, hostility: 'friendly' });
        a.maxHp = a.hp = 1;
        a.node = node;
        a.sprite = node.sprite;
        a.ver++;
        if (node.when) this.nodeActors.set(node, a);
        return a;
    }

    onKdWorldChanged() {
        for (const [node, a] of this.nodeActors || []) {
            const on = this.call.kdTest(node.when);
            if (on && !a) this.spawnNode(node);
            else if (!on && a) { this.call.mmoDespawnActor(a.id); this.nodeActors.set(node, null); }
        }
    }

    interact(a, id) {
        const obj = this.call.mmoActor(id);
        if (!obj || obj.kind !== 'node' || a.dead) return;
        const node = obj.node;
        if (Math.hypot(obj.x - a.x, obj.z - a.z) > this.call.mmoConfig().talkRange + 40) return this.call.mmoSend(a.socketId, 'MMO_ERROR', { text: 'You are too far away.' });
        if (node.id) this.game.triggerEvent('onKdUse', { actor: a, node: node.id });        // story objectives: {type: 'use', node}
        if (node.read) {                                                                    // a note or book lying about (in a locked box: picked first)
            if (node.lock != null && !obj.picked?.has(a.id)) { if (!this.pickLock(a, node)) return; (obj.picked ??= new Set()).add(a.id); }
            return this.game.mmoStorySystem?.readNode(a, node);
        }
        if (node.board) {                                                                   // a town's job board: its notices as talk options
            return this.call.mmoSend(a.socketId, 'MMO_DIALOG', { npc: null, id: obj.id, title: node.title, roles: [], quests: { available: [], active: [], complete: [] },
                talk: this.game.mmoStorySystem?.boardView(a, node) });
        }
        if (node.use) {                                                                     // a lever, a hoard: its actions
            const u = node.use, story = this.game.mmoStorySystem, key = `use:${node.id || node.title}`;
            if (u.once && story?.spent(u.once, key, a)) return this.call.mmoToast(a, u.spentText || 'There is nothing more here.', 'info');
            if (node.lock != null && !this.pickLock(a, node)) return;
            if (u.when && !this.call.kdTest(u.when, a)) return this.call.mmoToast(a, u.notYet || 'Nothing happens.', 'info');
            if (u.cooldown && obj.usedAt != null && obj.usedAt + u.cooldown > this.call.mmoNow()) return this.call.mmoToast(a, u.spentText || 'Not again, not yet.', 'info');
            obj.usedAt = this.call.mmoNow();
            this.call.mmoEmit({ t: 'act', s: a.id, an: 'open' }, a.x, a.z);
            if (u.once) story?.spend(u.once, key, a);
            this.game.mmoWorldStateSystem?.kdRun(u.actions, { actor: a });
            if (u.text) this.call.mmoToast(a, u.text, 'info');
            return;
        }
        if (node.portal) {
            // Like a dungeon door: usable in combat (the island is crawling with the dead).
            this.call.mmoTeleport(a, node.portal.x, node.portal.z);         // portal: { x, z } in world units
            return;
        }
        if (node.gather) return this.game.mmoProfessionSystem?.startGather(a, obj);      // ore, herbs: professions
        if (node.item) {
            const quests = this.game.mmoQuestSystem;
            if (!quests?.needsItem(a, node.item)) return this.call.mmoToast(a, 'You have no use for that right now.', 'info');
            if (!this.call.mmoGiveItem(a, node.item, 1)) return;
            quests.refreshCollect(a, true);
            this.call.mmoDespawnActor(obj.id);
            setTimeout(() => this.spawnNode(node), (node.respawn || 30) * 1000);
        }
    }

    static LOCKS = [[90, 'Master'], [75, 'Expert'], [50, 'Adept'], [25, 'Apprentice'], [0, 'Novice']];

    /** Try a lock: far beyond you, it won't budge; near your skill, a fair chance; within it, it opens. */
    pickLock(a, node) {
        const S = this.call.mmoSkill(a.char, 'lockpicking'), lock = node.lock;
        const name = ObjectiveSystem.LOCKS.find(([v]) => lock >= v)[1];
        if (S < lock - 15) { this.call.mmoSkillUse(a, 'lockpicking', 0.5); this.call.mmoToast(a, `${name} lock: beyond your skill (Lockpicking ${S}).`, 'error'); return false; }
        if (S < lock && Math.random() < 0.5) { this.call.mmoSkillUse(a, 'lockpicking', 2); this.call.mmoToast(a, `${name} lock: your pick slips. Try again.`, 'info'); return false; }
        this.call.mmoSkillUse(a, 'lockpicking', 3 + lock / 10);
        this.call.mmoToast(a, `${name} lock: it clicks open.`, 'info');
        return true;
    }

    // ==================== ESCORTS ====================

    escortObjectives(questId) {
        const def = this.call.mmoQuest(questId);
        return (def?.objectives || []).map((o, i) => ({ o, i })).filter(x => x.o.type === 'escort');
    }

    players() {
        return [...this.call.mmoActors().values()].filter(a => a.kind === 'player' && a.char);
    }

    update() {
        if (!this.game.isServer) return;
        const dt = this.game.state.deltaTime || 0.05;
        this._scan += dt;
        if (this._scan >= 1) { this._scan = 0; this.scanForCharges(); }
        for (const [key, e] of this.escorts) this.updateEscort(key, e, dt);
    }

    /** Make sure every unfinished escort has its charge waiting at the start. */
    scanForCharges() {
        for (const p of this.players()) {
            for (const [qid, q] of Object.entries(p.char.quests || {})) {
                for (const { o, i } of this.escortObjectives(qid)) {
                    if ((q.progress[i] || 0) >= 1) continue;
                    const key = `${p.char.name}|${qid}`;
                    if (this.escorts.has(key)) continue;
                    this.spawnCharge(key, p, qid, o, i);
                }
            }
        }
        // Charges whose player logged out or dropped the quest go home.
        for (const [key, e] of this.escorts) {
            const p = this.players().find(x => x.char.name === e.owner);
            if (!p || !p.char.quests?.[e.questId]) this.endEscort(key, e, null);
        }
    }

    spawnCharge(key, owner, questId, o, index) {
        const def = this.call.mmoNpc(o.npc) || { title: 'Traveller', unit: 'peasant' };
        // o.points: world [x, z] (continent zones); o.path: old zone tiles
        const path = o.points ? o.points.map(([x, z]) => ({ x, z })) : o.path.map(([tx, tz]) => this.tileToWorld(o.zone, tx, tz));
        const level = this.call.mmoQuest(questId)?.level || owner.level;
        const d = def.doll;          // a paper-doll NPC walks as itself
        const a = this.call.mmoSpawnActor({ kind: 'escort', name: def.title, subtitle: def.subtitle || 'Escort', unit: d ? `doll_${d.race}_${d.sex}_${d.class}` : def.unit, x: path[0].x, z: path[0].z, level, hostility: 'friendly', speed: ObjectiveSystem.ESCORT_SPEED });
        if (d) { a.npcDoll = d; a.classId = d.class; }
        a.maxHp = a.hp = Math.round(90 + 36 * (level - 1));
        a.armor = 20 + 14 * level;
        a.home = { x: path[0].x, z: path[0].z };
        this.escorts.set(key, { actor: a, owner: owner.char.name, questId, index, o, path, wp: 1, started: false, sprung: new Set(), ambushers: [], waitingSaid: 0 });
    }

    say(a, text) {
        this.call.mmoEmit({ t: 'say', id: a.id, text }, a.x, a.z);
    }

    updateEscort(key, e, dt) {
        const a = e.actor;
        if (!this.call.mmoActor(a.id)) { this.escorts.delete(key); return; }
        if (e.doneAt) { if (this.now() > e.doneAt) this.endEscort(key, e, null); return; }
        if (a.dead) return;
        const owner = this.players().find(x => x.char.name === e.owner);
        if (!owner) return;
        const d = Math.hypot(owner.x - a.x, owner.z - a.z);
        if (!e.started) {
            if (d > ObjectiveSystem.START_DISTANCE || owner.dead) return;
            e.started = true;
            this.say(a, this.call.mmoNpc(e.o.npc)?.greeting || 'Lead on — I\'ll follow.');
        }
        if (d > ObjectiveSystem.WAIT_DISTANCE || owner.dead) {
            a.moving = false;
            e.lastMoveAt = this.now();                       // waiting isn't being stuck
            if (this.now() - e.waitingSaid > 12) { e.waitingSaid = this.now(); this.say(a, 'Wait for me! Don\'t leave me out here!'); }
            return;
        }
        const target = e.path[e.wp];
        const mobs = this.game.mmoMobSystem;
        let arrived = mobs.moveToward(a, target.x, target.z, ObjectiveSystem.ESCORT_SPEED, dt, 14);
        // never stuck for good: no headway for a few seconds and the charge steps on to the waypoint
        const moved = Math.hypot(a.x - (e.lastX ?? a.x), a.z - (e.lastZ ?? a.z));
        if (moved > 20 || e.lastX == null) { e.lastX = a.x; e.lastZ = a.z; e.lastMoveAt = this.now(); }
        else if (!arrived && this.now() - e.lastMoveAt > 4) {
            console.warn(`[escort] ${a.name} stuck at ${Math.round(a.x)},${Math.round(a.z)} on the way to waypoint ${e.wp}; stepping on`);
            this.call.mmoTeleport ? this.call.mmoTeleport(a, target.x, target.z) : (a.x = target.x, a.z = target.z);
            e.lastX = a.x; e.lastZ = a.z; e.lastMoveAt = this.now();
            arrived = true;
        }
        if (!arrived) return;
        // Ambushes waiting at this waypoint.
        for (const [ai, amb] of (e.o.ambush || []).entries()) {
            if (amb.at !== e.wp || e.sprung.has(ai)) continue;
            e.sprung.add(ai);
            this.springAmbush(e, amb);
        }
        e.wp++;
        if (e.wp >= e.path.length) this.complete(key, e, owner);
    }

    springAmbush(e, amb) {
        const a = e.actor;
        const mobs = this.game.mmoMobSystem;
        const camp = { def: { id: `ambush:${e.owner}:${e.questId}`, mob: amb.mob }, mobs: new Set(), respawns: [], temporary: true };
        const step = this.game.mmoGameSystem;
        for (let k = 0; k < (amb.count || 1); k++) {
            let spot = null;
            for (let tries = 0; tries < 12 && !spot; tries++) {
                const ang = Math.random() * Math.PI * 2, r = 160 + Math.random() * 80;
                const x = a.x + Math.cos(ang) * r, z = a.z + Math.sin(ang) * r;
                if (step.mmoCanStep(x, z, a.x, a.z) || step.mmoFindPath(x, z, a.x, a.z)) spot = { x, z };
            }
            const m = mobs.spawnMob(camp, { pack: camp.def.id, x: (spot || a).x + (spot ? 0 : 60), z: (spot || a).z, slot: `a${k}` });
            if (!m) continue;
            this.call.mmoAddThreat(m, a, 30);
            e.ambushers.push(m.id);
        }
        this.say(a, amb.shout || 'Ambush! Protect me!');
    }

    complete(key, e, owner) {
        const quests = this.game.mmoQuestSystem;
        for (const p of this.players()) {
            const q = p.char.quests?.[e.questId];
            if (!q || (p !== owner && Math.hypot(p.x - e.actor.x, p.z - e.actor.z) > 600)) continue;
            q.progress[e.index] = 1;
            quests?.progressMsg(p, e.questId, `${e.actor.name} is safe.`);
        }
        this.say(e.actor, e.o.thanks || 'We made it! Thank you, friend.');
        e.actor.moving = false;
        e.doneAt = this.now() + 4;
    }

    /** The charge died: tell the player; a new one waits at the start. */
    onMmoKill({ victim }) {
        if (victim.kind !== 'escort') return;
        for (const [key, e] of this.escorts) {
            if (e.actor !== victim) continue;
            const owner = this.players().find(x => x.char.name === e.owner);
            if (owner) this.call.mmoToast(owner, `${victim.name} has fallen. Return to the start to try again.`, 'error');
            e.doneAt = this.now() + 5;
        }
    }

    endEscort(key, e) {
        this.escorts.delete(key);
        if (this.call.mmoActor(e.actor.id)) this.call.mmoDespawnActor(e.actor.id);
        // Ambushers still standing go away once nobody is fighting them.
        setTimeout(() => {
            for (const id of e.ambushers) {
                const m = this.call.mmoActor(id);
                if (m && !m.dead && !m.inCombat) this.call.mmoDespawnActor(id);
            }
        }, 8000);
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.ObjectiveSystem = ObjectiveSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.ObjectiveSystem = ObjectiveSystem; }
export default ObjectiveSystem;
export { ObjectiveSystem };
