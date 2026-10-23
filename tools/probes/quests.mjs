// Quest probe (run by probe.mjs against a dev server, REALM_DEV=1): a new character visits every NPC it can see, in name
// order: their dialog (quests offered/active, talk topics, vendor, trainer, inn), accepts what's
// offered, tries to turn in, buys a vendor's first item and sells it back. Prints a normalized log
// (no ids, no times) to compare two builds.
//   GAME_PKG=<package.json> REALM_URL=... ENTER_JSON=<ENTER_WORLD data> node quests.mjs
import { createRequire } from 'module';
const require = createRequire(process.env.GAME_PKG);
const { io } = require('socket.io-client');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const s = io(process.env.REALM_URL, { transports: ['websocket'] });
const out = [];
const log = (...a) => out.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
let me = null, char = null, dialog = null, seq = 0;
const actors = new Map();
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'id' || k === 'npcId' && false) && typeof v === 'number' ? undefined : v));
s.on('connect', () => s.emit('ENTER_WORLD', JSON.parse(process.env.ENTER_JSON || '{"name":"Qprobe","classId":"barbarian","create":true,"profile":true}')));
s.on('MMO_ENTER_FAILED', d => { console.log('enter failed', d); process.exit(1); });
s.on('MMO_WELCOME', d => { me = d.actorId; });
s.on('MMO_CHAR', d => { char = d; });
s.on('MMO_CORRECT', d => { seq = d.seq; });
s.on('MMO_SNAPSHOT', d => { for (const i of d.add) actors.set(i.id, { ...(actors.get(i.id) || {}), info: i }); for (const r of d.dyn) { const a = actors.get(r[0]); if (a) { a.x = r[1]; a.z = r[2]; a.marker = r[7]; } } for (const id of d.gone) actors.delete(id); });
s.on('MMO_DIALOG', d => { dialog = d; });
s.on('MMO_ERROR', d => log('  error', d.text));
s.on('MMO_TOAST', d => log('  toast', d.text));
s.on('MMO_QUEST_UPDATE', d => log('  quest update', strip(d)));
s.on('MMO_LEVEL_UP', d => log('  level up', d.level));
s.on('MMO_LOOT_MSG', d => log('  loot', strip(d)));
for (let i = 0; i < 80 && !(me && char && actors.size); i++) await wait(100);
await wait(1500);
const npcs = [...actors.values()].filter(a => a.info.k === 'npc').sort((a, b) => (a.info.n + a.x).localeCompare(b.info.n + b.x));
log('npcs in sight', npcs.length, npcs.map(n => `${n.info.n}:${n.marker ?? 0}`).join(', '));
const visited = new Set();
for (const n of npcs) {
    if (visited.has(n.info.n)) continue;
    visited.add(n.info.n);
    const a = actors.get(n.info.id) || n;
    s.emit('MMO_CHAT', { channel: 'say', text: `.tele ${Math.round(a.x + 40)} ${Math.round(a.z)}` });
    await wait(500);
    dialog = null;
    s.emit('MMO_INTERACT', { id: n.info.id });
    for (let i = 0; i < 20 && !dialog; i++) await wait(50);
    if (!dialog) { log(n.info.n, 'no dialog'); continue; }
    const d = dialog;
    log(n.info.n, 'roles', d.roles, 'quests', d.quests, 'talk', d.talk ? (d.talk.topics || d.talk).length ?? d.talk : null, 'vendor', (d.vendor || []).length, 'trainer', (d.trainer || []).length, 'inn', d.inn || null);
    const q = d.quests || {};
    for (const qq of [].concat(q.available || q.offer || [])) { const id = qq.id || qq; s.emit('MMO_QUEST_ACCEPT', { quest: id, npc: d.npc }); await wait(200); log('  accepted', id); }
    for (const qq of [].concat(q.complete || q.ready || q.turnIn || [])) { const id = qq.id || qq; s.emit('MMO_QUEST_TURNIN', { quest: id, npc: d.npc, choice: 0 }); await wait(200); log('  turn in', id); }
    if (d.vendor?.length) { s.emit('MMO_BUY', { npc: d.npc, item: d.vendor[0].id, count: 1 }); await wait(300); s.emit('MMO_SELL', { npc: d.npc, index: (char?.bags?.length || 1) - 1 }); await wait(300); log('  bought+sold', d.vendor[0].id, 'money', char?.money); }
}
await wait(800);
log('final quests', char?.quests, 'completed', char?.completed, 'money', char?.money, 'level', char?.level, 'xp', char?.xp, 'bags', (char?.bags || []).map(b => b.id || b));
console.log(out.join('\n').replace(/g_[a-z0-9]{8,}/g, 'g_ID'));                // generated item ids differ per run
s.close(); process.exit(0);
