class LootSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.lootSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Active loot items on the ground
        this.groundLoot = new Map();
        this.nextLootId = 1;

        // Pickup settings
        this.AUTO_PICKUP_RANGE = 50;
        this.PICKUP_RANGE = 30;
        this.LOOT_DESPAWN_TIME = 60; // seconds

        // Loot tables
        this.lootTables = {
            common: {
                dropChance: 0.5,
                items: [
                    { type: 'gold', weight: 40, min: 5, max: 20 },
                    { type: 'healthPotion', weight: 25 },
                    { type: 'manaPotion', weight: 20 },
                    { type: 'weapon_common', weight: 10 },
                    { type: 'armor_common', weight: 5 }
                ]
            },
            uncommon: {
                dropChance: 0.6,
                items: [
                    { type: 'gold', weight: 35, min: 15, max: 40 },
                    { type: 'healthPotion', weight: 20 },
                    { type: 'manaPotion', weight: 15 },
                    { type: 'weapon_uncommon', weight: 15 },
                    { type: 'armor_uncommon', weight: 10 },
                    { type: 'weapon_common', weight: 5 }
                ]
            },
            rare: {
                dropChance: 0.7,
                items: [
                    { type: 'gold', weight: 30, min: 30, max: 80 },
                    { type: 'healthPotion', weight: 15 },
                    { type: 'manaPotion', weight: 10 },
                    { type: 'weapon_rare', weight: 20 },
                    { type: 'armor_rare', weight: 15 },
                    { type: 'weapon_uncommon', weight: 10 }
                ]
            },
            elite: {
                dropChance: 0.9,
                items: [
                    { type: 'gold', weight: 25, min: 50, max: 150 },
                    { type: 'weapon_epic', weight: 20 },
                    { type: 'armor_epic', weight: 15 },
                    { type: 'weapon_rare', weight: 20 },
                    { type: 'armor_rare', weight: 15 },
                    { type: 'healthPotion', weight: 5 }
                ]
            }
        };

        // Item definitions
        this.itemDefinitions = {
            healthPotion: {
                name: 'Health Potion',
                icon: 'potion_health',
                stackable: true,
                maxStack: 20,
                effect: 'heal',
                value: 50
            },
            manaPotion: {
                name: 'Mana Potion',
                icon: 'potion_mana',
                stackable: true,
                maxStack: 20,
                effect: 'mana',
                value: 50
            },
            gold: {
                name: 'Gold',
                icon: 'gold',
                stackable: true,
                currency: true
            },
            weapon_common: {
                name: 'Common Weapon',
                icon: 'weapon_sword',
                slot: 'mainHand',
                rarity: 'common',
                stats: { damage: 5 }
            },
            weapon_uncommon: {
                name: 'Uncommon Weapon',
                icon: 'weapon_sword',
                slot: 'mainHand',
                rarity: 'uncommon',
                stats: { damage: 10, attackSpeed: 0.05 }
            },
            weapon_rare: {
                name: 'Rare Weapon',
                icon: 'weapon_sword',
                slot: 'mainHand',
                rarity: 'rare',
                stats: { damage: 20, attackSpeed: 0.1 }
            },
            weapon_epic: {
                name: 'Epic Weapon',
                icon: 'weapon_sword',
                slot: 'mainHand',
                rarity: 'epic',
                stats: { damage: 35, attackSpeed: 0.15, element: 'fire' }
            },
            armor_common: {
                name: 'Common Armor',
                icon: 'armor_chest',
                slot: 'chest',
                rarity: 'common',
                stats: { armor: 3 }
            },
            armor_uncommon: {
                name: 'Uncommon Armor',
                icon: 'armor_chest',
                slot: 'chest',
                rarity: 'uncommon',
                stats: { armor: 6, health: 20 }
            },
            armor_rare: {
                name: 'Rare Armor',
                icon: 'armor_chest',
                slot: 'chest',
                rarity: 'rare',
                stats: { armor: 12, health: 50 }
            },
            armor_epic: {
                name: 'Epic Armor',
                icon: 'armor_chest',
                slot: 'chest',
                rarity: 'epic',
                stats: { armor: 20, health: 100, fireResistance: 0.2 }
            }
        };
    }

    init() {
        this.game.gameManager.register('spawnLoot', this.spawnLoot.bind(this));
        this.game.gameManager.register('pickupLoot', this.pickupLoot.bind(this));
        this.game.gameManager.register('getGroundLoot', () => this.groundLoot);
        this.game.gameManager.register('getNearbyLoot', this.getNearbyLoot.bind(this));
        this.game.gameManager.register('getItemDefinition', (type) => this.itemDefinitions[type]);
        this.game.gameManager.register('addLootTable', this.addLootTable.bind(this));
    }

    addLootTable(name, table) {
        this.lootTables[name] = table;
    }

    spawnLoot(x, z, tableName = 'common', guaranteedDrops = null) {
        const table = this.lootTables[tableName];
        if (!table) {
            console.warn('Loot table not found:', tableName);
            return;
        }

        // Check drop chance
        if (Math.random() > table.dropChance) {
            return;
        }

        // Roll for items
        const items = this.rollLootTable(table);

        // Add guaranteed drops
        if (guaranteedDrops) {
            items.push(...guaranteedDrops);
        }

        // Spawn each item
        for (const item of items) {
            // Scatter items slightly
            const offsetX = (Math.random() - 0.5) * 30;
            const offsetZ = (Math.random() - 0.5) * 30;

            this.spawnLootItem(x + offsetX, z + offsetZ, item);
        }
    }

    rollLootTable(table) {
        const items = [];
        const totalWeight = table.items.reduce((sum, item) => sum + item.weight, 0);

        // Roll 1-3 items
        const numItems = 1 + Math.floor(Math.random() * 2);

        for (let i = 0; i < numItems; i++) {
            let roll = Math.random() * totalWeight;

            for (const item of table.items) {
                roll -= item.weight;
                if (roll <= 0) {
                    // Determine quantity for stackable items
                    let quantity = 1;
                    if (item.type === 'gold') {
                        quantity = item.min + Math.floor(Math.random() * (item.max - item.min + 1));
                    }

                    items.push({
                        type: item.type,
                        quantity
                    });
                    break;
                }
            }
        }

        return items;
    }

    spawnLootItem(x, z, item) {
        const lootId = this.nextLootId++;
        const definition = this.itemDefinitions[item.type];

        if (!definition) {
            console.warn('Item definition not found:', item.type);
            return;
        }

        this.groundLoot.set(lootId, {
            id: lootId,
            x, z,
            type: item.type,
            quantity: item.quantity || 1,
            definition,
            spawnTime: this.game.state.now
        });

        this.game.triggerEvent('onLootSpawned', {
            lootId,
            x, z,
            type: item.type,
            quantity: item.quantity || 1
        });

        return lootId;
    }

    getNearbyLoot(x, z, range = null) {
        const pickupRange = range || this.PICKUP_RANGE;
        const nearby = [];

        for (const [lootId, loot] of this.groundLoot) {
            const dx = loot.x - x;
            const dz = loot.z - z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist <= pickupRange) {
                nearby.push({ ...loot, distance: dist });
            }
        }

        return nearby.sort((a, b) => a.distance - b.distance);
    }

    pickupLoot(entityId, lootId) {
        const loot = this.groundLoot.get(lootId);
        if (!loot) return false;

        const definition = loot.definition;

        // Handle different item types
        if (definition.currency) {
            // Gold - add directly
            this.game.gameManager.call('addPlayerGold', loot.quantity);
        } else if (definition.effect) {
            // Consumable - add to inventory
            this.addToInventory(entityId, loot.type, loot.quantity);
        } else if (definition.slot) {
            // Equipment - add to inventory
            this.addToInventory(entityId, loot.type, 1, loot);
        }

        // Remove from ground
        this.groundLoot.delete(lootId);

        this.game.triggerEvent('onLootPickedUp', {
            entityId,
            lootId,
            type: loot.type,
            quantity: loot.quantity
        });

        return true;
    }

    addToInventory(entityId, itemType, quantity, itemData = null) {
        // This would integrate with an inventory system
        // For now, just trigger an event
        this.game.triggerEvent('onItemAdded', {
            entityId,
            itemType,
            quantity,
            itemData
        });

        // For potions, add to potion system
        if (itemType === 'healthPotion') {
            this.game.gameManager.call('addHealthPotions', entityId, quantity);
        } else if (itemType === 'manaPotion') {
            this.game.gameManager.call('addManaPotions', entityId, quantity);
        }
    }

    update() {
        // Auto-pickup for player
        this.autoPickupForPlayer();

        // Despawn old loot
        this.despawnOldLoot();
    }

    autoPickupForPlayer() {
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId) return;

        const playerPos = this.game.getComponent(playerEntityId, this.componentTypes.POSITION);
        if (!playerPos) return;

        // Check for nearby loot
        const nearbyLoot = this.getNearbyLoot(playerPos.x, playerPos.z, this.AUTO_PICKUP_RANGE);

        for (const loot of nearbyLoot) {
            // Auto-pickup gold and potions only
            if (loot.definition.currency || loot.definition.effect) {
                this.pickupLoot(playerEntityId, loot.id);
            }
        }
    }

    despawnOldLoot() {
        const now = this.game.state.now;

        for (const [lootId, loot] of this.groundLoot) {
            if (now - loot.spawnTime > this.LOOT_DESPAWN_TIME) {
                this.groundLoot.delete(lootId);
                this.game.triggerEvent('onLootDespawned', lootId);
            }
        }
    }
}
