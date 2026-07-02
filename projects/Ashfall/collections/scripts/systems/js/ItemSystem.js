/**
 * ItemSystem - D2-style items with PoE seasoning.
 *
 * - Item generation: base types + prefix/suffix affixes rolled by item level,
 *   rarities Normal/Magic/Rare/Unique, sockets, skill & support gems
 * - Loot drops on monster death (gold / potions / items / gems) as ground
 *   entities with rarity-colored labels (rendered by ArpgLootSystem)
 * - Grid inventory + equipment slots (paper doll) with requirements
 * - Equipment stat integration:
 *     getEquipmentStatBonuses() -> flat stats for ArpgStatsSystem.recompute
 *     collectDamageModifiers()  -> percent modifiers for StatAggregationSystem
 *     getGemGrantedSkills()     -> skill-gem abilities for SkillTreeSystem
 */
class ItemSystem extends GUTS.BaseSystem {
    static services = [
        'generateItem',
        'giveItemToPlayer',
        'dropLootAt',
        'pickupGroundItem',
        'equipItem',
        'unequipItem',
        'socketGem',
        'drinkPotion',
        'getGroundItemInfo',
        'sellItem',
        'addGold',
        'getGold'
    ];

    static serviceDependencies = [
        'getPlayerCharacter',
        'getPlayerEntities',
        'recomputeDerivedStats',
        'refreshGrantedAbilities'
    ];

    static RARITY_COLORS = {
        normal: '#e8e6e3',
        magic: '#7f7fff',
        rare: '#ffff77',
        unique: '#c7893c',
        gem: '#2fbf71',
        potion: '#e06a9f',
        gold: '#f0cf70'
    };

    static EQUIP_SLOTS = ['mainHand', 'offHand', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring1', 'ring2'];

    constructor(game) {
        super(game);
        this.game.itemSystem = this;
        this.nextUid = 1;
        this.groundItems = new Map();  // entityId -> { item | gold | potion payload }
    }

    init() {}

    // ─── Player setup ─────────────────────────────────────────────────────────

    onPlayerCharacterSpawned({ entityId }) {
        if (!this.game.hasComponent(entityId, 'inventory')) {
            const saved = this.game.state.savedInventory;
            this.game.addComponent(entityId, 'inventory', saved ? JSON.parse(JSON.stringify(saved)) : {
                kind: 'arpg', gridW: 10, gridH: 6, items: [], beltLife: 2, beltMana: 2
            });
        }
        if (!this.game.hasComponent(entityId, 'arpgEquipment')) {
            const savedEq = this.game.state.savedEquipment;
            this.game.addComponent(entityId, 'arpgEquipment', savedEq ? JSON.parse(JSON.stringify(savedEq)) : {
                kind: 'arpg', slots: {}
            });
        }
        this.call.recomputeDerivedStats(entityId);
    }

    persist(entityId) {
        const inv = this.game.getComponent(entityId, 'inventory');
        const eq = this.game.getComponent(entityId, 'arpgEquipment');
        if (inv) this.game.state.savedInventory = JSON.parse(JSON.stringify(inv));
        if (eq) this.game.state.savedEquipment = JSON.parse(JSON.stringify(eq));
    }

    // ─── Gold ─────────────────────────────────────────────────────────────────

    playerStats() {
        for (const pid of this.call.getPlayerEntities?.() || []) {
            const stats = this.game.getComponent(pid, 'playerStats');
            if (stats?.playerId === 0) return stats;
        }
        return null;
    }

    addGold(amount) {
        const stats = this.playerStats();
        if (stats) {
            stats.gold = Math.max(0, (stats.gold || 0) + amount);
            this.game.state.savedGold = stats.gold;   // persists across zone travels
        }
        return stats?.gold ?? 0;
    }

    getGold() {
        return this.playerStats()?.gold ?? 0;
    }

    // ─── Item generation ──────────────────────────────────────────────────────

    rollRarity(bonus = 0) {
        const r = Math.random() * 100;
        if (r < 2 + bonus * 2) return 'unique';
        if (r < 14 + bonus * 6) return 'rare';
        if (r < 55 + bonus * 10) return 'magic';
        return 'normal';
    }

    eligibleBases(ilvl) {
        const bases = this.collections.itemBases || {};
        return Object.keys(bases).filter(id => (bases[id].ilvlMin || 1) <= ilvl);
    }

    /**
     * Generate an item.
     * @param {Object} opts - { itemLevel, baseId?, rarity?, magicFindBonus? }
     */
    generateItem(opts = {}) {
        const ilvl = Math.max(1, opts.itemLevel || 1);
        const rarity = opts.rarity || this.rollRarity(opts.magicFindBonus || 0);

        if (rarity === 'unique') {
            const unique = this.rollUnique(ilvl);
            if (unique) return unique;
            // No eligible unique: downgrade to rare
            return this.generateItem({ ...opts, rarity: 'rare' });
        }

        const baseId = opts.baseId || this.pickRandom(this.eligibleBases(ilvl));
        if (!baseId) return null;
        const base = this.collections.itemBases[baseId];

        const item = {
            uid: this.nextUid++,
            baseId,
            rarity,
            ilvl,
            name: base.title,
            affixes: [],
            sockets: [],
            stats: {},
            damageMods: []
        };

        // Sockets (weapons/chest/helmet/shields)
        const maxSockets = base.maxSockets || 0;
        if (maxSockets > 0) {
            const count = Math.min(maxSockets, Math.floor(Math.random() * (maxSockets + 1)));
            item.sockets = new Array(count).fill(null);
        }

        // Affixes by rarity
        if (rarity === 'magic') {
            const nPrefix = Math.random() < 0.6 ? 1 : 0;
            const nSuffix = nPrefix === 0 ? 1 : (Math.random() < 0.5 ? 1 : 0);
            this.rollAffixes(item, base, nPrefix, nSuffix);
        } else if (rarity === 'rare') {
            const nPrefix = 1 + Math.floor(Math.random() * 3); // 1-3
            const nSuffix = 1 + Math.floor(Math.random() * 3); // 1-3
            this.rollAffixes(item, base, nPrefix, nSuffix);
        }

        item.name = this.buildItemName(item, base);
        return item;
    }

    rollUnique(ilvl) {
        const uniques = this.collections.uniqueItems || {};
        const eligible = Object.keys(uniques).filter(id => (uniques[id].ilvlMin || 1) <= ilvl);
        if (!eligible.length) return null;
        const uid = this.pickRandom(eligible);
        const u = uniques[uid];
        const base = this.collections.itemBases?.[u.base];
        if (!base) return null;

        return {
            uid: this.nextUid++,
            baseId: u.base,
            uniqueId: uid,
            rarity: 'unique',
            ilvl,
            name: u.title,
            lore: u.lore,
            affixes: (u.affixTexts || []).map(text => ({ text })),
            sockets: base.maxSockets > 0 ? new Array(Math.min(1, base.maxSockets)).fill(null) : [],
            stats: { ...(u.fixedStats || {}) },
            damageMods: (u.fixedDamageMods || []).slice(),
            reqLevel: u.reqLevel || base.reqLevel || 1
        };
    }

    generateGem(ilvl) {
        const gems = this.collections.gems || {};
        const eligible = Object.keys(gems).filter(id => (gems[id].ilvlMin || 1) <= ilvl);
        if (!eligible.length) return null;
        const gemId = this.pickRandom(eligible);
        const g = gems[gemId];
        return {
            uid: this.nextUid++,
            gemId,
            rarity: 'gem',
            ilvl,
            name: g.title,
            icon: g.icon,
            gem: {
                type: g.gemType,
                ability: g.ability || null,
                level: Math.max(1, Math.floor(ilvl / 4)),
                damageModifiers: g.damageModifiers || [],
                stats: g.stats || {}
            },
            w: 1, h: 1
        };
    }

    generatePotion(kind) {
        return { rarity: 'potion', potionType: kind, name: kind === 'life' ? 'Life Potion' : 'Mana Potion' };
    }

    rollAffixes(item, base, nPrefix, nSuffix) {
        const pool = this.collections.affixes || {};
        const applicableAffixes = (type) => Object.keys(pool).filter(id => {
            const a = pool[id];
            if (a.type !== type) return false;
            if (!this.affixApplies(a, base)) return false;
            // must have at least one tier at this ilvl
            return (a.tiers || []).some(t => t.ilvl <= item.ilvl);
        });

        const used = new Set();
        const rollOne = (type) => {
            const candidates = applicableAffixes(type).filter(id => !used.has(id));
            if (!candidates.length) return;
            const affixId = this.pickRandom(candidates);
            used.add(affixId);
            const a = pool[affixId];
            const tiers = a.tiers.filter(t => t.ilvl <= item.ilvl);
            const tier = tiers[tiers.length - 1]; // highest eligible tier
            const tierIndex = a.tiers.indexOf(tier);
            let value = tier.min + Math.random() * (tier.max - tier.min);

            // Percent-type stats stored as fractions
            const fractionStats = ['attackSpeed', 'moveSpeed', 'lifeLeech', 'criticalChance'];
            if (a.stat && fractionStats.includes(a.stat)) {
                value = Math.round(value) / 100;
            } else if (a.damageTags) {
                value = Math.round(value) / 100;
            } else {
                value = Math.round(value);
            }

            const displayV = (a.damageTags || fractionStats.includes(a.stat))
                ? Math.round(value * 100) : value;
            const affixEntry = {
                id: affixId,
                type,
                tier: tierIndex,
                tierName: a.tierNames?.[tierIndex] || '',
                value,
                text: (a.text || '{v}').replace('{v}', displayV)
            };
            item.affixes.push(affixEntry);

            if (a.stat) {
                item.stats[a.stat] = (item.stats[a.stat] || 0) + value;
            } else if (a.damageTags) {
                item.damageMods.push({ type: 'increased', tags: a.damageTags, value });
            }
        };

        for (let i = 0; i < nPrefix; i++) rollOne('prefix');
        for (let i = 0; i < nSuffix; i++) rollOne('suffix');
    }

    affixApplies(affix, base) {
        for (const a of affix.applicable || []) {
            if (a === base.category || a === base.slot) return true;
        }
        return false;
    }

    buildItemName(item, base) {
        if (item.rarity === 'normal') return base.title;
        if (item.rarity === 'magic') {
            const prefix = item.affixes.find(a => a.type === 'prefix');
            const suffix = item.affixes.find(a => a.type === 'suffix');
            let name = base.title;
            if (prefix) name = `${prefix.tierName} ${name}`;
            if (suffix) name = `${name} ${suffix.tierName}`;
            return name;
        }
        // Rare: two-word generated name
        const first = ['Storm', 'Bone', 'Ember', 'Dread', 'Blood', 'Gloom', 'Ash', 'Raven', 'Iron', 'Doom', 'Shadow', 'Grim'];
        const second = {
            weapon: ['Bite', 'Song', 'Fang', 'Reaver', 'Brand', 'Edge', 'Mangler'],
            armor: ['Guard', 'Shell', 'Veil', 'Ward', 'Hide', 'Carapace'],
            jewelry: ['Loop', 'Eye', 'Charm', 'Whisper', 'Knot']
        };
        const pool = second[base.category] || second.armor;
        return `${this.pickRandom(first)} ${this.pickRandom(pool)}`;
    }

    pickRandom(arr) {
        if (!arr || !arr.length) return null;
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ─── Loot drops ───────────────────────────────────────────────────────────

    onUnitKilled(deadEntityId) {
        if (!this.game.state.isAdventure) return;
        const monster = this.game.getComponent(deadEntityId, 'neutralMonster');
        if (!monster) return;
        const transform = this.game.getComponent(deadEntityId, 'transform');
        const pos = transform?.position;
        if (!pos) return;

        const mlvl = monster.monsterLevel || 1;
        const bonus = monster.rarityBonus || 0;   // champions/bosses drop better

        const drops = [];
        if (monster.guaranteedLoot) {
            drops.push({ kind: 'item' }, { kind: 'item' });
            if (Math.random() < 0.5) drops.push({ kind: 'gem' });
            drops.push({ kind: 'gold' });
        } else {
            const r = Math.random();
            if (r < 0.30) drops.push({ kind: 'gold' });
            else if (r < 0.42) drops.push({ kind: 'potion' });
            else if (r < 0.60) drops.push({ kind: 'item' });
            else if (r < 0.64) drops.push({ kind: 'gem' });
        }

        let i = 0;
        for (const d of drops) {
            const offset = { x: (i % 3 - 1) * 25, z: (Math.floor(i / 3) - 0.5) * 25 };
            this.dropLootAt(d.kind, { x: pos.x + offset.x, y: pos.y, z: pos.z + offset.z }, mlvl, bonus);
            i++;
        }
    }

    dropLootAt(kind, pos, ilvl = 1, rarityBonus = 0) {
        let payload = null;
        if (kind === 'gold') {
            payload = { kind: 'gold', amount: Math.round((5 + Math.random() * 15) * (1 + ilvl * 0.25)) };
        } else if (kind === 'potion') {
            payload = { kind: 'potion', potion: this.generatePotion(Math.random() < 0.5 ? 'life' : 'mana') };
        } else if (kind === 'gem') {
            const gem = this.generateGem(ilvl);
            if (!gem) return null;
            payload = { kind: 'gem', item: gem };
        } else {
            const item = this.generateItem({ itemLevel: ilvl, magicFindBonus: rarityBonus });
            if (!item) return null;
            payload = { kind: 'item', item };
        }

        const entityId = this.game.createEntity();
        this.game.addComponent(entityId, 'transform', {
            position: { x: pos.x, y: (pos.y || 0) + 5, z: pos.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });
        this.game.addComponent(entityId, 'loot', { type: 'item', amount: 1, currency: null, itemId: null });

        const color = payload.kind === 'gold' ? ItemSystem.RARITY_COLORS.gold
            : payload.kind === 'potion' ? ItemSystem.RARITY_COLORS.potion
            : ItemSystem.RARITY_COLORS[payload.item?.rarity] || '#fff';
        this.game.addComponent(entityId, 'lootVisual', { icon: 'loot', color, scale: 1 });

        this.groundItems.set(entityId, payload);
        return entityId;
    }

    getGroundItemInfo(entityId) {
        const payload = this.groundItems.get(entityId);
        if (!payload) return null;
        let label, color;
        if (payload.kind === 'gold') {
            label = `${payload.amount} Gold`;
            color = ItemSystem.RARITY_COLORS.gold;
        } else if (payload.kind === 'potion') {
            label = payload.potion.name;
            color = ItemSystem.RARITY_COLORS.potion;
        } else {
            label = payload.item.name;
            color = ItemSystem.RARITY_COLORS[payload.item.rarity] || '#fff';
        }
        return { label, color, payload };
    }

    pickupGroundItem(entityId) {
        const payload = this.groundItems.get(entityId);
        if (!payload) return false;

        const playerId = this.call.getPlayerCharacter?.();
        if (playerId == null) return false;

        let ok = true;
        if (payload.kind === 'gold') {
            this.addGold(payload.amount);
        } else if (payload.kind === 'potion') {
            const inv = this.game.getComponent(playerId, 'inventory');
            if (!inv) return false;
            if (payload.potion.potionType === 'life') inv.beltLife = Math.min(8, (inv.beltLife || 0) + 1);
            else inv.beltMana = Math.min(8, (inv.beltMana || 0) + 1);
        } else {
            ok = this.giveItemToPlayer(payload.item);
        }

        if (ok) {
            this.groundItems.delete(entityId);
            this.game.destroyEntity(entityId);
            this.persist(playerId);
            this.game.triggerEvent('onLootPickedUp', { payload });
        } else {
            this.game.triggerEvent('onInventoryFull', {});
        }
        return ok;
    }

    // ─── Inventory grid ───────────────────────────────────────────────────────

    itemSize(item) {
        if (item.rarity === 'gem') return { w: 1, h: 1 };
        const base = this.collections.itemBases?.[item.baseId];
        return { w: base?.w || 1, h: base?.h || 1 };
    }

    giveItemToPlayer(item) {
        const playerId = this.call.getPlayerCharacter?.();
        if (playerId == null) return false;
        const inv = this.game.getComponent(playerId, 'inventory');
        if (!inv) return false;

        const { w, h } = this.itemSize(item);
        const spot = this.findFreeSpot(inv, w, h);
        if (!spot) return false;

        inv.items.push({ x: spot.x, y: spot.y, w, h, item });
        this.persist(playerId);
        return true;
    }

    findFreeSpot(inv, w, h) {
        const occupied = Array.from({ length: inv.gridH }, () => new Array(inv.gridW).fill(false));
        for (const entry of inv.items) {
            for (let dy = 0; dy < entry.h; dy++) {
                for (let dx = 0; dx < entry.w; dx++) {
                    const yy = entry.y + dy, xx = entry.x + dx;
                    if (yy < inv.gridH && xx < inv.gridW) occupied[yy][xx] = true;
                }
            }
        }
        for (let y = 0; y <= inv.gridH - h; y++) {
            for (let x = 0; x <= inv.gridW - w; x++) {
                let fits = true;
                for (let dy = 0; dy < h && fits; dy++) {
                    for (let dx = 0; dx < w && fits; dx++) {
                        if (occupied[y + dy][x + dx]) fits = false;
                    }
                }
                if (fits) return { x, y };
            }
        }
        return null;
    }

    removeFromInventory(inv, uid) {
        const idx = inv.items.findIndex(e => e.item.uid === uid);
        if (idx === -1) return null;
        return inv.items.splice(idx, 1)[0].item;
    }

    findInInventory(inv, uid) {
        return inv.items.find(e => e.item.uid === uid)?.item || null;
    }

    // ─── Equip / unequip ──────────────────────────────────────────────────────

    meetsRequirements(playerId, item) {
        const base = this.collections.itemBases?.[item.baseId];
        if (!base) return { ok: false, reason: 'unknown base' };
        const sheet = this.game.getComponent(playerId, 'characterSheet');
        if (!sheet) return { ok: false, reason: 'no sheet' };

        const reqLevel = item.reqLevel || base.reqLevel || 1;
        if (sheet.level < reqLevel) return { ok: false, reason: `requires level ${reqLevel}` };

        const attrs = this.game.arpgStatsSystem?.getEffectiveAttributes?.(playerId) || sheet.attributes;
        if (base.reqStr && attrs.strength < base.reqStr) return { ok: false, reason: `requires ${base.reqStr} strength` };
        if (base.reqDex && attrs.dexterity < base.reqDex) return { ok: false, reason: `requires ${base.reqDex} dexterity` };
        if (base.reqInt && attrs.intelligence < base.reqInt) return { ok: false, reason: `requires ${base.reqInt} intelligence` };
        return { ok: true };
    }

    equipItem(uid) {
        const playerId = this.call.getPlayerCharacter?.();
        if (playerId == null) return { success: false, reason: 'no player' };
        const inv = this.game.getComponent(playerId, 'inventory');
        const eq = this.game.getComponent(playerId, 'arpgEquipment');
        if (!inv || !eq) return { success: false, reason: 'no inventory' };

        const item = this.findInInventory(inv, uid);
        if (!item) return { success: false, reason: 'not in inventory' };
        if (item.rarity === 'gem') return { success: false, reason: 'gems must be socketed' };

        const base = this.collections.itemBases?.[item.baseId];
        if (!base?.slot) return { success: false, reason: 'not equippable' };

        const req = this.meetsRequirements(playerId, item);
        if (!req.ok) return { success: false, reason: req.reason };

        // Resolve slot (rings have two)
        let slot = base.slot;
        if (slot === 'ring') {
            slot = !eq.slots.ring1 ? 'ring1' : (!eq.slots.ring2 ? 'ring2' : 'ring1');
        }

        // Swap out existing item
        this.removeFromInventory(inv, uid);
        const previous = eq.slots[slot];
        eq.slots[slot] = item;
        if (previous) {
            const size = this.itemSize(previous);
            const spot = this.findFreeSpot(inv, size.w, size.h);
            if (spot) {
                inv.items.push({ x: spot.x, y: spot.y, w: size.w, h: size.h, item: previous });
            } else {
                // No room: drop at feet
                const t = this.game.getComponent(playerId, 'transform');
                if (t?.position) {
                    const eid = this.dropLootAt('item', t.position, previous.ilvl);
                    if (eid) this.groundItems.set(eid, { kind: 'item', item: previous });
                }
            }
        }

        this.afterEquipmentChange(playerId);
        return { success: true, slot };
    }

    unequipItem(slot) {
        const playerId = this.call.getPlayerCharacter?.();
        if (playerId == null) return { success: false };
        const inv = this.game.getComponent(playerId, 'inventory');
        const eq = this.game.getComponent(playerId, 'arpgEquipment');
        if (!inv || !eq?.slots[slot]) return { success: false };

        const item = eq.slots[slot];
        const size = this.itemSize(item);
        const spot = this.findFreeSpot(inv, size.w, size.h);
        if (!spot) return { success: false, reason: 'inventory full' };

        inv.items.push({ x: spot.x, y: spot.y, w: size.w, h: size.h, item });
        eq.slots[slot] = null;
        this.afterEquipmentChange(playerId);
        return { success: true };
    }

    afterEquipmentChange(playerId) {
        this.call.recomputeDerivedStats(playerId);
        this.call.refreshGrantedAbilities(playerId);
        this.persist(playerId);
        this.game.triggerEvent('onEquipmentChanged', { entityId: playerId });
    }

    // ─── Sockets & gems ───────────────────────────────────────────────────────

    socketGem(gemUid, targetUid) {
        const playerId = this.call.getPlayerCharacter?.();
        if (playerId == null) return { success: false };
        const inv = this.game.getComponent(playerId, 'inventory');
        const eq = this.game.getComponent(playerId, 'arpgEquipment');
        if (!inv) return { success: false };

        const gem = this.findInInventory(inv, gemUid);
        if (!gem || gem.rarity !== 'gem') return { success: false, reason: 'not a gem' };

        // Target may be in inventory or equipped
        let target = this.findInInventory(inv, targetUid);
        if (!target) {
            for (const slot of Object.keys(eq?.slots || {})) {
                if (eq.slots[slot]?.uid === targetUid) { target = eq.slots[slot]; break; }
            }
        }
        if (!target) return { success: false, reason: 'target not found' };
        const openIdx = (target.sockets || []).findIndex(s => s === null);
        if (openIdx === -1) return { success: false, reason: 'no open socket' };

        this.removeFromInventory(inv, gemUid);
        target.sockets[openIdx] = gem;
        this.afterEquipmentChange(playerId);
        return { success: true };
    }

    // ─── Potions ──────────────────────────────────────────────────────────────

    drinkPotion(kind) {
        const playerId = this.call.getPlayerCharacter?.();
        if (playerId == null) return false;
        const inv = this.game.getComponent(playerId, 'inventory');
        if (!inv) return false;

        if (kind === 'life') {
            if ((inv.beltLife || 0) <= 0) return false;
            const health = this.game.getComponent(playerId, 'health');
            if (!health || health.current >= health.max) return false;
            inv.beltLife -= 1;
            health.current = Math.min(health.max, health.current + Math.round(health.max * 0.4));
        } else {
            if ((inv.beltMana || 0) <= 0) return false;
            const pool = this.game.getComponent(playerId, 'resourcePool');
            if (!pool || pool.mana >= pool.maxMana) return false;
            inv.beltMana -= 1;
            pool.mana = Math.min(pool.maxMana, pool.mana + Math.round(pool.maxMana * 0.6));
        }
        this.persist(playerId);
        return true;
    }

    // ─── Vendor support (used by VendorSystem later) ──────────────────────────

    itemValue(item) {
        if (item.rarity === 'gem') return 100 + item.ilvl * 15;
        const base = this.collections.itemBases?.[item.baseId];
        let v = 8 + (base?.ilvlMin || 1) * 4 + item.ilvl * 2;
        const mult = { normal: 1, magic: 2.2, rare: 5, unique: 9 }[item.rarity] || 1;
        return Math.round(v * mult);
    }

    sellItem(uid) {
        const playerId = this.call.getPlayerCharacter?.();
        if (playerId == null) return { success: false };
        const inv = this.game.getComponent(playerId, 'inventory');
        if (!inv) return { success: false };
        const item = this.removeFromInventory(inv, uid);
        if (!item) return { success: false };
        const value = Math.round(this.itemValue(item) * 0.3);
        this.addGold(value);
        this.persist(playerId);
        return { success: true, value };
    }

    // ─── Stat integration ─────────────────────────────────────────────────────

    /**
     * Flat stat bonuses from all equipped items (consumed by ArpgStatsSystem).
     * Includes weapon fundamentals as weapon* keys.
     */
    getEquipmentStatBonuses(entityId) {
        const totals = {};
        const eq = this.game.getComponent(entityId, 'arpgEquipment');
        if (!eq?.slots) return totals;

        const add = (key, v) => { totals[key] = (totals[key] || 0) + v; };

        for (const [slot, item] of Object.entries(eq.slots)) {
            if (!item) continue;
            const base = this.collections.itemBases?.[item.baseId];
            if (!base) continue;

            // Base properties
            if (base.armor) add('armor', base.armor);
            if (base.blockChance) add('blockChance', base.blockChance);
            if (base.criticalChance) add('criticalChance', base.criticalChance);

            // Weapon fundamentals
            if (slot === 'mainHand' && base.category === 'weapon') {
                totals.weaponDamage = (base.minDamage + base.maxDamage) / 2;
                totals.weaponRange = base.range;
                totals.weaponAttackSpeed = base.attackSpeed;
                totals.weaponProjectile = base.projectile || null;
                totals.weaponCategory = base.weaponCategory;
            }

            // Affix / unique stats
            for (const [stat, value] of Object.entries(item.stats || {})) {
                add(stat, value);
            }

            // Socketed gem stats
            for (const socket of item.sockets || []) {
                if (!socket?.gem) continue;
                for (const [stat, value] of Object.entries(socket.gem.stats || {})) {
                    add(stat, value);
                }
            }
        }
        return totals;
    }

    /**
     * Percent damage modifiers from equipped items (consumed by StatAggregationSystem).
     */
    collectDamageModifiers(entityId, modifiers) {
        const eq = this.game.getComponent(entityId, 'arpgEquipment');
        if (!eq?.slots) return;

        for (const item of Object.values(eq.slots)) {
            if (!item) continue;
            for (const mod of item.damageMods || []) {
                if (mod.type === 'increased') modifiers.increased.push(mod);
                else if (mod.type === 'more') modifiers.more.push(mod);
            }
            // Caster weapon implicit
            const base = this.collections.itemBases?.[item.baseId];
            if (base?.spellDamage) {
                modifiers.increased.push({ tags: ['spell'], value: base.spellDamage });
            }
            // Socketed support gems
            for (const socket of item.sockets || []) {
                if (!socket?.gem) continue;
                for (const mod of socket.gem.damageModifiers || []) {
                    if (mod.type === 'increased') modifiers.increased.push(mod);
                    else if (mod.type === 'more') modifiers.more.push(mod);
                }
            }
        }
    }

    /**
     * Skill-gem granted abilities from equipped items (consumed by SkillTreeSystem).
     */
    getGemGrantedSkills(entityId) {
        const out = [];
        const eq = this.game.getComponent(entityId, 'arpgEquipment');
        if (!eq?.slots) return out;
        for (const item of Object.values(eq.slots)) {
            if (!item) continue;
            for (const socket of item.sockets || []) {
                if (socket?.gem?.type === 'skill' && socket.gem.ability) {
                    out.push({ id: socket.gem.ability, itemLevel: socket.gem.level || 1 });
                }
            }
        }
        return out;
    }

    onSceneUnload() {
        this.groundItems.clear();
    }
}
