/**
 * RpgMobSystem - creature camps and creature AI (server only; the GUTS rpg kit).
 *
 * Spawns the zone's mob camps, runs each creature's brain, and handles loot
 * and respawns.
 *
 * Brain states:
 *   idle      wander near the spawn point; hostile mobs scan for players
 *             inside their aggro radius (scaled by level difference)
 *   combat    chase/attack the top of the threat table (taunts override),
 *             cast data-driven spells, pull packmates (social)
 *   evading   dragged too far from home or lost every target: run home,
 *             immune, then reset to full health
 *   dead      corpse with personal loot for the tapping player/party, then
 *             despawn and respawn after the mob's respawn timer
 *
 * Encounter zones (KINGDOM.md "Scaling"): a camp with `ez: {min, max}` spawns when a player
 * first comes near, at a level locked from the strongest player there:
 *   min + EZ_LAG * (their level - min), within [min, max]
 * kept in the world state (cells[campId]) until the camp is cleared and left alone for
 * `reset` seconds (default 20 min); then the next visit locks it afresh. Cleared camps don't
 * respawn creature by creature. `fixed: level` never scales (apex creatures). `roster:
 * [{mob, upTo}]` picks the creature by the locked level (the first whose upTo covers it; the
 * last entry for anything above); a pack member's own `mob` wins; `boss: true` is +2 levels.
 *
 * Skyrim's way of filling the land (KINGDOM.md "Spawning"), by a camp's `kind`:
 *   lair   (the default for an encounter zone) a named place: posts, a boss, a hoard. It locks
 *          its level and stays as it was left (cleared stays cleared) until it resets.
 *   wild   a spawn point in the open. When someone comes near it rolls `chance`; if it hits,
 *          it picks one entry of its leveled `table` ([{ mob | roster, n: [lo, hi], weight,
 *          levels: [lo, hi], roam, group }]) that suits its locked level, and that many creatures
 *          come out at its spots and roam (`roam`: how far from the point they wander). Left
 *          alone they go again, and the point rolls afresh next time. Nothing is saved.
 *   road   the same, on a road: an ambush, a patrol, a traveller. A miss keeps it quiet a while.
 * Wild and road camps keep their level and roll in memory only (there are thousands of them).
 *
 * A camp with `friendlyWhen` stands down while that condition holds (a truce): its creatures
 * are friendly (no aggro, can't be attacked) and turn hostile again when it ends.
 *
 * Ways in (KINGDOM.md "Camps"): a pack member can have a `pose` (sleep, sit: it sees less and
 * stays put), a `facing` (with `post: true` it stands there watching that way), or a `patrol` ([[x, z], ...]: it walks the loop, pausing at each
 * point). A camp's `sight` ([{ when, mult }]) scales how far its creatures see while a
 * condition holds (the fire put out, the ale spiked). A `noise` action ({ noise: [x, z], r })
 * sends idle creatures within r to look, away from their posts, and back again.
 *
 * A game extends it (`class MmoMobSystem extends GUTS.RpgMobSystem`) and overrides what it does
 * differently (targets, encounters, bodies). It registers as game.mmoMobSystem.
 */
class RpgMobSystem extends GUTS.BaseSystem {
    static AWAKE_RADIUS = 3000;     // creatures further than this from every player don't wander or scan
    static EZ_WAKE = 2400;          // an encounter-zone camp spawns (and locks its level) when a player comes this close
    static EZ_LAG = 0.6;            // how much of a player's growth above a zone's floor its creatures follow
    static EZ_RESET = 2400;         // seconds a cleared lair waits, unvisited, before it can fill up again
    static WILD_WAKE = 2200;        // a wild or road spawn point rolls when a player comes this close
    static WILD_GONE = 3200;        // ...and its creatures go when no player has been this close for WILD_LINGER
    static WILD_LINGER = 90;
    static WILD_RESET = 600;        // seconds before a cleared wild point can roll again (road: def.reset)
    static WILD_QUIET = 240;        // seconds a point that rolled nothing stays quiet
    static services = [
        'mmoCreditedPlayers',
        'mmoAwareOf',
        'mmoNoise'
    ];

    static serviceDependencies = [
        'mmoRandomGear',
        'mmoSkill',
        'mmoSkillUse',
        'mmoContentZones',
        'mmoConfig',
        'mmoZone',
        'mmoMob',
        'mmoMobStats',
        'mmoSpell',
        'mmoSpellRange',
        'mmoActor',
        'mmoActors',
        'mmoSpawnActor',
        'mmoDespawnActor',
        'mmoNearbyActors',
        'mmoGroundY',
        'mmoCanStep',
        'mmoFindPath',
        'mmoEmit',
        'mmoSend',
        'mmoToast',
        'mmoGiveItem',
        'mmoAddMoney',
        'mmoItem',
        'mmoNow',
        'mmoCastSpell',
        'mmoDistance',
        'mmoZones',
        'mmoAddThreat',
        'kdTest',
        'kdWorld',
        'kdTouch'
    ];

    constructor(game) {
        super(game);
        this.game.mmoMobSystem = this;
        this.camps = new Map();          // campId -> { def, mobs: Set<actorId>, respawns: [{at, spot}] }
        this._aggroAccum = 0;
    }

    get cfg() { return this.call.mmoConfig(); }
    now() { return this.call.mmoNow(); }

    init() {
        const bus = this.game.serverEventManager;
        if (!this.game.isServer || !bus) return;
        const actorOf = (e) => this.game.mmoWorldSystem?.mmoActor(this.game.mmoWorldSystem.sessions.get(e.playerId)?.actorId);
        bus.subscribe('MMO_LOOT_OPEN', (e) => { const a = actorOf(e); if (a) this.openLoot(a, e.data?.id); });
        bus.subscribe('MMO_LOOT_TAKE', (e) => { const a = actorOf(e); if (a) this.takeLoot(a, e.data?.id, e.data?.index); });
    }

    postSceneLoad() {
        if (!this.game.isServer) return;
        for (const def of this.call.mmoContentZones().flatMap(zone => zone.mobCamps || [])) {
            const camp = { def, mobs: new Set(), respawns: [], off: false };
            this.camps.set(def.id, camp);
            if (def.ez || def.fixed || this.transient(def)) camp.ez = true;                  // spawns when someone comes near (its creatures and levels by the zone)
            if (def.when && !this.call.kdTest(def.when)) { camp.off = true; continue; }     // not (yet) in this world
            if (camp.ez) continue;
            this.populateCamp(camp);
        }
        console.log(`[mobs] spawned ${[...this.camps.values()].reduce((n, c) => n + c.mobs.size, 0)} creatures in ${this.camps.size} camps`);
    }

    // ==================== SPAWNING ====================

    populateCamp(camp) {
        const def = camp.def;
        camp.populated = true;
        if (this.transient(def)) {                          // a wild or road roll: n of its spots, one pack
            const e = camp.pick || {}, [lo, hi] = e.n || [1, 1];
            const n = lo + Math.floor(Math.random() * (hi - lo + 1));
            const spots = (def.packs || []).flatMap(p => p.members);
            spots.slice(0, n).forEach((spot, mi) => {
                const member = e.patrol && def.route ? { ...spot, post: false, patrol: def.route } : spot;        // a road patrol walks the road
                this.spawnMob(camp, { pack: e.group === false ? `${def.id}#${mi}` : `${def.id}#0`, x: spot.x, z: spot.z, slot: `0:${mi}`, member });
            });
            return;
        }
        (def.packs || []).forEach((pack, pi) => {
            pack.members.forEach((spot, mi) => this.spawnMob(camp, { pack: `${def.id}#${pi}`, x: spot.x, z: spot.z, slot: `${pi}:${mi}`, member: spot }));
        });
    }

    /** Camps with a `when` come and go as the world changes (bandits move in, a lair is burned out). */
    onKdWorldChanged() {
        this._worldRev = (this._worldRev || 0) + 1;             // camps' sight re-reads its conditions
        for (const camp of this.camps.values()) {
            if (camp.def.friendlyWhen) {                                 // a truce begins or ends
                const calm = this.call.kdTest(camp.def.friendlyWhen);
                for (const id of camp.mobs) {
                    const a = this.call.mmoActor(id), want = calm ? 'friendly' : this.call.mmoMob(a?.mobId)?.hostility || 'hostile';
                    if (!a || a.dead || a.hostility === want) continue;
                    a.hostility = want;
                    if (calm) { a.threat.clear(); a.target = null; a.autoAttack = false; }
                    a.ver++;
                }
            }
            if (!camp.def.when) continue;
            const on = this.call.kdTest(camp.def.when);
            if (on && camp.off) { camp.off = false; if (!camp.ez) this.populateCamp(camp); }
            else if (!on && !camp.off) {
                camp.off = true;
                camp.respawns = [];
                for (const id of camp.mobs) { const a = this.call.mmoActor(id); if (a && !a.dead) this.call.mmoDespawnActor(id); }
                camp.mobs.clear();
                camp.populated = false;
            }
        }
    }

    // ==================== ENCOUNTER ZONES ====================

    campCenter(def) {
        if (def.at) return { x: def.at[0], z: def.at[1] };
        const p = def.packs?.[0];
        return p ? { x: p.x, z: p.z } : { x: 0, z: 0 };
    }

    /** Wild and road spawn points: nothing about them is kept in the world state. */
    transient(def) { return def.kind === 'wild' || def.kind === 'road'; }

    /** A camp's cell: the saved one for lairs, an in-memory one for wild and road points. */
    cellOf(camp) { return this.transient(camp.def) ? camp.mem : this.call.kdWorld().cells[camp.def.id]; }
    dropCell(camp) { if (this.transient(camp.def)) camp.mem = null; else { delete this.call.kdWorld().cells[camp.def.id]; this.call.kdTouch(); } }

    /** The level an encounter-zone camp is locked at (locking it now if it isn't). */
    ezLevel(camp, players) {
        const def = camp.def;
        if (def.fixed) return def.fixed;
        let cell = this.cellOf(camp);
        if (!cell?.level) {
            const P = Math.max(1, ...players.map(p => p.level || 1));
            const { min = 1, max = 99 } = def.ez || {};
            const L = Math.round(min + RpgMobSystem.EZ_LAG * Math.max(0, P - min));
            cell = { level: Math.max(min, Math.min(max, L)), lockedAt: Date.now() / 1000 };
            if (this.transient(def)) camp.mem = cell;
            else { this.call.kdWorld().cells[def.id] = cell; this.call.kdTouch(); }
        }
        return cell.level;
    }

    /** A wild or road point's roll: one entry of its table that suits the level, or null (nothing this time). */
    rollTable(camp, level) {
        const def = camp.def;
        if (Math.random() > (def.chance ?? 1)) return null;
        const fits = (def.table || []).filter(e => !e.levels || (level >= e.levels[0] && level <= e.levels[1]));
        const pool = fits.length ? fits : (def.table || []);
        if (!pool.length) return null;
        let v = Math.random() * pool.reduce((t, e) => t + (e.weight ?? 1), 0);
        for (const e of pool) if ((v -= e.weight ?? 1) <= 0) return e;
        return pool[pool.length - 1];
    }

    /**
     * A site (a fort: its gate, court, keep and interior camps, KINGDOM.md "Forts") is cleared when
     * every one of its camps has fallen, inside and out: whoever is near is told, once a clearing.
     */
    siteCheck(site, nowS) {
        const camps = [...this.camps.values()].filter(c => c.def.site === site);
        if (!camps.length || camps.some(c => c.mobs.size || !this.cellOf(c)?.clearedAt)) return;
        const since = Math.min(...camps.map(c => this.cellOf(c).clearedAt));
        this._sitesDone = this._sitesDone || {};
        if ((this._sitesDone[site] || 0) >= since) return;
        this._sitesDone[site] = nowS;
        const where = camps.map(c => this.campCenter(c.def));
        for (const p of this.game.mmoWorldSystem.actors.values()) {
            if (p.kind !== 'player' || !where.some(c => Math.hypot(c.x - p.x, c.z - p.z) < 6000)) continue;
            this.call.mmoToast(p, `${site} cleared`, 'quest');
        }
        console.log(`[sites] ${site} cleared`);
        this.game.triggerEvent('onKdSiteCleared', { site });
    }

    /** Wake encounter-zone camps players come near; reset cleared ones nobody is visiting. */
    updateEncounters(players) {
        const nowS = Date.now() / 1000;
        const pl = players.filter(p => p.kind === 'player');
        for (const camp of this.camps.values()) {
            if (!camp.ez || camp.off) continue;
            const def = camp.def, wild = this.transient(def), c = this.campCenter(def);
            const wake = def.wake || (wild ? RpgMobSystem.WILD_WAKE : RpgMobSystem.EZ_WAKE);
            const near = pl.filter(p => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < wake * wake);
            const cell = this.cellOf(camp);
            if (!camp.populated) {
                if (!near.length) continue;
                if (wild && camp.quietUntil > nowS) continue;                             // rolled nothing a moment ago
                if (cell?.clearedAt) {                                                   // cleared: stays empty until reset
                    if (nowS - cell.clearedAt < (def.reset ?? (wild ? RpgMobSystem.WILD_RESET : RpgMobSystem.EZ_RESET))) continue;
                    this.dropCell(camp);
                }
                camp.level = this.ezLevel(camp, near);
                if (wild) {
                    camp.pick = this.rollTable(camp, camp.level);
                    if (!camp.pick) { camp.quietUntil = nowS + (def.quiet ?? RpgMobSystem.WILD_QUIET); camp.mem = null; continue; }
                }
                this.populateCamp(camp);
                camp.seenAt = nowS;
                continue;
            }
            if (camp.mobs.size === 0 && cell && !cell.clearedAt) {                       // the last of them fell
                cell.clearedAt = nowS;
                if (!wild) this.call.kdTouch();
                this.game.triggerEvent('onKdCampCleared', { camp: def.id });
                if (def.site) this.siteCheck(def.site, nowS);
            }
            if (camp.mobs.size === 0 && !near.length) { camp.populated = false; continue; }   // left alone: may reset later
            if (!wild || camp.mobs.size === 0) continue;
            // a wild point's creatures go when nobody has been near for a while (and none is fighting)
            const gone = RpgMobSystem.WILD_GONE;
            if (pl.some(p => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < gone * gone)) { camp.seenAt = nowS; continue; }
            if (nowS - (camp.seenAt || nowS) < RpgMobSystem.WILD_LINGER) continue;
            if ([...camp.mobs].some(id => this.call.mmoActor(id)?.threat?.size)) continue;
            for (const id of camp.mobs) { const m = this.call.mmoActor(id); if (m && !m.dead) this.call.mmoDespawnActor(id); }
            camp.mobs.clear();
            camp.populated = false;
            camp.mem = null;                                                             // rolls afresh next time
        }
    }

    /** The creature and level for a spot in an encounter-zone camp. */
    ezPick(camp, spot) {
        const def = camp.def, member = spot.member || {};
        let level = camp.level || def.fixed || 1;
        if (member.boss) level += 2;
        else if (!def.fixed && Math.random() < 0.35) level -= 1;                       // a little spread in a pack
        const entry = camp.pick || {};
        const byLevel = (roster) => (roster.find(r => r.upTo == null || level <= r.upTo) || roster[roster.length - 1]).mob;
        const roster = member.roster || entry.roster || def.roster;
        let mob = member.mob || entry.mob;
        if (!mob && roster?.length) mob = byLevel(roster);
        return { mob: mob || def.mob, level: Math.max(1, level) };
    }

    /** spot: { pack, x, z, slot } — every creature has a fixed spawn point in a pack. */
    spawnMob(camp, spot) {
        const def = camp.def;
        const pick = camp.ez ? this.ezPick(camp, spot) : null;
        const mobId = pick?.mob || def.mob;
        const m = this.call.mmoMob(mobId);
        if (!m) { console.warn('[mobs] unknown mob', mobId); return null; }
        const [lo, hi] = m.levels || [1, 1];
        const level = pick ? pick.level : lo + Math.floor(Math.random() * (hi - lo + 1));
        const st = this.call.mmoMobStats(mobId, level);
        // a paper-doll creature (m.doll: one look, or a list to pick from per spawn) is drawn
        // like a doll NPC: that race's body for the class, in its gear
        const doll = Array.isArray(m.doll) ? m.doll[Math.floor(Math.random() * m.doll.length)] : m.doll;
        const a = this.call.mmoSpawnActor({
            kind: 'mob', name: spot.member?.name || m.title, unit: doll ? `doll_${doll.race}_${doll.sex}_${doll.class}` : m.unit, mobId, level, elite: !!(m.elite || spot.member?.boss),
            hostility: def.friendlyWhen && this.call.kdTest(def.friendlyWhen) ? 'friendly' : m.hostility, x: spot.x, z: spot.z, facing: Math.random() * Math.PI * 2, speed: st.speed
        });
        if (doll) { a.npcDoll = doll; a.classId = doll.class; }
        if (spot.member?.pose) { a.pose = spot.member.pose; a.sitting = a.pose !== 'sleep'; a.lying = a.pose === 'sleep'; }        // asleep or sitting at its post
        if (spot.member?.facing != null) a.facing = spot.member.facing;
        const roam = spot.member?.roam ?? camp.pick?.roam ?? def.roam;
        if (roam) { a.roam = roam; a.roamHome = { x: spot.x, z: spot.z }; }
        if (m.timid) a.timid = true;
        a.campId = def.id;
        a.packId = spot.pack;
        a.spot = spot;
        a.home = { x: spot.x, z: spot.z };
        a.maxHp = st.maxHp; a.hp = st.maxHp;
        a.armor = st.armor;
        a.weapon = st.weapon;
        a.aggroRadius = m.aggroRadius || 0;
        a.spells = (m.spells || []).slice();
        a.threat = new Map();
        a.state = 'idle';
        a.nextWander = this.now() + 2 + Math.random() * 8;
        a.wanderTarget = null;
        a.nextSpellCheck = 0;
        a.stuckFor = 0;
        camp.mobs.add(a.id);
        return a;
    }

    // ==================== TICK ====================

    update() {
        if (!this.game.isServer) return;
        const now = this.now();
        const dt = this.game.state.deltaTime || 0.05;

        this._aggroAccum += dt;
        const scanAggro = this._aggroAccum >= 0.3;
        if (scanAggro) this._aggroAccum = 0;

        // Creatures with no player anywhere near are dormant: no wandering, no aggro scans
        // (thousands of them across the continent; only the few by players need to think).
        const players = [];
        for (const o of this.call.mmoActors().values()) if (o.kind === 'player' || o.kind === 'escort') players.push(o);
        const R2 = RpgMobSystem.AWAKE_RADIUS * RpgMobSystem.AWAKE_RADIUS;
        const awake = (a) => players.some(p => (p.x - a.x) ** 2 + (p.z - a.z) ** 2 < R2);
        this._ezAccum = (this._ezAccum || 0) + dt;
        if (this._ezAccum >= 1) { this._ezAccum = 0; this.updateEncounters(players); }
        for (const a of [...this.call.mmoActors().values()]) {
            if (a.kind !== 'mob') continue;
            if (a.dead) { this.updateCorpse(a, now); continue; }
            if (a.evading) { this.updateEvade(a, dt); continue; }
            if (a.threat.size) this.updateCombat(a, now, dt);
            else {
                if (a.inCombat) this.resetCombatState(a);
                if (!awake(a)) { if (a.moving) { a.moving = false; a.wanderTarget = null; } continue; }
                this.updateIdle(a, now, dt, scanAggro);
            }
        }

        // Respawns
        for (const camp of this.camps.values()) {
            if (!camp.respawns.length || camp.off) continue;
            const due = camp.respawns.filter(r => r.at <= now);
            if (!due.length) continue;
            camp.respawns = camp.respawns.filter(r => r.at > now);
            for (const r of due) this.spawnMob(camp, r.spot);
        }
    }

    updateIdle(a, now, dt, scanAggro) {
        a.autoAttack = false;
        a.target = null;
        if (a.timid && this.updateWary(a, now, dt, scanAggro)) return;

        if (scanAggro && a.hostility === 'hostile' && a.aggroRadius > 0) {
            const victim = this.findAggroTarget(a);
            if (victim) {
                this.call.mmoAddThreat(a, victim, 1);
                return;
            }
            if (a.suspicious) { a.moving = false; a.wanderTarget = null; return; }   // stops and stares
        }

        // Gone to look at a noise: walk there, look about, go back to the post.
        if (a.investigate) {
            const iv = a.investigate;
            if (now > iv.until) { a.investigate = null; a.wanderTarget = null; a.returning = true; }
            else {
                const there = this.moveToward(a, iv.x, iv.z, a.speed * 0.6, dt, 30);
                if (there) { a.moving = false; if (!iv.arrived) { iv.arrived = true; iv.until = Math.min(iv.until, now + 6); } }
                return;
            }
        }
        if (a.returning) {
            if (this.moveToward(a, a.home.x, a.home.z, a.speed * 0.5, dt, 12)) { a.returning = false; if (a.spot?.member?.facing != null) a.facing = a.spot.member.facing; this.game.mmoWorldSystem.syncTransform(a); }
            return;
        }
        // On patrol: walk the loop, a few seconds at each point.
        const route = a.spot?.member?.patrol;
        if (route?.length) {
            a.patrolI = a.patrolI || 0;
            if (a.patrolWait && now < a.patrolWait) { a.moving = false; return; }
            const [px, pz] = route[a.patrolI % route.length];
            if (this.moveToward(a, px, pz, a.speed * 0.42, dt, 14)) { a.patrolI++; a.patrolWait = now + 2.5 + Math.random() * 2; a.moving = false; }
            return;
        }
        // Wander a little around home (not one sitting or asleep, or a sentry holding its post).
        if (a.pose || a.spot?.member?.post) {
            a.moving = false;
            const f = a.spot?.member?.facing;
            if (f != null && Math.abs(a.facing - f) > 0.01 && !a.suspicious) { a.facing = f; this.game.mmoWorldSystem.syncTransform(a); }
            return;
        }
        if (a.wanderTarget) {
            // a stroll never path-finds: blocked, it just stops and picks another spot later
            const done = this.moveToward(a, a.wanderTarget.x, a.wanderTarget.z, a.speed * (a.roam ? 0.45 : 0.35), dt, 4, true);
            if (done || !a.moving) a.wanderTarget = null;
        } else {
            a.moving = false;
            if (now >= a.nextWander) {
                // a roamer ranges about its spawn point; anyone else shuffles about its post
                a.nextWander = now + (a.roam ? 3 + Math.random() * 9 : 6 + Math.random() * 10);
                const ang = Math.random() * Math.PI * 2, c = a.roamHome || a.home;
                const r = a.roam ? 80 + Math.random() * a.roam : 15 + Math.random() * 45;
                const x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
                if (this.call.mmoCanStep(a.x, a.z, x, z)) a.wanderTarget = { x, z };
            }
        }
    }

    // ==================== AWARENESS ====================
    //
    // Creatures don't spot you the instant you're in range. Each scan (0.3 s) a creature's
    // awareness of the players it can see grows, faster the closer they are, and fades when it
    // can't; at 1 it attacks. It sees AWARE_CONE either side of where it faces; behind, only
    // close up. Sneaking (MMO_SNEAK) shrinks how far it sees you; one asleep or sitting at its
    // post (a pack member's `pose`) is easier still to slip past. Half aware, it stops and turns
    // to look (`suspicious`: a "?" over its head).

    static AWARE_CONE = 1.15;            // radians either side of facing
    static BEHIND = 0.35;                // sight range behind it, as a share
    static SNEAK = 0.45;                 // sight range of a sneaking player, as a share
    static POSE = { sleep: 0.25, sit: 0.7 };
    static NOTICE = 0.6;                 // seconds to notice someone standing right in front

    findAggroTarget(a) {
        const scan = 0.3, levelF = (p) => Math.max(0.5, Math.min(1.25, 1 + (a.level - p.level) * 0.06));
        let best = null, bestAware = 0;
        a.aware = a.aware || new Map();
        const seen = new Set();
        for (const p of this.call.mmoNearbyActors(a.x, a.z, a.aggroRadius * 1.6, o => o.kind === 'player' && !o.dead)) {
            if (Math.abs(p.y - a.y) >= 40) continue;
            const dx = p.x - a.x, dz = p.z - a.z, d = Math.hypot(dx, dz);
            let off = Math.abs(Math.atan2(dz, dx) - a.facing) % (Math.PI * 2);
            if (off > Math.PI) off = Math.PI * 2 - off;
            let R = a.aggroRadius * levelF(p) * (off <= RpgMobSystem.AWARE_CONE ? 1 : RpgMobSystem.BEHIND);
            if (p.sneaking) {
                // gear: Fortify Sneak and the Glass Mask hide you; heavy armor clanks (KINGDOM.md "Gear")
                const cs = this.game.mmoCombatSystem;
                R *= RpgMobSystem.SNEAK * Math.max(0.4, 1 - (this.call.mmoSkill(p.char, 'sneak') - 15) / 140)
                    * Math.max(0.3, 1 - cs.statSum(p, 'skill_sneak') - cs.statSum(p, 'sneakHide')) * (1 + cs.statSum(p, 'sneakNoise'));
            }
            R *= RpgMobSystem.POSE[a.pose] || 1;
            R *= this.sightOf(a);
            if (d > R) { if (p.sneaking && d < R * 3 && !(a.aware.get(p.id) > 0.3)) this.call.mmoSkillUse(p, 'sneak', 0.12); continue; }      // unseen, close: practice
            seen.add(p.id);
            const gain = scan / RpgMobSystem.NOTICE * (1.6 - d / R) * (p.sneaking ? 0.5 : 1);
            const v = Math.min(1, (a.aware.get(p.id) || 0) + gain);
            a.aware.set(p.id, v);
            if (v > bestAware) { bestAware = v; best = p; }
        }
        for (const [id, v] of a.aware) if (!seen.has(id)) { const n = v - scan * 0.25; if (n <= 0) a.aware.delete(id); else a.aware.set(id, n); }
        const wasSuspicious = a.suspicious;
        a.suspicious = bestAware >= 0.35 && bestAware < 1;
        if (best && bestAware >= 0.35) {
            a.facing = Math.atan2(best.z - a.z, best.x - a.x);                     // turns to look
            if (a.pose && bestAware >= 0.6) { a.pose = null; a.sitting = false; a.lying = false; }   // gets up
            this.game.mmoWorldSystem.syncTransform(a);
        }
        if (a.suspicious !== wasSuspicious) a.ver++;
        return bestAware >= 1 ? best : null;
    }

    /** A camp's sight while its conditions hold (`sight: [{ when, mult }]`), refreshed with the world. */
    sightOf(a) {
        const camp = this.camps.get(a.campId);
        if (!camp?.def.sight) return 1;
        if (camp.sightRev !== this._worldRev) {
            camp.sightRev = this._worldRev;
            camp.sightMult = camp.def.sight.reduce((m, s) => m * (!s.when || this.call.kdTest(s.when) ? s.mult : 1), 1);
        }
        return camp.sightMult;
    }

    /** A noise at (x, z): idle creatures within r go to look (and come back after). */
    mmoNoise(x, z, r = 600) {
        const now = this.now();
        for (const a of this.call.mmoNearbyActors(x, z, r, o => o.kind === 'mob' && !o.dead && !o.threat?.size && o.hostility === 'hostile')) {
            a.investigate = { x: x + (Math.random() - 0.5) * 80, z: z + (Math.random() - 0.5) * 80, until: now + 20 };
            a.pose = null; a.sitting = false; a.lying = false; a.suspicious = true; a.wanderTarget = null; a.ver++;
        }
    }

    /** How aware the creatures near a player are of them (0..1), for the HUD's eye. */
    mmoAwareOf(p) {
        let top = 0;
        for (const a of this.call.mmoNearbyActors(p.x, p.z, 1200, o => o.kind === 'mob' && !o.dead)) {
            if (a.threat?.has(p.id)) return 1;
            top = Math.max(top, a.aware?.get(p.id) || 0);
        }
        return top;
    }

    /** Called by combat whenever a mob gains a threat entry (first pull). */
    onMobEngaged(a, attacker) {
        if (a.state === 'combat') return;
        a.state = 'combat';
        a.wanderTarget = null;
        a.combatStart = this.now();
        a.nextSpellCheck = this.now() + 1.5 + Math.random() * 2;
        a.suspicious = false; a.pose = null; a.sitting = false; a.lying = false; a.investigate = null; a.returning = false; a.ver++;
        if (a.roam) a.home = { x: a.x, z: a.z };                 // a roamer's leash runs from where the fight began
        const m = this.call.mmoMob(a.mobId);
        if (m?.social) {
            // Social aggro pulls packmates close by; the rest of the camp hears it and comes to
            // look (aware of whoever started it, not yet fighting): a quiet kill stays quiet.
            for (const o of this.call.mmoNearbyActors(a.x, a.z, 650, x => x.kind === 'mob' && !x.dead && !x.evading && x.campId === a.campId && x !== a)) {
                if (o.threat.size || !attacker) continue;
                const d = Math.hypot(o.x - a.x, o.z - a.z);
                if (o.packId === a.packId && d < 220) this.call.mmoAddThreat(o, attacker, 1);
                else if (attacker.kind === 'player') { o.aware = o.aware || new Map(); o.aware.set(attacker.id, Math.max(o.aware.get(attacker.id) || 0, d < 400 ? 0.7 : 0.45)); }
            }
        }
    }

    pickTarget(a, now) {
        if (a.tauntedBy != null && now < a.tauntUntil) {
            const t = this.call.mmoActor(a.tauntedBy);
            if (t && !t.dead) return t;
        }
        let best = null, bestT = -1;
        for (const [id, threat] of a.threat) {
            const t = this.call.mmoActor(id);
            if (!t || t.dead || t.kind !== 'player') { a.threat.delete(id); continue; }
            if (Math.hypot(t.x - a.home.x, t.z - a.home.z) > this.cfg.leashDistance + 400) { a.threat.delete(id); continue; }
            // A new target must beat the current one by 10% (melee) to pull aggro.
            const cur = id === a.target ? threat * 1.1 : threat;
            if (cur > bestT) { bestT = cur; best = t; }
        }
        return best;
    }

    // ==================== TIMID ANIMALS ====================
    //
    // A timid creature (mob `timid: true`: deer, goats) never fights. It bolts from a player who
    // comes too close (less far if they sneak), and from anyone who hurts it, until it's well
    // away; then it settles and grazes where it stopped.

    static WARY = 420;                   // how close a walking player can come before it bolts
    static BOLT = 7;                     // seconds it runs

    /** Idle: is anyone too close? Starts or continues a bolt. Returns true while bolting. */
    updateWary(a, now, dt, scanAggro) {
        if (a.boltUntil > now) { this.bolt(a, dt); return true; }
        if (!scanAggro) return false;
        for (const p of this.call.mmoNearbyActors(a.x, a.z, RpgMobSystem.WARY, o => o.kind === 'player' && !o.dead)) {
            const r = RpgMobSystem.WARY * (p.sneaking ? RpgMobSystem.SNEAK * 0.7 : 1);
            if (Math.hypot(p.x - a.x, p.z - a.z) > r) continue;
            this.startBolt(a, p, now);
            return true;
        }
        return false;
    }

    startBolt(a, from, now) {
        const ang = Math.atan2(a.z - from.z, a.x - from.x) + (Math.random() - 0.5) * 0.6;
        a.boltUntil = now + RpgMobSystem.BOLT;
        a.boltDir = ang;
        a.wanderTarget = null; a.pose = null; a.sitting = false; a.lying = false; a.suspicious = false;
        a.ver++;
    }

    bolt(a, dt) {
        for (const off of [0, 0.6, -0.6, 1.2, -1.2, 2]) {
            const ang = a.boltDir + off, x = a.x + Math.cos(ang) * 120, z = a.z + Math.sin(ang) * 120;
            if (!this.call.mmoCanStep(a.x, a.z, x, z)) continue;
            if (off) a.boltDir = ang;
            this.moveToward(a, x, z, a.speed * 1.35, dt, 4, true);
            return;
        }
        a.moving = false;
    }

    updateCombat(a, now, dt) {
        if (a.timid) {                                     // hurt: it runs, and stops counting it a fight once away
            const src = [...a.threat.keys()].map(id => this.call.mmoActor(id)).find(t => t && !t.dead);
            if (!src || now > (a.boltUntil || 0) + 2) { a.threat.clear(); this.resetCombatState(a); a.home = { x: a.x, z: a.z }; a.roamHome = a.home; return; }
            if (!(a.boltUntil > now)) this.startBolt(a, src, now);
            this.bolt(a, dt);
            return;
        }
        a.state = 'combat';
        // Keep everything on the threat table in combat.
        for (const id of a.threat.keys()) {
            const p = this.call.mmoActor(id);
            if (p && p.kind === 'player') { p.inCombat = true; p.combatUntil = Math.max(p.combatUntil || 0, now + 2); }
        }

        if (Math.hypot(a.x - a.home.x, a.z - a.home.z) > this.cfg.leashDistance) return this.startEvade(a);
        const t = this.pickTarget(a, now);
        if (!t) return this.startEvade(a);

        a.target = t.id;
        a.autoAttack = true;
        if (a.cast) { a.moving = false; return; }
        const stunned = this.game.mmoCombatSystem.hasStat(a, 'stun');
        if (stunned) { a.moving = false; return; }

        // Spells
        if (now >= a.nextSpellCheck && a.spells.length && !(a.silencedUntil > now)) {
            a.nextSpellCheck = now + 1 + Math.random() * 1.5;
            for (const sid of a.spells) {
                const sp = this.call.mmoSpell(sid);
                if (!sp || (a.cooldowns[sid] || 0) > now) continue;
                const healSpell = (sp.effects || []).some(e => e.type === 'heal');
                if (healSpell && a.hp / a.maxHp > 0.5) continue;
                const range = this.call.mmoSpellRange(sp, a.weapon.range);
                if (sp.target === 'enemy' && this.call.mmoDistance(a, t) > range) continue;
                if (sp.target === 'self' && sp.aoe && !healSpell && this.call.mmoDistance(a, t) > sp.aoe.radius - 20) continue;
                if (Math.random() < 0.55) {
                    a.moving = false;
                    if (this.call.mmoCastSpell(a, sid, t.id)) return;
                }
            }
        }

        // Chase into weapon range.
        const reach = a.weapon.ranged ? Math.max(a.weapon.range, 200) * 0.9 : this.cfg.meleeRange * 0.7;
        const dist = this.call.mmoDistance(a, t);
        const rooted = this.game.mmoCombatSystem.hasStat(a, 'root');
        if (dist > reach && !rooted) {
            const speed = this.game.mmoCombatSystem.moveSpeedOf(a) * (a.weapon.ranged ? 1 : 1.05);
            const before = { x: a.x, z: a.z };
            this.moveToward(a, t.x, t.z, speed, dt, reach * 0.5);
            const progressed = Math.hypot(a.x - before.x, a.z - before.z) > speed * dt * 0.2;
            a.stuckFor = progressed ? 0 : a.stuckFor + dt;
            if (a.stuckFor > 3) return this.startEvade(a);
        } else {
            a.moving = false;
            a.stuckFor = 0;
            a.facing = Math.atan2(t.z - a.z, t.x - a.x);
            this.game.mmoWorldSystem.syncTransform(a);
        }
    }

    resetCombatState(a) {
        a.inCombat = false;
        a.autoAttack = false;
        a.target = null;
        a.state = 'idle';
        a.tapper = null;
        a.tapParty = null;
        a.tauntedBy = null;
    }

    startEvade(a) {
        a.evading = true;
        a.state = 'evading';
        a.threat.clear();
        a.autoAttack = false;
        a.target = null;
        a.cast = null;
        a.auras = [];
        a.combo = { target: null, points: 0 };
        a.ver++;
        this.call.mmoEmit({ t: 'evade', id: a.id }, a.x, a.z);
    }

    updateEvade(a, dt) {
        const before = { x: a.x, z: a.z };
        const done = this.moveToward(a, a.home.x, a.home.z, a.speed * 1.6, dt, 6);
        const moved = Math.hypot(a.x - before.x, a.z - before.z) > 0.5;
        a.evadeStuck = moved ? 0 : (a.evadeStuck || 0) + dt;
        if (!done && a.evadeStuck > 2.5) {
            // No way home on foot: put it back.
            a.x = a.home.x; a.z = a.home.z;
            a.y = this.call.mmoGroundY(a.x, a.z);
            this.game.mmoWorldSystem.syncTransform(a);
        }
        if (done || a.evadeStuck > 2.5) {
            a.evading = false;
            a.evadeStuck = 0;
            a.path = null;
            a.hp = a.maxHp;
            this.resetCombatState(a);
            a.ver++;
        }
    }

    /**
     * Walk toward (tx, tz). Goes straight when the line is clear, otherwise
     * follows an A* path (MmoGameSystem.mmoFindPath) over the tile grid, which
     * knows about ramps, cliffs and buildings. Re-plans when the target moves
     * or the plan is old. Returns true when within `stopAt` of the target.
     */
    moveToward(a, tx, tz, speed, dt, stopAt = 4, directOnly = false) {
        const d = Math.hypot(tx - a.x, tz - a.z);
        if (d <= stopAt) { a.moving = false; a.path = null; return true; }
        const now = this.now();

        // Is the straight line clear? (cached briefly; it's a terrain walk)
        if (a._directAt == null || now - a._directAt > 0.3 || Math.hypot(tx - a._directX, tz - a._directZ) > 30) {
            a._directAt = now; a._directX = tx; a._directZ = tz;
            a._direct = this.call.mmoCanStep(a.x, a.z, tx, tz);
        }

        let wx = tx, wz = tz;
        if (!a._direct && directOnly) { a.moving = false; return false; }
        if (!a._direct) {
            const stale = !a.path || now - a.pathAt > 1.5 || Math.hypot(tx - a.pathGoal.x, tz - a.pathGoal.z) > 96;
            if (stale) {
                a.path = this.call.mmoFindPath(a.x, a.z, tx, tz);
                a.pathAt = now;
                a.pathGoal = { x: tx, z: tz };
            }
            if (!a.path?.length) { a.moving = false; return false; }   // unreachable: caller's stuck timer decides
            while (a.path.length > 1 && Math.hypot(a.path[0].x - a.x, a.path[0].z - a.z) < 14) a.path.shift();
            wx = a.path[0].x; wz = a.path[0].z;
        } else {
            a.path = null;
        }

        const wd = Math.hypot(wx - a.x, wz - a.z);
        const step = Math.min(Math.max(0, (wx === tx && wz === tz) ? d - stopAt * 0.5 : wd), speed * dt);
        const dirAng = Math.atan2(wz - a.z, wx - a.x);
        for (const off of [0, 0.5, -0.5, 1.0, -1.0]) {
            const ang = dirAng + off;
            const nx = a.x + Math.cos(ang) * step, nz = a.z + Math.sin(ang) * step;
            if (this.call.mmoCanStep(a.x, a.z, nx, nz)) {
                a.x = nx; a.z = nz;
                a.y = this.call.mmoGroundY(nx, nz);
                a.facing = ang;
                a.moving = true;
                a.lastMoveAt = now;
                this.game.mmoWorldSystem.syncTransform(a);
                return false;
            }
        }
        a.moving = false;
        a.path = null;            // blocked mid-path: re-plan next tick
        a._directAt = null;
        return false;
    }

    // ==================== DEATH, CREDIT & LOOT ====================

    /** Players who get credit for a mob: the tapper, or their party members nearby. */
    mmoCreditedPlayers(mob) {
        const tapper = this.call.mmoActor(mob.tapper);
        if (!tapper) return [];
        const party = this.game.mmoPartySystem;
        const members = party ? party.membersOf(tapper) : [tapper];
        return members.filter(p => p === tapper || (p && !p.dead && Math.hypot(p.x - mob.x, p.z - mob.z) <= this.cfg.xpShareRadius));
    }

    onMmoKill({ victim, killer }) {
        if (victim.kind !== 'mob') return;
        const m = this.call.mmoMob(victim.mobId);
        victim.loot = {};
        const credited = victim.tapper != null ? this.mmoCreditedPlayers(victim) : [];
        const quests = this.game.mmoQuestSystem;
        for (const p of credited) {
            const loot = { money: 0, items: [] };
            const [gmin, gmax] = m.loot?.gold || [0, 0];
            loot.money = Math.round((gmin + Math.random() * (gmax - gmin)) / Math.max(1, credited.length));
            for (const drop of m.loot?.items || []) {
                if (drop.quest && !quests?.needsItem(p, drop.id)) continue;
                if (Math.random() < drop.chance) loot.items.push({ id: drop.id, n: 1 });
            }
            // champions and bosses carry gear worth having: a random plain piece for the level (mob `loot.gear`: the chance)
            const gearChance = m.loot?.gear ?? (victim.elite ? 0.4 : 0);
            if (gearChance && Math.random() < gearChance) { const g = this.call.mmoRandomGear(victim.level); if (g) loot.items.push({ id: g, n: 1 }); }
            const mat = this.game.mmoProfessionSystem?.materialDrop(victim, m);      // cloth, leather, dust for the professions
            if (mat && this.call.mmoItem(mat.id)) loot.items.push(mat);
            loot.empty = !loot.money && !loot.items.length;
            victim.loot[p.id] = loot;
        }
        const camp = this.camps.get(victim.campId);
        if (camp) {
            camp.mobs.delete(victim.id);
            if (!camp.ez) camp.respawns.push({ at: this.now() + (m.respawn || 45), spot: victim.spot });     // lairs stay cleared
        }
    }

    updateCorpse(a, now) {
        const anyLoot = a.loot && Object.values(a.loot).some(l => !l.empty);
        const lifetime = anyLoot ? this.cfg.corpseTime : 20;
        if (now - a.diedAt > lifetime) this.call.mmoDespawnActor(a.id);
    }

    openLoot(p, mobId) {
        const mob = this.call.mmoActor(mobId);
        if (!mob || mob.kind !== 'mob' || !mob.dead) return;
        const loot = mob.loot?.[p.id];
        if (!loot || loot.empty) return this.call.mmoSend(p.socketId, 'MMO_ERROR', { text: 'You have no loot on that corpse.' });
        if (Math.hypot(mob.x - p.x, mob.z - p.z) > this.cfg.lootRange + 40) return this.call.mmoSend(p.socketId, 'MMO_ERROR', { text: 'You are too far away.' });
        this.call.mmoSend(p.socketId, 'MMO_LOOT', { id: mob.id, name: mob.name, money: loot.money, items: loot.items });
        this.call.mmoEmit({ t: 'act', s: p.id, an: 'loot' }, p.x, p.z);
    }

    takeLoot(p, mobId, index) {
        const mob = this.call.mmoActor(mobId);
        const loot = mob?.loot?.[p.id];
        if (!loot || loot.empty) return;
        if (Math.hypot(mob.x - p.x, mob.z - p.z) > this.cfg.lootRange + 60) return;
        const takeAll = index == null || index === 'all';
        if ((takeAll || index === 'money') && loot.money) {
            this.call.mmoAddMoney(p, loot.money);
            this.call.mmoSend(p.socketId, 'MMO_LOOT_MSG', { money: loot.money });
            loot.money = 0;
        }
        const indices = takeAll ? loot.items.map((_, i) => i) : (Number.isInteger(index) ? [index] : []);
        for (const i of indices.sort((x, y) => y - x)) {
            const it = loot.items[i];
            if (!it) continue;
            const given = this.call.mmoGiveItem(p, it.id, it.n);
            if (given >= it.n) loot.items.splice(i, 1);
            else it.n -= given;
        }
        loot.empty = !loot.money && !loot.items.length;
        this.call.mmoSend(p.socketId, 'MMO_LOOT', { id: mob.id, name: mob.name, money: loot.money, items: loot.items, closed: loot.empty ? 1 : 0 });
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.RpgMobSystem = RpgMobSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.RpgMobSystem = RpgMobSystem; }
export default RpgMobSystem;
export { RpgMobSystem };
