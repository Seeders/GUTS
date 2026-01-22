/**
 * BeltUISystem - Unified ability bar with E (Collect) and 1-2-3 (Belt Slots)
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
            this.setupAbilityBar();
        }
    }

    setupAbilityBar() {
        let abilityBar = document.getElementById('abilityBarUI');
        if (!abilityBar) {
            abilityBar = document.createElement('div');
            abilityBar.id = 'abilityBarUI';
            abilityBar.className = 'ability-bar-container';
            abilityBar.innerHTML = `
                <div class="ability-bar">
                    <!-- E - Collect/Beam Ability -->
                    <div class="ability-slot ability-action" id="collectAbilitySlot">
                        <div class="ability-icon">✋</div>
                        <div class="ability-key">E</div>
                        <div class="ability-label">Beam</div>
                    </div>
                    <!-- Clone Status (shown when clone active, next to E) -->
                    <div class="ability-slot ability-action" id="cloneStatusSlot" style="display: none;">
                        <div class="ability-icon">👤</div>
                        <div class="ability-key">R</div>
                        <div class="ability-label">Clone</div>
                        <div class="ability-timer" id="cloneTimer"></div>
                        <div class="ability-progress-bar" id="cloneProgressBar"></div>
                    </div>
                    <!-- Separator -->
                    <div class="ability-separator"></div>
                    <!-- Belt Slots 1-2-3 -->
                    <div class="ability-slot belt-slot" id="beltSlot0" data-slot="0">
                        <div class="slot-content"></div>
                        <div class="ability-key">1</div>
                    </div>
                    <div class="ability-slot belt-slot" id="beltSlot1" data-slot="1">
                        <div class="slot-content"></div>
                        <div class="ability-key">2</div>
                    </div>
                    <div class="ability-slot belt-slot" id="beltSlot2" data-slot="2">
                        <div class="slot-content"></div>
                        <div class="ability-key">3</div>
                    </div>
                </div>
                <div class="ability-bar-hint">Press E to activate beam</div>
            `;

            const gameContainer = document.getElementById('gameScreen') || document.body;
            gameContainer.appendChild(abilityBar);
        }

        this.addAbilityBarCSS();
        this.setupSlotClickHandlers();
        this.startCloneTimerUpdate();
    }

    addAbilityBarCSS() {
        if (document.getElementById('ability-bar-styles')) return;

        const style = document.createElement('style');
        style.id = 'ability-bar-styles';
        style.textContent = `
            .ability-bar-container {
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 1000;
            }

            .ability-bar {
                display: flex;
                gap: 8px;
                background: linear-gradient(145deg, rgba(30, 30, 50, 0.95), rgba(20, 20, 40, 0.95));
                border: 2px solid #8b5cf6;
                border-radius: 10px;
                padding: 10px 12px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            }

            .ability-slot {
                width: 60px;
                height: 60px;
                background: rgba(0, 0, 0, 0.4);
                border: 2px solid #333;
                border-radius: 8px;
                position: relative;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
            }

            .ability-slot:hover {
                border-color: #8b5cf6;
                transform: scale(1.05);
            }

            /* Action abilities (Q, E) styling */
            .ability-action {
                border-color: #4080ff;
            }

            .ability-action:hover {
                border-color: #60a0ff;
            }

            .ability-icon {
                font-size: 22px;
                margin-bottom: 2px;
            }

            .ability-key {
                position: absolute;
                top: 3px;
                right: 5px;
                font-size: 10px;
                color: #666;
                font-weight: bold;
            }

            .ability-label {
                font-size: 9px;
                color: #4080ff;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .ability-timer {
                font-size: 11px;
                color: #fff;
                font-weight: bold;
                position: absolute;
                bottom: 6px;
                left: 50%;
                transform: translateX(-50%);
            }

            .ability-progress-bar {
                position: absolute;
                bottom: 0;
                left: 0;
                height: 3px;
                background: #00ffff;
                border-radius: 0 0 6px 6px;
                transition: width 0.1s linear;
            }

            /* Clone ability states */
            #cloneAbilitySlot.active {
                border-color: #00ffff;
                box-shadow: 0 0 15px rgba(0, 255, 255, 0.4);
                background: linear-gradient(145deg, rgba(64, 128, 255, 0.3), rgba(0, 0, 0, 0.4));
            }

            #cloneAbilitySlot.active .ability-label {
                color: #00ffff;
            }

            #cloneAbilitySlot.controlling-clone {
                border-color: #ff8040;
                box-shadow: 0 0 15px rgba(255, 128, 64, 0.4);
            }

            #cloneAbilitySlot.controlling-clone .ability-label {
                color: #ff8040;
            }

            #cloneAbilitySlot.controlling-clone .ability-progress-bar {
                background: #ff8040;
            }

            /* Collect ability - highlight when near collectible */
            #collectAbilitySlot.can-collect {
                border-color: #00ff80;
                box-shadow: 0 0 15px rgba(0, 255, 128, 0.4);
            }

            #collectAbilitySlot.can-collect .ability-label {
                color: #00ff80;
            }

            /* Collect mode active - beam is shooting */
            #collectAbilitySlot.collect-mode-active {
                border-color: #00ffaa;
                box-shadow: 0 0 15px rgba(0, 255, 170, 0.5);
                background: linear-gradient(145deg, rgba(0, 255, 170, 0.2), rgba(0, 0, 0, 0.4));
            }

            #collectAbilitySlot.collect-mode-active .ability-label {
                color: #00ffaa;
            }

            #collectAbilitySlot.collect-mode-active .ability-icon {
                animation: collectPulse 0.5s ease-in-out infinite;
            }

            /* Collect mode with target locked */
            #collectAbilitySlot.collect-mode-active.has-target {
                border-color: #00ff00;
                box-shadow: 0 0 20px rgba(0, 255, 0, 0.6);
            }

            #collectAbilitySlot.collect-mode-active.has-target .ability-label {
                color: #00ff00;
            }

            @keyframes collectPulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }

            /* Separator between actions and belt */
            .ability-separator {
                width: 2px;
                background: #333;
                margin: 5px 4px;
                border-radius: 1px;
            }

            /* Belt slot styling */
            .belt-slot {
                border-color: #8b5cf6;
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

            .slot-item-icon {
                font-size: 26px;
            }

            .slot-sprite-icon {
                image-rendering: pixelated;
                transform: scale(1.4);
            }

            .slot-item-img {
                max-width: 48px;
                max-height: 48px;
                image-rendering: pixelated;
                object-fit: contain;
            }

            .ability-bar-hint {
                color: #666;
                font-size: 10px;
                text-align: center;
                margin-top: 6px;
            }
        `;
        document.head.appendChild(style);
    }

    setupSlotClickHandlers() {
        // Belt slots
        for (let i = 0; i < 3; i++) {
            const slot = document.getElementById(`beltSlot${i}`);
            if (slot && !slot._clickHandlerAttached) {
                slot._clickHandlerAttached = true;
                slot.addEventListener('click', () => {
                    this.selectSlot(i);
                });
            }
        }

        // Collect/Beam ability slot
        const collectSlot = document.getElementById('collectAbilitySlot');
        if (collectSlot && !collectSlot._clickHandlerAttached) {
            collectSlot._clickHandlerAttached = true;
            collectSlot.addEventListener('click', () => {
                // Trigger E key action
                const playerEntity = this.game.call('getPlayerEntity');
                if (playerEntity) {
                    this.game.call('triggerCollectAbility', playerEntity);
                }
            });
        }

        // Clone status slot (for toggling control when clone is active)
        const cloneStatusSlot = document.getElementById('cloneStatusSlot');
        if (cloneStatusSlot && !cloneStatusSlot._clickHandlerAttached) {
            cloneStatusSlot._clickHandlerAttached = true;
            cloneStatusSlot.addEventListener('click', () => {
                // Toggle control between player and clone
                const playerEntity = this.game.call('getPlayerEntity');
                if (playerEntity) {
                    this.game.call('toggleCloneControl', playerEntity);
                }
            });
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

    // Event handler - called when collect mode is activated/deactivated
    onCollectModeChanged(data) {
        const collectSlot = document.getElementById('collectAbilitySlot');
        if (collectSlot) {
            collectSlot.classList.toggle('collect-mode-active', data.active);
        }

        // Update the hint text
        const hint = document.querySelector('.ability-bar-hint');
        if (hint) {
            if (data.active) {
                hint.textContent = 'Aim at object, press E to collect';
                hint.style.color = '#00ffaa';
            } else {
                hint.textContent = 'Left-click to place illusion';
                hint.style.color = '#666';
            }
        }
    }

    // Event handler - called when highlighted collectible changes
    onCollectHighlightChanged(data) {
        const collectSlot = document.getElementById('collectAbilitySlot');
        if (collectSlot) {
            collectSlot.classList.toggle('has-target', !!data.collectibleId);
        }
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
        const collections = this.game.getCollections();

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
                const iconHtml = this.getItemIconHtml(itemType, collections);
                contentEl.innerHTML = iconHtml;
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

    /**
     * Get HTML for item icon - uses sprite sheet or render texture
     */
    getItemIconHtml(itemType, collections) {
        const worldObjectDef = collections.worldObjects?.[itemType];
        if (!worldObjectDef) {
            return `<span class="slot-item-icon">❓</span>`;
        }

        const resourcesPath = this.game.resourceBaseUrl || './resources/';

        // For clone items, use the player's sprite animation set
        let spriteAnimationSetName = worldObjectDef.spriteAnimationSet;
        if (itemType === 'clone') {
            const playerEntity = this.game.call('getPlayerEntity');
            if (playerEntity) {
                const playerUnitType = this.game.getComponent(playerEntity, 'unitType');
                if (playerUnitType) {
                    // unitType uses numeric indices, convert to names
                    const reverseEnums = this.game.getReverseEnums();
                    const collectionName = reverseEnums.objectTypeDefinitions?.[playerUnitType.collection];
                    const typeName = reverseEnums[collectionName]?.[playerUnitType.type];
                    if (collectionName && typeName) {
                        const playerDef = collections[collectionName]?.[typeName];
                        if (playerDef?.spriteAnimationSet) {
                            spriteAnimationSetName = playerDef.spriteAnimationSet;
                        }
                    }
                }
            }
        }

        // Check for spriteAnimationSet first (has sprite sheet with frames)
        if (spriteAnimationSetName) {
            const spriteSet = collections.spriteAnimationSets?.[spriteAnimationSetName];

            if (spriteSet?.spriteSheet && spriteSet.frames) {
                // Try to get idleDownGround_0 first (ground-level view), fallback to idleDown_0
                const frame = spriteSet.frames.idleDownGround_0 || spriteSet.frames.idleDown_0;
                if (frame) {
                    const sheetUrl = resourcesPath + spriteSet.spriteSheet;
                    return this.createSpriteIconHtml(sheetUrl, frame);
                }
            }
        }

        // Fallback to renderTexture
        if (worldObjectDef.renderTexture) {
            const textureName = worldObjectDef.renderTexture;
            const textureDef = collections.textures?.[textureName];

            if (textureDef?.imagePath) {
                const textureUrl = resourcesPath + textureDef.imagePath;
                return `<img class="slot-item-img" src="${textureUrl}" alt="${itemType}">`;
            }
        }

        // Final fallback to emoji
        const fallbackIcons = {
            'barrel': '🛢️',
            'crate': '📦',
            'present': '🎁'
        };
        return `<span class="slot-item-icon">${fallbackIcons[itemType] || '❓'}</span>`;
    }

    /**
     * Create HTML for a sprite icon using CSS background-position
     */
    createSpriteIconHtml(sheetUrl, frame) {
        // Use CSS to show just the specific frame from the sprite sheet
        return `<div class="slot-sprite-icon" style="
            background-image: url('${sheetUrl}');
            background-position: -${frame.x}px -${frame.y}px;
            width: ${frame.w}px;
            height: ${frame.h}px;
        "></div>`;
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

        const cloneStatusSlot = document.getElementById('cloneStatusSlot');
        const cloneTimer = document.getElementById('cloneTimer');
        const cloneProgressBar = document.getElementById('cloneProgressBar');

        if (!cloneStatusSlot) return;

        const hasClone = playerController.activeCloneId && this.game.hasEntity(playerController.activeCloneId);
        const controllingClone = playerController.controllingClone;

        // Show/hide clone status slot based on whether clone exists
        cloneStatusSlot.style.display = hasClone ? 'flex' : 'none';

        cloneStatusSlot.classList.toggle('active', hasClone);
        cloneStatusSlot.classList.toggle('controlling-clone', hasClone && controllingClone);

        if (hasClone) {
            const playerClone = this.game.getComponent(playerController.activeCloneId, 'playerClone');
            if (playerClone) {
                const now = this.game.state.now || 0;
                const remaining = Math.max(0, playerClone.expiresAt - now);
                const duration = playerClone.duration || 20;
                const progress = (remaining / duration) * 100;

                if (cloneTimer) cloneTimer.textContent = remaining.toFixed(1) + 's';
                if (cloneProgressBar) cloneProgressBar.style.width = progress + '%';
            }
        } else {
            if (cloneTimer) cloneTimer.textContent = '';
            if (cloneProgressBar) cloneProgressBar.style.width = '0%';
        }
    }

    onSceneUnload() {
        const abilityBar = document.getElementById('abilityBarUI');
        if (abilityBar) {
            abilityBar.remove();
        }

        const styles = document.getElementById('ability-bar-styles');
        if (styles) {
            styles.remove();
        }

        if (this.cloneTimerInterval) {
            clearInterval(this.cloneTimerInterval);
            this.cloneTimerInterval = null;
        }
    }
}
