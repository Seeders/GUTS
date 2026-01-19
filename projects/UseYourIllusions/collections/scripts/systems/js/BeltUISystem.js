/**
 * BeltUISystem - Displays the magic belt UI and handles slot selection
 */
class BeltUISystem extends GUTS.BaseSystem {
    static services = [
        'updateBeltUI',
        'refreshBeltDisplay'
    ];

    constructor(game) {
        super(game);
        this.game.beltUISystem = this;
    }

    init() {
    }

    onSceneLoad(sceneData) {
        const sceneName = this.game.sceneManager.currentSceneName;
        if (sceneName === 'game') {
            this.setupBeltUI();
        }
    }

    setupBeltUI() {
        let beltContainer = document.getElementById('magicBeltUI');
        if (!beltContainer) {
            beltContainer = document.createElement('div');
            beltContainer.id = 'magicBeltUI';
            beltContainer.className = 'magic-belt-container';
            beltContainer.innerHTML = `
                <div class="belt-title">Magic Belt</div>
                <div class="belt-slots">
                    <div class="belt-slot" id="beltSlot0" data-slot="0">
                        <div class="slot-content"></div>
                        <div class="slot-key">1</div>
                    </div>
                    <div class="belt-slot" id="beltSlot1" data-slot="1">
                        <div class="slot-content"></div>
                        <div class="slot-key">2</div>
                    </div>
                    <div class="belt-slot" id="beltSlot2" data-slot="2">
                        <div class="slot-content"></div>
                        <div class="slot-key">3</div>
                    </div>
                </div>
                <div class="belt-hint">Press 1-3 to select, Right-click to place</div>
            `;

            const gameContainer = document.getElementById('gameScreen') || document.body;
            gameContainer.appendChild(beltContainer);
        }

        this.addBeltCSS();
        this.setupSlotClickHandlers();
    }

    addBeltCSS() {
        if (document.getElementById('belt-ui-styles')) return;

        const style = document.createElement('style');
        style.id = 'belt-ui-styles';
        style.textContent = `
            .magic-belt-container {
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: linear-gradient(145deg, rgba(30, 30, 50, 0.95), rgba(20, 20, 40, 0.95));
                border: 2px solid #8b5cf6;
                border-radius: 10px;
                padding: 10px 15px;
                z-index: 1000;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            }

            .belt-title {
                color: #8b5cf6;
                font-size: 12px;
                text-align: center;
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 1px;
            }

            .belt-slots {
                display: flex;
                gap: 10px;
            }

            .belt-slot {
                width: 60px;
                height: 60px;
                background: rgba(0, 0, 0, 0.4);
                border: 2px solid #333;
                border-radius: 8px;
                position: relative;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .belt-slot:hover {
                border-color: #8b5cf6;
                transform: scale(1.05);
            }

            .belt-slot.selected {
                border-color: #00ffff;
                box-shadow: 0 0 15px rgba(0, 255, 255, 0.4);
            }

            .belt-slot.filled {
                background: rgba(139, 92, 246, 0.2);
            }

            .slot-content {
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
            }

            .slot-key {
                position: absolute;
                bottom: 2px;
                right: 4px;
                font-size: 10px;
                color: #666;
                font-weight: bold;
            }

            .belt-hint {
                color: #666;
                font-size: 10px;
                text-align: center;
                margin-top: 8px;
            }

            .slot-item-icon {
                font-size: 28px;
            }
        `;
        document.head.appendChild(style);
    }

    setupSlotClickHandlers() {
        for (let i = 0; i < 3; i++) {
            const slot = document.getElementById(`beltSlot${i}`);
            if (slot && !slot._clickHandlerAttached) {
                slot._clickHandlerAttached = true;
                slot.addEventListener('click', () => {
                    this.selectSlot(i);
                });
            }
        }
    }

    // Event handler - called by triggerEvent('onBeltUpdated', data)
    onBeltUpdated(data) {
        this.updateBeltUI();
    }

    // Event handler - called by triggerEvent('onBeltSelectionChanged', data)
    onBeltSelectionChanged(data) {
        this.updateSlotSelection(data.slotIndex);
    }

    selectSlot(slotIndex) {
        const playerEntity = this.game.call('getPlayerEntity');
        if (!playerEntity) return;

        this.game.call('setSelectedBeltSlot', playerEntity, slotIndex);
    }

    updateSlotSelection(selectedIndex) {
        for (let i = 0; i < 3; i++) {
            const slot = document.getElementById(`beltSlot${i}`);
            if (slot) {
                slot.classList.toggle('selected', i === selectedIndex);
            }
        }
    }

    updateBeltUI() {
        const playerEntity = this.game.call('getPlayerEntity');
        if (!playerEntity) return;

        const belt = this.game.getComponent(playerEntity, 'magicBelt');
        if (!belt) return;

        const reverseEnums = this.game.getReverseEnums();

        for (let i = 0; i < 3; i++) {
            const slotKey = `slot${i}`;
            const itemTypeIndex = belt[slotKey];
            const slotEl = document.getElementById(`beltSlot${i}`);

            if (!slotEl) continue;

            const contentEl = slotEl.querySelector('.slot-content');

            // null means empty slot, 0 is a valid item index (barrel)
            if (itemTypeIndex !== null) {
                // Convert index to string name for icon lookup
                const itemType = reverseEnums.collectibles?.[itemTypeIndex];
                contentEl.innerHTML = `<span class="slot-item-icon">${this.getItemIcon(itemType)}</span>`;
                slotEl.classList.add('filled');
            } else {
                contentEl.innerHTML = '';
                slotEl.classList.remove('filled');
            }

            slotEl.classList.toggle('selected', i === belt.selectedSlot);
        }
    }

    refreshBeltDisplay() {
        this.updateBeltUI();
    }

    getItemIcon(itemType) {
        const icons = {
            'barrel': '🛢️',
            'crate': '📦',
            'decoy_soldier': '🪖'
        };
        return icons[itemType] || '❓';
    }

    onSceneUnload() {
        const beltContainer = document.getElementById('magicBeltUI');
        if (beltContainer) {
            beltContainer.remove();
        }

        const beltStyles = document.getElementById('belt-ui-styles');
        if (beltStyles) {
            beltStyles.remove();
        }
    }
}
