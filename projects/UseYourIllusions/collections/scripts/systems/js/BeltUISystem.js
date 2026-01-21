/**
 * BeltUISystem - Displays the magic belt UI, clone ability indicator, and handles slot selection
 */
class BeltUISystem extends GUTS.BaseSystem {
    static services = [
        'updateBeltUI',
        'refreshBeltDisplay'
    ];

    constructor(game) {
        super(game);
        this.game.beltUISystem = this;
        this.cloneTimerInterval = null;
    }

    init() {
    }

    onSceneLoad(sceneData) {
        const sceneName = this.game.sceneManager.currentSceneName;
        if (sceneName === 'game') {
            this.setupBeltUI();
            this.setupCloneAbilityUI();
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
                const itemType = reverseEnums.worldObjects?.[itemTypeIndex];
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
            'present': '🎁'
        };
        return icons[itemType] || '❓';
    }

    setupCloneAbilityUI() {
        let cloneContainer = document.getElementById('cloneAbilityUI');
        if (!cloneContainer) {
            cloneContainer = document.createElement('div');
            cloneContainer.id = 'cloneAbilityUI';
            cloneContainer.className = 'clone-ability-container';
            cloneContainer.innerHTML = `
                <div class="clone-ability-box" id="cloneAbilityBox">
                    <div class="clone-icon">👤</div>
                    <div class="clone-key">Q</div>
                    <div class="clone-label">Clone</div>
                    <div class="clone-timer" id="cloneTimer"></div>
                    <div class="clone-progress-bar" id="cloneProgressBar"></div>
                </div>
            `;

            const gameContainer = document.getElementById('gameScreen') || document.body;
            gameContainer.appendChild(cloneContainer);
        }

        this.addCloneAbilityCSS();
        this.startCloneTimerUpdate();
    }

    addCloneAbilityCSS() {
        if (document.getElementById('clone-ability-styles')) return;

        const style = document.createElement('style');
        style.id = 'clone-ability-styles';
        style.textContent = `
            .clone-ability-container {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 1000;
            }

            .clone-ability-box {
                width: 70px;
                height: 70px;
                background: linear-gradient(145deg, rgba(30, 30, 50, 0.95), rgba(20, 20, 40, 0.95));
                border: 2px solid #4080ff;
                border-radius: 10px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                position: relative;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                transition: all 0.2s ease;
            }

            .clone-ability-box.active {
                border-color: #00ffff;
                box-shadow: 0 0 20px rgba(0, 255, 255, 0.5);
                background: linear-gradient(145deg, rgba(64, 128, 255, 0.3), rgba(20, 20, 40, 0.95));
            }

            .clone-ability-box.controlling-clone {
                border-color: #ff8040;
                box-shadow: 0 0 20px rgba(255, 128, 64, 0.5);
            }

            .clone-icon {
                font-size: 24px;
                margin-bottom: 2px;
            }

            .clone-key {
                position: absolute;
                top: 4px;
                right: 6px;
                font-size: 10px;
                color: #666;
                font-weight: bold;
            }

            .clone-label {
                font-size: 10px;
                color: #4080ff;
                text-transform: uppercase;
                letter-spacing: 1px;
            }

            .clone-ability-box.active .clone-label {
                color: #00ffff;
            }

            .clone-ability-box.controlling-clone .clone-label {
                color: #ff8040;
            }

            .clone-timer {
                font-size: 12px;
                color: #fff;
                font-weight: bold;
                position: absolute;
                bottom: 4px;
                left: 50%;
                transform: translateX(-50%);
            }

            .clone-progress-bar {
                position: absolute;
                bottom: 0;
                left: 0;
                height: 3px;
                background: #00ffff;
                border-radius: 0 0 8px 8px;
                transition: width 0.1s linear;
            }

            .clone-ability-box.controlling-clone .clone-progress-bar {
                background: #ff8040;
            }
        `;
        document.head.appendChild(style);
    }

    startCloneTimerUpdate() {
        if (this.cloneTimerInterval) {
            clearInterval(this.cloneTimerInterval);
        }

        this.cloneTimerInterval = setInterval(() => {
            this.updateCloneAbilityUI();
        }, 100);
    }

    updateCloneAbilityUI() {
        const playerEntity = this.game.call('getPlayerEntity');
        if (!playerEntity) return;

        const playerController = this.game.getComponent(playerEntity, 'playerController');
        if (!playerController) return;

        const cloneBox = document.getElementById('cloneAbilityBox');
        const cloneTimer = document.getElementById('cloneTimer');
        const cloneProgressBar = document.getElementById('cloneProgressBar');

        if (!cloneBox) return;

        const hasClone = playerController.activeCloneId && this.game.hasEntity(playerController.activeCloneId);
        const controllingClone = playerController.controllingClone;

        cloneBox.classList.toggle('active', hasClone);
        cloneBox.classList.toggle('controlling-clone', hasClone && controllingClone);

        if (hasClone) {
            const playerClone = this.game.getComponent(playerController.activeCloneId, 'playerClone');
            if (playerClone) {
                const now = this.game.state.now || 0;
                const remaining = Math.max(0, playerClone.expiresAt - now);
                const duration = playerClone.duration || 10;
                const progress = (remaining / duration) * 100;

                cloneTimer.textContent = remaining.toFixed(1) + 's';
                cloneProgressBar.style.width = progress + '%';
            }
        } else {
            cloneTimer.textContent = '';
            cloneProgressBar.style.width = '0%';
        }
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

        const cloneContainer = document.getElementById('cloneAbilityUI');
        if (cloneContainer) {
            cloneContainer.remove();
        }

        const cloneStyles = document.getElementById('clone-ability-styles');
        if (cloneStyles) {
            cloneStyles.remove();
        }

        if (this.cloneTimerInterval) {
            clearInterval(this.cloneTimerInterval);
            this.cloneTimerInterval = null;
        }
    }
}
