/**
 * NpcSystem - Town NPCs: spawning, dialogue, vendors, stash.
 *
 * NPC definitions live in data/npcs. NPCs are neutral units with their AI
 * removed and an interactable component; clicking their label opens dialogue.
 */
class NpcSystem extends GUTS.BaseSystem {
    static services = [
        'spawnZoneNpcs',
        'openDialogue',
        'getVendorStock',
        'buyVendorItem',
        'depositToStash',
        'withdrawFromStash'
    ];

    static serviceDependencies = [
        'createEntityFromPrefab',
        'getPlayerCharacter',
        'getQuestActionsForNpc',
        'startQuest',
        'turnInQuest',
        'generateItem',
        'giveItemToPlayer',
        'addGold',
        'getGold'
    ];

    constructor(game) {
        super(game);
        this.game.npcSystem = this;
        this.vendorStocks = {};   // npcId -> item[] (regenerated per town visit)
    }

    init() {}

    // ─── Spawning (called by ZoneSystem.setupZone) ────────────────────────────

    spawnZoneNpcs(level, toWorld) {
        const spawns = level?.arpg?.npcSpawns;
        if (!spawns) return;

        for (const [npcId, marker] of Object.entries(spawns)) {
            const def = this.collections.npcs?.[npcId];
            if (!def) continue;
            const pos = toWorld(marker);
            if (!pos) continue;

            if (def.unit) {
                const entityId = this.call.createEntityFromPrefab({
                    prefab: 'unit',
                    type: def.unit,
                    collection: 'units',
                    team: this.enums.team.neutral,
                    componentOverrides: {
                        transform: { position: { x: pos.x, y: pos.y || 0, z: pos.z } }
                    }
                });
                if (entityId != null) {
                    this.game.removeComponent(entityId, 'aiState');
                    const vel = this.game.getComponent(entityId, 'velocity');
                    if (vel) { vel.anchored = true; vel.maxSpeed = 0; }
                    // NPCs are not attackable/attack-worthy: huge hp, neutral team
                    const health = this.game.getComponent(entityId, 'health');
                    if (health) { health.max = 999999; health.current = 999999; }
                    this.game.addComponent(entityId, 'interactable', {
                        kind: 'npc',
                        target: npcId,
                        label: `💬 ${def.title}`,
                        data: { color: def.color || '#f0cf70' }
                    });
                }
            } else {
                // Object-only interactable (stash)
                this.game.zoneSystem?.spawnInteractable(def.role === 'stash' ? 'stash' : 'npc', pos, {
                    target: npcId,
                    label: `📦 ${def.title}`,
                    color: def.color || '#e0b060'
                });
            }
        }
    }

    // Interactable clicks routed here by ZoneSystem's onInteract event
    onInteract({ interactable }) {
        if (interactable.kind === 'npc') {
            this.openDialogue(interactable.target);
        } else if (interactable.kind === 'stash') {
            this.game.arpgUiSystem?.openStashPanel?.();
        }
    }

    // ─── Dialogue ─────────────────────────────────────────────────────────────

    openDialogue(npcId) {
        if (this.game.isServer) return;
        const def = this.collections.npcs?.[npcId];
        if (!def) return;
        this.game.arpgUiSystem?.openDialoguePanel?.(npcId, def);
    }

    // ─── Vendors ──────────────────────────────────────────────────────────────

    getVendorStock(npcId) {
        const def = this.collections.npcs?.[npcId];
        if (!def?.vendor) return [];

        if (!this.vendorStocks[npcId]) {
            const pid = this.call.getPlayerCharacter?.();
            const sheet = pid != null ? this.game.getComponent(pid, 'characterSheet') : null;
            const ilvl = Math.max(1, sheet?.level || 1);
            const stock = [];

            if (def.vendor.stock === 'arms') {
                const bases = ['shortSword', 'handAxe', 'mace', 'dagger', 'shortBow', 'lightCrossbow',
                    'buckler', 'leatherCap', 'leatherArmor', 'ringMail', 'leatherGloves', 'boots', 'sash',
                    'broadSword', 'longBow', 'helm', 'kiteShield'];
                for (let i = 0; i < (def.vendor.count || 8); i++) {
                    const baseId = bases[Math.floor(Math.random() * bases.length)];
                    const base = this.collections.itemBases?.[baseId];
                    if (!base || (base.ilvlMin || 1) > ilvl + 2) { i--; continue; }
                    const rarity = Math.random() < 0.35 ? 'magic' : 'normal';
                    const item = this.call.generateItem({ itemLevel: ilvl, rarity, baseId });
                    if (item) stock.push(item);
                }
            } else if (def.vendor.stock === 'arcana') {
                const casterBases = ['wand', 'gnarledStaff', 'amulet', 'ring', 'runedStaff'];
                for (let i = 0; i < 4; i++) {
                    const baseId = casterBases[Math.floor(Math.random() * casterBases.length)];
                    const base = this.collections.itemBases?.[baseId];
                    if (!base || (base.ilvlMin || 1) > ilvl + 2) { i--; continue; }
                    const item = this.call.generateItem({
                        itemLevel: ilvl,
                        rarity: Math.random() < 0.4 ? 'magic' : 'normal',
                        baseId
                    });
                    if (item) stock.push(item);
                }
                // A couple of gems
                for (let i = 0; i < 3; i++) {
                    const gem = this.game.itemSystem?.generateGem(ilvl);
                    if (gem) stock.push(gem);
                }
                // Potions as pseudo-items
                stock.push({ uid: -1, rarity: 'potion', potionType: 'life', name: 'Life Potion', price: 30 });
                stock.push({ uid: -2, rarity: 'potion', potionType: 'mana', name: 'Mana Potion', price: 30 });
            }
            this.vendorStocks[npcId] = stock;
        }
        return this.vendorStocks[npcId];
    }

    buyVendorItem(npcId, index) {
        const stock = this.getVendorStock(npcId);
        const item = stock[index];
        if (!item) return { success: false, reason: 'sold out' };

        const price = item.price ?? Math.round((this.game.itemSystem?.itemValue(item) || 20) * 1.5);
        if (this.call.getGold() < price) return { success: false, reason: 'not enough gold' };

        if (item.rarity === 'potion') {
            const pid = this.call.getPlayerCharacter?.();
            const inv = pid != null ? this.game.getComponent(pid, 'inventory') : null;
            if (!inv) return { success: false };
            if (item.potionType === 'life') inv.beltLife = Math.min(8, (inv.beltLife || 0) + 1);
            else inv.beltMana = Math.min(8, (inv.beltMana || 0) + 1);
            this.call.addGold(-price);
            return { success: true, price };
        }

        if (!this.call.giveItemToPlayer(item)) {
            return { success: false, reason: 'inventory full' };
        }
        this.call.addGold(-price);
        stock.splice(index, 1);
        return { success: true, price };
    }

    // ─── Stash ────────────────────────────────────────────────────────────────

    stash() {
        this.game.state.stashItems = this.game.state.stashItems || [];
        return this.game.state.stashItems;
    }

    depositToStash(uid) {
        const pid = this.call.getPlayerCharacter?.();
        const inv = pid != null ? this.game.getComponent(pid, 'inventory') : null;
        if (!inv) return false;
        const item = this.game.itemSystem?.removeFromInventory(inv, uid);
        if (!item) return false;
        this.stash().push(item);
        this.game.itemSystem?.persist(pid);
        return true;
    }

    withdrawFromStash(uid) {
        const stash = this.stash();
        const idx = stash.findIndex(i => i.uid === uid);
        if (idx === -1) return false;
        if (!this.call.giveItemToPlayer(stash[idx])) return false;
        stash.splice(idx, 1);
        return true;
    }

    onSceneUnload() {
        // Vendor stock refreshes when the town reloads
        this.vendorStocks = {};
    }
}
