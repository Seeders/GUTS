class ServerLootSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.serverLootSystem = this;
        this.serverNetworkManager = this.engine.serverNetworkManager;

        // Track loot per room
        this.roomLoot = new Map(); // roomId -> Map of lootId -> loot data
        this.lootIdCounter = 0;

        // Pickup configuration
        this.pickupRange = 50;
        this.lootDespawnTime = 60000; // 60 seconds
        this.goldPickupRange = 100; // Auto-pickup range for gold
    }

    init(params) {
        this.params = params || {};

        // Register game manager methods
        this.game.gameManager.register('dropLootForRoom', this.dropLootForRoom.bind(this));
        this.game.gameManager.register('dropGoldForRoom', this.dropGoldForRoom.bind(this));
        this.game.gameManager.register('getRoomLoot', this.getRoomLoot.bind(this));

        this.subscribeToEvents();
    }

    subscribeToEvents() {
        if (!this.game.serverEventManager) {
            console.error('ServerLootSystem: No event manager found');
            return;
        }

        this.game.serverEventManager.subscribe('PICKUP_LOOT', this.handlePickupLoot.bind(this));
        this.game.serverEventManager.subscribe('REQUEST_ROOM_LOOT', this.handleRequestRoomLoot.bind(this));
        this.game.serverEventManager.subscribe('DROP_LOOT', this.handleDropLoot.bind(this));
    }

    handlePickupLoot(eventData) {
        try {
            const { playerId, data } = eventData;
            const { lootId, playerPosition } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            const roomLootMap = this.roomLoot.get(roomId);
            if (!roomLootMap) {
                this.serverNetworkManager.sendToPlayer(playerId, 'PICKUP_FAILED', {
                    lootId: lootId,
                    reason: 'loot_not_found'
                });
                return;
            }

            const loot = roomLootMap.get(lootId);
            if (!loot) {
                this.serverNetworkManager.sendToPlayer(playerId, 'PICKUP_FAILED', {
                    lootId: lootId,
                    reason: 'loot_not_found'
                });
                return;
            }

            // Validate pickup range
            const dx = playerPosition.x - loot.position.x;
            const dy = playerPosition.y - loot.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            const range = loot.type === 'gold' ? this.goldPickupRange : this.pickupRange;
            if (distance > range) {
                this.serverNetworkManager.sendToPlayer(playerId, 'PICKUP_FAILED', {
                    lootId: lootId,
                    reason: 'out_of_range'
                });
                return;
            }

            // Process pickup based on loot type
            const pickupResult = this.processPickup(playerId, loot);

            if (pickupResult.success) {
                // Remove loot from room
                roomLootMap.delete(lootId);

                // Broadcast pickup to all players
                this.serverNetworkManager.broadcastToRoom(roomId, 'LOOT_PICKED_UP', {
                    lootId: lootId,
                    playerId: playerId,
                    lootType: loot.type,
                    item: loot.item,
                    amount: loot.amount
                });

                // Confirm to picker
                this.serverNetworkManager.sendToPlayer(playerId, 'PICKUP_SUCCESS', {
                    lootId: lootId,
                    lootType: loot.type,
                    item: loot.item,
                    amount: loot.amount,
                    newTotal: pickupResult.newTotal
                });
            } else {
                this.serverNetworkManager.sendToPlayer(playerId, 'PICKUP_FAILED', {
                    lootId: lootId,
                    reason: pickupResult.reason
                });
            }

        } catch (error) {
            console.error('ServerLootSystem: Error handling pickup:', error);
        }
    }

    handleRequestRoomLoot(eventData) {
        try {
            const { playerId } = eventData;
            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            const lootList = this.getRoomLootArray(roomId);

            this.serverNetworkManager.sendToPlayer(playerId, 'ROOM_LOOT', {
                loot: lootList
            });

        } catch (error) {
            console.error('ServerLootSystem: Error handling room loot request:', error);
        }
    }

    handleDropLoot(eventData) {
        try {
            const { playerId, data } = eventData;
            const { position, lootType, item, amount } = data;

            const roomId = this.serverNetworkManager.getPlayerRoom(playerId);
            if (!roomId) return;

            if (lootType === 'gold') {
                this.dropGoldForRoom(roomId, position, amount);
            } else {
                this.dropLootForRoom(roomId, position, item);
            }

        } catch (error) {
            console.error('ServerLootSystem: Error handling drop loot:', error);
        }
    }

    processPickup(playerId, loot) {
        const room = this.engine.getRoom(this.serverNetworkManager.getPlayerRoom(playerId));
        if (!room) {
            return { success: false, reason: 'room_not_found' };
        }

        const player = room.getPlayer(playerId);
        if (!player) {
            return { success: false, reason: 'player_not_found' };
        }

        switch (loot.type) {
            case 'gold':
                // Add gold to player
                player.stats.gold = (player.stats.gold || 0) + loot.amount;
                return { success: true, newTotal: player.stats.gold };

            case 'potion':
                // Add potion to inventory
                // This would integrate with inventory system
                return { success: true, newTotal: 1 };

            case 'item':
                // Add item to inventory
                // Check if inventory has space
                return { success: true, newTotal: 1 };

            default:
                return { success: false, reason: 'unknown_loot_type' };
        }
    }

    dropLootForRoom(roomId, position, item, sourceEntityId = null) {
        // Initialize room loot map if needed
        if (!this.roomLoot.has(roomId)) {
            this.roomLoot.set(roomId, new Map());
        }

        const roomLootMap = this.roomLoot.get(roomId);
        const lootId = `loot_${++this.lootIdCounter}`;

        const lootData = {
            id: lootId,
            type: 'item',
            item: item,
            amount: 1,
            position: { x: position.x, y: position.y },
            dropTime: Date.now(),
            sourceEntityId: sourceEntityId
        };

        roomLootMap.set(lootId, lootData);

        // Schedule despawn
        setTimeout(() => {
            this.despawnLoot(roomId, lootId);
        }, this.lootDespawnTime);

        // Broadcast to room
        this.serverNetworkManager.broadcastToRoom(roomId, 'LOOT_DROPPED', {
            lootId: lootId,
            lootType: 'item',
            item: item,
            position: position
        });

        return lootId;
    }

    dropGoldForRoom(roomId, position, amount, sourceEntityId = null) {
        if (!this.roomLoot.has(roomId)) {
            this.roomLoot.set(roomId, new Map());
        }

        const roomLootMap = this.roomLoot.get(roomId);
        const lootId = `gold_${++this.lootIdCounter}`;

        const lootData = {
            id: lootId,
            type: 'gold',
            amount: amount,
            position: { x: position.x, y: position.y },
            dropTime: Date.now(),
            sourceEntityId: sourceEntityId
        };

        roomLootMap.set(lootId, lootData);

        // Schedule despawn
        setTimeout(() => {
            this.despawnLoot(roomId, lootId);
        }, this.lootDespawnTime);

        // Broadcast to room
        this.serverNetworkManager.broadcastToRoom(roomId, 'LOOT_DROPPED', {
            lootId: lootId,
            lootType: 'gold',
            amount: amount,
            position: position
        });

        return lootId;
    }

    dropPotionForRoom(roomId, position, potionType, sourceEntityId = null) {
        if (!this.roomLoot.has(roomId)) {
            this.roomLoot.set(roomId, new Map());
        }

        const roomLootMap = this.roomLoot.get(roomId);
        const lootId = `potion_${++this.lootIdCounter}`;

        const lootData = {
            id: lootId,
            type: 'potion',
            potionType: potionType,
            amount: 1,
            position: { x: position.x, y: position.y },
            dropTime: Date.now(),
            sourceEntityId: sourceEntityId
        };

        roomLootMap.set(lootId, lootData);

        // Schedule despawn
        setTimeout(() => {
            this.despawnLoot(roomId, lootId);
        }, this.lootDespawnTime);

        // Broadcast to room
        this.serverNetworkManager.broadcastToRoom(roomId, 'LOOT_DROPPED', {
            lootId: lootId,
            lootType: 'potion',
            potionType: potionType,
            position: position
        });

        return lootId;
    }

    despawnLoot(roomId, lootId) {
        const roomLootMap = this.roomLoot.get(roomId);
        if (!roomLootMap) return;

        if (roomLootMap.has(lootId)) {
            roomLootMap.delete(lootId);

            // Broadcast despawn
            this.serverNetworkManager.broadcastToRoom(roomId, 'LOOT_DESPAWNED', {
                lootId: lootId
            });
        }
    }

    getRoomLoot(roomId) {
        return this.roomLoot.get(roomId) || new Map();
    }

    getRoomLootArray(roomId) {
        const roomLootMap = this.roomLoot.get(roomId);
        if (!roomLootMap) return [];

        return Array.from(roomLootMap.values());
    }

    // Generate loot drops from enemy death
    generateEnemyLoot(roomId, enemyType, tier, position) {
        const drops = [];

        // Gold drop (always)
        const goldAmount = this.calculateGoldDrop(enemyType, tier);
        if (goldAmount > 0) {
            this.dropGoldForRoom(roomId, position, goldAmount);
            drops.push({ type: 'gold', amount: goldAmount });
        }

        // Item drop (chance-based)
        const itemDropChance = this.getItemDropChance(enemyType, tier);
        if (Math.random() < itemDropChance) {
            const item = this.generateRandomItem(tier);
            if (item) {
                this.dropLootForRoom(roomId, position, item);
                drops.push({ type: 'item', item: item });
            }
        }

        // Potion drop (chance-based)
        const potionDropChance = 0.15;
        if (Math.random() < potionDropChance) {
            const potionType = Math.random() < 0.7 ? 'health' : 'mana';
            this.dropPotionForRoom(roomId, position, potionType);
            drops.push({ type: 'potion', potionType: potionType });
        }

        return drops;
    }

    calculateGoldDrop(enemyType, tier) {
        const baseGold = {
            'skeleton': 5,
            'zombie': 8,
            'goblin': 10,
            'orc': 20,
            'demon': 50
        };

        const base = baseGold[enemyType] || 5;
        const variation = Math.floor(Math.random() * base * 0.5);
        return Math.floor((base + variation) * (1 + (tier - 1) * 0.3));
    }

    getItemDropChance(enemyType, tier) {
        const baseChance = {
            'skeleton': 0.05,
            'zombie': 0.08,
            'goblin': 0.10,
            'orc': 0.15,
            'demon': 0.25
        };

        const base = baseChance[enemyType] || 0.05;
        return Math.min(0.5, base * (1 + (tier - 1) * 0.1));
    }

    generateRandomItem(tier) {
        const itemTypes = ['weapon', 'armor', 'ring', 'amulet'];
        const rarities = ['common', 'uncommon', 'rare', 'epic'];

        // Determine rarity based on tier
        let rarityIndex = 0;
        const roll = Math.random();
        if (roll < 0.5) rarityIndex = 0;
        else if (roll < 0.8) rarityIndex = 1;
        else if (roll < 0.95) rarityIndex = 2;
        else rarityIndex = 3;

        // Higher tiers can get better loot
        rarityIndex = Math.min(rarities.length - 1, rarityIndex + Math.floor(tier / 3));

        const itemType = itemTypes[Math.floor(Math.random() * itemTypes.length)];
        const rarity = rarities[rarityIndex];

        return {
            id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: itemType,
            rarity: rarity,
            name: this.generateItemName(itemType, rarity),
            stats: this.generateItemStats(itemType, rarity, tier),
            tier: tier
        };
    }

    generateItemName(itemType, rarity) {
        const prefixes = {
            'common': ['Worn', 'Simple', 'Basic'],
            'uncommon': ['Sturdy', 'Fine', 'Quality'],
            'rare': ['Superior', 'Enchanted', 'Masterwork'],
            'epic': ['Legendary', 'Ancient', 'Divine']
        };

        const itemNames = {
            'weapon': ['Sword', 'Axe', 'Mace', 'Dagger'],
            'armor': ['Chestplate', 'Helmet', 'Boots', 'Gauntlets'],
            'ring': ['Ring', 'Band', 'Loop'],
            'amulet': ['Amulet', 'Pendant', 'Talisman']
        };

        const prefix = prefixes[rarity][Math.floor(Math.random() * prefixes[rarity].length)];
        const name = itemNames[itemType][Math.floor(Math.random() * itemNames[itemType].length)];

        return `${prefix} ${name}`;
    }

    generateItemStats(itemType, rarity, tier) {
        const rarityMultiplier = {
            'common': 1,
            'uncommon': 1.5,
            'rare': 2,
            'epic': 3
        };

        const multiplier = rarityMultiplier[rarity] * (1 + tier * 0.2);
        const stats = {};

        switch (itemType) {
            case 'weapon':
                stats.damage = Math.floor(5 * multiplier);
                if (Math.random() < 0.3) stats.attackSpeed = 0.1 * multiplier;
                break;
            case 'armor':
                stats.armor = Math.floor(3 * multiplier);
                if (Math.random() < 0.3) stats.health = Math.floor(10 * multiplier);
                break;
            case 'ring':
                if (Math.random() < 0.5) stats.damage = Math.floor(2 * multiplier);
                else stats.mana = Math.floor(10 * multiplier);
                break;
            case 'amulet':
                stats.health = Math.floor(15 * multiplier);
                if (Math.random() < 0.3) stats.manaRegen = Math.floor(1 * multiplier);
                break;
        }

        return stats;
    }

    update(deltaTime) {
        // Could check for auto-pickup proximity here
    }

    cleanup() {
        this.roomLoot.clear();
    }
}
