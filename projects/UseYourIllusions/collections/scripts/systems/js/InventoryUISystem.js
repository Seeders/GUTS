/**
 * InventoryUISystem - Player inventory and ability slot management UI
 *
 * Features:
 * - Toggle with I key
 * - Shows player inventory items
 * - Shows Q ability slot for item abilities
 * - Click to assign/unassign abilities to slot
 */
class InventoryUISystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'getPlayerEntity'
    ];

    static services = [
        'toggleInventoryUI',
        'isInventoryOpen'
    ];

    constructor(game) {
        super(game);
        this.game.inventoryUISystem = this;
        this.isOpen = false;
    }

    init() {
    }

    onSceneLoad(sceneData) {
        const sceneName = this.game.sceneManager.currentSceneName;
        if (sceneName === 'game') {
            this.setupInventoryUI();
        }
    }

    setupInventoryUI() {
        // Create the inventory panel (hidden by default)
        let inventoryPanel = document.getElementById('inventoryUI');
        if (!inventoryPanel) {
            inventoryPanel = document.createElement('div');
            inventoryPanel.id = 'inventoryUI';
            inventoryPanel.className = 'inventory-panel';
            inventoryPanel.style.display = 'none';
            inventoryPanel.innerHTML = `
                <div class="inventory-header">
                    <h2>Inventory</h2>
                    <button class="inventory-close" id="inventoryCloseBtn">&times;</button>
                </div>
                <div class="inventory-content">
                    <div class="inventory-section">
                        <h3>Ability Slot</h3>
                        <div class="ability-slot-display" id="abilitySlotDisplay">
                            <span class="slot-key-badge">Q</span>
                            <span class="slot-ability-name" id="inventorySlotQName">Empty</span>
                        </div>
                    </div>
                    <div class="inventory-section">
                        <h3>Items</h3>
                        <div class="inventory-items" id="inventoryItems">
                            <div class="empty-message">No items</div>
                        </div>
                        <div class="inventory-hint">Click item to assign to [Q]</div>
                    </div>
                </div>
            `;

            const gameContainer = document.getElementById('gameScreen') || document.body;
            gameContainer.appendChild(inventoryPanel);

            // Add close button handler
            document.getElementById('inventoryCloseBtn').addEventListener('click', () => {
                this.toggleInventoryUI();
            });
        }

        this.addInventoryCSS();
    }

    addInventoryCSS() {
        if (document.getElementById('inventory-ui-styles')) return;

        const style = document.createElement('style');
        style.id = 'inventory-ui-styles';
        style.textContent = `
            .inventory-panel {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 400px;
                max-height: 80vh;
                background: linear-gradient(145deg, rgba(30, 30, 50, 0.98), rgba(20, 20, 40, 0.98));
                border: 2px solid #8b5cf6;
                border-radius: 12px;
                z-index: 2000;
                overflow: hidden;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
            }

            .inventory-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                background: rgba(139, 92, 246, 0.2);
                border-bottom: 1px solid #8b5cf6;
            }

            .inventory-header h2 {
                margin: 0;
                color: #fff;
                font-size: 18px;
            }

            .inventory-close {
                background: none;
                border: none;
                color: #888;
                font-size: 24px;
                cursor: pointer;
                padding: 0;
                line-height: 1;
            }

            .inventory-close:hover {
                color: #fff;
            }

            .inventory-content {
                padding: 16px;
                overflow-y: auto;
                max-height: calc(80vh - 60px);
            }

            .inventory-section {
                margin-bottom: 20px;
            }

            .inventory-section h3 {
                color: #8b5cf6;
                font-size: 14px;
                margin: 0 0 10px 0;
                text-transform: uppercase;
                letter-spacing: 1px;
            }

            .ability-slot-display {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 14px;
                background: rgba(0, 0, 0, 0.3);
                border: 2px solid #444;
                border-radius: 8px;
            }

            .ability-slot-display.has-ability {
                border-color: #00ffaa;
                background: rgba(0, 255, 170, 0.1);
            }

            .slot-key-badge {
                width: 28px;
                height: 28px;
                background: #333;
                border: 1px solid #555;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #888;
                font-weight: bold;
                font-size: 14px;
            }

            .ability-slot-display.has-ability .slot-key-badge {
                border-color: #00ffaa;
                color: #00ffaa;
            }

            .slot-ability-name {
                color: #888;
                font-size: 14px;
            }

            .ability-slot-display.has-ability .slot-ability-name {
                color: #00ffaa;
            }

            .inventory-items {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }

            .inventory-item {
                width: 70px;
                height: 70px;
                background: rgba(0, 0, 0, 0.4);
                border: 2px solid #444;
                border-radius: 8px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                position: relative;
                transition: all 0.2s;
            }

            .inventory-item:hover {
                border-color: #8b5cf6;
                transform: scale(1.05);
            }

            .inventory-item.assigned {
                border-color: #00ffaa;
                background: rgba(0, 255, 170, 0.15);
            }

            .item-icon {
                font-size: 28px;
            }

            .item-name {
                font-size: 9px;
                color: #888;
                margin-top: 2px;
                text-align: center;
            }

            .assigned-badge {
                position: absolute;
                top: 2px;
                right: 4px;
                font-size: 10px;
                color: #00ffaa;
                font-weight: bold;
            }

            .inventory-hint {
                color: #666;
                font-size: 11px;
                margin-top: 10px;
                text-align: center;
            }

            .empty-message {
                color: #666;
                font-style: italic;
                font-size: 12px;
            }
        `;
        document.head.appendChild(style);
    }

    toggleInventoryUI() {
        this.isOpen = !this.isOpen;
        const panel = document.getElementById('inventoryUI');
        if (panel) {
            panel.style.display = this.isOpen ? 'block' : 'none';
            if (this.isOpen) {
                this.refreshInventoryDisplay();
            }
        }
    }

    isInventoryOpen() {
        return this.isOpen;
    }

    refreshInventoryDisplay() {
        const playerEntity = this.call.getPlayerEntity();
        if (!playerEntity) return;

        this.updateAbilitySlotDisplay(playerEntity);
        this.updateItemsDisplay(playerEntity);
    }

    updateAbilitySlotDisplay(playerEntity) {
        const slots = this.game.getComponent(playerEntity, 'abilitySlots');
        const slotNameEl = document.getElementById('inventorySlotQName');
        const slotDisplay = document.getElementById('abilitySlotDisplay');
        if (!slotNameEl || !slotDisplay) return;

        const abilityId = slots?.slotQ;
        if (abilityId) {
            const abilityNames = {
                'CollectAbility': 'Collect'
            };
            slotNameEl.textContent = abilityNames[abilityId] || abilityId.replace('Ability', '');
            slotDisplay.classList.add('has-ability');
        } else {
            slotNameEl.textContent = 'Empty';
            slotDisplay.classList.remove('has-ability');
        }
    }

    updateItemsDisplay(playerEntity) {
        const inventory = this.game.getComponent(playerEntity, 'playerInventory');
        const slots = this.game.getComponent(playerEntity, 'abilitySlots');
        const itemsContainer = document.getElementById('inventoryItems');
        if (!itemsContainer) return;

        if (!inventory || !inventory.items || inventory.items.length === 0) {
            itemsContainer.innerHTML = '<div class="empty-message">No items</div>';
            return;
        }

        // Find which item's ability is currently assigned to Q
        const assignedAbility = slots?.slotQ;

        let html = '';
        for (const itemId of inventory.items) {
            // Try different collection paths
            let itemData = this.collections.items?.[itemId];
            if (!itemData) {
                itemData = this.collections.spawns?.items?.[itemId];
            }
            const icon = this.getItemIcon(itemId);
            const title = itemData?.title || itemId;

            // Check if this item's ability is assigned to Q
            const isAssigned = itemData?.grantsAbilities?.includes(assignedAbility);

            html += `
                <div class="inventory-item ${isAssigned ? 'assigned' : ''}"
                     data-item="${itemId}"
                     title="${itemData?.description || ''}">
                    <span class="item-icon">${icon}</span>
                    <span class="item-name">${title}</span>
                    ${isAssigned ? '<span class="assigned-badge">[Q]</span>' : ''}
                </div>
            `;
        }

        itemsContainer.innerHTML = html;

        // Add click handlers to assign item's ability to Q
        itemsContainer.querySelectorAll('.inventory-item').forEach(el => {
            el.addEventListener('click', () => {
                const itemId = el.dataset.item;
                this.assignItemAbility(playerEntity, itemId);
            });
        });
    }

    /**
     * Assign the first ability from an item to the Q slot
     */
    assignItemAbility(playerEntity, itemId) {
        // Try different collection paths
        let itemData = this.collections.items?.[itemId];
        if (!itemData) {
            itemData = this.collections.spawns?.items?.[itemId];
        }
        if (!itemData?.grantsAbilities?.length) {
            return;
        }

        const slots = this.game.getComponent(playerEntity, 'abilitySlots');
        if (!slots) {
            return;
        }

        const abilityId = itemData.grantsAbilities[0];

        // Toggle: if already assigned, unassign; otherwise assign
        if (slots.slotQ === abilityId) {
            slots.slotQ = null;
        } else {
            slots.slotQ = abilityId;
        }
        this.game.triggerEvent('onAbilitySlotsChanged', { entityId: playerEntity });
        this.refreshInventoryDisplay();
    }

    getItemIcon(itemId) {
        const icons = {
            'magicBelt': '🔮'
        };
        return icons[itemId] || '❓';
    }

    // Event handler for ability slot changes
    onAbilitySlotsChanged(data) {
        if (this.isOpen) {
            this.refreshInventoryDisplay();
        }
    }

    // Event handler for item grants
    onItemGranted(data) {
        if (this.isOpen) {
            this.refreshInventoryDisplay();
        }
    }

    // Event handler for container opened
    onContainerOpened(data) {
        // Show notification about found items
        if (data.contents && data.contents.length > 0) {
            const itemNames = data.contents.map(itemId => {
                const itemData = this.collections.items?.[itemId];
                return itemData?.title || itemId;
            }).join(', ');

            // Could show a toast notification here
            console.log(`[InventoryUISystem] Found: ${itemNames}`);
        }
    }

    // Event handler for player state loaded from save
    onPlayerStateLoaded(data) {
        if (this.isOpen) {
            this.refreshInventoryDisplay();
        }
    }

    onSceneUnload() {
        this.isOpen = false;
        const panel = document.getElementById('inventoryUI');
        if (panel) {
            panel.remove();
        }

        const styles = document.getElementById('inventory-ui-styles');
        if (styles) {
            styles.remove();
        }
    }
}
