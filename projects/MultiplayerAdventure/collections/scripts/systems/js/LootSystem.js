/**
 * LootSystem - Manages loot drops and distribution
 *
 * Handles:
 * - Loot generation from loot tables
 * - Party loot distribution modes
 * - Item drops visualization
 * - Auto-pickup for gold
 */
class LootSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.lootSystem = this;

        // Loot tracking
        this.droppedLoot = new Map(); // entityId -> loot data

        // Round robin state
        this.roundRobinIndex = 0;

        // Auto pickup range
        this.autoPickupRange = 50;
    }

    init(params) {
        this.params = params || {};
        console.log('[LootSystem] Initializing...');
        this.registerServices();
    }

    registerServices() {
        this.game.register('generateLoot', this.generateLoot.bind(this));
        this.game.register('dropLoot', this.dropLoot.bind(this));
        this.game.register('pickupLoot', this.pickupLoot.bind(this));
        this.game.register('getDroppedLoot', () => this.droppedLoot);
    }

    generateLoot(lootTableId, level = 1) {
        const lootTables = this.game.getCollections().lootTables;
        const table = lootTables?.[lootTableId];

        if (!table) {
            console.warn('[LootSystem] Loot table not found:', lootTableId);
            return { items: [], gold: 0 };
        }

        const items = [];
        const rng = this.game.rng || { random: Math.random };

        // Roll for each entry in the table
        for (const entry of table.entries || []) {
            const roll = rng.random();
            const adjustedChance = entry.chance * (1 + (level - 1) * 0.1); // Higher level = better drops

            if (roll <= adjustedChance) {
                items.push({
                    itemId: entry.itemId,
                    quantity: entry.quantity || 1
                });
            }
        }

        // Calculate gold
        const baseGold = table.goldMin || 5;
        const goldRange = (table.goldMax || 15) - baseGold;
        const gold = Math.floor(baseGold + rng.random() * goldRange * (1 + level * 0.1));

        return { items, gold };
    }

    dropLoot(position, lootTableId, level = 1) {
        const loot = this.generateLoot(lootTableId, level);

        if (loot.items.length === 0 && loot.gold === 0) {
            return null; // Nothing to drop
        }

        // Create loot entity
        const entityId = `loot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        this.game.createEntity(entityId);

        this.game.addComponent(entityId, 'transform', {
            position: { ...position },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        });

        this.game.addComponent(entityId, 'loot', {
            items: loot.items,
            gold: loot.gold,
            dropTime: this.game.state.now,
            despawnTime: this.game.state.now + 120 // 2 minutes
        });

        this.game.addComponent(entityId, 'interactable', {
            interactionType: 'loot',
            interactionRadius: 40,
            promptText: 'Pick up loot'
        });

        this.droppedLoot.set(entityId, {
            entityId,
            items: loot.items,
            gold: loot.gold,
            position
        });

        // Spawn visual
        this.game.call('spawnInstance', entityId, 'effects', 'loot_bag', position);

        return entityId;
    }

    pickupLoot(entityId, playerId = null) {
        const loot = this.game.getComponent(entityId, 'loot');
        if (!loot) return false;

        const localPlayerId = this.game.call('getPlayerId');
        const isLocalPlayer = !playerId || playerId === localPlayerId;

        // Handle party loot distribution
        const isInParty = this.game.call('isInParty');
        const lootMode = this.game.call('getLootMode') || 'free_for_all';

        if (isInParty && loot.items.length > 0) {
            switch (lootMode) {
                case 'round_robin':
                    if (isLocalPlayer) {
                        this.distributeRoundRobin(loot.items);
                    }
                    break;
                case 'need_greed':
                    // Would show roll UI - simplified for now
                    this.distributeToPlayer(loot.items, localPlayerId);
                    break;
                default: // free_for_all
                    this.distributeToPlayer(loot.items, localPlayerId);
            }
        } else if (isLocalPlayer) {
            // Solo player or no party
            this.distributeToPlayer(loot.items, localPlayerId);
        }

        // Award gold (split in party)
        if (loot.gold > 0 && isLocalPlayer) {
            const partySize = isInParty ? (this.game.call('getPartySize') || 1) : 1;
            const goldShare = Math.floor(loot.gold / partySize);
            this.game.call('awardGold', goldShare);
        }

        // Clean up loot entity
        this.game.call('removeInstance', entityId);
        this.game.destroyEntity(entityId);
        this.droppedLoot.delete(entityId);

        return true;
    }

    distributeToPlayer(items, playerId) {
        const localPlayerId = this.game.call('getPlayerId');
        if (playerId !== localPlayerId) return;

        for (const item of items) {
            const success = this.game.call('addToInventory', item.itemId, item.quantity);
            if (success) {
                const itemsCol = this.game.getCollections().items;
                const itemDef = itemsCol?.[item.itemId];
                this.game.call('showNotification', `Received: ${itemDef?.name || item.itemId}`, 'success');
            }
        }
    }

    distributeRoundRobin(items) {
        const partyMembers = this.game.call('getPartyMembers') || [];
        if (partyMembers.length === 0) return;

        for (const item of items) {
            const recipient = partyMembers[this.roundRobinIndex % partyMembers.length];
            this.roundRobinIndex++;

            const localPlayerId = this.game.call('getPlayerId');
            if (recipient.playerId === localPlayerId) {
                const success = this.game.call('addToInventory', item.itemId, item.quantity);
                if (success) {
                    const itemsCol = this.game.getCollections().items;
                    const itemDef = itemsCol?.[item.itemId];
                    this.game.call('showNotification', `Received: ${itemDef?.name || item.itemId}`, 'success');
                }
            } else {
                // Notify that another player received item
                const itemsCol = this.game.getCollections().items;
                const itemDef = itemsCol?.[item.itemId];
                this.game.call('showNotification', `${recipient.name} received: ${itemDef?.name || item.itemId}`, 'info');
            }
        }
    }

    update() {
        const localPlayer = this.game.call('getLocalPlayerEntity');
        if (!localPlayer) return;

        const playerTransform = this.game.getComponent(localPlayer, 'transform');
        if (!playerTransform) return;

        // Check for loot auto-pickup (gold only)
        for (const [entityId, lootData] of this.droppedLoot) {
            const transform = this.game.getComponent(entityId, 'transform');
            const loot = this.game.getComponent(entityId, 'loot');

            if (!transform || !loot) continue;

            // Check despawn
            if (this.game.state.now >= loot.despawnTime) {
                this.game.call('removeInstance', entityId);
                this.game.destroyEntity(entityId);
                this.droppedLoot.delete(entityId);
                continue;
            }

            // Check auto-pickup range for gold-only loot
            if (loot.items.length === 0 && loot.gold > 0) {
                const dx = transform.position.x - playerTransform.position.x;
                const dz = transform.position.z - playerTransform.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist < this.autoPickupRange) {
                    this.pickupLoot(entityId);
                }
            }
        }
    }
}
