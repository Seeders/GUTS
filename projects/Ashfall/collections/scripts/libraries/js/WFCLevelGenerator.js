/**
 * WFCLevelGenerator - Wave function collapse over hand-authored 8x8 tile pieces.
 *
 * Pieces live in the levels collection as `piece_<set>_<name>` entries with a
 * `wfc` block: { set, weight, edges: {n,e,s,w}, features }. Adjacent pieces
 * must have equal edge labels on their shared edge. The map border is
 * unconstrained except that non-"open" edges are preferred (handled by
 * weighting), and the whole map is ringed by the extension terrain.
 *
 * Output: a complete level JSON (terrainMap/heightMap/levelEntities/
 * startingLocations) plus an `arpg` block with gameplay markers:
 *   { entrance, exit, waypoint, bossSpawn, packSpawns[], chestSpawns[] }
 * All marker coordinates are tile coords (gridX/gridZ).
 */
class WFCLevelGenerator {
    static PIECE_SIZE = 8;

    /**
     * @param {Object} collections - game collections (levels holds the pieces)
     * @param {Object} rng - function returning [0,1) (seeded)
     */
    constructor(collections, rng = Math.random) {
        this.collections = collections;
        this.rng = rng;
    }

    loadPieces(setName) {
        const pieces = [];
        const levels = this.collections.levels || {};
        for (const [key, def] of Object.entries(levels)) {
            if (def?.isWfcPiece && def.wfc?.set === setName) {
                pieces.push({ id: key, ...def.wfc, tiles: def.tiles, heights: def.heights, entities: def.entities || [] });
            }
        }
        return pieces;
    }

    pick(arr, weightFn) {
        let total = 0;
        for (const a of arr) total += weightFn(a);
        let r = this.rng() * total;
        for (const a of arr) {
            r -= weightFn(a);
            if (r <= 0) return a;
        }
        return arr[arr.length - 1];
    }

    /**
     * Run WFC on an n x n piece grid.
     * @returns {Array<Array<piece>>} chosen pieces or null on failure
     */
    collapse(pieces, n, maxAttempts = 40) {
        const OPP = { n: 's', e: 'w', s: 'n', w: 'e' };
        const DIRS = [
            ['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]
        ];

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // domains[z][x] = array of candidate pieces
            const domains = Array.from({ length: n }, () =>
                Array.from({ length: n }, () => pieces.slice()));
            const chosen = Array.from({ length: n }, () => new Array(n).fill(null));
            let failed = false;

            const propagate = (x, z) => {
                const stack = [[x, z]];
                while (stack.length) {
                    const [cx, cz] = stack.pop();
                    const cd = chosen[cz][cx] ? [chosen[cz][cx]] : domains[cz][cx];
                    for (const [dir, dx, dz] of DIRS) {
                        const nx = cx + dx, nz = cz + dz;
                        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
                        if (chosen[nz][nx]) continue;
                        const validLabels = new Set(cd.map(p => p.edges[dir]));
                        const before = domains[nz][nx].length;
                        domains[nz][nx] = domains[nz][nx].filter(p => validLabels.has(p.edges[OPP[dir]]));
                        if (domains[nz][nx].length === 0) return false;
                        if (domains[nz][nx].length < before) stack.push([nx, nz]);
                    }
                }
                return true;
            };

            let cellsLeft = n * n;
            while (cellsLeft > 0 && !failed) {
                // find lowest-entropy uncollapsed cell
                let best = null, bestLen = Infinity;
                for (let z = 0; z < n; z++) {
                    for (let x = 0; x < n; x++) {
                        if (chosen[z][x]) continue;
                        const len = domains[z][x].length;
                        if (len === 0) { failed = true; break; }
                        if (len < bestLen) { bestLen = len; best = [x, z]; }
                    }
                    if (failed) break;
                }
                if (failed || !best) break;

                const [x, z] = best;
                const cell = this.pick(domains[z][x], p => p.weight || 1);
                chosen[z][x] = cell;
                domains[z][x] = [cell];
                cellsLeft--;
                if (!propagate(x, z)) { failed = true; }
            }

            if (!failed) return chosen;
        }
        return null;
    }

    /**
     * Generate a complete zone level.
     * @param {Object} opts - { set, sizePieces, title, world }
     */
    generate(opts) {
        const P = WFCLevelGenerator.PIECE_SIZE;
        const n = opts.sizePieces || 6;
        const size = n * P;

        const pieces = this.loadPieces(opts.set);
        if (!pieces.length) {
            console.error('[WFC] No pieces for set:', opts.set);
            return null;
        }

        let layout = this.collapse(pieces, n);
        if (!layout) {
            console.warn('[WFC] collapse failed after retries — falling back to open pieces');
            const open = pieces.filter(p => p.features?.includes('open'));
            layout = Array.from({ length: n }, () =>
                Array.from({ length: n }, () => this.pick(open.length ? open : pieces, p => p.weight || 1)));
        }

        // Assemble tile grids
        const terrainMap = Array.from({ length: size }, () => new Array(size).fill(6));
        const heightMap = Array.from({ length: size }, () => new Array(size).fill(2));
        const levelEntities = [];
        const openCells = [];
        const packSpawns = [];
        const chestSpawns = [];

        const gridSize = this.collections.configs?.game?.gridSize || 48;
        const terrainSize = size * gridSize;
        const tileToWorld = (tx, tz) => ({
            x: tx * gridSize - terrainSize / 2 + gridSize / 2,
            z: tz * gridSize - terrainSize / 2 + gridSize / 2
        });

        for (let cz = 0; cz < n; cz++) {
            for (let cx = 0; cx < n; cx++) {
                const p = layout[cz][cx];
                for (let z = 0; z < P; z++) {
                    for (let x = 0; x < P; x++) {
                        terrainMap[cz * P + z][cx * P + x] = p.tiles[z][x];
                        heightMap[cz * P + z][cx * P + x] = p.heights?.[z]?.[x] ?? 2;
                    }
                }
                for (const en of p.entities) {
                    const tx = cx * P + en.tx;
                    const tz = cz * P + en.tz;
                    const w = tileToWorld(tx, tz);
                    levelEntities.push({
                        spawnType: 'worldObject',
                        type: en.type,
                        components: {
                            transform: {
                                position: { x: w.x, y: 0, z: w.z },
                                rotation: { x: 0, y: 0, z: 0 },
                                scale: { x: 1, y: 1, z: 1 }
                            }
                        }
                    });
                }

                const center = { gridX: cx * P + P / 2, gridZ: cz * P + P / 2, cx, cz };
                if (p.features?.includes('open')) openCells.push(center);
                if (p.features?.includes('packSpawn')) packSpawns.push(center);
                if (p.features?.includes('chest')) chestSpawns.push(center);
            }
        }

        // Entrance = open cell nearest a corner; exit = open cell farthest from entrance
        const fallbackCell = { gridX: P / 2, gridZ: P / 2, cx: 0, cz: 0 };
        const cells = openCells.length ? openCells : [fallbackCell];
        let entrance = cells[0];
        let bestD = Infinity;
        for (const c of cells) {
            const d = c.gridX + c.gridZ;
            if (d < bestD) { bestD = d; entrance = c; }
        }
        let exit = cells[0];
        bestD = -1;
        for (const c of cells) {
            const d = Math.abs(c.gridX - entrance.gridX) + Math.abs(c.gridZ - entrance.gridZ);
            if (d > bestD) { bestD = d; exit = c; }
        }

        // Boss spawn: near the exit (one open cell before it); waypoint near entrance
        let bossSpawn = exit;
        let waypoint = null;
        if (opts.hasWaypoint) {
            // second-closest open cell to entrance
            const sorted = cells.slice().sort((a, b) =>
                (Math.abs(a.gridX - entrance.gridX) + Math.abs(a.gridZ - entrance.gridZ)) -
                (Math.abs(b.gridX - entrance.gridX) + Math.abs(b.gridZ - entrance.gridZ)));
            waypoint = sorted[Math.min(1, sorted.length - 1)];
        }

        // Filter pack spawns too close to the entrance
        const farPacks = packSpawns.filter(c =>
            Math.abs(c.gridX - entrance.gridX) + Math.abs(c.gridZ - entrance.gridZ) > P);

        return {
            title: opts.title || 'Generated Zone',
            published: false,
            world: opts.world || 'shire',
            grassShader: 'grass',
            waterShader: 'water',
            tileMap: {
                size,
                terrainTypes: ['water', 'lava', 'dirt', 'brick', 'rock', 'forest', 'grass'],
                terrainMap,
                heightMap,
                ramps: [],
                startingLocations: [
                    { side: 'left', gridX: entrance.gridX, gridZ: entrance.gridZ },
                    { side: 'right', gridX: exit.gridX, gridZ: exit.gridZ }
                ],
                extensionTerrainType: opts.set === 'forest' ? 5 : (opts.set === 'rock' ? 4 : 2),
                extensionHeight: opts.set === 'forest' ? 2 : 3,
                terrainBGColor: { paletteColor: 'greenMColor' },
                levelEntities,
                cliffs: []
            },
            arpg: {
                entrance: { gridX: entrance.gridX, gridZ: entrance.gridZ },
                exit: { gridX: exit.gridX, gridZ: exit.gridZ },
                waypoint: waypoint ? { gridX: waypoint.gridX, gridZ: waypoint.gridZ } : null,
                bossSpawn: { gridX: bossSpawn.gridX, gridZ: bossSpawn.gridZ },
                packSpawns: (farPacks.length ? farPacks : packSpawns).map(c => ({ gridX: c.gridX, gridZ: c.gridZ })),
                chestSpawns: chestSpawns.map(c => ({ gridX: c.gridX, gridZ: c.gridZ }))
            }
        };
    }
}

if (typeof window !== 'undefined') {
    if (!window.GUTS) window.GUTS = {};
    window.GUTS.WFCLevelGenerator = WFCLevelGenerator;
}
if (typeof global !== 'undefined') {
    if (!global.GUTS) global.GUTS = {};
    global.GUTS.WFCLevelGenerator = WFCLevelGenerator;
}

export default WFCLevelGenerator;
export { WFCLevelGenerator };
