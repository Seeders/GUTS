class VendorSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.vendorSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        this.uiContainer = null;
        this.isVisible = false;
        this.currentVendor = null;

        // Vendor inventories
        this.vendors = {
            weaponsmith: {
                name: 'Weaponsmith',
                icon: '⚔️',
                items: [
                    { name: 'Iron Sword', slot: 'mainHand', rarity: 'common', stats: { damage: 8 }, price: 50 },
                    { name: 'Steel Sword', slot: 'mainHand', rarity: 'uncommon', stats: { damage: 15 }, price: 150 },
                    { name: 'Flame Blade', slot: 'mainHand', rarity: 'rare', stats: { damage: 25, fireResistance: 0.1 }, price: 400 },
                    { name: 'Iron Axe', slot: 'mainHand', rarity: 'common', stats: { damage: 10 }, price: 60 },
                    { name: 'War Hammer', slot: 'mainHand', rarity: 'uncommon', stats: { damage: 18, attackSpeed: -0.1 }, price: 180 }
                ]
            },
            armorer: {
                name: 'Armorer',
                icon: '🛡️',
                items: [
                    { name: 'Leather Armor', slot: 'chest', rarity: 'common', stats: { armor: 5 }, price: 40 },
                    { name: 'Chainmail', slot: 'chest', rarity: 'uncommon', stats: { armor: 12, health: 20 }, price: 120 },
                    { name: 'Plate Armor', slot: 'chest', rarity: 'rare', stats: { armor: 20, health: 50 }, price: 350 },
                    { name: 'Iron Helm', slot: 'helmet', rarity: 'common', stats: { armor: 3 }, price: 30 },
                    { name: 'Steel Shield', slot: 'offHand', rarity: 'uncommon', stats: { armor: 8 }, price: 100 }
                ]
            },
            alchemist: {
                name: 'Alchemist',
                icon: '🧪',
                items: [
                    { name: 'Health Potion', type: 'potion', potionType: 'health', price: 25 },
                    { name: 'Mana Potion', type: 'potion', potionType: 'mana', price: 25 },
                    { name: 'Greater Health Potion', type: 'potion', potionType: 'health', quantity: 3, price: 60 },
                    { name: 'Greater Mana Potion', type: 'potion', potionType: 'mana', quantity: 3, price: 60 }
                ]
            },
            jeweler: {
                name: 'Jeweler',
                icon: '💎',
                items: [
                    { name: 'Ruby Ring', slot: 'ring1', rarity: 'uncommon', stats: { fireResistance: 0.15 }, price: 200 },
                    { name: 'Sapphire Ring', slot: 'ring1', rarity: 'uncommon', stats: { coldResistance: 0.15 }, price: 200 },
                    { name: 'Emerald Amulet', slot: 'amulet', rarity: 'rare', stats: { poisonResistance: 0.2, health: 30 }, price: 400 },
                    { name: 'Diamond Ring', slot: 'ring1', rarity: 'rare', stats: { damage: 5, mana: 20 }, price: 500 }
                ]
            }
        };
    }

    init() {
        this.game.gameManager.register('openVendor', this.openVendor.bind(this));
        this.game.gameManager.register('closeVendor', this.close.bind(this));
        this.game.gameManager.register('buyItem', this.buyItem.bind(this));
        this.game.gameManager.register('sellItem', this.sellItem.bind(this));

        this.createUI();
    }

    createUI() {
        this.uiContainer = document.createElement('div');
        this.uiContainer.id = 'vendor-ui';
        this.uiContainer.innerHTML = `
            <style>
                #vendor-ui {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 500px;
                    max-height: 80vh;
                    background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
                    border: 2px solid #d4af37;
                    border-radius: 10px;
                    display: none;
                    flex-direction: column;
                    z-index: 9000;
                    font-family: 'Georgia', serif;
                    box-shadow: 0 0 50px rgba(0, 0, 0, 0.8);
                }

                .vendor-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 15px 20px;
                    border-bottom: 1px solid #333;
                }

                .vendor-title {
                    color: #d4af37;
                    font-size: 24px;
                }

                .vendor-gold {
                    color: #ffdd00;
                    font-size: 16px;
                }

                .vendor-close {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                }

                .vendor-close:hover {
                    color: #ff4444;
                }

                .vendor-content {
                    padding: 20px;
                    overflow-y: auto;
                    flex: 1;
                }

                .vendor-item {
                    display: flex;
                    align-items: center;
                    padding: 10px;
                    background: #222;
                    border: 1px solid #444;
                    border-radius: 5px;
                    margin-bottom: 8px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .vendor-item:hover {
                    border-color: #d4af37;
                    background: #2a2a3a;
                }

                .vendor-item.too-expensive {
                    opacity: 0.5;
                }

                .item-icon {
                    width: 40px;
                    height: 40px;
                    background: #333;
                    border-radius: 5px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                    margin-right: 15px;
                }

                .item-info {
                    flex: 1;
                }

                .item-name {
                    font-size: 14px;
                    margin-bottom: 3px;
                }

                .item-stats {
                    color: #7cfc00;
                    font-size: 11px;
                }

                .item-price {
                    color: #ffdd00;
                    font-size: 14px;
                    font-weight: bold;
                }
            </style>

            <div class="vendor-header">
                <div class="vendor-title" id="vendor-title">Vendor</div>
                <div class="vendor-gold" id="vendor-gold">Gold: 0</div>
                <button class="vendor-close" id="vendor-close">&times;</button>
            </div>

            <div class="vendor-content" id="vendor-content"></div>
        `;

        document.body.appendChild(this.uiContainer);

        document.getElementById('vendor-close').addEventListener('click', () => this.close());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) this.close();
        });
    }

    openVendor(vendorId) {
        const vendor = this.vendors[vendorId];
        if (!vendor) return;

        this.currentVendor = vendorId;
        this.isVisible = true;
        this.uiContainer.style.display = 'flex';

        document.getElementById('vendor-title').textContent = `${vendor.icon} ${vendor.name}`;
        this.refreshVendorItems();
    }

    refreshVendorItems() {
        const content = document.getElementById('vendor-content');
        const vendor = this.vendors[this.currentVendor];
        const playerGold = this.game.gameManager.call('getPlayerGold');

        document.getElementById('vendor-gold').textContent = `Gold: ${playerGold}`;

        const rarityColors = {
            common: '#ffffff',
            uncommon: '#00ff00',
            rare: '#0088ff',
            epic: '#aa00ff',
            legendary: '#ff8800'
        };

        content.innerHTML = vendor.items.map((item, index) => {
            const canAfford = playerGold >= item.price;
            let statsText = '';

            if (item.stats) {
                statsText = Object.entries(item.stats)
                    .map(([k, v]) => `+${v} ${k}`)
                    .join(', ');
            } else if (item.type === 'potion') {
                statsText = item.quantity ? `x${item.quantity}` : 'x1';
            }

            return `
                <div class="vendor-item ${canAfford ? '' : 'too-expensive'}" data-index="${index}">
                    <div class="item-icon">📦</div>
                    <div class="item-info">
                        <div class="item-name" style="color: ${rarityColors[item.rarity] || '#fff'}">${item.name}</div>
                        <div class="item-stats">${statsText}</div>
                    </div>
                    <div class="item-price">${item.price}g</div>
                </div>
            `;
        }).join('');

        content.querySelectorAll('.vendor-item').forEach(el => {
            el.addEventListener('click', () => {
                const index = parseInt(el.dataset.index);
                this.buyItem(index);
            });
        });
    }

    buyItem(itemIndex) {
        const vendor = this.vendors[this.currentVendor];
        const item = vendor.items[itemIndex];
        const playerGold = this.game.gameManager.call('getPlayerGold');

        if (playerGold < item.price) {
            this.game.gameManager.call('showMessage', 'Not enough gold!');
            return false;
        }

        // Spend gold
        this.game.gameManager.call('spendPlayerGold', item.price);

        // Add item based on type
        if (item.type === 'potion') {
            const quantity = item.quantity || 1;
            if (item.potionType === 'health') {
                this.game.gameManager.call('addHealthPotions', this.game.gameManager.call('getPlayerEntity'), quantity);
            } else if (item.potionType === 'mana') {
                this.game.gameManager.call('addManaPotions', this.game.gameManager.call('getPlayerEntity'), quantity);
            }
        } else {
            // Add equipment to inventory
            const newItem = {
                name: item.name,
                slot: item.slot,
                rarity: item.rarity || 'common',
                stats: { ...item.stats }
            };
            this.game.gameManager.call('addItemToInventory', this.game.gameManager.call('getPlayerEntity'), newItem);
        }

        this.game.gameManager.call('showMessage', `Bought ${item.name}!`);
        this.refreshVendorItems();
        return true;
    }

    sellItem(inventorySlot) {
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        const item = this.game.gameManager.call('removeItemFromInventory', playerEntityId, inventorySlot);

        if (!item) return false;

        // Calculate sell price (50% of buy value)
        const basePrice = 50;
        const rarityMultiplier = { common: 1, uncommon: 2, rare: 4, epic: 8, legendary: 16 };
        const sellPrice = Math.floor(basePrice * (rarityMultiplier[item.rarity] || 1) * 0.5);

        this.game.gameManager.call('addPlayerGold', sellPrice);
        this.game.gameManager.call('showMessage', `Sold ${item.name} for ${sellPrice}g`);

        return true;
    }

    close() {
        this.isVisible = false;
        this.uiContainer.style.display = 'none';
        this.currentVendor = null;
    }

    update() {}
}
