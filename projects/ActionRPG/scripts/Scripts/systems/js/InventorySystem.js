class InventorySystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.inventorySystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Inventory storage per entity
        this.inventories = new Map();

        // Configuration
        this.INVENTORY_SIZE = 40; // 8x5 grid
        this.EQUIPMENT_SLOTS = ['mainHand', 'offHand', 'helmet', 'chest', 'legs', 'feet', 'gloves', 'ring1', 'ring2', 'amulet'];

        // UI
        this.uiContainer = null;
        this.isVisible = false;

        // Item rarity colors
        this.rarityColors = {
            common: '#ffffff',
            uncommon: '#00ff00',
            rare: '#0088ff',
            epic: '#aa00ff',
            legendary: '#ff8800'
        };
    }

    init() {
        this.game.gameManager.register('getInventory', this.getInventory.bind(this));
        this.game.gameManager.register('addItemToInventory', this.addItem.bind(this));
        this.game.gameManager.register('removeItemFromInventory', this.removeItem.bind(this));
        this.game.gameManager.register('equipItem', this.equipItem.bind(this));
        this.game.gameManager.register('unequipItem', this.unequipItem.bind(this));
        this.game.gameManager.register('getEquippedItems', this.getEquippedItems.bind(this));
        this.game.gameManager.register('showInventory', this.show.bind(this));
        this.game.gameManager.register('hideInventory', this.hide.bind(this));
        this.game.gameManager.register('toggleInventory', this.toggle.bind(this));

        this.createUI();
    }

    initializeInventory(entityId) {
        if (!this.inventories.has(entityId)) {
            this.inventories.set(entityId, {
                items: new Array(this.INVENTORY_SIZE).fill(null),
                equipped: {}
            });
        }
        return this.inventories.get(entityId);
    }

    getInventory(entityId) {
        return this.initializeInventory(entityId);
    }

    getEquippedItems(entityId) {
        const inv = this.initializeInventory(entityId);
        return inv.equipped;
    }

    addItem(entityId, item) {
        const inv = this.initializeInventory(entityId);

        // Find empty slot
        const emptySlot = inv.items.findIndex(slot => slot === null);
        if (emptySlot === -1) {
            this.game.triggerEvent('onInventoryFull', entityId);
            return false;
        }

        // Generate unique ID if not present
        if (!item.uid) {
            item.uid = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        inv.items[emptySlot] = item;

        this.game.triggerEvent('onItemAddedToInventory', {
            entityId,
            item,
            slot: emptySlot
        });

        if (this.isVisible) this.refreshUI();
        return true;
    }

    removeItem(entityId, slotIndex) {
        const inv = this.initializeInventory(entityId);

        if (slotIndex < 0 || slotIndex >= inv.items.length) return null;

        const item = inv.items[slotIndex];
        inv.items[slotIndex] = null;

        if (this.isVisible) this.refreshUI();
        return item;
    }

    equipItem(entityId, inventorySlot) {
        const inv = this.initializeInventory(entityId);
        const item = inv.items[inventorySlot];

        if (!item || !item.slot) return false;

        const equipSlot = item.slot;

        // Unequip current item in slot
        if (inv.equipped[equipSlot]) {
            const oldItem = inv.equipped[equipSlot];
            inv.items[inventorySlot] = oldItem;
        } else {
            inv.items[inventorySlot] = null;
        }

        // Equip new item
        inv.equipped[equipSlot] = item;

        // Apply stats
        this.applyItemStats(entityId, item, true);

        this.game.triggerEvent('onItemEquipped', {
            entityId,
            item,
            slot: equipSlot
        });

        if (this.isVisible) this.refreshUI();
        return true;
    }

    unequipItem(entityId, equipSlot) {
        const inv = this.initializeInventory(entityId);

        if (!inv.equipped[equipSlot]) return false;

        const item = inv.equipped[equipSlot];

        // Find empty inventory slot
        const emptySlot = inv.items.findIndex(slot => slot === null);
        if (emptySlot === -1) {
            this.game.triggerEvent('onInventoryFull', entityId);
            return false;
        }

        // Move to inventory
        inv.items[emptySlot] = item;
        inv.equipped[equipSlot] = null;

        // Remove stats
        this.applyItemStats(entityId, item, false);

        this.game.triggerEvent('onItemUnequipped', {
            entityId,
            item,
            slot: equipSlot
        });

        if (this.isVisible) this.refreshUI();
        return true;
    }

    applyItemStats(entityId, item, apply) {
        const CT = this.componentTypes;
        const multiplier = apply ? 1 : -1;

        if (!item.stats) return;

        const health = this.game.getComponent(entityId, CT.HEALTH);
        const combat = this.game.getComponent(entityId, CT.COMBAT);
        const resources = this.game.getComponent(entityId, CT.RESOURCE_POOL);

        if (item.stats.health && health) {
            health.max += item.stats.health * multiplier;
            if (apply) health.current += item.stats.health;
        }

        if (combat) {
            if (item.stats.damage) combat.damage += item.stats.damage * multiplier;
            if (item.stats.armor) combat.armor += item.stats.armor * multiplier;
            if (item.stats.attackSpeed) combat.attackSpeed += item.stats.attackSpeed * multiplier;
            if (item.stats.fireResistance) combat.fireResistance += item.stats.fireResistance * multiplier;
            if (item.stats.coldResistance) combat.coldResistance += item.stats.coldResistance * multiplier;
            if (item.stats.lightningResistance) combat.lightningResistance += item.stats.lightningResistance * multiplier;
            if (item.stats.poisonResistance) combat.poisonResistance += item.stats.poisonResistance * multiplier;
        }

        if (item.stats.mana && resources) {
            resources.maxMana += item.stats.mana * multiplier;
            if (apply) resources.mana += item.stats.mana;
        }
    }

    createUI() {
        this.uiContainer = document.createElement('div');
        this.uiContainer.id = 'inventory-ui';
        this.uiContainer.innerHTML = `
            <style>
                #inventory-ui {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 700px;
                    background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
                    border: 2px solid #d4af37;
                    border-radius: 10px;
                    display: none;
                    z-index: 9000;
                    font-family: 'Georgia', serif;
                    box-shadow: 0 0 50px rgba(0, 0, 0, 0.8);
                }

                .inventory-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 15px 20px;
                    border-bottom: 1px solid #333;
                }

                .inventory-title {
                    color: #d4af37;
                    font-size: 24px;
                }

                .inventory-close {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                }

                .inventory-close:hover {
                    color: #ff4444;
                }

                .inventory-content {
                    display: flex;
                    padding: 20px;
                    gap: 20px;
                }

                .equipment-panel {
                    width: 200px;
                }

                .equipment-title {
                    color: #fff;
                    font-size: 16px;
                    margin-bottom: 10px;
                }

                .equipment-slots {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                }

                .equip-slot {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px;
                    background: #222;
                    border: 1px solid #444;
                    border-radius: 5px;
                    cursor: pointer;
                }

                .equip-slot:hover {
                    border-color: #d4af37;
                }

                .equip-slot-icon {
                    width: 32px;
                    height: 32px;
                    background: #333;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                }

                .equip-slot-name {
                    color: #888;
                    font-size: 12px;
                    flex: 1;
                }

                .equip-slot.filled .equip-slot-name {
                    color: #fff;
                }

                .inventory-panel {
                    flex: 1;
                }

                .inventory-grid-title {
                    color: #fff;
                    font-size: 16px;
                    margin-bottom: 10px;
                }

                .inventory-grid {
                    display: grid;
                    grid-template-columns: repeat(8, 1fr);
                    gap: 4px;
                }

                .inv-slot {
                    width: 48px;
                    height: 48px;
                    background: #222;
                    border: 1px solid #444;
                    border-radius: 4px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                    position: relative;
                }

                .inv-slot:hover {
                    border-color: #d4af37;
                }

                .inv-slot.has-item {
                    background: #2a2a3a;
                }

                .item-tooltip {
                    position: absolute;
                    background: rgba(0, 0, 0, 0.95);
                    border: 1px solid #d4af37;
                    padding: 10px;
                    border-radius: 5px;
                    z-index: 10001;
                    min-width: 200px;
                    pointer-events: none;
                }

                .tooltip-name {
                    font-size: 14px;
                    font-weight: bold;
                    margin-bottom: 5px;
                }

                .tooltip-type {
                    color: #888;
                    font-size: 11px;
                    margin-bottom: 8px;
                }

                .tooltip-stat {
                    color: #7cfc00;
                    font-size: 11px;
                }
            </style>

            <div class="inventory-header">
                <div class="inventory-title">Inventory</div>
                <button class="inventory-close" id="inventory-close">&times;</button>
            </div>

            <div class="inventory-content">
                <div class="equipment-panel">
                    <div class="equipment-title">Equipment</div>
                    <div class="equipment-slots" id="equipment-slots"></div>
                </div>

                <div class="inventory-panel">
                    <div class="inventory-grid-title">Backpack</div>
                    <div class="inventory-grid" id="inventory-grid"></div>
                </div>
            </div>
        `;

        document.body.appendChild(this.uiContainer);

        document.getElementById('inventory-close').addEventListener('click', () => this.hide());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) this.hide();
            if (e.key === 'i' || e.key === 'I') this.toggle();
        });
    }

    refreshUI() {
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId) return;

        const inv = this.getInventory(playerEntityId);

        // Render equipment slots
        const equipmentDiv = document.getElementById('equipment-slots');
        equipmentDiv.innerHTML = '';

        const slotIcons = {
            mainHand: '⚔️', offHand: '🛡️', helmet: '⛑️', chest: '👕',
            legs: '👖', feet: '👢', gloves: '🧤', ring1: '💍', ring2: '💍', amulet: '📿'
        };

        this.EQUIPMENT_SLOTS.forEach(slot => {
            const item = inv.equipped[slot];
            const slotDiv = document.createElement('div');
            slotDiv.className = `equip-slot ${item ? 'filled' : ''}`;

            slotDiv.innerHTML = `
                <div class="equip-slot-icon">${item ? '📦' : slotIcons[slot]}</div>
                <div class="equip-slot-name">${item ? item.name : slot}</div>
            `;

            if (item) {
                slotDiv.addEventListener('click', () => {
                    this.unequipItem(playerEntityId, slot);
                });
            }

            equipmentDiv.appendChild(slotDiv);
        });

        // Render inventory grid
        const gridDiv = document.getElementById('inventory-grid');
        gridDiv.innerHTML = '';

        for (let i = 0; i < this.INVENTORY_SIZE; i++) {
            const item = inv.items[i];
            const slotDiv = document.createElement('div');
            slotDiv.className = `inv-slot ${item ? 'has-item' : ''}`;

            if (item) {
                slotDiv.textContent = '📦';
                slotDiv.style.borderColor = this.rarityColors[item.rarity] || '#444';

                slotDiv.addEventListener('click', () => {
                    if (item.slot) {
                        this.equipItem(playerEntityId, i);
                    }
                });

                // Tooltip on hover
                slotDiv.addEventListener('mouseenter', (e) => {
                    this.showTooltip(e, item);
                });
                slotDiv.addEventListener('mouseleave', () => {
                    this.hideTooltip();
                });
            }

            gridDiv.appendChild(slotDiv);
        }
    }

    showTooltip(event, item) {
        let tooltip = document.getElementById('item-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'item-tooltip';
            tooltip.className = 'item-tooltip';
            document.body.appendChild(tooltip);
        }

        let statsHtml = '';
        if (item.stats) {
            for (const [stat, value] of Object.entries(item.stats)) {
                if (value) statsHtml += `<div class="tooltip-stat">+${value} ${stat}</div>`;
            }
        }

        tooltip.innerHTML = `
            <div class="tooltip-name" style="color: ${this.rarityColors[item.rarity] || '#fff'}">${item.name}</div>
            <div class="tooltip-type">${item.slot || 'Consumable'} - ${item.rarity || 'common'}</div>
            ${statsHtml}
        `;

        tooltip.style.display = 'block';
        tooltip.style.left = `${event.pageX + 10}px`;
        tooltip.style.top = `${event.pageY + 10}px`;
    }

    hideTooltip() {
        const tooltip = document.getElementById('item-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    }

    show() {
        this.isVisible = true;
        this.uiContainer.style.display = 'block';
        this.refreshUI();
    }

    hide() {
        this.isVisible = false;
        this.uiContainer.style.display = 'none';
        this.hideTooltip();
    }

    toggle() {
        if (this.isVisible) this.hide();
        else this.show();
    }

    update() {}
}
