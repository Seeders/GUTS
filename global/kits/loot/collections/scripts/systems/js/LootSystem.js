/**
 * LootSystem - rolled items and drop tables, after Diablo II (runs where the game's rules run: the
 * server, or every peer of a lockstep game; it uses the seeded `game.rng`, strand 'loot').
 *
 * Items are ordinary item definitions in one collection (configs/loot.json "items", default
 * "itemDefs"). A rolled item is a new definition under a new id (prefix "g_"), registered into that
 * collection, so anything that reads items reads rolled ones too. The game hears of each one
 * (onLootItemRegistered { id, def }) to send it to clients and save it with whoever holds it.
 *
 * Rolling an item (rollItem(ilvl, opts) -> id)
 *   1. a rarity, by its chance, better ones helped by magic find (diminishing: mf * k / (mf + k))
 *   2. a base: an item with "base": true whose "qlvl" the item level reaches; a kind first (each kind
 *      alike, kindWeight), then usually the best tier of it
 *   3. the rarity's affixes: prefixes and suffixes (the affixes data) whose "where" names the base's
 *      category, at a tier the item level reaches, values rolled in the tier's range
 *   4. a name (prefix base suffix, two random words, or a word before the base), enhanced
 *      damage/defense, sockets, durability (and ethereal), a level requirement and a price
 *   5. unidentified, if the rarity says so: the base's name and numbers show until revealed
 * "unique" and "set" rarities copy one of the hand-made items ("unique": true / "setItem": true)
 * whose level fits, else fall back to the next rarity.
 *
 * Data (paths into collections are dotted strings, e.g. "descent.affixes.affixes"):
 *   configs/loot.json   { items, idPrefix, seeded, affixes, runewords, sets, rarities, rareWords, ethereal,
 *                          weaponStats, armorStat, tables, socketRaisesLevel }
 *   affixes  [{ prefix: bool, stat, where: [categories], group, tiers: [{ name, alvl, lo, hi }] }]
 *   tables   { name: { always: [entries], each: [entries with p], rolls: n | [lo, hi], entries: [with w] } }
 *            an entry's drop: "gold" { gold: { base, perLevel, spread } }, "item" { rarity, slot, ilvl, mf },
 *            "id" { id, n }, "table" { table }, "nothing", or one the game adds (registerDropType)
 *   runewords [{ name, kinds: [categories], runes: [item ids in order], stats, procs }]
 *   sets     { setId: { name, pieces: [item ids], bonuses: { "2": stats, "3": stats, "full": stats } } }
 *
 * Games change the details by subclassing (extends GUTS.LootSystem) and overriding the hooks:
 * category, kindOf, kindWeight, affixAllows, applyAffix, finishItem, finishCopy, normalizeStats, baseNameOf.
 */
class LootSystem extends GUTS.BaseSystem {
    static services = [
        'rollItem', 'rollTable', 'registerItem', 'getItemDef', 'uniqueCopy', 'identifyItem', 'isUnidentified',
        'registerDropType', 'socketItem', 'setBonuses', 'wearItem', 'repairCost', 'isBroken',
        'exportItems', 'importItems', 'forgetItems', 'rolledItemIds'
    ];

    static RARITIES = [
        { id: 'unique', chance: 0.006, mfK: 2.5, from: 'unique', quality: 'unique', identified: false, levelKey: 'ilvl', window: [14, 3] },
        { id: 'set', chance: 0.014, mfK: 5, from: 'set', quality: 'set', identified: false, levelKey: 'qlvl', window: [null, 2] },
        { id: 'rare', chance: 0.05, mfK: 6, quality: 'rare', identified: false, priceMult: 6, naming: 'random', sockets: false,
            affixes: { min: 2, max: 4, maxPrefix: 3, maxSuffix: 3, byLevel: [[12, 2, 5], [30, 2, 6]] } },
        { id: 'magic', chance: 0.25, mf: 'full', quality: 'magic', identified: false, priceMult: 3, naming: 'affixes',
            affixes: { min: 1, max: 2, maxPrefix: 1, maxSuffix: 1 } },
        { id: 'superior', otherwise: 0.12, quality: 'normal', title: ['Superior'], ed: [0.05, 0.15], priceMult: 1.5, socketChance: 0.3, flag: 'superior' },
        { id: 'low', otherwise: 0.12, quality: 'low', title: ['Crude', 'Cracked', 'Damaged', 'Low Quality'], ed: [-0.25, -0.25], priceMult: 0.4 },
        { id: 'normal', quality: 'normal', socketChance: 0.3 }
    ];
    static RARE_WORDS = {
        a: ['Doom', 'Grim', 'Blood', 'Bone', 'Gloom', 'Storm', 'Shadow', 'Soul', 'Wraith', 'Rune', 'Dread', 'Raven', 'Viper', 'Skull', 'Death', 'Ash', 'Grave', 'Spirit', 'Stone', 'Wind'],
        b: { weapon: ['Bite', 'Song', 'Fang', 'Edge', 'Thirst', 'Reaver', 'Cleaver', 'Spike', 'Call'], helm: ['Visage', 'Crown', 'Hood', 'Brow', 'Cowl', 'Mask', 'Horn'],
            chest: ['Shroud', 'Hide', 'Mantle', 'Shell', 'Coat'], gloves: ['Grip', 'Fist', 'Claw', 'Hand', 'Clutch'], boots: ['Stride', 'Tread', 'Track', 'Spur'],
            belt: ['Coil', 'Lash', 'Cord', 'Girdle'], cloak: ['Wings', 'Shade', 'Veil', 'Wrap'], ring: ['Loop', 'Band', 'Circle', 'Eye', 'Grasp'],
            amulet: ['Beads', 'Heart', 'Collar', 'Talisman'], shield: ['Ward', 'Wall', 'Guard', 'Aegis', 'Tower'] }
    };
    static DEFAULTS = {
        items: 'itemDefs', idPrefix: 'g_', seeded: true, affixes: 'affixes', runewords: 'runewords', sets: 'sets', tables: 'lootTables',
        weaponStats: ['weaponMin', 'weaponMax'], armorStat: 'armor', ethereal: null, rareWords: null, rarities: null
    };

    constructor(game) {
        super(game);
        this.game.lootSystem = this;
        this.dropTypes = new Map();
        this._n = 0;
        this._cache = {};
    }

    get config() {
        if (!this._config) this._config = { ...LootSystem.DEFAULTS, ...(this.collections.configs?.loot || {}) };
        return this._config;
    }

    onSceneLoad() {
        this._config = null;
        this._cache = {};
    }

    // ==================== DATA ====================

    /** A collection, or a dotted path into the collections, or the value itself. */
    data(ref) {
        if (ref == null || typeof ref !== 'string') return ref;
        let v = this.collections;
        for (const k of ref.split('.')) { v = v?.[k]; if (v == null) return null; }
        return v;
    }
    list(ref) {
        const v = this.data(ref);
        return Array.isArray(v) ? v : v ? Object.values(v) : [];
    }
    defs() { return this.data(this.config.items) || (this.collections[this.config.items] = {}); }
    getItemDef(id) { return this.defs()[id] || null; }
    affixes() { return this._cache.affixes ||= this.list(this.config.affixes); }
    rarities() { return this.config.rarities || LootSystem.RARITIES; }
    rarityOf(id) { return this.rarities().find(r => r.id === id) || null; }
    bases() { return this._cache.bases ||= Object.entries(this.defs()).filter(([, d]) => d.base === true); }
    uniques() { return this._cache.uniques ||= Object.entries(this.defs()).filter(([id, d]) => d.unique && !id.startsWith(this.config.idPrefix)); }
    setPieces() { return this._cache.sets ||= Object.entries(this.defs()).filter(([id, d]) => d.setItem && !id.startsWith(this.config.idPrefix)); }

    // ==================== RANDOMNESS ====================

    rand() {
        // (looked up each time: a game that reseeds clears its strands, and a kept handle would miss that)
        if (this.config.seeded !== false && this.game.rng?.strand) return this.game.rng.strand('loot').next();
        return Math.random();
    }
    pick(arr) { return arr[Math.floor(this.rand() * arr.length)]; }
    pickW(list, w) {
        const tot = list.reduce((n, e) => n + Math.max(0, w(e)), 0);
        let r = this.rand() * tot;
        for (const e of list) { r -= Math.max(0, w(e)); if (r <= 0) return e; }
        return list[list.length - 1];
    }
    rollRange(lo, hi) {
        const v = lo + this.rand() * (hi - lo);
        return Math.abs(hi) < 1 && Math.abs(lo) < 1 ? +v.toFixed(3) : Math.round(v);
    }
    static effMF(mf, k) { return mf > 0 ? mf * k / (mf + k) : 0; }

    // ==================== HOOKS (override in a game's subclass) ====================

    /** What affixes, runewords and rare names know an item as. */
    category(def) {
        if (def.cat) return def.cat;
        return { weapon: 'weapon', offhand: def.shield ? 'shield' : 'weapon', head: 'helm', chest: 'chest', hands: 'gloves', feet: 'boots', waist: 'belt', back: 'cloak', finger: 'ring', neck: 'amulet' }[def.slot] || 'armor';
    }
    /** Bases of one kind are one choice when rolling (then a tier of it). */
    kindOf(def) { return `${this.category(def)}:${def.weaponType || def.armorType || ''}`; }
    kindWeight(kind) { return 1; }
    affixAllows(affix, def) { return affix.where.includes(this.category(def)) || (!!def.weaponType && affix.where.includes(def.weaponType)); }
    /**
     * Put a rolled affix's value onto the item. Returns the word for its name, or false to reject it.
     * ctx: { def, st (its stats), base, ilvl, tierIndex, prefix }; ctx.ed collects enhanced damage.
     */
    applyAffix(affix, tier, v, ctx) {
        const { def, st, base } = ctx, [wMin, wMax] = this.config.weaponStats;
        if (affix.stat === 'ed') ctx.ed += v / 100;
        else if (affix.stat === 'maxDmg' && st[wMax] != null) st[wMax] += v;
        else if (affix.stat === 'minDmg' && st[wMin] != null) st[wMin] += v;
        else if (affix.stat === 'sockets') def.sockets = Math.min(base.maxSockets || 2, v);
        else if (affix.stat === 'indestructible') def.indestructible = true;
        else if (affix.stat === 'reqReduce') { st.reqReduce = v; for (const k of Object.keys(def.req || {})) def.req[k] = Math.round(def.req[k] * (1 - v)); }
        else st[affix.stat] = +((st[affix.stat] || 0) + v).toFixed(3);
        return tier.name;
    }
    /** Last touches to a freshly rolled item (before naming, pricing, durability and hiding). */
    finishItem(def, base, rarity, ctx) { }
    normalizeStats(st) { return st; }
    /** Last touches to a copy of a hand-made item (uniqueCopy), before durability and hiding. */
    finishCopy(def, src) { }
    /** The name an unidentified item shows. */
    baseNameOf(def, src) { return def.base || def.baseName || src?.title || def.title; }

    // ==================== ROLLING ITEMS ====================

    /** The rarity a roll comes out as, for magic find mf. */
    rollRarity(mf = 0) {
        const r = this.rand();
        let acc = 0;
        const list = this.rarities();
        for (const q of list) {
            if (q.chance == null) continue;
            const boost = q.mf === 'full' ? mf : LootSystem.effMF(mf, q.mfK ?? 0);
            acc += q.chance * (1 + boost);
            if (r < acc) return q.id;
        }
        for (const q of list) if (q.otherwise != null && this.rand() < q.otherwise) return q.id;
        return list.find(q => q.chance == null && q.otherwise == null)?.id || 'normal';
    }

    /**
     * A rolled item for item level ilvl, as an item id (null if nothing fits).
     * opts: { rarity (forced), magicFind, slot, base (a base id), filter (def => bool), identified, noEthereal }
     */
    rollItem(ilvl, opts = {}) {
        ilvl = Math.max(1, Math.round(ilvl));
        let rid = opts.rarity || this.rollRarity(opts.magicFind || 0);
        for (let guard = 0; guard < 8; guard++) {
            const q = this.rarityOf(rid);
            if (!q) return null;
            if (q.from === 'unique' || q.from === 'set') {
                const src = q.from === 'unique' ? this.uniques() : this.setPieces();
                // (its level within window [below, above] of the item level; null: no limit that side)
                const [below, above] = q.window || [null, 3], lv = (d) => d[q.levelKey || 'ilvl'] || 1;
                const pool = src.filter(([, d]) => (above == null || lv(d) <= ilvl + above) && (below == null || lv(d) >= ilvl - below) && (!opts.slot || d.slot === opts.slot) && (!opts.filter || opts.filter(d)));
                if (pool.length) return this.uniqueCopy(this.pick(pool)[0], opts.identified);
                rid = q.fallback || this.rarities()[this.rarities().indexOf(q) + 1]?.id;
                continue;
            }
            const base = this.pickBase(ilvl, opts);
            return base ? this.make(base[0], base[1], ilvl, rid, opts) : null;
        }
        return null;
    }

    /** [id, def] of a base for this item level: a kind first, then (mostly) its best tier the level allows. */
    pickBase(ilvl, opts = {}) {
        const fits = ([id, d]) => (opts.base ? id === opts.base : (!opts.slot || d.slot === opts.slot)) && (!opts.filter || opts.filter(d));
        let pool = this.bases().filter(e => fits(e) && (e[1].qlvl || 1) <= ilvl);
        if (!pool.length) pool = this.bases().filter(fits).sort((p, q) => (p[1].qlvl || 1) - (q[1].qlvl || 1)).slice(0, 1);
        if (!pool.length) return null;
        const kinds = [...new Set(pool.map(([, d]) => this.kindOf(d)))];
        const kind = this.pickW(kinds, k => this.kindWeight(k));
        const ofKind = pool.filter(([, d]) => this.kindOf(d) === kind).sort((p, q) => (q[1].qlvl || 1) - (p[1].qlvl || 1));
        return ofKind[this.rand() < 0.65 ? 0 : Math.floor(this.rand() * ofKind.length)];
    }

    /** An item of a base, at an item level, of a rarity (id or rarity object). */
    make(baseId, base, ilvl, rarity, opts = {}) {
        const q = typeof rarity === 'object' ? rarity : this.rarityOf(rarity) || { id: rarity };
        const def = JSON.parse(JSON.stringify(base));
        delete def.base; delete def.maxSockets; delete def.armorRange;
        const st = def.stats = { ...(base.stats || {}) };
        const cat = this.category(base), [wMin, wMax] = this.config.weaponStats, armor = this.config.armorStat;
        if (base.armorRange) st[armor] = base.armorRange[0] + Math.floor(this.rand() * (base.armorRange[1] - base.armorRange[0] + 1));
        const ctx = { def, st, base, ilvl, ed: 0, alvlMax: 0, prefixes: [], suffixes: [], used: new Set(), rarity: q.id, opts };
        // affixes
        const A = q.affixes;
        if (A) {
            let [lo, hi] = [A.min ?? 1, A.max ?? 1];
            for (const [lv, a, b] of A.byLevel || []) if (ilvl >= lv) { lo = a; hi = b; }
            const n = lo + Math.floor(this.rand() * (hi - lo + 1));
            const maxP = A.maxPrefix ?? n, maxS = A.maxSuffix ?? n;
            for (let i = 0; i < n * 3 && ctx.prefixes.length + ctx.suffixes.length < n; i++) {
                const p = ctx.prefixes.length, s = ctx.suffixes.length;
                const want = p >= maxP ? false : s >= maxS ? true : this.rand() < 0.5;
                if (want ? p >= maxP : s >= maxS) break;
                this.rollAffix(want, ctx);
            }
        }
        if (q.ed) ctx.ed += q.ed[0] + this.rand() * (q.ed[1] - q.ed[0]);
        if (q.flag) def[q.flag] = true;
        this.finishItem(def, base, q, ctx);
        // enhanced damage (or defense), baked in
        if (ctx.ed) {
            if (st[wMin] != null) { st[wMin] = Math.max(1, Math.round(st[wMin] * (1 + ctx.ed))); st[wMax] = Math.max(st[wMin], Math.round(st[wMax] * (1 + ctx.ed))); }
            else if (st[armor]) st[armor] = Math.max(1, Math.round(st[armor] * (1 + ctx.ed)));
            if (ctx.ed > 0 && q.affixes) def.ed = Math.round(ctx.ed * 100);
        }
        if (st[wMin] != null && st[wMax] != null) st[wMax] = Math.max(st[wMin], st[wMax]);
        // sockets: some plain items have them (as many as base and level allow); some rarities never do
        if (q.sockets === false) delete def.sockets;
        else if (q.socketChance && base.maxSockets && this.rand() < q.socketChance) {
            const cap = Math.min(base.maxSockets, ilvl < 26 ? 3 : ilvl < 41 ? 4 : 6);
            def.sockets = 1 + Math.floor(this.rand() * cap);
        }
        if (def.sockets) def.socketed = [];
        // the name
        let title = base.title;
        if (q.naming === 'affixes') title = [ctx.prefixes[0], base.title, ctx.suffixes[0]].filter(Boolean).join(' ');
        else if (q.naming === 'random') {
            const W = this.config.rareWords || LootSystem.RARE_WORDS;
            title = `${this.pick(W.a)} ${this.pick(W.b[cat] || W.b.weapon)}`;
            def.base = base.title;
        } else if (q.title) title = `${this.pick(q.title)} ${base.title}`;
        this.normalizeStats(st);
        this.wearable(def, base, opts);
        def.title = title;
        def.quality = q.quality || q.id;
        def.rarity = q.id;
        def.ilvl = ilvl;
        def.level = Math.max(base.level || 1, Math.round(ctx.alvlMax * 0.8));
        def.price = Math.max(5, Math.round((base.price || 20) * (q.priceMult || 1) * (1 + (ctx.prefixes.length + ctx.suffixes.length) * 0.4) * (def.ethereal ? 1.3 : 1)));
        def.from = baseId;
        def.baseName = base.title;
        if (q.identified === false && !opts.identified) this.hide(def);
        return this.registerItem(def);
    }

    /** One affix (prefix or suffix) onto ctx's item; false if none fits. */
    rollAffix(prefix, ctx) {
        const { def, ilvl, used } = ctx;
        const ok = this.affixes().filter(a => !!a.prefix === prefix && this.affixAllows(a, def) && !used.has(a.stat) && !(a.group && used.has(a.group)) && a.tiers.some(t => t.alvl <= ilvl));
        if (!ok.length) return false;
        const a = this.pick(ok);
        used.add(a.stat);
        if (a.group) used.add(a.group);
        const tiers = a.tiers.filter(t => t.alvl <= ilvl);
        const t = tiers[Math.max(0, tiers.length - 1 - Math.floor(this.rand() * Math.min(3, tiers.length)))];
        ctx.tierIndex = a.tiers.indexOf(t);
        ctx.prefix = prefix;
        const word = this.applyAffix(a, t, this.rollRange(t.lo, t.hi), ctx);
        if (word === false) return false;
        ctx.alvlMax = Math.max(ctx.alvlMax, t.alvl);
        (prefix ? ctx.prefixes : ctx.suffixes).push(word);
        return true;
    }

    /**
     * Durability (and the ethereal, if configs/loot.json "ethereal" { chance, mult, reqMinus, reqKeys } is set):
     * an item that can wear gets its base's maxDur, full. An ethereal one hits harder (or guards
     * better) for less durability and can never be mended.
     */
    wearable(def, base, opts = {}) {
        if (!base?.maxDur || def.indestructible) { delete def.maxDur; delete def.dur; return; }
        def.maxDur = base.maxDur;
        const E = this.config.ethereal;
        if (E && !opts.identified && !opts.noEthereal && this.rand() < (E.chance ?? 0.05)) {
            def.ethereal = true;
            const st = def.stats || {}, [wMin, wMax] = this.config.weaponStats, armor = this.config.armorStat, m = E.mult ?? 1.5;
            if (st[wMin] != null) { st[wMin] = Math.round(st[wMin] * m); st[wMax] = Math.round(st[wMax] * m); }
            else if (st[armor]) st[armor] = Math.round(st[armor] * m);
            if (def.req && E.reqMinus) for (const k of E.reqKeys || Object.keys(def.req)) if (def.req[k]) def.req[k] = Math.max(0, def.req[k] - E.reqMinus);
            def.maxDur = Math.floor(def.maxDur / 2) + 1;
        }
        def.dur = def.maxDur;
    }

    /** A hand-made item's own copy (unique or set piece), unidentified unless asked. */
    uniqueCopy(srcId, identified = false) {
        const t = this.defs()[srcId];
        if (!t) return null;
        const def = JSON.parse(JSON.stringify(t));
        def.gen = srcId;
        this.finishCopy(def, t);
        this.wearable(def, t, {});
        if (!identified) this.hide(def);
        return this.registerItem(def);
    }

    // ==================== IDENTIFICATION ====================

    /** Hide an item's powers: its base's name and numbers show; the rest waits for identifyItem. */
    hide(def) {
        const src = this.defs()[def.from || def.gen], st = def.stats || {}, [wMin, wMax] = this.config.weaponStats, armor = this.config.armorStat;
        def.idTitle = def.title;
        def.title = this.baseNameOf(def, src);
        def.unid = true;
        def.baseStats = Object.fromEntries([armor, wMin, wMax].filter(k => st[k]).map(k => [k, st[k]]));
        def.idPrice = def.price;
        def.price = Math.max(3, Math.round((def.price || 0) * 0.3));
    }

    isUnidentified(id) { return !!this.defs()[id]?.unid; }

    /** Reveal an item: its name, powers and worth. False if it was known. */
    identifyItem(id) {
        const def = this.defs()[id];
        if (!def?.unid) return false;
        def.title = def.idTitle; def.price = def.idPrice;
        delete def.unid; delete def.idTitle; delete def.baseStats; delete def.idPrice;
        this.registerItem(def, id);
        return true;
    }

    // ==================== THE REGISTRY ====================

    /** A rolled item's def under a new id (or an existing id: it changed). Tells the game: onLootItemRegistered. */
    registerItem(def, id = null, info = null) {
        // a new id: from the clock (unique across restarts, so saved items never collide), or from the
        // seeded strand when the game is deterministic (the same on every peer)
        for (let fresh = !id; fresh; fresh = !!this.defs()[id]) {
            const seeded = this.config.seeded !== false && this.game.rng?.strand;
            const r = Math.floor(this.rand() * 36 ** 4).toString(36);
            id = `${this.config.idPrefix}${seeded ? '' : Date.now().toString(36)}${(this._n++).toString(36)}${r}`;
        }
        this.defs()[id] = def;
        this.game.triggerEvent('onLootItemRegistered', { id, def, info });
        return id;
    }

    rolledItemIds() {
        const p = this.config.idPrefix;
        return Object.keys(this.defs()).filter(id => id.startsWith(p));
    }

    /** The defs of these rolled items (and of what's socketed into them), to save with their holder. */
    exportItems(ids) {
        const out = {}, p = this.config.idPrefix, add = (id) => {
            const d = id?.startsWith?.(p) && this.defs()[id];
            if (!d || out[id]) return;
            out[id] = d;
            for (const g of d.socketed || []) add(g);
        };
        for (const id of ids) add(id);
        return out;
    }

    /** Saved rolled items exist again (ones already registered are left as they are). */
    importItems(map) {
        for (const [id, def] of Object.entries(map || {})) if (!this.defs()[id]) this.defs()[id] = def;
    }

    /** Forget rolled items not in `live` (a Set or array of ids that are still held somewhere). */
    forgetItems(live) {
        const keep = live instanceof Set ? live : new Set(live);
        for (const id of [...keep]) for (const g of this.defs()[id]?.socketed || []) keep.add(g);
        let n = 0;
        for (const id of this.rolledItemIds()) if (!keep.has(id)) { delete this.defs()[id]; n++; }
        return n;
    }

    // ==================== DROP TABLES ====================

    /** A drop kind a table's entries can name: fn(entry, level, ctx) -> item id | { item, n } | { gold } | null. */
    registerDropType(name, fn) { this.dropTypes.set(name, fn); }

    /** One table entry as a drop ({ gold } | { item, n }), or null. */
    dropEntry(e, L, ctx = {}) {
        const mf = (ctx.mf || 0) + (e.mf || 0), il = L + (e.ilvl || 0) + (ctx.ilvl || 0);
        const one = (id) => id ? { item: id, n: 1 } : null;
        const custom = this.dropTypes.get(e.drop);
        if (custom) {
            const r = custom.call(this, e, L, { ...ctx, mf, ilvl: il });
            return typeof r === 'string' ? one(r) : r || null;
        }
        switch (e.drop) {
            case 'gold': {
                const g = e.gold || {}, [lo, hi] = g.spread || [0.5, 1.5];
                return { gold: Math.max(1, Math.round(((g.base ?? 4) + (g.perLevel ?? 3) * L) * (lo + this.rand() * (hi - lo)) * (ctx.goldMult || 1) * (1 + (ctx.gf || 0)))) };
            }
            case 'item': return one(this.rollItem(il, { magicFind: mf, rarity: e.rarity || null, slot: Array.isArray(e.slot) ? this.pick(e.slot) : e.slot }));
            case 'id': return e.id && this.defs()[e.id] ? { item: e.id, n: e.n || 1 } : null;
            case 'table': return { many: this.rollTable(e.table, L, ctx) };
            default: return null;                                    // 'nothing'
        }
    }

    /**
     * What a table (its name in the tables data, or the table itself) gives at level L: each of its
     * always, each of its each by its p, and rolls picks from its entries by weight (w, plus flaggedW
     * when ctx.flagged; minLevel skips an entry below that level).
     * ctx: { mf (magic find), gf (gold find), goldMult, ilvl (+levels), flagged, ... (passed to drop types) }
     */
    rollTable(name, L, ctx = {}) {
        const t = typeof name === 'string' ? this.data(this.config.tables)?.[name] : name;
        if (!t) return [];
        const out = [], c = { ...ctx, mf: (ctx.mf || 0) + (t.mf || 0) };
        const put = (e) => {
            const d = e && this.dropEntry(e, L, c);
            if (d?.many) out.push(...d.many);
            else if (d && (d.gold || d.item)) out.push(d);
        };
        for (const e of t.always || []) put(e);
        for (const e of t.each || []) if (this.rand() < (e.p ?? 1)) put(e);
        const n = Array.isArray(t.rolls) ? t.rolls[0] + Math.floor(this.rand() * (t.rolls[1] - t.rolls[0] + 1)) : (t.rolls || 0);
        const ok = (t.entries || []).filter(e => !(e.minLevel > L));
        for (let i = 0; i < n && ok.length; i++) put(this.pickW(ok, e => (e.w || 0) + (c.flagged ? e.flaggedW || 0 : 0)));
        return out;
    }

    // ==================== SOCKETS, RUNEWORDS, SETS ====================

    static addStats(st, more) {
        for (const [k, v] of Object.entries(more || {})) st[k] = +((st[k] || 0) + v).toFixed(4);
        return st;
    }

    /** What a socketable gives this item: its def.socket[weapon | shield | armor]. */
    socketKind(def) {
        const c = this.category(def);
        return c === 'weapon' ? 'weapon' : c === 'shield' ? 'shield' : 'armor';
    }

    /**
     * Set a socketable (an item def with "socket": { weapon, shield, armor: stats }) into an item's next
     * empty socket, for good. Returns { ok, reason, runeword }. A plain item whose sockets fill with
     * runes in a runeword's order becomes that runeword. The caller takes the socketable away.
     */
    socketItem(itemId, gemId) {
        const def = this.defs()[itemId], gem = this.defs()[gemId];
        if (!def || !gem?.socket) return { ok: false, reason: 'not socketable' };
        if (!def.sockets) return { ok: false, reason: 'no sockets' };
        def.socketed ||= [];
        if (def.socketed.length >= def.sockets) return { ok: false, reason: 'full' };
        if (def.unid || gem.unid) return { ok: false, reason: 'unidentified' };
        LootSystem.addStats(def.stats ||= {}, gem.socket[this.socketKind(def)]);
        this.normalizeStats(def.stats);
        if ((this.config.socketRaisesLevel || ['jewel']).includes(gem.kind) && gem.level > (def.level || 1)) def.level = gem.level;      // (a jewel's level: what the item asks)
        def.socketed.push(gemId);
        const rw = this.checkRuneword(def);
        this.registerItem(def, itemId);
        return { ok: true, runeword: rw?.name || null };
    }

    checkRuneword(def) {
        if (def.runeword || def.socketed?.length !== def.sockets || !['normal', 'low', 'common'].includes(def.quality)) return null;
        const kinds = new Set([this.category(def), def.weaponType].filter(Boolean));
        const rw = this.list(this.config.runewords).find(r => r.runes.length === def.sockets && r.runes.every((id, i) => def.socketed[i] === id) && r.kinds.some(k => kinds.has(k)));
        if (!rw) return null;
        LootSystem.addStats(def.stats, rw.stats);
        this.normalizeStats(def.stats);
        if (rw.procs) def.procs = [...(def.procs || []), ...rw.procs.map(p => ({ ...p }))];
        def.runeword = rw.name;
        def.base = def.baseName || def.title;
        def.title = `‘${rw.name}’`;
        def.quality = 'runeword';
        def.price = Math.round((def.price || 100) * 8);
        return rw;
    }

    /** The bonuses of sets worn together: { stats, worn: { setId: pieces } } for these worn item ids. */
    setBonuses(wornIds) {
        const sets = this.data(this.config.sets) || {}, worn = {}, stats = {};
        for (const id of wornIds) { const d = this.defs()[id]; if (d?.set && !this.isBroken(id)) worn[d.set] = (worn[d.set] || 0) + 1; }
        for (const [sid, n] of Object.entries(worn)) {
            const set = sets[sid];
            if (!set) continue;
            for (const [k, bonus] of Object.entries(set.bonuses || {})) {
                if (n >= (k === 'full' ? set.pieces.length : +k)) LootSystem.addStats(stats, this.normalizeStats({ ...bonus }));
            }
        }
        return { stats, worn };
    }

    // ==================== DURABILITY ====================

    isBroken(id) { const d = this.defs()[id]; return !!d?.maxDur && d.dur != null && d.dur <= 0; }

    /** Wear a rolled item by n points. Returns { dur, broke } or null if it doesn't wear. */
    wearItem(id, n = 1) {
        const def = this.defs()[id];
        if (!def?.maxDur || def.indestructible || !(def.dur > 0) || !id.startsWith(this.config.idPrefix)) return null;
        def.dur = Math.max(0, def.dur - n);
        this.registerItem(def, id, { wear: true });
        return { dur: def.dur, broke: def.dur <= 0 };
    }

    /** What mending it costs (0: nothing to mend or it can't be: ethereal). */
    repairCost(id) {
        const d = this.defs()[id];
        if (!d?.maxDur || d.ethereal || !(d.dur < d.maxDur)) return 0;
        return Math.max(1, Math.round((1 - d.dur / d.maxDur) * (d.idPrice || d.price || 20) * 0.3 + (d.dur <= 0 ? 10 : 0)));
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.LootSystem = LootSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.LootSystem = LootSystem; }
export default LootSystem;
export { LootSystem };
