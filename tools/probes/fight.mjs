// Fight probe (preloaded by probe.mjs, run in the game's folder), with PROBE_OUT=<file>.
// Seeds Math.random before the game loads, stops the engine's timer loop and drives ticks by count,
// so a run is the same every time. A fake player enters (ENTER_JSON), then fights the first mobs
// in turn: targets one, stands beside it, swings (MMO_HAND) and auto-attacks (MMO_ATTACK) for a
// while. Every world event (hits, misses, deaths, auras...) is logged with its tick; at the end the
// log's hash and per-kind counts are written.
import { writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import path from 'path';
import { whenWorldReady } from './hook.mjs';

let seed = 987654321;
Math.random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
let probeTick = 0;
Date.now = () => 1767225600000 + probeTick * 50;          // the game's clock moves with the ticks

const enginePath = pathToFileURL(path.join(process.cwd(), 'node_modules/guts/engine/ServerEngine.js')).href;
const { default: ServerEngine } = await import(enginePath);
ServerEngine.prototype.gameLoop = function () { };          // ticks come from the probe

whenWorldReady(async (game) => {
    const engine = global.serverEngine, room = [...engine.gameRooms.values()][0];
    let tick = 0;
    const step = async (n) => { for (let i = 0; i < n; i++) { tick++; probeTick = tick; room.update(engine.tickRate); await new Promise(r => setImmediate(r)); } };
    const ws = game.mmoWorldSystem, bus = game.serverEventManager, log = [];
    const emit = ws.netEmit.bind(ws);
    ws.netEmit = (evt, x, z, only) => { log.push([tick, evt]); return emit(evt, x, z, only); };
    const send = (name, data) => bus.emit(name, { playerId: 'probe', eventName: name, data, socket: null, networkManager: null });

    await step(40);
    send('MMO_ENTER', JSON.parse(process.env.ENTER_JSON || '{"name":"Fightprobe","create":true,"profile":true,"classId":"barbarian"}'));
    await step(40);
    const me = ws.netActor(ws.sessions.get('probe')?.actorId);
    if (!me) { writeFileSync(process.env.PROBE_OUT, JSON.stringify({ error: 'no player' })); process.exit(0); }
    send('MMO_RESYNC', {});
    await step(10);
    const ms = game.mmoMobSystem;
    const camps = [...ms.camps.values()].filter(c => c.def?.mob || c.def?.packs?.length).sort((a, b) => String(a.def.id).localeCompare(String(b.def.id)));
    const centerOf = (c) => ms.campCenter?.(c.def) || (c.def.x != null ? { x: c.def.x, z: c.def.z } : c.def.packs?.[0]?.members?.[0] ? { x: c.def.packs[0].members[0].x, z: c.def.packs[0].members[0].z } : null);
    let fights = 0;
    for (const c of camps) {
        if (fights >= Number(process.env.FIGHTS || 4)) break;
        const at = centerOf(c);
        if (!at) continue;
        ws.netTeleport(me, at.x + 300, at.z, Math.PI);
        await step(30);
        const m = [...ws.netActors().values()].filter(a => a.kind === 'mob' && !a.dead && Math.hypot(a.x - me.x, a.z - me.z) < 1200).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z) || a.id - b.id)[0];
        if (!m) continue;
        fights++;
        log.push([tick, { t: 'probe_fight', camp: c.def.id, mob: m.mobId }]);
        ws.netTeleport(me, m.x + 45, m.z, Math.PI);
        me.hp = me.maxHp; me.dead = false;
        await step(5);
        send('MMO_TARGET', { id: m.id });
        send('MMO_ATTACK', { on: true });
        for (let k = 0; k < 30; k++) {
            const f = Math.atan2(m.z - me.z, m.x - me.x);
            send('MMO_HAND', { hand: 'right', down: true, f, target: m.id });
            await step(2);
            send('MMO_HAND', { hand: 'right', down: false, f, target: m.id });
            await step(14);
            if (m.dead || me.dead) break;
        }
        send('MMO_ATTACK', { on: false });
        log.push([tick, { t: 'probe_end', mob: m.mobId, mobHp: m.hp, mobDead: !!m.dead, meHp: me.hp, meDead: !!me.dead }]);
        await step(20);
    }
    const norm = JSON.stringify(log).replace(/g_[a-z0-9]{8,}/g, 'g_ID');
    const kinds = {};
    for (const [, e] of log) kinds[e.t] = (kinds[e.t] || 0) + 1;
    const res = { ticks: tick, events: log.length, hash: createHash('sha1').update(norm).digest('hex').slice(0, 16), kinds, ends: log.filter(([, e]) => e.t === 'probe_end').map(([, e]) => e) };
    writeFileSync(process.env.PROBE_OUT, JSON.stringify({ ...res, log: JSON.parse(norm) }));
    console.log('[fightprobe]', JSON.stringify(res));
    process.exit(0);
});
