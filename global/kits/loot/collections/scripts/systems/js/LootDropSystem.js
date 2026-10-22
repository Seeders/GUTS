/**
 * LootDropSystem - drops lying on the ground as entities (where the game's rules run).
 *
 * spawnLoot(position, drops, opts) lays drops ({ item, n } | { gold }, as LootSystem.rollTable gives
 * them) round a point, each its own entity with transform + lootDrop, and tells the game
 * (onLootDropped { entityId, drop }). With "prefab" set in configs/loot.json "drops", each is made
 * from that prefab (units kit) with a model from "models", so it is drawn like any world object.
 *
 * pickupLoot(dropId, pickerId) is how something takes one: the game hears onLootPickup
 * { picker, entityId, item, n, gold, taken } and sets `taken` to how many it could carry (default:
 * all); what's left stays on the ground. Entities with a lootPicker component pick up gold (and,
 * with "items": true, items) within their radius by themselves. Drops go after "life" seconds.
 *
 * configs/loot.json "drops": { life: 600, scatter: [22, 60], prefab: null, collection: 'worldObjects',
 *   models: { gold, default, kind: { [kind]: model }, slot: { [slot]: model }, rarity: { [rarity]: model } } }
 */
class LootDropSystem extends GUTS.BaseSystem {
    static services = ['spawnLoot', 'pickupLoot', 'getLootDrops'];
    static serviceDependencies = ['getItemDef', 'createEntityFromPrefab', 'getTerrainHeightAtPosition'];
    static DEFAULTS = { life: 600, scatter: [22, 60], prefab: null, collection: 'worldObjects', models: {} };

    constructor(game) {
        super(game);
        this.game.lootDropSystem = this;
        this._acc = 0;
    }

    get config() { return { ...LootDropSystem.DEFAULTS, ...(this.collections.configs?.loot?.drops || {}) }; }

    now() { return this.game.state?.now || 0; }

    rand() {
        const L = this.game.lootSystem;
        return L ? L.rand() : Math.random();
    }

    /** The model a drop is drawn with (configs/loot.json drops.models), or null. */
    modelFor(drop) {
        const M = this.config.models || {};
        if (drop.gold) return M.gold || M.default || null;
        const def = this.game.hasService('getItemDef') ? this.call.getItemDef(drop.item) : null;
        return (def && (M.rarity?.[def.rarity] || M.slot?.[def.slot] || M.kind?.[def.kind])) || M.default || null;
    }

    groundY(x, z, fallback = 0) {
        return this.game.hasService('getTerrainHeightAtPosition') ? (this.call.getTerrainHeightAtPosition(x, z) ?? fallback) : fallback;
    }

    /** Lay drops round position; returns their entity ids. opts: { scatter: [min, max] } */
    spawnLoot(position, drops, opts = {}) {
        const C = this.config, [r0, r1] = opts.scatter || C.scatter, ids = [];
        (drops || []).forEach((drop, i) => {
            const a = this.rand() * Math.PI * 2, r = drops.length === 1 && !opts.scatter ? 0 : r0 + this.rand() * (r1 - r0 + i * 8);
            const x = position.x + Math.cos(a) * r, z = position.z + Math.sin(a) * r;
            const transform = { position: { x, y: this.groundY(x, z, position.y || 0), z }, rotation: { x: 0, y: this.rand() * Math.PI * 2, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
            const model = C.prefab && this.game.hasService('createEntityFromPrefab') ? this.modelFor(drop) : null;
            let id = null;
            if (model) id = this.call.createEntityFromPrefab({ prefab: C.prefab, type: model, collection: C.collection, team: this.enums.team?.neutral ?? 0, componentOverrides: { transform } });
            if (id == null) { id = this.game.createEntity(); this.game.addComponent(id, 'transform', transform); }
            this.game.addComponent(id, 'lootDrop', { item: drop.item || '', n: drop.n || 1, gold: drop.gold || 0, at: this.now() });
            ids.push(id);
            this.game.triggerEvent('onLootDropped', { entityId: id, drop });
        });
        return ids;
    }

    /** Take a drop: the game hears onLootPickup and says how much it took. Returns the event, or null. */
    pickupLoot(dropId, pickerId) {
        const d = this.game.getComponent(dropId, 'lootDrop');
        if (!d) return null;
        const ev = { picker: pickerId, entityId: dropId, item: d.item || null, n: d.n, gold: d.gold, taken: d.gold ? 1 : d.n };
        this.game.triggerEvent('onLootPickup', ev);
        if (!d.gold && ev.taken > 0 && ev.taken < d.n) { d.n -= ev.taken; return ev; }
        if (ev.taken > 0) this.game.destroyEntity(dropId);
        return ev;
    }

    getLootDrops() {
        return this.game.getEntitiesWith('lootDrop', 'transform');
    }

    update() {
        this._acc += this.game.state.deltaTime || 0.05;
        if (this._acc < 0.25) return;
        this._acc = 0;
        const drops = this.getLootDrops();
        if (!drops.length) return;
        const now = this.now(), life = this.config.life;
        const pickers = this.game.getEntitiesWith('lootPicker', 'transform');
        for (const id of [...drops]) {
            const d = this.game.getComponent(id, 'lootDrop');
            if (life > 0 && now - d.at > life) { this.game.destroyEntity(id); continue; }
            if (!pickers.length) continue;
            const p = this.game.getComponent(id, 'transform').position;
            for (const pid of pickers) {
                const lp = this.game.getComponent(pid, 'lootPicker');
                if (!d.gold && !lp.items) continue;
                const q = this.game.getComponent(pid, 'transform').position;
                if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < lp.radius * lp.radius) { this.pickupLoot(id, pid); break; }
            }
        }
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.LootDropSystem = LootDropSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.LootDropSystem = LootDropSystem; }
export default LootDropSystem;
export { LootDropSystem };
