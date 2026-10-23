/**
 * ContinentSystem - a world of square chunks of tiles, for the server and every client (the GUTS
 * world kit). The same numbers on both sides: where the ground is and how high, water, what
 * blocks a walker or an arrow, bridges, interiors, zones and paths.
 *
 *   data      collections.continent (the layout: size, chunk, grid, res, minX, minZ, seaLevel,
 *             zones, chunks [{ id, cx, cz, x, z }], subzones, version) and each chunk's level as
 *             collections.levels.chunk_<id> (a tileMap with terrainMap, heightMap, heightField,
 *             zoneMap, subMap, levelEntities); zones (buildings, decor, bridges), buildings
 *             (collision masks), worldObjects (impassable, blockRadius), interiors (rock grids)
 *   loading   mmoLoadWorld(onProgress) fetches resources/world/ on a client (the server puts the
 *             same in collections first: MultiplayerHost's beforeWorld, loadContinent); terrain()
 *             is the composite grid over every chunk added so far; mmoAddChunk(id) adds one
 *   asking    mmoWalkHeight, mmoCanStep, mmoBlocked, mmoWaterAt / mmoSwimAt, mmoZoneAt,
 *             mmoInteriorAt, mmoShotBlocked, mmoFindPath, inWorld, tileOf ...
 *
 * A game extends it (its rules system: `class MmoGameSystem extends GUTS.ContinentSystem`) and
 * sets `this.config` (startZone, treeRadius). Anything it does differently it overrides: kdOn
 * (conditions on buildings), mmoCanStep, mmoWalkHeight, bridgeAt, interiorOpen, blockers...
 * After the world changes (a building comes or goes) call mmoWorldStaticsChanged().
 */
class ContinentSystem extends GUTS.BaseSystem {
    static services = [
        'mmoShotBlocked',
        'mmoZone',
        'mmoZones',
        'mmoZoneAt',
        'mmoBlocked',
        'mmoBuildingAt',
        'mmoWalkHeight',
        'mmoCanStep',
        'mmoFindPath',
        'mmoStartZone',
        'mmoContinent',
        'mmoLoadWorld',
        'mmoSubzoneAt',
        'mmoWorldStaticsChanged',
        'mmoInteriorAt',
        'mmoInteriors',
        'mmoContentZones'
    ];

    constructor(game) {
        super(game);
        this.game.continentSystem = this;         // (the world kit's ChunkStreamSystem reads it)
    }

    // ==================== THE CONTINENT ====================
    //
    // The world is one continent (tools/world/continent.mjs), stored as square
    // chunks of tiles: resources/world/continent.json lists them and the zones,
    // resources/world/chunks/<id>.json are level-shaped tile data. The server
    // reads them at start (server.js), the client fetches them before entering
    // (mmoLoadWorld); both put the chunks in collections.levels as chunk_<id>.
    // Gameplay below works on one composite tile grid over every chunk.
    //
    // Zones are regions of the continent: each tile has a zone (the chunk's
    // zoneMap). data/zones/<id>.json holds a zone's title, levels, race, palette,
    // town and content, all in world coordinates.

    /** The continent's layout (null until loaded). */
    mmoContinent() { return this.collections.continent || null; }

    /**
     * Client: fetch the continent's layout (once) and the chunks within `radius` of
     * (x, z) before the world scene loads. Further chunks stream in as you travel
     * (MmoWorldChunkSystem → mmoFetchChunk).
     */
    async mmoLoadWorld(x = 0, z = 0, radius = 9000, onProgress = null, version = null) {
        const base = (this.game.app?.getResourcesPath?.() || './resources/') + 'world/';
        if (version && this.collections.continent && this.collections.continent.version !== version) {
            // the server runs another build of the world: drop ours
            for (const k of Object.keys(this.collections.levels || {})) if (k.startsWith('chunk_')) delete this.collections.levels[k];
            this.collections.continent = null;
            this.collections._chunkFetches = null;
        }
        if (!this.collections.continent) {
            this.collections.continent = await (await fetch(`${base}continent.json?v=${version || Date.now()}`)).json();
            this._zones = null; this._terrain = null; this._trees = null; this._nav = null;
        }
        const cont = this.collections.continent, half = (cont.chunk * cont.grid) / 2;
        const near = cont.chunks.filter(c => Math.hypot(Math.max(0, Math.abs(x - c.x) - half), Math.max(0, Math.abs(z - c.z) - half)) < radius);
        let done = 0;
        await Promise.all(near.map(c => this.mmoFetchChunk(c.id).then(() => onProgress?.(++done / near.length))));
        return true;
    }

    /** Client: fetch one chunk's data (once) and add it to the world grid if there is one. */
    mmoFetchChunk(id) {
        const pending = this.collections._chunkFetches || (this.collections._chunkFetches = new Map());
        if (!pending.has(id)) {
            const base = (this.game.app?.getResourcesPath?.() || './resources/') + 'world/';
            pending.set(id, fetch(`${base}chunks/${id}.json?v=${this.collections.continent?.version || ''}`).then(r => r.json()).then(level => {
                const levels = this.collections.levels || (this.collections.levels = {});
                if (!levels[`chunk_${id}`]) levels[`chunk_${id}`] = level;
            }));
        }
        return pending.get(id).then(() => { if (this._terrain) this.mmoAddChunk(id); });
    }

    /** Every zone of the continent, in its zoneMap order (each with its `id`). */
    mmoZones() {
        if (!this._zones) {
            const ids = this.mmoContinent()?.zones || [];
            this._zones = ids.map(id => this.collections.zones?.[id] && Object.assign(this.collections.zones[id], { id })).filter(Boolean);
        }
        return this._zones;
    }

    /** Everything that holds content (NPCs, camps, world objects, triggers): the zones, then the interiors. */
    mmoContentZones() {
        if (!this._contentZones) this._contentZones = [...this.mmoZones(), ...this.mmoInteriors()];
        return this._contentZones;
    }

    // ==================== BRIDGES ====================
    //
    // A zone's `bridges` ([{ x, z, ry, len, width, rise, y0, y1 }]: centre, turn, span along the
    // local z axis, deck width, how high the deck arches over its ends, the ground height at each
    // end) can be walked over whatever lies below, water included. The deck curves from y0 to y1
    // with `rise` at the middle.

    bridges() {
        if (!this._bridges) {
            this._bridges = this.mmoZones().flatMap(z => z.bridges || []).map(b => ({ ...b, c: Math.cos(b.ry || 0), s: Math.sin(b.ry || 0), r: Math.hypot(b.len, b.width) / 2 }));
        }
        return this._bridges;
    }

    bridgeAt(x, z) {
        for (const b of this.bridges()) {
            const dx = x - b.x, dz = z - b.z;
            if (dx * dx + dz * dz > b.r * b.r) continue;
            // local: along (lz) and across (lx) the span; the model's length runs along its z
            const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
            if (Math.abs(lx) > b.width / 2 || Math.abs(lz) > b.len / 2) continue;
            const t = lz / b.len + 0.5;                                   // 0 at one end, 1 at the other
            return { deckY: b.y0 + (b.y1 - b.y0) * t + b.rise * Math.sin(Math.PI * t) };
        }
        return null;
    }

    // ==================== INTERIORS ====================
    //
    // Dungeons and other interiors (collections/interiors, from tools/content/dungeons.mjs) sit
    // off the continent. Each is a grid of `cell`-unit squares from origin [x0, z0]: rows of
    // characters, '#' solid rock, anything else floor, at floor height `y` under a ceiling
    // `height` above it. Walking, heights, paths and the zone under you come from that grid.

    mmoInteriors() {
        if (!this._interiors) {
            this._interiors = Object.entries(this.collections.interiors || {}).map(([id, d]) => Object.assign(d, {
                id, x0: d.origin[0], z0: d.origin[1], x1: d.origin[0] + d.w * d.cell, z1: d.origin[1] + d.h * d.cell
            }));
        }
        return this._interiors;
    }

    mmoInteriorAt(x, z) {
        for (const it of this.mmoInteriors()) if (x >= it.x0 && z >= it.z0 && x < it.x1 && z < it.z1) return it;
        return null;
    }

    static BODY = 18;               // a walker keeps this far from an interior's rock

    interiorFloor(it, x, z) {
        const ch = it.grid[Math.floor((z - it.z0) / it.cell)]?.[Math.floor((x - it.x0) / it.cell)];
        return ch != null && ch !== '#';
    }

    interiorOpen(it, x, z, r = ContinentSystem.BODY) {
        return this.interiorFloor(it, x - r, z - r) && this.interiorFloor(it, x + r, z - r) && this.interiorFloor(it, x - r, z + r) && this.interiorFloor(it, x + r, z + r);
    }

    interiorStep(it, x0, z0, x1, z1) {
        const dist = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.ceil(dist / 8));
        const startOpen = this.interiorOpen(it, x0, z0);
        for (let i = 1; i <= steps; i++) {
            const k = i / steps, x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k;
            if (startOpen ? !this.interiorOpen(it, x, z) : !this.interiorFloor(it, x, z)) return false;
        }
        return true;
    }

    /** A* over an interior's cells (4-way), string-pulled with interiorStep. */
    interiorPath(it, x0, z0, x1, z1) {
        const W = it.w, cell = it.cell, at = (x, z) => [Math.floor((x - it.x0) / cell), Math.floor((z - it.z0) / cell)];
        const [sx, sz] = at(x0, z0), [gx, gz] = at(x1, z1);
        const open = (i, j) => it.grid[j]?.[i] != null && it.grid[j][i] !== '#';
        if (!open(gx, gz)) return null;
        const key = (i, j) => j * W + i, came = new Map([[key(sx, sz), -1]]), q = [[sx, sz]];
        while (q.length) {
            const [i, j] = q.shift();
            if (i === gx && j === gz) break;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const ni = i + di, nj = j + dj, k = key(ni, nj);
                if (!open(ni, nj) || came.has(k)) continue;
                came.set(k, key(i, j));
                q.push([ni, nj]);
            }
        }
        if (!came.has(key(gx, gz))) return null;
        const cells = [];
        for (let k = key(gx, gz); k !== -1 && k !== key(sx, sz); k = came.get(k)) cells.unshift({ x: it.x0 + (k % W + 0.5) * cell, z: it.z0 + (Math.floor(k / W) + 0.5) * cell });
        if (cells.length) cells[cells.length - 1] = { x: x1, z: z1 };
        else cells.push({ x: x1, z: z1 });
        const out = [];                                         // string-pull: skip corners you can see past
        let from = { x: x0, z: z0 };
        for (let i = 0; i < cells.length; i++) {
            const next = cells[i + 1];
            if (next && this.interiorStep(it, from.x, from.z, next.x, next.z)) continue;
            out.push(cells[i]);
            from = cells[i];
        }
        return out;
    }

    /** Where a new character of a race starts: its race's zone (or the zone its race data names), else the shared start zone. */
    mmoStartZone(race) {
        const named = this.collections.races?.[race]?.startZone;
        return this.mmoZones().find(z => z.race && z.race === race) || (named && this.mmoZone(named)) || this.mmoZone(this.config.startZone) || this.mmoZones()[0] || null;
    }

    /** The zone under a world position (null outside every zone). */
    mmoZoneAt(x, z) {
        const it = this.mmoInteriorAt(x, z);
        if (it) return this.mmoZones().find(q => q.id === it.zone) || null;     // an interior belongs to the zone outside it
        const t = this.terrain();
        if (!t) return null;
        const gx = Math.floor((x - t.minX) / t.grid), gz = Math.floor((z - t.minZ) / t.grid);
        if (gx < 0 || gz < 0 || gx >= t.W || gz >= t.H) return null;
        const i = t.zoneIdx[gz * t.W + gx];
        return i >= 0 ? t.zones[i] : null;
    }

    /** The subzone under a world position ({ id, title, zone, palette, label } from continent.json), null if none. */
    mmoSubzoneAt(x, z) {
        const it = this.mmoInteriorAt(x, z);
        if (it) return it._sub || (it._sub = { id: it.id, title: it.title, zone: it.zone, interior: true });     // one object: the HUD compares them
        const t = this.terrain(), subs = this.mmoContinent()?.subzones;
        if (!t || !subs) return null;
        const gx = Math.floor((x - t.minX) / t.grid), gz = Math.floor((z - t.minZ) / t.grid);
        if (gx < 0 || gz < 0 || gx >= t.W || gz >= t.H) return null;
        return subs[t.subIdx[gz * t.W + gx]] || null;
    }

    // ==================== COLLISION ====================

    /**
     * Buildings of every zone: [{x, z, hw, hd, c, s, r, type, ry, mask}]. With a
     * collision mask (tools/assets/import_synty.mjs: walls and furniture of the
     * ground floor, open doorways) the building can be walked into; otherwise
     * its footprint rectangle is solid. Masks live in the model's own frame,
     * turned by the building's ry; r bounds it for a quick reject.
     */
    blockers() {
        if (this._blockers) return this._blockers;
        const grid = this.collections.configs?.game?.gridSize || 48;
        const masks = new Map();
        const maskOf = (type, def) => {
            if (!def?.collision) return null;
            if (!masks.has(type)) {
                const m = def.collision;
                masks.set(type, { ...m, solid: ContinentSystem.bits(m.solid), cover: ContinentSystem.bits(m.cover) });
            }
            return masks.get(type);
        };
        this._blockers = this.mmoZones().flatMap(zone => (zone.buildings || []).filter(b => this.kdOn(b.when)).map(b => {
            const def = this.collections.buildings?.[b.type];
            const mask = maskOf(b.type, def);
            const [w, d] = def?.footprint || [grid * (def?.footprintWidth || 1) * 0.84, grid * (def?.footprintHeight || 1) * 0.84];
            const hw = mask ? Math.max(-mask.x0, mask.x0 + mask.w * mask.cell) : w / 2;
            const hd = mask ? Math.max(-mask.z0, mask.z0 + mask.h * mask.cell) : d / 2;
            const ry = b.ry || 0;
            return { x: b.x, z: b.z, hw, hd, c: Math.cos(ry), s: Math.sin(ry), r: Math.hypot(hw, hd), type: b.type, ry, mask, src: b };
        }));
        return this._blockers;
    }

    /** Does a world condition hold (a building's or decor piece's `when`)? Always, unless the game
     *  overrides it with its own conditions (Kingdom's KdLogic, against game.kdWorldCtx). */
    kdOn(cond) { return true; }

    /** The world changed: buildings with `when` may have come or gone, so collision rebuilds. */
    mmoWorldStaticsChanged() {
        if (this._anyWhen == null) this._anyWhen = this.mmoZones().some(z => (z.buildings || []).some(b => b.when));
        if (!this._anyWhen) return;                     // nothing to rebuild (the nav grid is costly)
        this._blockers = null; this._blockerCells = null; this._nav = null; this._links = null; this._shotDecor = null;
    }

    // ==================== WHAT STOPS AN ARROW ====================
    //
    // Arrows and bolts fly in 3D, so their obstacles have heights: a building's walls (its collision
    // mask, open doorways and all) up to its eaves and its roof above the rooms; trees and props
    // (impassable world objects and zone decor) as a trunk up to their height, and trees a canopy
    // over the upper half; an interior's rock and ceiling.

    static SHOT_CELL = 96;

    shotCells() {
        return this._shots ||= new Map();
    }

    /** One prop as an arrow obstacle: [x, z, trunk radius, height, canopy radius] in a spatial hash. */
    addShotSolid(x, z, def, scale = 1, cells = this.shotCells()) {
        const h = (def.height || 75) * scale, r = def.blockRadius || this.config.treeRadius || 12;
        const treeish = r <= 16 && h >= 70;                             // a trunk with leaves up top
        const cr = treeish ? Math.min(60, Math.max(r, (def.size || 48) * 0.38 * scale)) : 0;
        const key = Math.floor(x / ContinentSystem.SHOT_CELL) * 65536 + Math.floor(z / ContinentSystem.SHOT_CELL);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(x, z, r, h, cr);
    }

    /** Zone decor that stands in the way (impassable kinds, those whose `when` holds). */
    shotDecor() {
        if (this._shotDecor) return this._shotDecor;
        const cells = new Map();
        for (const zone of this.mmoZones()) for (const d of zone.decor || []) {
            const def = this.collections.worldObjects?.[d.type];
            if (def?.impassable && this.kdOn(d.when)) this.addShotSolid(d.x, d.z, def, d.scale || 1, cells);
        }
        return (this._shotDecor = cells);
    }

    /** Is the point (x, y, z) inside something an arrow can't pass? */
    mmoShotBlocked(x, y, z) {
        const it = this.mmoInteriorAt(x, z);
        if (it) return !this.interiorFloor(it, x, z) ? 'rock' : y > it.y + (it.height || 200) ? 'ceiling' : y < it.y - 4 ? 'floor' : false;
        for (const b of this.blockersNear(x, z)) {
            const dx = x - b.x, dz = z - b.z;
            if (dx * dx + dz * dz >= b.r * b.r) continue;
            const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
            b.base ??= this.mmoWalkHeight(b.x, b.z);
            const def = this.collections.buildings?.[b.type];
            const wallH = b.mask?.wallH || def?.height || 120, top = b.base + wallH * 1.4;
            if (y > top || y < b.base - 10) continue;
            if (b.mask) {
                if (ContinentSystem.maskAt(b.mask, 'solid', lx, lz)) return `wall:${b.type}`;
                if (y > b.base + wallH * 0.95 && ContinentSystem.maskAt(b.mask, 'cover', lx, lz)) return `roof:${b.type}`;   // the roof
            } else if (Math.abs(lx) < b.hw && Math.abs(lz) < b.hd) return `box:${b.type}`;
        }
        const C = ContinentSystem.SHOT_CELL, gx = Math.floor(x / C), gz = Math.floor(z / C);
        for (const cells of [this.shotCells(), this.shotDecor()]) {
            for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
                const list = cells.get((gx + ix) * 65536 + gz + iz);
                if (!list) continue;
                for (let i = 0; i < list.length; i += 5) {
                    const d2 = (x - list[i]) ** 2 + (z - list[i + 1]) ** 2, r = list[i + 2], h = list[i + 3], cr = list[i + 4];
                    if (d2 > Math.max(r, cr) ** 2) continue;
                    const g = this.mmoWalkHeight(list[i], list[i + 1]);
                    if (y < g - 10 || y > g + h) continue;
                    if (d2 < r * r) return `solid r${r} h${Math.round(h)} @${Math.round(list[i])},${Math.round(list[i + 1])}`;                                       // trunk, rock, wall of a tent
                    if (cr && y > g + h * 0.45) return `leaves r${Math.round(cr)} h${Math.round(h)} @${Math.round(list[i])},${Math.round(list[i + 1])}`;                           // into the leaves
                }
            }
        }
        return false;
    }

    static NONE = [];
    static CLIMB = 1.1;     // steepest walkable climb on natural ground (tools/zone/terrain.mjs)
    static DROP = 2.6;      // steepest walkable descent
    static STEEP = 1.6;     // no climbing onto ground steeper than this in any direction (a slanted path can't cheat a cliff)

    /** Base64 bit rows (numpy packbits, high bit first) -> bytes. */
    static bits(b64) {
        if (!b64) return null;
        if (typeof atob === 'function') {
            const s = atob(b64), out = new Uint8Array(s.length);
            for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
            return out;
        }
        return new Uint8Array(Buffer.from(b64, 'base64'));
    }

    /** Is building-frame point (lx, lz) set in one of a mask's layers ('solid' | 'cover')? */
    static maskAt(mask, layer, lx, lz) {
        const gx = Math.floor((lx - mask.x0) / mask.cell), gz = Math.floor((lz - mask.z0) / mask.cell);
        if (gx < 0 || gz < 0 || gx >= mask.w || gz >= mask.h) return false;
        const i = gz * mask.w + gx, bytes = mask[layer];
        return !!bytes && (bytes[i >> 3] & (0x80 >> (i & 7))) !== 0;
    }

    /** The building whose roof covers (x, z), if you're inside one (null outside). */
    mmoBuildingAt(x, z) {
        for (const b of this.blockersNear(x, z)) {
            if (!b.mask) continue;
            const dx = x - b.x, dz = z - b.z;
            if (dx * dx + dz * dz >= b.r * b.r) continue;
            if (ContinentSystem.maskAt(b.mask, 'cover', dx * b.c - dz * b.s, dx * b.s + dz * b.c)) return b;
        }
        return null;
    }

    /** Tree trunks as a spatial hash (impassable props of the loaded chunks, by world tile; see mmoAddChunk). */
    trees() {
        if (!this._trees) this.terrain();
        return this._trees || { cells: new Map(), grid: 48, minX: 0, minZ: 0, r: this.config.treeRadius, count: 0 };
    }

    /** Is (x, z) inside a tree trunk? */
    treeAt(x, z, r = null) {
        const t = this.trees();
        const gx = Math.floor((x - t.minX) / t.grid), gz = Math.floor((z - t.minZ) / t.grid);
        // wide blockers (r up to ~2 tiles) are found from two tiles away
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                const list = t.cells.get((gx + dx) * 4096 + gz + dz);
                if (!list) continue;
                for (let i = 0; i < list.length; i += 3) {
                    const rr = r ?? list[i + 2];
                    if ((x - list[i]) ** 2 + (z - list[i + 1]) ** 2 < rr * rr) return true;
                }
            }
        }
        return false;
    }

    /** Is (x, z) inside a solid building or tree trunk? */
    /** Buildings whose bounds reach the 512-unit cell around (x, z). */
    blockersNear(x, z) {
        if (!this._blockerCells) {
            const cells = new Map();
            for (const b of this.blockers()) {
                for (let cx = Math.floor((b.x - b.r) / 512); cx <= Math.floor((b.x + b.r) / 512); cx++) {
                    for (let cz = Math.floor((b.z - b.r) / 512); cz <= Math.floor((b.z + b.r) / 512); cz++) {
                        const k = cx * 65536 + cz;
                        if (!cells.has(k)) cells.set(k, []);
                        cells.get(k).push(b);
                    }
                }
            }
            this._blockerCells = cells;
        }
        return this._blockerCells.get(Math.floor(x / 512) * 65536 + Math.floor(z / 512)) || ContinentSystem.NONE;
    }

    mmoBlocked(x, z) {
        for (const b of this.blockersNear(x, z)) {
            const dx = x - b.x, dz = z - b.z;
            if (dx * dx + dz * dz >= b.r * b.r) continue;
            // into the building's frame (three.js turns local (x, z) by ry about +Y)
            const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
            if (b.mask ? ContinentSystem.maskAt(b.mask, 'solid', lx, lz) : Math.abs(lx) < b.hw && Math.abs(lz) < b.hd) return true;
        }
        return this.treeAt(x, z);
    }

    // ==================== WALKABLE GROUND ====================
    //
    // The terrain heightmap stores every tile flat, so a ramp tile is a hard
    // step there; only the renderer slopes it (WorldRenderer: one smoothstep
    // spanning the ramp tile and the lower tile beyond it). Walking, unit
    // placement and pathfinding all use walkHeight(), which applies the same
    // slope, so characters can climb ramps and stand on them.

    /**
     * The composite world grid over the whole continent (continent.json: size, minX,
     * minZ), filled chunk by chunk (mmoAddChunk): the server adds every chunk at
     * start, the client those near the player as they arrive. hm holds height levels
     * (-1 where no chunk is loaded); tiles are indexed gz * W + gx from the world's
     * north-west corner. zoneIdx is each tile's zone (index into zones), types its
     * ground (terrainTypes), field the natural heightfield (RES samples per tile).
     */
    terrain() {
        if (this._terrain) return this._terrain;
        const cont = this.mmoContinent();
        if (!cont) return null;
        const grid = cont.grid || this.collections.configs?.game?.gridSize || 48;
        const step = this.collections.heightMaps?.naturalTerrain?.heightStep || 15;
        const W = cont.size, H = cont.size, RES = cont.res || 2, FW = W * RES + 1, FH = H * RES + 1;
        const first = this.collections.levels?.[`chunk_${cont.chunks[0]?.id}`]?.tileMap;
        this._terrain = {
            grid, step, minX: cont.minX, minZ: cont.minZ, W, H, RES, FW,
            hm: new Int8Array(W * H).fill(-1), ramps: new Uint8Array(W * H), zoneIdx: new Int8Array(W * H).fill(-1), types: new Uint8Array(W * H),
            subIdx: new Int16Array(W * H).fill(-1),
            natural: new Uint8Array(W * H), liquid: new Uint8Array(W * H), field: new Float32Array(FW * FH).fill(cont.seaLevel ?? 22),
            relief: null, terrainTypes: first?.terrainTypes || ['water', 'lava', 'dirt', 'brick', 'rock', 'forest', 'grass', 'sea'],
            zones: this.mmoZones(), loaded: new Set()
        };
        this._shots = null; this._trees = { cells: new Map(), grid, minX: cont.minX, minZ: cont.minZ, r: this.config.treeRadius, count: 0 };
        for (const c of cont.chunks) {
            const lv = this.collections.levels?.[`chunk_${c.id}`];
            if (lv?.added) { delete this.collections.levels[`chunk_${c.id}`]; this.collections._chunkFetches?.delete(c.id); }   // stripped by an earlier world: stream it again
            else if (lv) this.mmoAddChunk(c.id);
        }
        return this._terrain;
    }

    /**
     * Puts a loaded chunk (collections.levels.chunk_<id>) into the composite grid and
     * its trees into the trunk hash. Afterwards only its props are kept on the level.
     */
    mmoAddChunk(id) {
        const t = this._terrain || this.terrain();
        const level = this.collections.levels?.[`chunk_${id}`], c = this.mmoContinent()?.chunks.find(q => q.id === id);
        if (!t || !level || !c || t.loaded.has(id) || !level.tileMap?.terrainMap) return false;
        const tm = level.tileMap, n = tm.size, RES = t.RES, ox = c.cx * n, oz = c.cz * n;
        for (let r = 0; r < n; r++) {
            for (let col = 0; col < n; col++) {
                const i = (oz + r) * t.W + ox + col, ty = tm.terrainTypes[tm.terrainMap[r][col]];
                t.hm[i] = tm.heightMap[r][col];
                t.zoneIdx[i] = tm.zoneMap?.[r]?.[col] ?? -1;
                t.subIdx[i] = tm.subMap?.[r]?.[col] ?? -1;
                t.types[i] = tm.terrainMap[r][col];
                t.natural[i] = 1;
                t.liquid[i] = ty === 'water' || ty === 'lava' || ty === 'sea' ? 1 : 0;
            }
        }
        const hf = tm.heightField, fn = n * RES + 1;
        for (let r = 0; r < fn; r++) for (let col = 0; col < fn; col++) t.field[(oz * RES + r) * t.FW + ox * RES + col] = hf.data[r * fn + col];
        // trunks: impassable props, in world space, bucketed by tile
        const tr = this._trees;
        for (const e of tm.levelEntities || []) {
            const def = this.collections.worldObjects?.[e.type];
            if (!def?.impassable) continue;
            const p = e.components?.transform?.position;
            if (!p) continue;
            const x = p.x + c.x, z = p.z + c.z;
            const key = Math.floor((x - tr.minX) / tr.grid) * 4096 + Math.floor((z - tr.minZ) / tr.grid);
            if (!tr.cells.has(key)) tr.cells.set(key, []);
            tr.cells.get(key).push(x, z, def.blockRadius || tr.r);           // its own radius (a tent, a windmill) or a trunk's
            tr.count++;
            this.addShotSolid(x, z, def, e.components?.transform?.scale?.y || 1);
        }
        level.tileMap = { size: n, levelEntities: tm.levelEntities || [] };
        level.added = true;
        t.loaded.add(id);
        this._nav = null;
        return true;
    }

    isRamp(gx, gz) {
        const t = this.terrain();
        return !!t && gx >= 0 && gz >= 0 && gx < t.W && gz < t.H && t.ramps[gz * t.W + gx] === 1;
    }

    tileLevel(gx, gz) {
        const t = this.terrain();
        if (!t || gx < 0 || gz < 0 || gx >= t.W || gz >= t.H) return null;
        const h = t.hm[gz * t.W + gx];
        return h < 0 ? null : h;
    }

    /** Ground height at (x, z): the level (ramp tiles sloped like the renderer draws them) plus the relief. */
    mmoWalkHeight(x, z) {
        const it = this.mmoInteriorAt(x, z);
        if (it) return it.y;
        const br = this.bridgeAt(x, z);
        if (br) return br.deckY;
        const nt = this.naturalAt(x, z);
        if (nt) return ContinentSystem.reliefAt(nt.field, nt.FW, ((x - nt.minX) / nt.grid) * 2, ((z - nt.minZ) / nt.grid) * 2);
        const base = this.levelHeight(x, z);
        const t = this._terrain;
        return t?.relief ? base + ContinentSystem.reliefAt(t.relief, t.W + 1, (x - t.minX) / t.grid, (z - t.minZ) / t.grid) : base;
    }

    /**
     * Relief (smooth rolling ground over the height levels, world units at tile
     * corners, written by tools/zone/kit.mjs) at tile-space (u, v): Catmull-Rom
     * bicubic over an n x n corner grid. Same code as kit.mjs reliefAt and TerrainDataManager.
     */
    static reliefAt(r, n, u, v) {
        if (!r) return 0;
        const cl = (a) => (a < 0 ? 0 : a > n - 1 ? n - 1 : a);
        u = u < 0 ? 0 : u > n - 1 ? n - 1 : u; v = v < 0 ? 0 : v > n - 1 ? n - 1 : v;
        const i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j;
        const cr = (p0, p1, p2, p3, s) => p1 + 0.5 * s * (p2 - p0 + s * (2 * p0 - 5 * p1 + 4 * p2 - p3 + s * (3 * (p1 - p2) + p3 - p0)));
        const row = (jj) => { const o = cl(jj) * n; return cr(r[o + cl(i - 1)], r[o + cl(i)], r[o + cl(i + 1)], r[o + cl(i + 2)], fx); };
        return cr(row(j - 1), row(j), row(j + 1), row(j + 2), fz);
    }

    levelHeight(x, z) {
        const t = this.terrain();
        if (!t) {
            const y = this.game.terrainSystem?.getTerrainHeightAtPosition?.(x, z);
            return Number.isFinite(y) ? y : 0;
        }
        const fx = (x - t.minX) / t.grid, fz = (z - t.minZ) / t.grid;
        const gx = Math.floor(fx), gz = Math.floor(fz);
        const here = this.tileLevel(gx, gz);
        if (here == null) return 2 * t.step;
        const tx = fx - gx, tz = fz - gz;
        const slope = (high, low, pos) => {
            const k = Math.max(0, Math.min(1, pos / 2));
            const s = k * k * (3 - 2 * k);
            return (high * (1 - s) + low * s) * t.step;
        };
        // [dx, dz, distance from the far edge toward that neighbour (0..1)]
        const dirs = [[0, -1, 1 - tz], [0, 1, tz], [-1, 0, 1 - tx], [1, 0, tx]];
        for (const [dx, dz, toward] of dirs) {
            const nb = this.tileLevel(gx + dx, gz + dz);
            if (nb == null) continue;
            if (here > nb && this.isRamp(gx, gz)) return slope(here, nb, toward);              // on the ramp tile
            if (nb > here && this.isRamp(gx + dx, gz + dz)) return slope(nb, here, 2 - toward);  // on the tile below it
        }
        return here * t.step;
    }

    /** The composite terrain if (x, z) is on natural (heightfield) ground, else null. */
    naturalAt(x, z) {
        const t = this.terrain();
        if (!t?.field) return null;
        const gx = Math.floor((x - t.minX) / t.grid), gz = Math.floor((z - t.minZ) / t.grid);
        return gx >= 0 && gz >= 0 && gx < t.W && gz < t.H && t.natural[gz * t.W + gx] ? t : null;
    }

    /** The water surface at (x, z) (a lake, a river, the sea), or null. */
    mmoWaterAt(x, z) {
        const t = this.terrain();
        if (!t) return null;
        const gx = Math.floor((x - t.minX) / t.grid), gz = Math.floor((z - t.minZ) / t.grid);
        if (gx < 0 || gz < 0 || gx >= t.W || gz >= t.H) return null;
        const i = gz * t.W + gx, ty = t.terrainTypes[t.types[i]];
        if (ty === 'sea') return this.mmoContinent()?.seaLevel ?? 22.5;
        if (ty === 'water' && t.hm[i] >= 0) return t.hm[i] * t.step + t.step / 2;
        return null;
    }

    static SWIM_DEPTH = 20;          // water deeper than this over the bed: swimming, not wading

    /** Is (x, z) water deep enough to swim in? */
    mmoSwimAt(x, z) {
        const s = this.mmoWaterAt(x, z);
        return s != null && s - this.mmoWalkHeight(x, z) > ContinentSystem.SWIM_DEPTH ? s : null;
    }

    /** Water or lava on natural ground (it can't be walked into). */
    liquidAt(x, z) {
        const t = this.naturalAt(x, z);
        if (!t) return false;
        return t.liquid[Math.floor((z - t.minZ) / t.grid) * t.W + Math.floor((x - t.minX) / t.grid)] === 1;
    }

    /** Is (x, z) at least `margin` units inside the world (some zone covers it all round)? */
    inWorld(x, z, margin = 40) {
        const t = this.terrain();
        if (!t) return Math.abs(x) < 1536 - margin && Math.abs(z) < 1536 - margin;
        const at = (px, pz) => this.tileLevel(Math.floor((px - t.minX) / t.grid), Math.floor((pz - t.minZ) / t.grid)) != null;
        return at(x - margin, z) && at(x + margin, z) && at(x, z - margin) && at(x, z + margin);
    }

    /** Steepest rise per unit of the ground around (x, z), in any direction (natural ground). */
    steepnessAt(x, z) {
        const e = 12, h = (px, pz) => this.mmoWalkHeight(px, pz);
        return Math.hypot(h(x + e, z) - h(x - e, z), h(x, z + e) - h(x, z - e)) / (2 * e);
    }

    /**
     * Can a walker step from (x0,z0) to (x1,z1)? Blocks cliffs (sudden height
     * changes), solid buildings, trees and the edge of the world. Shared by
     * client prediction, server validation and creature movement.
     */
    mmoCanStep(x0, z0, x1, z1, swim = false) {
        const it0 = this.mmoInteriorAt(x0, z0), it1 = this.mmoInteriorAt(x1, z1);
        if (it0 || it1) return it0 === it1 && this.interiorStep(it1, x0, z0, x1, z1);     // doors move you between them
        if (!this.inWorld(x1, z1)) return false;
        const startBlocked = this.mmoBlocked(x0, z0);   // already inside: let them walk out
        const dist = Math.hypot(x1 - x0, z1 - z0);
        const steps = Math.max(1, Math.ceil(dist / 4));     // finer than a 2-cell building wall
        let prevY = this.mmoWalkHeight(x0, z0);
        const seg = dist / steps;
        const startWet = this.liquidAt(x0, z0);
        for (let i = 1; i <= steps; i++) {
            const k = i / steps;
            const sx = x0 + (x1 - x0) * k, sz = z0 + (z1 - z0) * k;
            if (!startBlocked && this.mmoBlocked(sx, sz) && !this.bridgeAt(sx, sz)) return false;     // a deck passes over whatever stands below it
            if (swim && this.mmoWaterAt(sx, sz) != null) { prevY = this.mmoWalkHeight(sx, sz); continue; }   // a swimmer: the surface, not the bed
            const y = this.mmoWalkHeight(sx, sz);
            if (this.naturalAt(sx, sz)) {
                // Natural ground: climb up to CLIMB, step down up to DROP (rise per unit);
                // water and lava can't be entered (only left, if you're somehow in it).
                const dy = y - prevY;
                if (dy > ContinentSystem.CLIMB * seg + 0.5 || -dy > ContinentSystem.DROP * seg + 0.5) return false;
                if (!startWet && this.liquidAt(sx, sz) && !this.bridgeAt(sx, sz)) return false;
            } else if (Math.abs(y - prevY) > 12) return false;
            prevY = y;
        }
        return true;
    }

    // ==================== PATHFINDING ====================
    //
    // A* over the world tile grid. Tiles are walkable unless a building covers
    // their centre or a tree stands near it; neighbours connect when they share
    // a height level or are joined by a ramp. Paths are string-pulled with
    // mmoCanStep so walkers cut corners instead of zig-zagging between tiles.

    navGrid() {
        const t = this.terrain();
        if (!t) return null;
        if (this._nav) return this._nav;
        const { W, H } = t;
        const open = new Uint8Array(W * H);
        // tiles near a building (only those need the building tests)
        const near = new Uint8Array(W * H);
        for (const b of this.blockers()) {
            const g0 = this.tileOf(b.x - b.r - 24, b.z - b.r - 24), g1 = this.tileOf(b.x + b.r + 24, b.z + b.r + 24);
            for (let gz = Math.max(0, g0.gz); gz <= Math.min(H - 1, g1.gz); gz++) {
                for (let gx = Math.max(0, g0.gx); gx <= Math.min(W - 1, g1.gx); gx++) near[gz * W + gx] = 1;
            }
        }
        for (let gz = 0; gz < H; gz++) {
            for (let gx = 0; gx < W; gx++) {
                if (t.hm[gz * W + gx] < 0) continue;
                const c = this.tileCenter(gx, gz);
                // A tree near the centre closes the tile: paths go round
                // copses instead of threading trunks (string-pulling with
                // mmoCanStep still lets walkers cut between them).
                // Buildings close every tile they touch: walkers keep out of them
                // (doorways are for players).
                const inBuilding = near[gz * W + gx] && [[0, 0], [-16, -16], [16, -16], [-16, 16], [16, 16]]
                    .some(([ox, oz]) => this.mmoBlocked(c.x + ox, c.z + oz) || this.mmoBuildingAt(c.x + ox, c.z + oz));
                open[gz * W + gx] = inBuilding || this.treeAt(c.x, c.z, 22) ? 0 : 1;
            }
        }
        this._nav = { W, H, open };
        return this._nav;
    }

    /** Natural ground: can a walker go from tile a's centre to neighbour b's (cached)? */
    naturalLink(ax, az, bx, bz) {
        const t = this.terrain();
        if (!this._links) this._links = new Map();
        const key = (az * t.W + ax) * 9 + (bz - az + 1) * 3 + (bx - ax + 1);
        let v = this._links.get(key);
        if (v === undefined) {
            if (t.liquid[bz * t.W + bx]) v = false;
            else { const a = this.tileCenter(ax, az), b = this.tileCenter(bx, bz); v = this.mmoCanStep(a.x, a.z, b.x, b.z); }
            this._links.set(key, v);
        }
        return v;
    }

    tileCenter(gx, gz) {
        const t = this.terrain();
        return { x: (gx + 0.5) * t.grid + t.minX, z: (gz + 0.5) * t.grid + t.minZ };
    }

    tileOf(x, z) {
        const t = this.terrain();
        return { gx: Math.floor((x - t.minX) / t.grid), gz: Math.floor((z - t.minZ) / t.grid) };
    }

    /** Can you walk from tile a to orthogonal neighbour b? */
    tilesConnect(ax, az, bx, bz) {
        const t = this.terrain();
        if (t?.field && t.natural[az * t.W + ax] && t.natural[bz * t.W + bx]) return this.naturalLink(ax, az, bx, bz);
        const ha = this.tileLevel(ax, az), hb = this.tileLevel(bx, bz);
        if (ha == null || hb == null) return false;
        if (ha === hb) return true;
        return ha > hb ? this.isRamp(ax, az) : this.isRamp(bx, bz);
    }

    /**
     * Path from (x0,z0) to (x1,z1) as world waypoints (excluding the start),
     * or null when unreachable. maxNodes bounds the search cost.
     */
    mmoFindPath(x0, z0, x1, z1, maxNodes = 6000) {
        const it = this.mmoInteriorAt(x0, z0);
        if (it || this.mmoInteriorAt(x1, z1)) {
            if (it !== this.mmoInteriorAt(x1, z1)) return null;
            return this.mmoCanStep(x0, z0, x1, z1) ? [{ x: x1, z: z1 }] : this.interiorPath(it, x0, z0, x1, z1);
        }
        const nav = this.navGrid();
        if (!nav) return null;
        if (this.mmoCanStep(x0, z0, x1, z1)) return [{ x: x1, z: z1 }];
        const { W, H, open } = nav;
        const s = this.tileOf(x0, z0), g = this.tileOf(x1, z1);
        const inside = (gx, gz) => gx >= 0 && gz >= 0 && gx < W && gz < H;
        if (!inside(s.gx, s.gz) || !inside(g.gx, g.gz)) return null;
        const sI = s.gz * W + s.gx, gI = g.gz * W + g.gx;

        // the search's arrays are kept between calls and stamped per search (a whole-world fill each
        // call was most of a search's cost, with many walkers)
        if (!this._pf || this._pf.n !== W * H) this._pf = { n: W * H, g: new Float32Array(W * H), came: new Int32Array(W * H), seen: new Uint32Array(W * H), shut: new Uint32Array(W * H), stamp: 0 };
        const P = this._pf;
        if (++P.stamp >= 0xfffffff0) { P.seen.fill(0); P.shut.fill(0); P.stamp = 1; }
        const st = P.stamp, came = P.came;
        const gOf = (i) => (P.seen[i] === st ? P.g[i] : Infinity);
        const setG = (i, v) => { P.seen[i] = st; P.g[i] = v; };
        const heap = [];
        const push = (i, f) => {
            heap.push([f, i]);
            let c = heap.length - 1;
            while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
        };
        const pop = () => {
            const top = heap[0], last = heap.pop();
            if (heap.length) {
                heap[0] = last;
                let c = 0;
                for (;;) {
                    const l = c * 2 + 1, r = l + 1;
                    let m = c;
                    if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                    if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                    if (m === c) break;
                    [heap[m], heap[c]] = [heap[c], heap[m]]; c = m;
                }
            }
            return top;
        };
        const h = (gx, gz) => Math.hypot(gx - g.gx, gz - g.gz);

        setG(sI, 0);
        came[sI] = -1;
        push(sI, h(s.gx, s.gz));
        let expanded = 0, found = false;
        const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
        while (heap.length && expanded < maxNodes) {
            const [, i] = pop();
            if (P.shut[i] === st) continue;
            P.shut[i] = st;
            expanded++;
            if (i === gI) { found = true; break; }
            const cx = i % W, cz = (i - cx) / W;
            for (const [dx, dz, cost] of dirs) {
                const nx = cx + dx, nz = cz + dz;
                if (!inside(nx, nz)) continue;
                const ni = nz * W + nx;
                if (P.shut[ni] === st || (!open[ni] && ni !== gI)) continue;
                if (dx && dz) {
                    // Diagonals only across flat ground with both orthogonal tiles open.
                    if (!open[cz * W + nx] || !open[nz * W + cx]) continue;
                    const t = this.terrain();
                    if (t.field && t.natural[cz * W + cx] && t.natural[nz * W + nx]) {
                        if (!this.naturalLink(cx, cz, nx, nz) || !this.naturalLink(cx, cz, nx, cz) || !this.naturalLink(cx, cz, cx, nz)) continue;
                    } else {
                        const hc = this.tileLevel(cx, cz);
                        if (this.tileLevel(nx, nz) !== hc || this.tileLevel(nx, cz) !== hc || this.tileLevel(cx, nz) !== hc) continue;
                    }
                } else if (!this.tilesConnect(cx, cz, nx, nz)) continue;
                const ng = gOf(i) + cost;
                if (ng < gOf(ni)) {
                    setG(ni, ng);
                    came[ni] = i;
                    push(ni, ng + h(nx, nz));
                }
            }
        }
        if (!found) return null;

        // Rebuild tile chain, convert to centres, end on the exact goal.
        const tiles = [];
        for (let i = gI; i !== -1 && i !== sI; i = came[i]) tiles.push(i);
        tiles.reverse();
        const pts = tiles.map(i => this.tileCenter(i % W, Math.floor(i / W)));
        pts[pts.length - 1] = { x: x1, z: z1 };

        // String-pull: from each point, jump to the farthest directly reachable one.
        const out = [];
        let cur = { x: x0, z: z0 }, k = 0;
        while (k < pts.length) {
            let far = k;
            for (let j = pts.length - 1; j > k; j--) {
                if (this.mmoCanStep(cur.x, cur.z, pts[j].x, pts[j].z)) { far = j; break; }
            }
            out.push(pts[far]);
            cur = pts[far];
            k = far + 1;
        }
        return out;
    }

    /** A zone by id. */
    mmoZone(id) { return (id && this.collections.zones?.[id]) || null; }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.ContinentSystem = ContinentSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.ContinentSystem = ContinentSystem; }
export default ContinentSystem;
export { ContinentSystem };
