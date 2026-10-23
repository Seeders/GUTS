#!/usr/bin/env node
// Runs a probe against a multiplayer kit game, from the game's folder (after `npm run build`):
//
//   node node_modules/guts/tools/probes/probe.mjs <world|fight|quests> [--out f] [--base f]
//        [--port 3940] [--seed 777] [--build]
//
// Each run starts the game's server.js on fresh saves in a temp folder, with WORLD_SEED fixed.
// --out is where the result goes (default: the temp folder). --base compares with an earlier
// result: same or each difference, exit code 1 on a difference. --build runs `npm run build` first.
// How the probe's character enters comes from the game's package.json "gutsProbe": { "fight":
// {...MMO_ENTER data}, "quests": {...ENTER_WORLD data} } (default: a new barbarian; null drops
// a default field).
import { spawn, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, openSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import os from 'os';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const [kind, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) opt[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] == null ? true : rest[++i];
if (!['world', 'fight', 'quests'].includes(kind)) { console.log('usage: probe.mjs <world|fight|quests> [--out f] [--base f] [--port n] [--seed n] [--build]'); process.exit(2); }

const root = process.cwd();
if (!existsSync(path.join(root, 'server.js'))) { console.error('run it from a game folder (no server.js here)'); process.exit(2); }
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const game = path.basename(root);
const tmp = mkdtempSync(path.join(os.tmpdir(), `guts-probe-${game}-`));
const out = path.resolve(opt.out || path.join(tmp, `${kind}.${kind === 'quests' ? 'txt' : 'json'}`));
mkdirSync(path.dirname(out), { recursive: true });
const port = Number(opt.port || 3940);
const enter = { name: kind === 'quests' ? 'Qprobe' : 'Fightprobe', create: true, profile: true, classId: 'barbarian', ...(pkg.gutsProbe?.[kind] || {}) };
for (const k in enter) if (enter[k] === null) delete enter[k];                 // null drops a default
const env = { ...process.env, PORT: String(port), WORLD_SEED: String(opt.seed || 777), REALM_DEV: '1', REALM_SAVES: path.join(tmp, 'saves'), PROBE_OUT: out, ENTER_JSON: JSON.stringify(enter) };

if (opt.build) {
    const b = spawnSync('npm', ['run', 'build'], { cwd: root, shell: true, encoding: 'utf8' });
    if (b.status) { console.error(b.stdout.slice(-2000), b.stderr.slice(-2000)); process.exit(1); }
}

const logFile = out + '.log';
const server = (preload) => spawn(process.execPath, [...(preload ? ['--import', pathToFileURL(path.join(here, preload)).href] : []), 'server.js'], { cwd: root, env, stdio: ['ignore', openSync(logFile, 'w'), openSync(logFile, 'a')] });
const exited = (child, ms) => new Promise(res => { const t = setTimeout(() => { child.kill(); res('timeout'); }, ms); child.on('exit', (code) => { clearTimeout(t); res(code); }); });

if (kind === 'world' || kind === 'fight') {
    const code = await exited(server(`${kind}.mjs`), 900000);
    if (!existsSync(out)) { console.error(`${game} ${kind}: no result (exit ${code}), see ${logFile}`); process.exit(1); }
} else {
    const srv = server('steady.mjs');
    let up = false;
    for (let i = 0; i < 300 && !up; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const log = readFileSync(logFile, 'utf8');
        if (/running on/.test(log)) up = true;
        else if (/Failed to/.test(log) || srv.exitCode != null) break;
    }
    if (!up) { srv.kill(); console.error(`${game} quests: the server didn't start, see ${logFile}`); process.exit(1); }
    const q = spawnSync(process.execPath, [path.join(here, 'quests.mjs')], { cwd: root, env: { ...env, GAME_PKG: path.join(root, 'package.json'), REALM_URL: `http://localhost:${port}` }, encoding: 'utf8', timeout: 300000 });
    srv.kill();
    writeFileSync(out, q.stdout || '');
    if (q.status) { console.error(`${game} quests: probe exit ${q.status}`, (q.stderr || '').slice(-1000)); process.exit(1); }
}
const errors = (readFileSync(logFile, 'utf8').match(/^.*(TypeError|ReferenceError|Error:).*$/gm) || []);
console.log(`${game} ${kind}: ${out}${errors.length ? `  (${errors.length} error lines in the server log, first: ${errors[0].slice(0, 200)})` : ''}`);

if (!opt.base) process.exit(0);
let same = true;
if (kind === 'quests') {
    const a = readFileSync(opt.base, 'utf8').split('\n'), b = readFileSync(out, 'utf8').split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) {
        if (same) console.log(`${game} quests: DIFF`);
        same = false;
        console.log(`  line ${i + 1}\n    base: ${(a[i] ?? '').slice(0, 300)}\n    now:  ${(b[i] ?? '').slice(0, 300)}`);
    }
} else {
    const a = JSON.parse(readFileSync(opt.base, 'utf8')), b = JSON.parse(readFileSync(out, 'utf8'));
    if (kind === 'world') {
        for (const k of new Set([...Object.keys(a.hashes), ...Object.keys(b.hashes)])) if (a.hashes[k] !== b.hashes[k]) {
            same = false;
            const i = (a.out[k] || []).findIndex((v, j) => JSON.stringify(v) !== JSON.stringify(b.out[k]?.[j]));
            console.log(`${game} world: DIFF ${k} ${a.hashes[k]} -> ${b.hashes[k]}${i >= 0 ? ` (first at #${i}: ${JSON.stringify(a.out[k][i])} -> ${JSON.stringify(b.out[k]?.[i])})` : ''}`);
        }
    } else if (a.hash !== b.hash) {
        same = false;
        const i = a.log.findIndex((v, j) => JSON.stringify(v) !== JSON.stringify(b.log[j]));
        console.log(`${game} fight: DIFF ${a.hash} (${a.events} events) -> ${b.hash} (${b.events} events)`);
        if (i >= 0) console.log(`  first at #${i}\n    base: ${JSON.stringify(a.log[i]).slice(0, 300)}\n    now:  ${JSON.stringify(b.log[i]).slice(0, 300)}`);
    }
}
if (same) console.log(`${game} ${kind}: SAME as ${opt.base}`);
process.exit(same ? 0 : 1);
