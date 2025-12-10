/**
 * InventorySystem - Manages player inventory and items
 *
 * Handles:
 * - Item storage
 * - Equipment management
 * - Item usage
 * - Inventory UI
 */
class InventorySystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.inventorySystem = this;

        // Inventory storage
        this.inventory = []; // Array of { itemId, quantity, slot }
        this.maxSlots = 20;

        // Equipment slots
        this.equipment = {
            weapon: null,
            armor: null,
            helmet: null,
            boots: null,
            accessory: null
        };

        // UI state
        this.isInventoryOpen = false;
    }

    init(params) {
        this.params = params || {};
        console.log('[InventorySystem] Initializing...');
        this.registerServices();
        this.loadInventory();
    }

    registerServices() {
        // Inventory management
        this.game.register('addToInventory', this.addToInventory.bind(this));
        this.game.register('removeFromInventory', this.removeFromInventory.bind(this));
        this.game.register('getInventory', () => [...this.inventory]);
        this.game.register('setInventory', (items) => { this.inventory = items; });
        this.game.register('hasItem', this.hasItem.bind(this));
        this.game.register('getItemCount', this.getItemCount.bind(this));

        // Equipment
        this.game.register('equipItem', this.equipItem.bind(this));
        this.game.register('unequipItem', this.unequipItem.bind(this));
        this.game.register('getEquipment', () => ({ ...this.equipment }));
        this.game.register('setEquipment', (equip) => { this.equipment = { ...equip }; });
        this.game.register('getEquippedItem', (slot) => this.equipment[slot]);

        // Item usage
        this.game.register('useItem', this.useItem.bind(this));

        // UI
        this.game.register('toggleInventory', this.toggleInventory.bind(this));
        this.game.register('isInventoryOpen', () => this.isInventoryOpen);
    }

    loadInventory() {
        // Try to load from character save
        const savedChar = this.game.call('loadCharacter');
        if (savedChar?.inventory) {
            this.inventory = savedChar.inventory;
        }
        if (savedChar?.equipment) {
            this.equipment = savedChar.equipment;
        }
    }

    addToInventory(itemId, quantity = 1) {
        // Check if item is stackable
        const items = this.game.getCollections().items;
        const itemDef = items?.[itemId];

        if (!itemDef) {
            console.warn('[InventorySystem] Item not found:', itemId);
            return false;
        }

        const isStackable = itemDef.stackable !== false;

        if (isStackable) {
            // Find existing stack
            const existingSlot = this.inventory.find(slot => slot.itemId === itemId);
            if (existingSlot) {
                existingSlot.quantity += quantity;
                this.updateInventoryUI();
                return true;
            }
        }

        // Add to new slot
        if (this.inventory.length >= this.maxSlots) {
            this.game.call('showNotification', 'Inventory full!', 'error');
            return false;
        }

        this.inventory.push({
            itemId,
            quantity,
            slot: this.findEmptySlot()
        });

        this.updateInventoryUI();
        return true;
    }

    removeFromInventory(itemId, quantity = 1) {
        const slotIndex = this.inventory.findIndex(slot => slot.itemId === itemId);
        if (slotIndex === -1) return false;

        const slot = this.inventory[slotIndex];
        slot.quantity -= quantity;

        if (slot.quantity <= 0) {
            this.inventory.splice(slotIndex, 1);
        }

        this.updateInventoryUI();
        return true;
    }

    hasItem(itemId, quantity = 1) {
        const slot = this.inventory.find(s => s.itemId === itemId);
        return slot && slot.quantity >= quantity;
    }

    getItemCount(itemId) {
        const slot = this.inventory.find(s => s.itemId === itemId);
        return slot ? slot.quantity : 0;
    }

    findEmptySlot() {
        for (let i = 0; i < this.maxSlots; i++) {
            if (!this.inventory.find(slot => slot.slot === i)) {
                return i;
            }
        }
        return -1;
    }

    equipItem(inventorySlot) {
        const slot = this.inventory.find(s => s.slot === inventorySlot);
        if (!slot) return false;

        const items = this.game.getCollections().items;
        const itemDef = items?.[slot.itemId];

        if (!itemDef || !itemDef.equipSlot) {
            this.game.call('showNotification', 'Cannot equip this item', 'warning');
            return false;
        }

        // Unequip existing item in slot
        if (this.equipment[itemDef.equipSlot]) {
            this.unequipItem(itemDef.equipSlot);
        }

        // Remove from inventory
        this.removeFromInventory(slot.itemId, 1);

        // Equip
        this.equipment[itemDef.equipSlot] = slot.itemId;

        // Apply stats
        this.applyEquipmentStats();

        this.game.call('showNotification', `Equipped ${itemDef.name}`, 'success');
        this.updateInventoryUI();
        return true;
    }

    unequipItem(equipSlot) {
        const itemId = this.equipment[equipSlot];
        if (!itemId) return false;

        // Add back to inventory
        if (!this.addToInventory(itemId, 1)) {
            this.game.call('showNotification', 'Inventory full, cannot unequip', 'error');
            return false;
        }

        // Clear equipment slot
        this.equipment[equipSlot] = null;

        // Recalculate stats
        this.applyEquipmentStats();

        this.updateInventoryUI();
        return true;
    }

    applyEquipmentStats() {
        const localPlayer = this.game.call('getLocalPlayerEntity');
        if (!localPlayer) return;

        const items = this.game.getCollections().items;
        const playerChar = this.game.getComponent(localPlayer, 'playerCharacter');
        const level = playerChar?.level || 1;
        const characterClass = playerChar?.characterClass || 'warrior';

        // Get base stats
        const baseStats = this.game.call('calculateStats', level, characterClass);

        // Add equipment bonuses
        let bonusHealth = 0;
        let bonusDamage = 0;
        let bonusDefense = 0;

        for (const slot in this.equipment) {
            const itemId = this.equipment[slot];
            if (!itemId) continue;

            const itemDef = items?.[itemId];
            if (!itemDef) continue;

            if (itemDef.bonusHealth) bonusHealth += itemDef.bonusHealth;
            if (itemDef.bonusDamage) bonusDamage += itemDef.bonusDamage;
            if (itemDef.bonusDefense) bonusDefense += itemDef.bonusDefense;
        }

        // Update player components
        const health = this.game.getComponent(localPlayer, 'health');
        if (health) {
            const newMax = baseStats.health + bonusHealth;
            const healthPercent = health.current / health.max;
            health.max = newMax;
            health.current = Math.floor(healthPercent * newMax);
        }

        const combat = this.game.getComponent(localPlayer, 'combat');
        if (combat) {
            combat.damage = baseStats.damage + bonusDamage;
            combat.defense = baseStats.defense + bonusDefense;
        }
    }

    useItem(inventorySlot) {
        const slot = this.inventory.find(s => s.slot === inventorySlot);
        if (!slot) return false;

        const items = this.game.getCollections().items;
        const itemDef = items?.[slot.itemId];

        if (!itemDef || !itemDef.usable) {
            this.game.call('showNotification', 'Cannot use this item', 'warning');
            return false;
        }

        // Apply item effect
        const localPlayer = this.game.call('getLocalPlayerEntity');
        if (!localPlayer) return false;

        switch (itemDef.effect) {
            case 'heal':
                const health = this.game.getComponent(localPlayer, 'health');
                if (health) {
                    health.current = Math.min(health.max, health.current + (itemDef.healAmount || 50));
                    this.game.call('showNotification', `Healed for ${itemDef.healAmount || 50}`, 'success');
                }
                break;

            case 'buff_damage':
                // Add temporary buff
                this.game.call('applyBuff', localPlayer, 'damage', itemDef.buffAmount || 10, itemDef.duration || 30);
                this.game.call('showNotification', 'Damage increased!', 'success');
                break;

            case 'buff_defense':
                this.game.call('applyBuff', localPlayer, 'defense', itemDef.buffAmount || 10, itemDef.duration || 30);
                this.game.call('showNotification', 'Defense increased!', 'success');
                break;

            default:
                console.warn('[InventorySystem] Unknown item effect:', itemDef.effect);
                return false;
        }

        // Consume item
        this.removeFromInventory(slot.itemId, 1);
        return true;
    }

    toggleInventory() {
        this.isInventoryOpen = !this.isInventoryOpen;

        let inventoryPanel = document.getElementById('inventory-panel');

        if (this.isInventoryOpen) {
            if (!inventoryPanel) {
                this.createInventoryPanel();
            }
            this.updateInventoryUI();
            document.getElementById('inventory-panel').style.display = 'block';
        } else {
            if (inventoryPanel) {
                inventoryPanel.style.display = 'none';
            }
        }
    }

    createInventoryPanel() {
        const panel = document.createElement('div');
        panel.id = 'inventory-panel';
        panel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.95);
            border: 2px solid #4a9eff;
            border-radius: 12px;
            padding: 20px;
            z-index: 500;
            min-width: 400px;
            pointer-events: auto;
        `;

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h2 style="color: #4a9eff; margin: 0;">Inventory</h2>
                <button id="close-inventory" style="
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                ">&times;</button>
            </div>
            <div id="equipment-slots" style="
                display: flex;
                justify-content: space-around;
                margin-bottom: 20px;
                padding-bottom: 15px;
                border-bottom: 1px solid #333;
            "></div>
            <div id="inventory-slots" style="
                display: grid;
                grid-template-columns: repeat(5, 1fr);
                gap: 5px;
            "></div>
        `;

        document.body.appendChild(panel);

        // Close button
        document.getElementById('close-inventory').addEventListener('click', () => {
            this.toggleInventory();
        });
    }

    updateInventoryUI() {
        const equipmentContainer = document.getElementById('equipment-slots');
        const inventoryContainer = document.getElementById('inventory-slots');

        if (!equipmentContainer || !inventoryContainer) return;

        const items = this.game.getCollections().items || {};

        // Render equipment
        const equipSlots = ['weapon', 'armor', 'helmet', 'boots', 'accessory'];
        equipmentContainer.innerHTML = equipSlots.map(slot => {
            const itemId = this.equipment[slot];
            const itemDef = itemId ? items[itemId] : null;

            return `
                <div class="equip-slot" data-slot="${slot}" style="
                    width: 50px;
                    height: 50px;
                    background: #222;
                    border: 2px solid ${itemId ? '#4a9eff' : '#444'};
                    border-radius: 8px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    cursor: ${itemId ? 'pointer' : 'default'};
                " title="${itemDef ? itemDef.name : slot}">
                    <span style="font-size: 20px;">${itemDef?.icon || this.getSlotIcon(slot)}</span>
                    <span style="font-size: 8px; color: #888; text-transform: capitalize;">${slot}</span>
                </div>
            `;
        }).join('');

        // Add equipment click handlers
        equipmentContainer.querySelectorAll('.equip-slot').forEach(el => {
            el.addEventListener('click', () => {
                const slot = el.dataset.slot;
                if (this.equipment[slot]) {
                    this.unequipItem(slot);
                }
            });
        });

        // Render inventory
        inventoryContainer.innerHTML = '';
        for (let i = 0; i < this.maxSlots; i++) {
            const slot = this.inventory.find(s => s.slot === i);
            const itemDef = slot ? items[slot.itemId] : null;

            const slotEl = document.createElement('div');
            slotEl.className = 'inventory-slot';
            slotEl.dataset.slot = i;
            slotEl.style.cssText = `
                width: 50px;
                height: 50px;
                background: #222;
                border: 2px solid ${slot ? '#4a9eff' : '#333'};
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                cursor: ${slot ? 'pointer' : 'default'};
            `;

            if (itemDef) {
                slotEl.innerHTML = `
                    <span style="font-size: 24px;">${itemDef.icon || '?'}</span>
                    ${slot.quantity > 1 ? `<span style="
                        position: absolute;
                        bottom: 2px;
                        right: 4px;
                        font-size: 10px;
                        color: white;
                    ">${slot.quantity}</span>` : ''}
                `;
                slotEl.title = `${itemDef.name}\n${itemDef.description || ''}\nRight-click to use`;
            }

            inventoryContainer.appendChild(slotEl);
        }

        // Add inventory slot click handlers
        inventoryContainer.querySelectorAll('.inventory-slot').forEach(el => {
            const slotIndex = parseInt(el.dataset.slot);
            const slot = this.inventory.find(s => s.slot === slotIndex);
            if (!slot) return;

            const itemDef = items[slot.itemId];

            el.addEventListener('click', () => {
                if (itemDef?.equipSlot) {
                    this.equipItem(slotIndex);
                }
            });

            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (itemDef?.usable) {
                    this.useItem(slotIndex);
                }
            });
        });
    }

    getSlotIcon(slot) {
        const icons = {
            weapon: '&#9876;',
            armor: '&#128737;',
            helmet: '&#9935;',
            boots: '&#128095;',
            accessory: '&#128142;'
        };
        return icons[slot] || '?';
    }

    update() {
        // Handle I key to toggle inventory
        // (Handled in KeyboardSystem or PlayerControlSystem)
    }

    onSceneUnload() {
        // Close inventory if open
        if (this.isInventoryOpen) {
            this.toggleInventory();
        }
    }
}
