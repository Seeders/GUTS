// World probe (preloaded by probe.mjs): when the world room is up, asks the rules system
// (game.mmoGameSystem, a world kit ContinentSystem) a grid of world questions (walk height, blocked,
// zones, steps, line of sight, paths, interiors) and writes the answers and a hash per kind to
// PROBE_OUT, then exits. PROBE_N sets the grid size (120), PROBE_SWIM=0 steps without swimming.
import { writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { whenWorldReady } from './hook.mjs';

let rnd = 12345;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

whenWorldReady((game) => {
    setTimeout(() => {
        const gs = game.mmoGameSystem, t = gs.terrain(), out = {};
        const add = (k, v) => (out[k] ||= []).push(v);
        const r = (v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
        const x0 = t.minX, z0 = t.minZ, W = t.W * t.grid, H = t.H * t.grid;
        const N = Number(process.env.PROBE_N || 120);
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
            const x = x0 + (i + 0.37) * W / N, z = z0 + (j + 0.61) * H / N;
            add('walk', r(gs.mmoWalkHeight(x, z)));
            add('blocked', gs.mmoBlocked(x, z) ? 1 : 0);
            add('inWorld', gs.inWorld(x, z) ? 1 : 0);
            add('water', r(gs.mmoWaterAt?.(x, z) ?? null));
            add('swim', r(gs.mmoSwimAt?.(x, z) ?? null));
            add('zone', gs.mmoZoneAt(x, z)?.id ?? null);
            add('sub', gs.mmoSubzoneAt?.(x, z)?.id ?? null);
            add('interior', gs.mmoInteriorAt?.(x, z)?.id ?? null);
            for (const [dx, dz] of [[30, 0], [0, 30], [-21, 21]]) add('step', gs.mmoCanStep(x, z, x + dx, z + dz, process.env.PROBE_SWIM !== '0') ? 1 : 0);
            if ((i + j) % 4 === 0) add('shot', gs.mmoShotBlocked ? String(gs.mmoShotBlocked(x, gs.mmoWalkHeight(x, z) + 40, z, x + 300, gs.mmoWalkHeight(x + 300, z) + 40, z + 120)) : null);
        }
        if (gs.mmoAddLevel) for (const d of [1, 3, 6, 9, 13]) gs.mmoAddLevel(d, 1000 + d);     // (the Descent: dungeon levels)
        // interiors: points inside each
        for (const it of gs.mmoInteriors?.() || []) for (let k = 0; k < 400; k++) {
            const x = it.x0 + rand() * (it.x1 - it.x0), z = it.z0 + rand() * (it.z1 - it.z0);
            add('in_walk', r(gs.mmoWalkHeight(x, z)));
            add('in_step', gs.mmoCanStep(x, z, x + 25, z - 10, true) ? 1 : 0);
            add('in_open', gs.interiorOpen ? (gs.interiorOpen(it, x, z) ? 1 : 0) : null);
            add('in_shot', gs.mmoShotBlocked ? String(gs.mmoShotBlocked(x, gs.mmoWalkHeight(x, z) + 40, z, x + 200, gs.mmoWalkHeight(x, z) + 40, z + 90)) : null);
            if (k % 20 === 0) { const p = gs.mmoFindPath(x, z, it.x0 + rand() * (it.x1 - it.x0), it.z0 + rand() * (it.z1 - it.z0)); add('in_path', p ? p.map(q => `${Math.round(q.x)},${Math.round(q.z)}`).join(';') : null); }
        }
        // paths between points on open ground
        const open = [];
        while (open.length < 60) { const x = x0 + rand() * W, z = z0 + rand() * H; if (gs.inWorld(x, z) && !gs.mmoBlocked(x, z)) open.push([x, z]); }
        for (let k = 0; k + 1 < open.length; k += 2) {
            const [ax, az] = open[k], [bx, bz] = [open[k][0] + (rand() - 0.5) * 4000, open[k][1] + (rand() - 0.5) * 4000];
            const p = gs.mmoFindPath(ax, az, bx, bz);
            add('path', p ? p.length + ':' + p.map(q => `${Math.round(q.x)},${Math.round(q.z)}`).join(';') : null);
        }
        const hashes = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, `${v.length} ${createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12)}`]));
        writeFileSync(process.env.PROBE_OUT, JSON.stringify({ hashes, out }));
        console.log('[probe]', JSON.stringify(hashes));
        process.exit(0);
    }, 1500);
});
