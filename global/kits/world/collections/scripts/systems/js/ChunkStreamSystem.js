/**
 * ChunkStreamSystem - streams and draws the continent around the player (client only; the GUTS
 * world kit). The world's numbers are ContinentSystem's (this.world).
 *
 * The continent is stored as square chunks of tiles. Nothing is loaded whole: chunk data within
 * DATA units of the player is fetched (ContinentSystem.mmoFetchChunk puts it into the world grid
 * that walking and the camera read), and chunks within LOAD units are drawn, one step per frame
 * (ground, then water, then props a batch at a time). Chunks past UNLOAD are freed. Fog hides the
 * edge of what is drawn.
 *
 * Drawing reads the world grid, never one chunk alone, so chunks meet without seams:
 *   ground  a mesh of MESH-unit cells; heights from mmoWalkHeight; colours per tile from each
 *           zone's palette (zones' `palette`), blended over the neighbouring zones' near borders
 *           (zone weights from the overview's zone map), then rock on steep ground and snow above
 *           a snowy zone's snow line
 *   liquids water and lava tiles as flat surfaces at their tile level, with the level's
 *           water/lava shaders (fog added)
 *   props   the chunk's levelEntities as world objects (trees, rocks, clutter)
 *   ocean   one plane at sea level under the whole world (land covers it)
 *
 * Also loads the overview (resources/world/map.png, zones.png) for the maps.
 *
 * A game extends it (`class MmoWorldChunkSystem extends GUTS.ChunkStreamSystem`), says where its
 * player is (playerPos), and overrides what it draws differently (buildGround, waterMaterial,
 * spawnProps...).
 */
class ChunkStreamSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'createEntityFromPrefab'
    ];

    static DATA = 9500;            // fetch chunk data whose square comes this close (world units)
    static LOAD = 6500;            // draw chunks this close
    static UNLOAD = 7800;          // free them past this
    static MESH = 16;              // ground cell (world units): tools/zone/terrain.mjs seats props on this mesh
    static BLEND = 5;              // zone colour blend radius (tiles)
    static PROPS_PER_FRAME = 120;

    constructor(game) {
        super(game);
        this.game.chunkStreamSystem = this;
        this.chunks = new Map();          // id -> { c, group, entities, state, d }
        this.queue = [];
        this.scene = null;
        this.time = 0;
        this.checkAt = 0;
        this.liquidMaterials = {};
        this.overview = null;             // { W, H, zone: Uint8Array, sea: Uint8Array, map: HTMLImageElement }
    }

    /** The world (the kit's ContinentSystem: a game's rules system extends it). */
    get world() { return this.game.continentSystem; }

    /** Where the player is ({ x, z }), or null before entering: chunks stream around it. */
    playerPos() { return null; }

    async postSceneLoad() {
        if (this.game.isServer) return;
        const ws = this.game.worldSystem;
        if (ws?.setupWorldRenderingPromise) await ws.setupWorldRenderingPromise;
        const wr = ws?.worldRenderer;
        this.scene = wr?.getScene?.();
        const gs = this.world;
        if (!this.scene || !gs?.terrain()) return console.warn('[chunks] no scene or continent');
        // the stub level's own ground and water stay hidden
        if (wr.ground) wr.ground.visible = false;
        for (const m of wr.liquidMeshes || []) m.visible = false;
        this.groundMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
        await this.loadOverview();
        this.buildPalettes();
        this.buildOcean();
        this.ready = true;
    }

    // ==================== OVERVIEW ====================

    /** The continent's overview images: ground colours (the maps) and zone index / sea per tile. */
    async loadOverview() {
        const base = (this.game.app?.getResourcesPath?.() || './resources/') + 'world/';
        const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
        const [map, zones] = await Promise.all([load(`${base}map.png`), load(`${base}zones.png`)]);
        if (!zones) return;
        const c = document.createElement('canvas');
        c.width = zones.width; c.height = zones.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(zones, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data, N = c.width * c.height;
        const zone = new Uint8Array(N), sea = new Uint8Array(N);
        const sub = new Uint8Array(N);
        for (let i = 0; i < N; i++) { zone[i] = d[i * 4]; sea[i] = d[i * 4 + 1] > 127 ? 1 : 0; sub[i] = d[i * 4 + 2]; }
        this.overview = { W: c.width, H: c.height, zone, sea, sub, map };
    }

    // ==================== COLOURS ====================

    /** Ground palettes, one per subzone (continent.json subzones; else one per zone): blending runs over these. */
    buildPalettes() {
        const t = this.world.terrain(), subs = this.world.mmoContinent()?.subzones;
        this.bySub = !!(subs?.length && this.overview?.sub);
        const col = (hex) => { const c = new THREE.Color(hex || '#7a8a5a'); return [c.r, c.g, c.b]; };
        this.pal = (this.bySub ? subs : t.zones).map(z => {
            const p = z.palette || {};
            return {
                types: t.terrainTypes.map(name => col(p.types?.[name] || (name === 'sea' ? p.types?.water : null))),
                rock: col(p.rock || '#8a857a'), rockSlope: p.rockSlope || [0.7, 1.1],
                snow: p.snow ? col(p.snow) : null, snowLine: p.snowLine || [1e9, 1e9], variation: p.variation ?? 0.06
            };
        });
    }

    /**
     * Per-tile colours for a chunk and a one-tile margin: the tile's ground in each
     * nearby zone's palette, weighted by how much of the BLEND window that zone fills.
     */
    chunkColours(ch) {
        const t = this.world.terrain(), ov = this.overview, n = this.world.mmoContinent().chunk;
        const Z = this.pal.length, R = ChunkStreamSystem.BLEND, M = n + 2;
        const gx0 = ch.c.cx * n - 1, gz0 = ch.c.cz * n - 1;
        const rgb = new Float32Array(M * M * 3), rock = new Float32Array(M * M * 3), snowW = new Float32Array(M * M * Z);
        const zoneAt = (gx, gz) => {
            gx = Math.max(0, Math.min(t.W - 1, gx)); gz = Math.max(0, Math.min(t.H - 1, gz));
            return ov ? (this.bySub ? ov.sub : ov.zone)[gz * ov.W + gx] : Math.max(0, t.zoneIdx[gz * t.W + gx]);
        };
        // zone counts over the window, slid along each row
        const counts = new Float32Array(Z);
        for (let j = 0; j < M; j++) {
            const gz = gz0 + j;
            counts.fill(0);
            for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) counts[zoneAt(gx0 + dx, gz + dz)]++;
            for (let i = 0; i < M; i++) {
                const gx = gx0 + i;
                if (i > 0) for (let dz = -R; dz <= R; dz++) { counts[zoneAt(gx - R - 1, gz + dz)]--; counts[zoneAt(gx + R, gz + dz)]++; }
                const ti = Math.max(0, Math.min(t.H - 1, gz)) * t.W + Math.max(0, Math.min(t.W - 1, gx));
                const role = t.hm[ti] >= 0 ? t.types[ti] : t.terrainTypes.indexOf('grass');
                const o = j * M + i, tot = (2 * R + 1) ** 2;
                for (let zi = 0; zi < Z; zi++) {
                    const w = counts[zi] / tot;
                    if (!w) continue;
                    const p = this.pal[zi], c = p.types[role] || p.types[0];
                    for (let k = 0; k < 3; k++) { rgb[o * 3 + k] += c[k] * w; rock[o * 3 + k] += p.rock[k] * w; }
                    snowW[o * Z + zi] = w;
                }
            }
        }
        return { rgb, rock, snowW, M, gx0, gz0 };
    }

    // ==================== STREAMING ====================

    update() {
        if (!this.ready) return;
        const dt = this.game.state.deltaTime || 1 / 60;
        this.time += dt;
        for (const m of Object.values(this.liquidMaterials)) if (m.uniforms?.time) m.uniforms.time.value = this.time;
        this.updateWaterLight();
        const pos = this.playerPos();
        if (pos && this.time >= this.checkAt) {
            this.checkAt = this.time + 0.4;
            this.plan(pos.x, pos.z);
        }
        this.work();
    }

    /** Which chunks to fetch, which to draw (nearest first) and which to free. */
    plan(x, z) {
        const gs = this.world, cont = gs.mmoContinent(), t = gs.terrain();
        const half = (cont.chunk * cont.grid) / 2;
        const dist = (c) => Math.hypot(Math.max(0, Math.abs(x - c.x) - half), Math.max(0, Math.abs(z - c.z) - half));
        for (const c of cont.chunks) {
            const d = dist(c), have = this.chunks.get(c.id);
            if (d < ChunkStreamSystem.DATA && !t.loaded.has(c.id)) gs.mmoFetchChunk(c.id);
            if (d < ChunkStreamSystem.LOAD && !have && t.loaded.has(c.id)) {
                this.chunks.set(c.id, { c, state: 'queued', entities: [], d });
                this.queue.push(c.id);
            } else if (have) {
                have.d = d;
                if (d > ChunkStreamSystem.UNLOAD) this.free(c.id);
            }
        }
        this.queue.sort((a, b) => (this.chunks.get(a)?.d ?? 1e9) - (this.chunks.get(b)?.d ?? 1e9));
    }

    /**
     * Are the height data of every chunk around this one in? The ground is sampled bicubically,
     * so a chunk's edge rows read into its neighbours' heights: built before a neighbour's data
     * arrives, its edge sags into a long strip (and is never rebuilt).
     */
    neighboursReady(c) {
        const gs = this.world, t = gs.terrain(), cont = gs.mmoContinent();
        if (!this._byCell) { this._byCell = new Map(); for (const q of cont.chunks) this._byCell.set(`${q.cx},${q.cz}`, q.id); }
        let ok = true;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const nid = this._byCell.get(`${c.cx + dx},${c.cz + dz}`);
            if (nid != null && !t.loaded.has(nid)) { gs.mmoFetchChunk(nid); ok = false; }
        }
        return ok;
    }

    /** One step of building: the nearest queued chunk's next part (its ground waits for its neighbours' heights). */
    work() {
        while (this.queue.length && !this.chunks.get(this.queue[0])) this.queue.shift();
        let qi = 0;
        while (qi < this.queue.length) {
            const c = this.chunks.get(this.queue[qi]);
            if (c && (c.state !== 'queued' || this.neighboursReady(c.c))) break;
            qi++;
        }
        const id = this.queue[qi];
        if (!id) return;
        if (qi) { this.queue.splice(qi, 1); this.queue.unshift(id); }
        const ch = this.chunks.get(id);
        try {
            if (ch.state === 'queued') { this.buildGround(ch); ch.state = 'ground'; }
            else if (ch.state === 'ground') { this.buildLiquids(ch); ch.state = 'props'; ch.propAt = 0; }
            else if (ch.state === 'props') {
                if (this.spawnProps(ch)) { ch.state = 'done'; this.queue.shift(); }
            }
        } catch (e) {
            console.error(`[chunks] ${id}`, e);
            ch.state = 'done';
            this.queue.shift();
        }
    }

    free(id) {
        const ch = this.chunks.get(id);
        if (!ch) return;
        this.chunks.delete(id);
        if (ch.group) {
            this.scene.remove(ch.group);
            ch.group.traverse(o => { o.geometry?.dispose?.(); });
        }
        for (const e of ch.entities) { try { this.game.destroyEntity(e); } catch (err) { /* gone */ } }
    }

    // ==================== GROUND ====================

    buildGround(ch) {
        const gs = this.world, t = gs.terrain(), cont = gs.mmoContinent();
        const size = cont.chunk * cont.grid, half = size / 2, MS = ChunkStreamSystem.MESH, N = Math.round(size / MS);
        const x0 = ch.c.x - half, z0 = ch.c.z - half;
        const V = (N + 1) * (N + 1);
        const pos = new Float32Array(V * 3), col = new Float32Array(V * 3);
        const { rgb, rock, snowW, M, gx0, gz0 } = this.chunkColours(ch);
        const pal = this.pal, Z = pal.length;
        const smooth = (a, b, v) => { const k = Math.max(0, Math.min(1, (v - a) / (b - a))); return k * k * (3 - 2 * k); };
        const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
        const cell = (i, j) => Math.max(0, Math.min(M - 1, j)) * M + Math.max(0, Math.min(M - 1, i));
        for (let j = 0; j <= N; j++) {
            for (let i = 0; i <= N; i++) {
                const v = j * (N + 1) + i, x = x0 + i * MS, z = z0 + j * MS;
                const y = gs.mmoWalkHeight(x, z);
                pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
                // the four nearest tiles' colours, smoothly blended
                const u = (x - t.minX) / t.grid - 0.5 - gx0, w = (z - t.minZ) / t.grid - 0.5 - gz0;
                const ci = Math.floor(u), cj = Math.floor(w), fx = u - ci, fz = w - cj;
                const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
                const a = cell(ci, cj), b = cell(ci + 1, cj), c = cell(ci, cj + 1), d = cell(ci + 1, cj + 1);
                const mix = (arr, k) => (arr[a * 3 + k] * (1 - sx) + arr[b * 3 + k] * sx) * (1 - sz) + (arr[c * 3 + k] * (1 - sx) + arr[d * 3 + k] * sx) * sz;
                let r = mix(rgb, 0), g = mix(rgb, 1), bl = mix(rgb, 2);
                // rock on steep ground
                const e = 8, dx = gs.mmoWalkHeight(x + e, z) - gs.mmoWalkHeight(x - e, z), dz = gs.mmoWalkHeight(x, z + e) - gs.mmoWalkHeight(x, z - e);
                const slope = Math.hypot(dx, dz) / (2 * e);
                let rs0 = 0, rs1 = 0, varn = 0, snowK = 0, sr = 0, sg = 0, sb = 0, sw = 0;
                for (let q = 0; q < Z; q++) {
                    const wq = snowW[a * Z + q];
                    if (!wq) continue;
                    const p = pal[q];
                    rs0 += p.rockSlope[0] * wq; rs1 += p.rockSlope[1] * wq; varn += p.variation * wq;
                    if (p.snow) { snowK += wq * smooth(p.snowLine[0], p.snowLine[1], y); sr += p.snow[0] * wq; sg += p.snow[1] * wq; sb += p.snow[2] * wq; sw += wq; }
                }
                const kr = smooth(rs0 || 0.7, rs1 || 1.1, slope);
                if (kr > 0) { r += (mix(rock, 0) - r) * kr; g += (mix(rock, 1) - g) * kr; bl += (mix(rock, 2) - bl) * kr; }
                // snow above the snow line, where a snowy zone reaches
                if (sw > 0) {
                    const ks = snowK * (1 - kr * 0.7);
                    if (ks > 0) { r += (sr / sw - r) * ks; g += (sg / sw - g) * ks; bl += (sb / sw - bl) * ks; }
                }
                const jit = 1 + (hash(Math.round(x / 24), Math.round(z / 24)) - 0.5) * 2 * (varn || 0.06);
                col[v * 3] = r * jit; col[v * 3 + 1] = g * jit; col[v * 3 + 2] = bl * jit;
            }
        }
        const idx = new Uint32Array(N * N * 6);
        let k = 0;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
            idx[k++] = a; idx[k++] = c; idx[k++] = b;
            idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, this.groundMaterial);
        mesh.receiveShadow = true;
        mesh.name = `ground:${ch.c.id}`;
        const group = new THREE.Group();
        group.name = `chunk:${ch.c.id}`;
        group.add(mesh);
        this.scene.add(group);
        ch.group = group;
    }

    // ==================== LIQUIDS ====================

    /**
     * Lakes, rivers, the sea's shore and lava of the chunk. Water tiles are cut finer (WATER_SUB a
     * side) and carry their depth (surface to bed) for the water shader: shallows, shore foam, the
     * soft edge. Open sea away from the shore is left to the ocean plane.
     */
    static WATER_SUB = 4;

    buildLiquids(ch) {
        const gs = this.world, t = gs.terrain(), cont = gs.mmoContinent();
        const grid = t.grid, n = cont.chunk, x0 = ch.c.x - (n * grid) / 2, z0 = ch.c.z - (n * grid) / 2;
        const gx0 = ch.c.cx * n, gz0 = ch.c.cz * n, ext = grid * 0.25;
        const level = { waterShader: 'water', lavaShader: 'lava' };
        const typeAt = (x, z) => { const gx = gx0 + x, gz = gz0 + z; return gx >= 0 && gz >= 0 && gx < t.W && gz < t.H && t.hm[gz * t.W + gx] >= 0 ? t.types[gz * t.W + gx] : -1; };
        const W = t.terrainTypes.indexOf('water'), SEA = t.terrainTypes.indexOf('sea'), sea = cont.seaLevel ?? 22.5;
        const wet = (ty) => ty === W || ty === SEA;
        // the bed under the water: the natural heightfield, else the tile levels
        const bed = (x, z) => {
            const nt = gs.naturalAt(x, z);
            return nt ? GUTS.ContinentSystem.reliefAt(nt.field, nt.FW, ((x - nt.minX) / nt.grid) * 2, ((z - nt.minZ) / nt.grid) * 2) : gs.levelHeight(x, z);
        };
        const shoreSea = (x, z) => {                                    // a sea tile within two of land
            for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (!wet(typeAt(x + dx, z + dz))) return true;
            return false;
        };
        for (const name of ['water', 'lava']) {
            const verts = [], uvs = [], depth = [], idx = [];
            for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
                const ty = typeAt(x, z);
                let y;
                if (name === 'lava') { if (ty !== t.terrainTypes.indexOf('lava')) continue; y = t.hm[(gz0 + z) * t.W + gx0 + x] * t.step + t.step / 2; }
                else if (ty === W) y = t.hm[(gz0 + z) * t.W + gx0 + x] * t.step + t.step / 2;
                else if (ty === SEA && shoreSea(x, z)) y = sea;
                else continue;
                const same = (dx, dz) => (name === 'lava' ? typeAt(x + dx, z + dz) === ty : wet(typeAt(x + dx, z + dz)));
                // pushed out where it meets the shore so it tucks under the bank
                const l = same(-1, 0) ? 0 : ext, r = same(1, 0) ? 0 : ext, u = same(0, -1) ? 0 : ext, d = same(0, 1) ? 0 : ext;
                const ax = x0 + x * grid - l, az = z0 + z * grid - u, bx = x0 + (x + 1) * grid + r, bz = z0 + (z + 1) * grid + d;
                const S = name === 'water' ? ChunkStreamSystem.WATER_SUB : 1, base = verts.length / 3;
                for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
                    const px = ax + (bx - ax) * i / S, pz = az + (bz - az) * j / S;
                    verts.push(px, y, pz);
                    uvs.push(gx0 + x + i / S, gz0 + z + j / S);
                    // how far in from the water's edge (the tile sides that meet land; negative out under the bank)
                    let edge = 999;
                    if (!same(-1, 0)) edge = Math.min(edge, px - (x0 + x * grid));
                    if (!same(1, 0)) edge = Math.min(edge, x0 + (x + 1) * grid - px);
                    if (!same(0, -1)) edge = Math.min(edge, pz - (z0 + z * grid));
                    if (!same(0, 1)) edge = Math.min(edge, z0 + (z + 1) * grid - pz);
                    if (!same(-1, -1)) edge = Math.min(edge, Math.hypot(px - (x0 + x * grid), pz - (z0 + z * grid)));
                    if (!same(1, -1)) edge = Math.min(edge, Math.hypot(x0 + (x + 1) * grid - px, pz - (z0 + z * grid)));
                    if (!same(-1, 1)) edge = Math.min(edge, Math.hypot(px - (x0 + x * grid), z0 + (z + 1) * grid - pz));
                    if (!same(1, 1)) edge = Math.min(edge, Math.hypot(x0 + (x + 1) * grid - px, z0 + (z + 1) * grid - pz));
                    const d = name === 'water' ? Math.min(y - bed(px, pz), edge * 0.3) : 10;      // shallow toward any shore
                    depth.push(Math.max(-4, Math.min(120, d)));
                }
                for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
                    const a0 = base + j * (S + 1) + i, a1 = a0 + 1, a2 = a0 + S + 1, a3 = a2 + 1;
                    idx.push(a0, a2, a1, a1, a2, a3);
                }
            }
            if (!idx.length) continue;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mesh = new THREE.Mesh(geo, name === 'water' ? this.waterMaterial() : this.liquidMaterial(name, level));
            mesh.name = `${name}:${ch.c.id}`;
            ch.group.add(mesh);
        }
    }

    // ==================== WATER ====================
    //
    // One material for lakes, rivers and the sea: rippling normals (a few travelling waves and two
    // octaves of noise), the sky in it by Fresnel, the sun's glint, shallow-to-deep colour by the
    // water's depth over its bed, foam lapping at the shore and a soft edge where it meets land,
    // the scene's fog. The sun follows the scene's directional light.

    waterMaterial() {
        if (this._water) return this._water;
        const vs = `
            attribute float aDepth;
            uniform float time;
            varying vec3 vWorld;
            varying float vDepth;
            varying float vFogDepth;
            void main() {
                vec4 w = modelMatrix * vec4(position, 1.0);
                float open = clamp(aDepth / 10.0, 0.0, 1.0);
                w.y += (sin(w.x * 0.045 + time * 1.1) * 0.6 + sin(w.z * 0.038 - time * 0.9) * 0.5 + sin((w.x + w.z) * 0.021 + time * 0.6) * 0.7) * open;
                vWorld = w.xyz;
                vDepth = aDepth;
                vec4 mv = viewMatrix * w;
                vFogDepth = -mv.z;
                gl_Position = projectionMatrix * mv;
            }`;
        const fs = `
            uniform float time;
            uniform vec3 deepColor, shallowColor, skyColor, horizonColor, sunColor, sunDir, foamColor;
            uniform vec3 fogColor;
            uniform float fogDensity;
            varying vec3 vWorld;
            varying float vDepth;
            varying float vFogDepth;
            float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float noise(vec2 p) {
                vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
            }
            // slope of a wave field at p: travelling waves plus two drifting noise octaves
            vec2 slope(vec2 p) {
                vec2 g = vec2(0.0);
                vec2 d1 = normalize(vec2(1.0, 0.35)), d2 = normalize(vec2(-0.6, 1.0)), d3 = normalize(vec2(0.2, -1.0)), d4 = normalize(vec2(-1.0, -0.2));
                g += d1 * cos(dot(p, d1) * 0.06 + time * 1.3) * 0.06;
                g += d2 * cos(dot(p, d2) * 0.09 + time * 1.7) * 0.045;
                g += d3 * cos(dot(p, d3) * 0.15 + time * 2.3) * 0.03;
                g += d4 * cos(dot(p, d4) * 0.23 + time * 2.9) * 0.02;
                float e = 0.5;
                vec2 q = p * 0.05 + vec2(time * 0.12, time * 0.07), r = p * 0.13 - vec2(time * 0.09, -time * 0.15);
                g += vec2(noise(q + vec2(e, 0)) - noise(q - vec2(e, 0)), noise(q + vec2(0, e)) - noise(q - vec2(0, e))) * 0.18;
                g += vec2(noise(r + vec2(e, 0)) - noise(r - vec2(e, 0)), noise(r + vec2(0, e)) - noise(r - vec2(0, e))) * 0.10;
                return g;
            }
            void main() {
                vec2 g = slope(vWorld.xz);
                vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
                vec3 V = normalize(cameraPosition - vWorld);
                float dist = length(cameraPosition - vWorld);
                N = normalize(mix(N, vec3(0.0, 1.0, 0.0), clamp(dist / 9000.0, 0.0, 0.7)));       // calmer far off
                float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
                float depth = max(vDepth, 0.0);
                vec3 body = mix(shallowColor, deepColor, smoothstep(2.0, 45.0, depth));
                vec3 R = reflect(-V, N);
                vec3 sky = mix(horizonColor, skyColor, clamp(R.y * 1.6, 0.0, 1.0));
                vec3 col = mix(body, sky, fres * 0.7);
                // the sun on the ripples
                float sp = pow(max(dot(R, normalize(sunDir)), 0.0), 220.0);
                col += sunColor * sp * 2.2;
                col += sunColor * pow(max(dot(R, normalize(sunDir)), 0.0), 24.0) * 0.12;
                // foam: lines lapping in from the shore, broken by noise
                float shore = 1.0 - smoothstep(0.0, 7.0, depth);
                float lap = 0.5 + 0.5 * sin(depth * 1.6 - time * 1.8 + noise(vWorld.xz * 0.08) * 4.0);
                float foam = shore * smoothstep(0.55, 0.95, lap) * (0.6 + 0.4 * noise(vWorld.xz * 0.3 + time * 0.2));
                foam = max(foam, (1.0 - smoothstep(0.0, 1.4, depth)) * 0.8);
                col = mix(col, foamColor, clamp(foam, 0.0, 1.0) * 0.85);
                float alpha = mix(0.55, 0.93, smoothstep(1.0, 30.0, depth));
                alpha = max(alpha, fres);
                alpha *= smoothstep(-1.5, 2.0, vDepth);                                            // a soft edge on the sand
                col = mix(col, fogColor, 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth));
                gl_FragColor = vec4(col, alpha);
            }`;
        const C = (h) => new THREE.Color(h);
        this._water = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                deepColor: { value: C(0x0d2f42) }, shallowColor: { value: C(0x2a6466) },
                skyColor: { value: C(0x7fa8cf) }, horizonColor: { value: C(0xc9dbe6) },
                sunColor: { value: C(0xfff1d0) }, sunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
                foamColor: { value: C(0xeef6f4) },
                fogColor: { value: this.scene?.fog?.color || new THREE.Color(0xffffff) },
                fogDensity: { value: this.scene?.fog?.density || 0.0002 }
            },
            vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, side: THREE.DoubleSide
        });
        this.liquidMaterials.water = this._water;                      // (time ticks with the others)
        return this._water;
    }

    /** Sky, horizon and sun for the water: from the scene's fog and its directional light. */
    updateWaterLight() {
        const m = this._water;
        if (!m || !this.scene) return;
        if (!this._sun || !this._sun.parent) {
            this._sun = null;
            this.scene.traverse(o => { if (!this._sun && o.isDirectionalLight) this._sun = o; });
        }
        if (this._sun) {
            const d = new THREE.Vector3().subVectors(this._sun.position, this._sun.target?.position || new THREE.Vector3()).normalize();
            m.uniforms.sunDir.value.copy(d);
            m.uniforms.sunColor.value.copy(this._sun.color).multiplyScalar(Math.min(1.4, 0.6 + this._sun.intensity * 0.4));
        }
        const fog = this.scene.fog?.color;
        if (fog) {
            m.uniforms.fogColor.value = fog;
            m.uniforms.horizonColor.value.copy(fog).lerp(new THREE.Color(1, 1, 1), 0.15);
            m.uniforms.skyColor.value.copy(fog).multiply(new THREE.Color(0.75, 0.85, 1.05));
        }
        if (this.scene.fog?.density) m.uniforms.fogDensity.value = this.scene.fog.density;
    }

    /** The level's water or lava shader (as WorldRenderer builds it), shared by every chunk. */
    liquidMaterial(name, level) {
        if (this.liquidMaterials[name]) return this.liquidMaterials[name];
        const def = this.collections.shaders?.[name === 'water' ? level.waterShader : level.lavaShader];
        let m;
        if (def?.vertexScript && def?.fragmentScript) {
            const uniforms = {};
            for (const [k, u] of Object.entries(def.uniforms || {})) {
                let v = u.value;
                if (def.vectors?.includes(k)) {
                    if (Array.isArray(v)) v = new THREE.Vector3(v[0], v[1], v[2]);
                    else if (typeof v === 'string' && v.startsWith('#')) { const c = new THREE.Color(v); v = new THREE.Vector3(c.r, c.g, c.b); }
                    else v = new THREE.Vector3(0, 0, 0);
                }
                uniforms[k] = { value: v };
            }
            const base = new THREE.Color(name === 'water' ? 0x3a6f9a : 0xff5a1f);
            const unset = (u) => u && (!u.value || (u.value.isVector3 && !u.value.x && !u.value.y && !u.value.z));
            if (unset(uniforms.liquidColor)) uniforms.liquidColor.value = new THREE.Vector3(base.r, base.g, base.b);
            if (unset(uniforms.foamColor)) uniforms.foamColor.value = new THREE.Vector3(Math.min(1, base.r + 0.3), Math.min(1, base.g + 0.3), Math.min(1, base.b + 0.3));
            uniforms.fogColor = { value: this.scene?.fog?.color || new THREE.Color(0xffffff) };
            uniforms.fogDensity = { value: this.scene?.fog?.density || 0.0002 };
            if (def.texture && this.game.imageManager) {
                const tex = this.game.imageManager.getTexture(def.texture);
                if (tex) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = ''; uniforms.overlayTexture = { value: tex }; }
            }
            // the level shaders have no fog: add the scene's (exponential squared), so far water fades like the land
            const end = (src, code) => { const i = src.lastIndexOf('}'); return src.slice(0, i) + code + '\n' + src.slice(i); };
            const vs = 'varying float vFogDepth;\n' + end(def.vertexScript, '    vFogDepth = -(modelViewMatrix * vec4(position, 1.0)).z;');
            const fs = 'uniform vec3 fogColor;\nuniform float fogDensity;\nvarying float vFogDepth;\n'
                + end(def.fragmentScript, '    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth));');
            m = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, transparent: true, side: THREE.DoubleSide, depthWrite: true });
        } else {
            m = new THREE.MeshStandardMaterial({ color: name === 'water' ? 0x3a6f9a : 0xff5a1f, transparent: true, opacity: name === 'water' ? 0.75 : 0.95, side: THREE.DoubleSide });
        }
        this.liquidMaterials[name] = m;
        return m;
    }

    /** The sea: one plane at sea level under the whole world; the land covers it, the sea bed is carved below. */
    buildOcean() {
        const gs = this.world, t = gs.terrain(), cont = gs.mmoContinent();
        const S = Math.max(t.W, t.H) * t.grid + 120000, seg = 64;
        const geo = new THREE.PlaneGeometry(S, S, seg, seg);
        geo.rotateX(-Math.PI / 2);
        const uv = geo.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * S / t.grid, uv.getY(i) * S / t.grid);
        geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(80), 1));
        const mesh = new THREE.Mesh(geo, this.waterMaterial());
        mesh.position.set(t.minX + (t.W * t.grid) / 2, (cont.seaLevel ?? 22) - 0.6, t.minZ + (t.H * t.grid) / 2);
        mesh.renderOrder = -1;
        mesh.name = 'ocean';
        this.scene.add(mesh);
        this.ocean = mesh;
    }

    // ==================== PROPS ====================

    /** Spawns the next batch of the chunk's props; true when all are out. */
    spawnProps(ch) {
        const level = this.collections.levels?.[`chunk_${ch.c.id}`];
        const list = level?.tileMap?.levelEntities || [];
        if (!this.prefabToCollection) {
            this.prefabToCollection = {};
            for (const [id, def] of Object.entries(this.collections.objectTypeDefinitions || {})) if (def.singular) this.prefabToCollection[def.singular] = id;
        }
        const end = Math.min(list.length, ch.propAt + ChunkStreamSystem.PROPS_PER_FRAME);
        for (; ch.propAt < end; ch.propAt++) {
            const e = list[ch.propAt];
            const collection = this.prefabToCollection[e.spawnType];
            const typeData = collection && this.collections[collection]?.[e.type];
            const p = e.components?.transform?.position;
            if (!typeData || !p) continue;
            const transform = { ...e.components.transform, position: { x: p.x + ch.c.x, y: p.y || 0, z: p.z + ch.c.z } };
            if (typeData.render?.model && !typeData.renderTexture && !typeData.spriteAnimationSet && !e.fixed) {
                // meshes: a stable random turn and size per spot, so repeats don't look stamped
                const h = Math.abs(Math.sin(transform.position.x * 12.9898 + transform.position.z * 78.233) * 43758.5453) % 1;
                const k = 0.85 + ((h * 7.31) % 1) * 0.3;
                transform.rotation = { x: 0, y: h * Math.PI * 2, z: 0 };
                transform.scale = { x: k, y: k, z: k };
            }
            try {
                const id = this.call.createEntityFromPrefab({
                    prefab: typeData.prefab || e.spawnType, type: e.type, collection, team: this.enums.team.neutral,
                    componentOverrides: { ...e.components, transform }
                });
                if (id != null) ch.entities.push(id);
            } catch (err) { /* skip a bad prop */ }
        }
        return ch.propAt >= list.length;
    }

    onSceneUnload() {
        for (const id of [...this.chunks.keys()]) this.free(id);
        if (this.ocean) { this.ocean.parent?.remove(this.ocean); this.ocean.geometry.dispose(); this.ocean = null; }
        this.queue = [];
        this.ready = false;
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.ChunkStreamSystem = ChunkStreamSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.ChunkStreamSystem = ChunkStreamSystem; }
export default ChunkStreamSystem;
export { ChunkStreamSystem };
