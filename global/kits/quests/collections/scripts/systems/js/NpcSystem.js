/**
 * NpcSystem - a world's NPCs (server only; the GUTS quests kit).
 *
 * Spawns the zones' NPCs and answers interactions:
 *   quest     offer / progress / turn-in (via QuestSystem)
 *   vendor    buy listed items, sell anything with a price
 *   trainer   teach spells and powers, once a skill is high enough, for coin
 *   inn       bind your hearth; the hearthstone returns you here
 *   talk      topics and lines (once-only topics, conditions); pockets to pick
 *
 * Daily routines: an NPC with `routine` keeps hours on the world's clock (DAY: one day's length).
 * Each block { from, to (hours, may wrap midnight), x, z, facing, pose: sit | sleep, wander
 * (radius), path ([[x, z]...] walked in a loop), anims (acts played now and then), say (lines
 * spoken to passers-by) } sends them walking to it when it begins. Quest `places` that hold come
 * first; then the routine; then home (x, z). Talked to, they stop and face you; asleep, they wake
 * (grumbling) and lie down again when you leave.
 *
 * A game extends it (`class MmoNpcSystem extends GUTS.NpcSystem`) and overrides what it does
 * differently (sendDialog, buy, sell, hearth...).
 */
class NpcSystem extends GUTS.BaseSystem {
    static services = [];

    static serviceDependencies = [
        'mmoTrainable', 'mmoSpellNeeds', 'mmoSkill', 'mmoSkillDefs',
        'kdNpcSay',
        'mmoSkill',
        'mmoSkillUse',
        'mmoContentZones',
        'mmoStartZone',
        'mmoConfig',
        'mmoZone',
        'mmoZones',
        'mmoNpc',
        'mmoItem',
        'mmoSpell',
        'mmoClass',
        'mmoActor',
        'mmoEmit',
        'mmoCanStep',
        'mmoSpawnActor',
        'mmoDespawnActor',
        'mmoSend',
        'mmoToast',
        'mmoMarkDirty',
        'mmoGiveItem',
        'mmoTakeItem',
        'mmoCountItem',
        'mmoAddMoney',
        'mmoTeleport',
        'mmoQuestsForNpc',
        'mmoNow',
        'kdFlag',
        'kdSetFlag',
        'kdTest',
        'kdRun'
    ];

    constructor(game) {
        super(game);
        this.game.mmoNpcSystem = this;
        this.npcs = new Map();      // npcId -> actor
        this.reactive = [];         // npcIds with `when` or `places`
        this.routined = new Set();  // npcIds that keep hours
        this._routineAt = 0;
    }

    static DAY = 40 * 60;           // seconds in a day: the world's clock (MmoAtmosphereSystem.DAY)

    /** The hour of the day, 0..24 (0 midnight, 6 dawn, 12 noon, 18 dusk). */
    static hour(ms = Date.now()) { return ((ms / 1000) % NpcSystem.DAY) / NpcSystem.DAY * 24; }

    /** The hour on this server's clock (the dev command `.hour H` shifts it; the sky doesn't follow). */
    hourNow() { return NpcSystem.hour(Date.now() + (this.clockShift || 0)); }

    /** The routine block an NPC keeps at hour h, or null. */
    static blockOf(def, h) {
        return (def.routine || []).find(b => (b.from <= b.to ? h >= b.from && h < b.to : h >= b.from || h < b.to)) || null;
    }

    get cfg() { return this.call.mmoConfig(); }

    init() {
        const bus = this.game.serverEventManager;
        if (!this.game.isServer || !bus) return;
        const actorOf = (e) => this.game.mmoWorldSystem?.mmoActor(this.game.mmoWorldSystem.sessions.get(e.playerId)?.actorId);
        bus.subscribe('MMO_INTERACT', (e) => { const a = actorOf(e); if (a) this.interact(a, e.data?.id); });
        bus.subscribe('MMO_TALK', (e) => { const a = actorOf(e); if (a) this.talk(a, e.data?.id, e.data?.topic); });
        bus.subscribe('MMO_PICKPOCKET', (e) => { const a = actorOf(e); if (a) this.steal(a, e.data?.id, e.data?.item); });
        bus.subscribe('MMO_BUY', (e) => { const a = actorOf(e); if (a) this.buy(a, e.data?.npc, e.data?.item, e.data?.n); });
        bus.subscribe('MMO_SELL', (e) => { const a = actorOf(e); if (a) this.sell(a, e.data?.npc, e.data?.index); });
        bus.subscribe('MMO_TRAIN', (e) => { const a = actorOf(e); if (a) this.train(a, e.data?.npc, e.data?.spell); });
        bus.subscribe('MMO_BIND', (e) => { const a = actorOf(e); if (a) this.bind(a, e.data?.npc); });
        bus.subscribe('MMO_HEARTH', (e) => { const a = actorOf(e); if (a) this.hearth(a); });
    }

    postSceneLoad() {
        if (!this.game.isServer) return;
        for (const npcId of this.call.mmoContentZones().flatMap(zone => zone.npcs || [])) {
            const def = this.call.mmoNpc(npcId);
            if (!def) continue;
            if (def.when || def.places) this.reactive.push(npcId);
            if (def.routine?.length) this.routined.add(npcId);
            if (def.when && !this.call.kdTest(def.when)) continue;          // not (yet) here
            this.spawnNpc(npcId, def);
        }
    }

    /** Where an NPC stands now: the first of `places` [{when, x, z, facing}] that holds, else home. */
    placeOf(def) {
        const p = (def.places || []).find(q => !q.when || this.call.kdTest(q.when));
        if (p) return { x: p.x, z: p.z, facing: p.facing ?? def.facing ?? 0, fixed: true };
        const b = NpcSystem.blockOf(def, this.hourNow());
        if (b) return { x: b.x, z: b.z, facing: b.facing ?? def.facing ?? 0, block: b };
        return { x: def.x, z: def.z, facing: def.facing || 0 };
    }

    spawnNpc(npcId, def) {
        // a paper-doll NPC (def.doll: race, sex, class, face, gear, weapon) is drawn as that
        // race's body for the class, dressed like a player
        const d = def.doll, at = this.placeOf(def);
        const a = this.call.mmoSpawnActor({
            kind: 'npc', name: def.title, subtitle: def.subtitle, unit: d ? `doll_${d.race}_${d.sex}_${d.class}` : def.unit, npcId,
            level: 15, hostility: 'friendly', x: at.x, z: at.z, facing: at.facing
        });
        a.maxHp = a.hp = 5000;
        if (d) { a.npcDoll = d; a.classId = d.class; }
        if (at.block) { a.block = at.block; a.blockKey = `${at.block.from}-${at.block.to}`; this.setPose(a, at.block.pose); }
        this.npcs.set(npcId, a);
        return a;
    }

    /** NPCs with `when` arrive and leave, and ones with `places` move, as the world changes. */
    onKdWorldChanged() {
        for (const npcId of this.reactive) {
            const def = this.call.mmoNpc(npcId), a = this.npcs.get(npcId);
            const here = !def.when || this.call.kdTest(def.when);
            if (here && a?.walkTo?.leaving) a.walkTo = null;              // called back before they got away
            if (here && !a) this.spawnNpc(npcId, def);
            else if (!here && a) {
                if (def.exit && !a.walkTo?.leaving) a.walkTo = { x: def.exit[0], z: def.exit[1], facing: a.facing, leaving: true, lastX: a.x, lastZ: a.z, lastAt: this.call.mmoNow() };     // walks off, then goes
                else if (!def.exit) { this.call.mmoDespawnActor(a.id); this.npcs.delete(npcId); }
            }
            else if (a && def.places) {
                const at = this.placeOf(def);
                if (Math.hypot(at.x - a.x, at.z - a.z) > 1) { this.setPose(a, null); a.walkTo = { ...at, since: this.call.mmoNow(), lastX: a.x, lastZ: a.z, lastAt: this.call.mmoNow() }; }
                a.block = at.block || null;
            }
        }
    }

    static WALK_SPEED = 120;
    static SIGHT = 3200;            // beyond this (each way) from every player, NPCs don't walk: they're simply there

    /** A body at rest: seated, lying asleep, or standing (null). */
    setPose(a, pose) {
        const ws = this.game.mmoWorldSystem;
        ws.setSitting(a, pose === 'sit');
        a.lying = pose === 'sleep';
        a.indoors = pose === 'indoors';                        // in at a door with no way in: out of sight till the block ends
    }

    /** Routines: once a second, each NPC that keeps hours checks the clock and goes about its day. */
    tickRoutines(now) {
        const h = this.hourNow(), ws = this.game.mmoWorldSystem;
        for (const npcId of this.routined) {
            const a = this.npcs.get(npcId), def = this.call.mmoNpc(npcId);
            if (!a || a.dead || !def || a.walkTo?.leaving || (a.talkingUntil || 0) > now) continue;
            if ((def.places || []).some(q => !q.when || this.call.kdTest(q.when))) continue;      // the story has them somewhere
            const b = NpcSystem.blockOf(def, h);
            if (!b) continue;
            const key = `${b.from}-${b.to}`;
            if (a.blockKey !== key) {                                           // a new part of the day: off they go
                a.block = b; a.blockKey = key; a.pathI = 0; a.wanderAt = now + 6 + Math.random() * 10; a.animAt = now + 2;
                this.setPose(a, null);
                a.walkTo = { x: b.x, z: b.z, facing: b.facing ?? def.facing ?? 0, since: now, lastX: a.x, lastZ: a.z, lastAt: now };
                continue;
            }
            if (a.walkTo) continue;
            if ((a.wokenUntil || 0) > now) continue;                            // woken: up a while before lying down again
            if (b.pose && !(b.pose === 'sit' ? a.sitting : b.pose === 'sleep' ? a.lying : a.indoors)) this.setPose(a, b.pose);
            if (b.path?.length && now > (a.wanderAt || 0)) {                   // a beat or a round: the next point
                a.pathI = ((a.pathI || 0) + 1) % b.path.length;
                const [px, pz] = b.path[a.pathI];
                this.setPose(a, null);
                a.walkTo = { x: px, z: pz, facing: a.facing, since: now, lastX: a.x, lastZ: a.z, lastAt: now, stroll: true };
                a.wanderAt = now + 2 + Math.random() * 4;
            } else if (b.wander && now > (a.wanderAt || 0)) {                  // pottering about the place
                const ang = Math.random() * Math.PI * 2, d = b.wander * Math.sqrt(Math.random());
                const x = b.x + Math.cos(ang) * d, z = b.z + Math.sin(ang) * d;
                if (this.call.mmoCanStep(b.x, b.z, x, z)) {
                    this.setPose(a, null);
                    a.walkTo = { x, z, facing: Math.random() * Math.PI * 2, since: now, lastX: a.x, lastZ: a.z, lastAt: now, stroll: true };
                }
                a.wanderAt = now + 8 + Math.random() * 16;
            }
            if (b.anims?.length && !a.walkTo && now > (a.animAt || 0)) {       // at work: hammering, sweeping, stirring
                this.call.mmoEmit({ t: 'act', s: a.id, an: b.anims[Math.floor(Math.random() * b.anims.length)] }, a.x, a.z);
                a.animAt = now + 3 + Math.random() * 5;
            }
            if (b.say?.length && now > (a.sayAt || 0)) {                      // a word to someone passing
                const near = ws.playersNear ? ws.playersNear(a.x, a.z, 260) : [...ws.actors.values()].filter(p => p.kind === 'player' && !p.dead && Math.hypot(p.x - a.x, p.z - a.z) < 260);
                if (near.length && Math.random() < 0.35) this.call.kdNpcSay(a, b.say[Math.floor(Math.random() * b.say.length)], near[0]);
                a.sayAt = now + 25 + Math.random() * 40;
            }
        }
    }

    /** NPCs whose place changed walk there (the way they'd really go); one stuck for long steps on. */
    update() {
        if (!this.game.isServer) return;
        const dt = this.game.state.deltaTime || 0.05, now = this.call.mmoNow(), mobs = this.game.mmoMobSystem;
        if (now - this._routineAt >= 1) { this._routineAt = now; this.tickRoutines(now); }
        // who could see them: an NPC walking where no player is near just arrives (no pathing to pay for)
        const eyes = [];
        for (const p of this.game.mmoWorldSystem.actors.values()) if (p.kind === 'player') eyes.push(p);
        const seen = (x, z) => eyes.some(p => Math.abs(p.x - x) < NpcSystem.SIGHT && Math.abs(p.z - z) < NpcSystem.SIGHT);
        for (const a of this.npcs.values()) {
            const w = a.walkTo;
            if (!w || !mobs) continue;
            if (!w.leaving && !seen(a.x, a.z) && !seen(w.x, w.z)) {
                a.x = w.x; a.z = w.z; a.y = this.game.mmoWorldSystem.mmoGroundY(w.x, w.z);
                a.facing = w.facing; a.moving = false; a.walkTo = null; a.path = null;
                this.game.mmoWorldSystem.syncTransform(a);
                continue;
            }
            if ((a.talkingUntil || 0) > now) { if (a.moving) { a.moving = false; this.game.mmoWorldSystem.syncTransform(a); } w.lastAt = now; continue; }
            const arrived = mobs.moveToward(a, w.x, w.z, NpcSystem.WALK_SPEED, dt, 10);
            if (Math.hypot(a.x - w.lastX, a.z - w.lastZ) > 30) { w.lastX = a.x; w.lastZ = a.z; w.lastAt = now; }
            const stuck = now - w.lastAt > 8;
            if (arrived || stuck) {
                if (w.leaving) { this.call.mmoDespawnActor(a.id); this.npcs.delete(a.npcId); continue; }
                if (stuck && !w.stroll) { a.x = w.x; a.z = w.z; a.y = this.game.mmoWorldSystem.mmoGroundY(w.x, w.z); }
                a.facing = w.facing;
                a.moving = false;
                a.walkTo = null;
                this.game.mmoWorldSystem.syncTransform(a);
            }
        }
    }

    static WOKEN = ["Mm? What... it's the middle of the night.", "Hm? Who's there? Oh. You.", "Can't it wait till morning?", "Gods... what is it?"];

    npcActor(npcId) { return this.npcs.get(npcId) || null; }

    near(actor, npc) {
        return Math.hypot(npc.x - actor.x, npc.z - actor.z) <= this.cfg.talkRange + 60;
    }

    // ==================== DIALOGUE ====================

    interact(actor, actorId) {
        const npc = this.call.mmoActor(actorId);
        if (!npc || npc.kind !== 'npc' || actor.dead) return;
        if (!this.near(actor, npc)) return this.call.mmoSend(actor.socketId, 'MMO_ERROR', { text: 'You are too far away.' });
        if (actor.inCombat) return this.call.mmoSend(actor.socketId, 'MMO_ERROR', { text: 'You are in combat.' });
        if (actor.sneaking) return this.sendPockets(actor, npc);            // sneaking up on someone: their pockets
        if ((actor.char.caught?.[npc.npcId] || 0) > Date.now() / 1000) {
            this.call.kdNpcSay(npc, 'Get away from me, thief!', actor);
            return;
        }
        const now = this.call.mmoNow();
        if (npc.lying) {                                       // asleep: woken, and not pleased about it
            this.setPose(npc, null);
            npc.wokenUntil = now + 40;
            const def = this.call.mmoNpc(npc.npcId);
            this.call.kdNpcSay(npc, def?.woken || NpcSystem.WOKEN[Math.floor(Math.random() * NpcSystem.WOKEN.length)], actor);
        }
        // they stop what they're doing and turn to you
        npc.talkingUntil = now + 12;
        npc.facing = Math.atan2(actor.z - npc.z, actor.x - npc.x);
        if (npc.sitting) npc.talkSeated = true;
        this.game.mmoWorldSystem.syncTransform(npc);
        this.sendDialog(actor, npc);
    }

    sendDialog(actor, npc, talk = null) {
        const def = this.call.mmoNpc(npc.npcId);
        const roles = def.roles || [];
        const dialog = {
            npc: npc.npcId, id: npc.id, title: def.title, subtitle: def.subtitle,
            greeting: def.greeting, roles,
            quests: this.call.mmoQuestsForNpc(npc.npcId, actor),
            talk: talk || this.talkView(actor, npc.npcId)
        };
        if (roles.includes('vendor')) {
            dialog.vendor = (def.vendor || []).map(id => ({ id, price: this.buyPrice(actor, this.call.mmoItem(id) || {}) }));
        }
        if (roles.includes('trainer')) dialog.trainer = this.trainerList(actor);
        if (roles.includes('inn')) dialog.inn = { bound: actor.char.hearth?.npc === npc.npcId };
        if (roles.includes('flight')) { this.game.mmoFlightSystem?.discover(actor, npc.npcId); dialog.flight = this.game.mmoFlightSystem?.view(actor, npc.npcId); }
        if (roles.includes('professions')) dialog.professions = this.game.mmoProfessionSystem?.trainerView(actor) || [];
        this.call.mmoSend(actor.socketId, 'MMO_DIALOG', dialog);
    }

    // ==================== PICKPOCKETING ====================
    //
    // Sneak up on someone and interact: what they carry, and the chance of lifting each without
    // being noticed (Pickpocket skill; worse if they can see you, and for bigger prizes). Caught,
    // they won't deal with you for a while. A person's pockets refill (for you) after half an hour.

    static POCKET_REFILL = 1800;
    static CAUGHT_FOR = 300;

    pockets(actor, npc) {
        const def = this.call.mmoNpc(npc.npcId) || {}, roles = def.roles || [];
        const took = actor.char.pocketed?.[npc.npcId];
        const fresh = !took || Date.now() / 1000 - took.at > NpcSystem.POCKET_REFILL;
        let seed = [...npc.npcId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
        const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        const purse = def.pockets?.gold ?? Math.round((roles.includes('vendor') || roles.includes('inn') ? 40 : roles.includes('trainer') ? 30 : 8) * (0.6 + rnd() * 0.8));
        const items = def.pockets?.items || (rnd() < 0.5 ? [rnd() < 0.5 ? 'minorHealingPotion' : 'trailBread'] : []);
        const list = [{ id: 'gold', gold: purse }, ...items.map(id => ({ id }))];
        return list.filter(e => fresh || !took.taken.includes(e.id));
    }

    stealChance(actor, npc, entry) {
        const S = this.call.mmoSkill(actor.char, 'pickpocket');
        let c = 0.25 + (S - 15) / 100;
        const toThief = Math.atan2(actor.z - npc.z, actor.x - npc.x);
        let off = Math.abs(toThief - (npc.facing || 0)) % (Math.PI * 2);
        if (off > Math.PI) off = Math.PI * 2 - off;
        if (off < 1.0) c *= 0.6;                                         // they're looking right at you
        const value = entry.gold || this.call.mmoItem(entry.id)?.price || 20;
        c *= 1 - Math.min(0.5, value / 400);
        return Math.max(0.05, Math.min(0.9, c));
    }

    sendPockets(actor, npc) {
        const items = this.pockets(actor, npc).map(e => ({
            id: e.id, gold: e.gold || 0, title: e.gold ? `${e.gold} coin` : this.call.mmoItem(e.id)?.title || e.id,
            icon: e.gold ? 'stack_of_coins' : this.call.mmoItem(e.id)?.icon, chance: Math.round(this.stealChance(actor, npc, e) * 100)
        }));
        const def = this.call.mmoNpc(npc.npcId);
        this.call.mmoSend(actor.socketId, 'MMO_DIALOG', { npc: npc.npcId, id: npc.id, title: def.title, subtitle: 'Pickpocket', roles: [], quests: { available: [], active: [], complete: [] }, pickpocket: items });
    }

    steal(actor, actorId, itemId) {
        const npc = this.call.mmoActor(actorId);
        if (!npc || npc.kind !== 'npc' || actor.dead || !actor.sneaking || !this.near(actor, npc)) return;
        const entry = this.pockets(actor, npc).find(e => e.id === itemId);
        if (!entry) return;
        const c = actor.char;
        if (Math.random() < this.stealChance(actor, npc, entry)) {
            if (entry.gold) this.call.mmoAddMoney(actor, entry.gold);
            else if (!this.call.mmoGiveItem(actor, entry.id, 1)) return;
            c.pocketed = c.pocketed || {};
            const rec = c.pocketed[npc.npcId];
            if (!rec || Date.now() / 1000 - rec.at > NpcSystem.POCKET_REFILL) c.pocketed[npc.npcId] = { at: Date.now() / 1000, taken: [entry.id] };
            else rec.taken.push(entry.id);
            this.call.mmoSkillUse(actor, 'pickpocket', 4 + (entry.gold || this.call.mmoItem(entry.id)?.price || 20) / 25);
            this.call.mmoToast(actor, `You lift ${entry.gold ? `${entry.gold} coin` : this.call.mmoItem(entry.id)?.title} without a sound.`, 'info');
            this.sendPockets(actor, npc);
        } else {
            c.caught = c.caught || {};
            c.caught[npc.npcId] = Date.now() / 1000 + NpcSystem.CAUGHT_FOR;
            this.call.mmoSkillUse(actor, 'pickpocket', 1);
            actor.sneaking = false;
            this.call.kdNpcSay(npc, 'Hey! Thief! Hands off!');
            this.call.mmoSend(actor.socketId, 'MMO_DIALOG_CLOSE', { id: npc.id });
            this.call.mmoToast(actor, `Caught! ${npc.name} won't deal with you for a while.`, 'error');
        }
        this.call.mmoMarkDirty(actor);
    }

    // ==================== CONVERSATION ====================
    //
    // Topics for an NPC come from collections/dialogues/<npcId>.json ({greeting, topics}) and
    // from every story quest's `topics: {<npcId>: [...]}` (a quest carries its own lines).
    // A topic: { id, text (the player's line), reply (the NPC's: a string or [{when, text}]),
    //   when, actions, next: [topic ids] (follow-ups; else back to the top) | 'end',
    //   sub: true (only reachable through `next`), once: true (per player) | 'world' }

    topicsFor(npcId) {
        if (!this._topics) {
            const idx = this._topics = new Map();
            const add = (npc, t, prefix) => {
                if (!idx.has(npc)) idx.set(npc, []);
                idx.get(npc).push({ ...t, key: `${npc}.${prefix ? prefix + '.' : ''}${t.id}`, ref: prefix ? `${prefix}.${t.id}` : t.id });
            };
            for (const [npc, d] of Object.entries(this.collections.dialogues || {})) for (const t of d.topics || []) add(npc, t, '');
            for (const [qid, q] of Object.entries(this.collections.quests || {})) for (const [npc, list] of Object.entries(q.topics || {})) for (const t of list) add(npc, t, qid);
        }
        return this._topics.get(npcId) || [];
    }

    topicOpen(actor, t) {
        if (t.once === 'world' && this.call.kdFlag(`topic:${t.key}`)) return false;
        if (t.once && t.once !== 'world' && actor.char.topics?.includes(t.key)) return false;
        return !t.when || this.call.kdTest(t.when, actor);
    }

    pickLine(v, actor) {
        if (Array.isArray(v)) return v.find(x => !x.when || this.call.kdTest(x.when, actor))?.text ?? null;
        return v ?? null;
    }

    /** What the NPC says and what you can say back: { line, options: [{ ref, text }] }. */
    talkView(actor, npcId, line = null, only = null) {
        const all = this.topicsFor(npcId);
        const d = this.collections.dialogues?.[npcId];
        if (!all.length && !d) return null;
        const pool = only ? only.map(r => all.find(t => t.ref === r || t.id === r)).filter(Boolean) : all.filter(t => !t.sub);
        const options = pool.filter(t => this.topicOpen(actor, t)).map(t => ({ ref: t.ref, text: t.text }));
        return { line: line ?? this.pickLine(d?.greeting, actor), options };
    }

    talk(actor, actorId, ref) {
        const npc = this.call.mmoActor(actorId);
        if (!npc || npc.kind !== 'npc' || actor.dead || !this.near(actor, npc)) return;
        const t = this.topicsFor(npc.npcId).find(x => x.ref === ref);
        if (!t || !this.topicOpen(actor, t)) return;
        if (t.once === 'world') this.call.kdSetFlag(`topic:${t.key}`, 1);
        else if (t.once) this.call.kdRun([{ topic: t.key }], { actor });
        const reply = this.pickLine(t.reply, actor);                   // chosen before the actions change the state
        this.call.kdRun(t.actions, { actor, npc });
        if (t.next === 'end') { this.call.mmoSend(actor.socketId, 'MMO_DIALOG_CLOSE', { id: npc.id, line: reply, title: npc.name }); return; }
        this.sendDialog(actor, npc, this.talkView(actor, npc.npcId, reply, Array.isArray(t.next) && t.next.length ? t.next : null));
    }

    // ==================== VENDOR ====================

    buy(actor, npcId, itemId, n = 1) {
        const npc = this.npcs.get(npcId);
        const def = this.call.mmoNpc(npcId);
        if (!npc || !def?.vendor?.includes(itemId) || !this.near(actor, npc)) return;
        const item = this.call.mmoItem(itemId);
        n = Math.max(1, Math.min(item.stack || 1, Math.floor(n || 1)));
        const price = this.buyPrice(actor, item);
        const cost = price * n;
        if (actor.char.money < cost) return this.call.mmoSend(actor.socketId, 'MMO_ERROR', { text: 'You don\'t have enough money.' });
        const given = this.call.mmoGiveItem(actor, itemId, n, false);
        if (given > 0) {
            this.call.mmoAddMoney(actor, -price * given);
            this.call.mmoSkillUse(actor, 'speech', Math.min(4, 0.4 + price * given / 300));
            this.call.mmoSend(actor.socketId, 'MMO_LOOT_MSG', { item: itemId, n: given, bought: 1 });
        }
    }

    /** What a merchant charges you: a smooth talker pays up to a fifth less. */
    buyPrice(actor, item) { return Math.max(1, Math.round((item.price || 0) * Math.max(0.78, 1 - (this.call.mmoSkill(actor.char, 'speech') - 15) / 380))); }

    sell(actor, npcId, index) {
        const npc = this.npcs.get(npcId);
        if (!npc || !this.call.mmoNpc(npcId)?.vendor || !this.near(actor, npc)) return;
        const slot = actor.char.bags[index];
        if (!slot) return;
        const item = this.call.mmoItem(slot.id);
        if (!item || item.kind === 'quest' || !item.price) return this.call.mmoSend(actor.socketId, 'MMO_ERROR', { text: 'The merchant isn\'t interested.' });
        const value = Math.max(1, Math.floor(item.price / 4 * (1 + (this.call.mmoSkill(actor.char, 'speech') - 15) / 300))) * slot.n;
        this.call.mmoSkillUse(actor, 'speech', Math.min(4, 0.4 + value / 100));
        actor.char.bags.splice(index, 1);
        this.call.mmoAddMoney(actor, value);
        this.call.mmoMarkDirty(actor);
        this.call.mmoSend(actor.socketId, 'MMO_LOOT_MSG', { money: value, sold: slot.id });
    }

    // ==================== TRAINER ====================

    trainCost(spell) {
        return Math.max(10, (spell.learnLevel || 1) ** 2 * 12);
    }

    // No classes (KINGDOM.md "No classes"): a trainer teaches anyone any spell or power, once
    // they are good enough in its skill (mmoSpellNeeds).
    trainerList(actor) {
        return this.call.mmoTrainable().map(id => {
            const sp = this.call.mmoSpell(id), need = this.call.mmoSpellNeeds(sp);
            return {
                id, level: sp?.learnLevel || 1, skill: need.skill, needs: need.level,
                cost: this.trainCost(sp),
                known: actor.char.spells.includes(id)
            };
        }).sort((a, b) => String(a.skill).localeCompare(String(b.skill)) || a.needs - b.needs);
    }

    train(actor, npcId, spellId) {
        const npc = this.npcs.get(npcId);
        if (!npc || !this.call.mmoNpc(npcId)?.roles?.includes('trainer') || !this.near(actor, npc)) return;
        const sp = this.call.mmoSpell(spellId);
        if (!sp || !this.call.mmoTrainable().includes(spellId) || actor.char.spells.includes(spellId)) return;
        const need = this.call.mmoSpellNeeds(sp);
        if (need.level && this.call.mmoSkill(actor.char, need.skill) < need.level) return this.call.mmoSend(actor.socketId, 'MMO_ERROR', { text: `Requires ${this.call.mmoSkillDefs()[need.skill]?.title || need.skill} ${need.level}.` });
        const cost = this.trainCost(sp);
        if (actor.char.money < cost) return this.call.mmoSend(actor.socketId, 'MMO_ERROR', { text: 'You don\'t have enough money.' });
        this.call.mmoAddMoney(actor, -cost);
        actor.char.spells.push(spellId);
        const bar = actor.char.actionBar;
        const free = bar.indexOf(null);
        if (free !== -1) bar[free] = spellId;
        this.call.mmoMarkDirty(actor);
        this.call.mmoSend(actor.socketId, 'MMO_LEARNED', { spell: spellId });
        this.sendDialog(actor, npc);
    }

    // ==================== INN ====================

    bind(actor, npcId) {
        const npc = this.npcs.get(npcId);
        if (!npc || !this.call.mmoNpc(npcId)?.roles?.includes('inn') || !this.near(actor, npc)) return;
        actor.char.hearth = { npc: npcId, x: npc.x + 40, z: npc.z + 40 };
        this.call.mmoMarkDirty(actor);
        this.call.mmoToast(actor, `${this.call.mmoNpc(npcId).title}'s inn is now your home.`, 'success');
        this.sendDialog(actor, npc);
    }

    hearth(actor) {
        if (actor.dead) return;
        if (actor.inCombat) return this.call.mmoSend(actor.socketId, 'MMO_ERROR', { text: 'You can\'t do that while in combat.' });
        const now = this.call.mmoNow();
        if ((actor.cooldowns.hearth || 0) > now) {
            const m = Math.ceil((actor.cooldowns.hearth - now) / 60);
            return this.call.mmoSend(actor.socketId, 'MMO_ERROR', { text: `Hearthstone is ready in ${m} min.` });
        }
        const zone = this.call.mmoStartZone(actor.char.appearance?.race);
        const h = actor.char.hearth || { x: zone.spawn.x, z: zone.spawn.z };
        actor.cooldowns.hearth = now + 300;
        this.call.mmoTeleport(actor, h.x, h.z);
        this.call.mmoToast(actor, 'You return home.', 'info');
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.NpcSystem = NpcSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.NpcSystem = NpcSystem; }
export default NpcSystem;
export { NpcSystem };
