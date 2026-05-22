/**
 * PlacementUISystem - Client-side UI for placement phase
 *
 * Handles:
 * - Raycasting for mouse position
 * - Placement preview rendering
 * - Undo functionality
 * - Canvas click handling
 * - UI button state management
 * - Visual effects (placement effects, respawn effects)
 *
 * This system is CLIENT-ONLY. The core placement logic is in PlacementSystem.
 * Network communication is handled by ClientNetworkSystem.
 */
class PlacementUISystem extends GUTS.BaseSystem {
    static services = [
        'getWorldPositionFromMouse',
        'undoLastPlacement',
        'getUndoStatus',
        'setBattlePaused',
        'handleReadyForBattleUpdate',
        'handleUnitSelectionChange'
    ];

    static serviceDependencies = [
        'getPlacementGridSize',
        'getCamera',
        'cameraLookAt',
        'getActivePlayerTeam',
        'getCameraPositionForTeam',
        'showNotification',
        'placementGridToWorld',
        'clearAllDamageEffects',
        'clearAllEffects',
        'ui_toggleReadyForBattle',
        'applyNetworkUnitData',
        'resyncEntities',
        'resetAI',
        'getGroundMesh',
        'worldToPlacementGrid',
        'getSquadData',
        'getSquadCells',
        'isValidGridPlacement',
        'isValidGoldMinePlacement',
        'getSquadSize',
        'calculateUnitPositions',
        'updateGoldDisplay',
        'ui_undoPlacement',
        'createParticleEffect',
        'getWorldScene',
        'showPreviewMultiplePositionSets',
        'hidePreview',
        'clearPreview',
        'submitLeaderSelection',
        'submitHeroSelection',
        'submitHeroMove',
        'getPlayerEntities',
        'submitEquipGear',
        'submitSocketGem',
        'submitSocketRune'
    ];
    constructor(game) {
        super(game);
        this.game.placementUISystem = this;

        // Raycasting
        this.raycastHelper = null;
        this.canvas = this.game.canvas;

        // Undo stack (client-side only)
        this.undoStack = [];
        this.maxUndoSteps = 10;

        // Mouse tracking
        this.mouseWorldOffset = { x: 0, z: 0 };
        this.mouseWorldPos = { x: 0, y: 0, z: 0 };
        this.mouseScreenPos = { x: 0, y: 0 };
        this.lastValidationTime = 0;
        this.cachedValidation = null;
        this.cachedGridPos = null;
        this.cachedWorldPos = null;
        this.lastMouseX = null;
        this.lastMouseY = null;
        this.lastRaycastTime = null;
        this.lastRaycastMouseX = null;
        this.lastRaycastMouseY = null;
        this.approximateWorldScale = null;
        this.previousWorldPos = null;
        this.previousMouseX = null;
        this.previousMouseY = null;
        this.squadValidationCache = new Map();

        // UI state
        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;
        this.elements = {};

        // Config
        this.config = {
            maxSquadsPerRound: 2,
            enablePreview: true,
            enableUndo: true,
            validationThrottle: 0.32
        };

        // Battle tracking
        this.battleDuration = 30;
        this.battleStartTime = 0;
        this.isBattlePaused = false;

        // Update tracking
        this.lastUpdateTime = 0;
        this.lastPendingBuildingUpdate = 0;

        // Intervals
        this.mouseRayCastInterval = null;

        // Hero drag state (prep phase reposition)
        this.draggedHeroId = null;
        this.dragOffset = { x: 0, z: 0 };

        // Right-click camera pan state (terrain point stays under cursor)
        this.panAnchor = null;  // { x, z } world point clicked
        this.panLookAt = null;  // { x, z } current camera lookAt target we're driving

        // Inventory → equip state: which inventory item the player has currently selected
        this.selectedInventoryIndex = null;
        // Gem detail panel state: which socketed gem we're inspecting (for rune sockets)
        this.openGem = null;  // { rosterIndex, abilitySlotIndex }
    }

    init(params) {
        this.params = params || {};
    }

    // Service alias methods
    /**
     * Get world position from mouse. If screenX/screenY are provided, raycast at those
     * screen coordinates. Otherwise return the cached mouseWorldPos.
     * @param {number} [screenX] - Screen X coordinate (client coords)
     * @param {number} [screenY] - Screen Y coordinate (client coords)
     * @param {boolean} [applyGridOffset=true] - Whether to apply grid centering offset
     * @returns {Object|null} World position {x, y, z}
     */
    getWorldPositionFromMouse(screenX, screenY, applyGridOffset = true) {
        // If screen coordinates provided, do a fresh raycast at that position
        if (screenX !== undefined && screenY !== undefined) {
            if (!this.raycastHelper || !this.canvas) return null;

            // Convert screen (client) coords to NDC
            const rect = this.canvas.getBoundingClientRect();
            const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
            const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

            const worldPos = this.rayCastGround(ndcX, ndcY);
            if (worldPos && applyGridOffset) {
                // Apply offset to center on grid cell (for building placements)
                worldPos.x += this.mouseWorldOffset.x;
                worldPos.z += this.mouseWorldOffset.z;
            }
            return worldPos;
        }

        // Otherwise return cached mouse position (always has offset applied)
        // If caller wants raw position, they need to provide screen coords
        if (!applyGridOffset) {
            // Return raw raycast without offset
            const rawPos = this.rayCastGround(this.mouseScreenPos.x, this.mouseScreenPos.y);
            return rawPos;
        }
        return this.mouseWorldPos;
    }

    setBattlePaused(paused) {
        this.isBattlePaused = paused;
    }

    handleUnitSelectionChange() {
        this.cachedValidation = null;
        this.cachedGridPos = null;
        this.cachedWorldPos = null;
        this.lastMouseX = null;
        this.lastMouseY = null;
        this.lastRaycastTime = null;
        this.lastRaycastMouseX = null;
        this.lastRaycastMouseY = null;
        this.approximateWorldScale = null;
        this.previousWorldPos = null;
        this.previousMouseX = null;
        this.previousMouseY = null;

        if (this.squadValidationCache) {
            this.squadValidationCache.clear();
        }

        this.call.clearPreview?.();
        document.body.style.cursor = 'default';
    }

    onSceneLoad(sceneData) {
        // Update canvas reference - it may not have existed at constructor time
        this.canvas = this.game.canvas;
        const gridSize = this.call.getPlacementGridSize();
        this.mouseWorldOffset = {
            x: gridSize / 2,
            z: gridSize / 2
        };
        // Initialize RaycastHelper when scene and camera are available
        const camera = this.call.getCamera();
        const scene = this.call.getWorldScene();
        if (scene && camera && !this.raycastHelper) {
            this.raycastHelper = new GUTS.RaycastHelper(camera, scene);
        }
    }

    /**
     * Called when game scene is fully loaded and ready
     */
    onGameStarted() {
        this.setupEventListeners();
        this.setupCameraForMySide();
        this.setupArenaOverlays();
        // Don't call onPlacementPhaseStart here — AutobattlerRoundSystem drives phases
    }

    /**
     * Set up camera position based on player's side
     */
    setupCameraForMySide() {
        const myTeam = this.call.getActivePlayerTeam();
        if (myTeam === null || myTeam === undefined) {
            console.warn('[PlacementUISystem] Cannot setup camera - active player team not set');
            return;
        }

        const cameraData = this.call.getCameraPositionForTeam(myTeam);
        if (cameraData) {
            const look = cameraData.lookAt;
            // Use cameraLookAt service to properly set camera position and store lookAt target
            // This ensures free camera mode starts at the correct position
            this.call.cameraLookAt?.(look.x, look.z);
        }
    }

    // ==================== HERO ARENA OVERLAYS ====================

    setupArenaOverlays() {
        // Wire HUD element references — event methods below are called automatically
        // by game.triggerEvent() when the server broadcasts phase changes
        this.elements.playerHPBar     = document.getElementById('playerHPBar');
        this.elements.playerHPValue   = document.getElementById('playerHPValue');
        this.elements.opponentHPBar   = document.getElementById('opponentHPBar');
        this.elements.opponentHPValue = document.getElementById('opponentHPValue');
        this.elements.roundDisplay    = document.getElementById('roundDisplay');
        this.elements.phaseDisplay    = document.getElementById('phaseDisplay');
        this.elements.goldDisplay     = document.getElementById('playerGold');
        this.elements.prepControls    = document.getElementById('prepControls');
        this.elements.heroRosterPanel = document.getElementById('heroRosterPanel');
        this.elements.heroRosterCards = document.getElementById('heroRosterCards');
        this.elements.inventoryPanel  = document.getElementById('inventoryPanel');
        this.elements.inventoryItems  = document.getElementById('inventoryItems');
        this.elements.gemDetailPanel  = document.getElementById('gemDetailPanel');
        this.elements.gemDetailTitle  = document.getElementById('gemDetailTitle');
        this.elements.gemDetailMeta   = document.getElementById('gemDetailMeta');
        this.elements.gemDetailRunes  = document.getElementById('gemDetailRunes');
        this.elements.gemDetailClose  = document.getElementById('gemDetailClose');
        this.elements.combatLogEntries     = document.getElementById('combatLogEntries');
        this.elements.itemDetailsPanel     = document.getElementById('itemDetailsPanel');
        this.elements.itemDetailsContent   = document.getElementById('itemDetailsContent');

        // Delegated click handler: handles inventory item selection + equip/socket on hero slots
        if (!this._prepClickHandler) {
            this._prepClickHandler = (event) => this._onPrepClick(event);
            this.elements.heroRosterCards?.addEventListener('click', this._prepClickHandler);
            this.elements.inventoryItems?.addEventListener('click', this._prepClickHandler);
            this.elements.gemDetailRunes?.addEventListener('click', this._prepClickHandler);
            this.elements.gemDetailClose?.addEventListener('click', () => this._closeGemDetail());
        }
    }

    // Called by game.triggerEvent('onLeaderSelectStart', data)
    onLeaderSelectStart(data) {
        const overlay = document.getElementById('leaderSelectOverlay');
        const grid    = document.getElementById('leaderOptions');
        if (!overlay || !grid) return;

        grid.innerHTML = '';
        const leaders = data?.options || [];
        leaders.forEach(leader => {
            const card = document.createElement('div');
            card.className = 'arena-option-card';
            card.innerHTML = `
                <div class="arena-option-name">${leader.label}</div>
                <div class="arena-option-desc">${leader.bonus}</div>`;
            card.addEventListener('click', () => {
                this.call.submitLeaderSelection(leader.id);
                overlay.classList.add('hidden');
            });
            grid.appendChild(card);
        });
        overlay.classList.remove('hidden');
    }

    // Called by game.triggerEvent('onHeroSelectStart', data)
    onHeroSelectStart(data) {
        const overlay  = document.getElementById('heroSelectOverlay');
        const grid     = document.getElementById('heroOptions');
        const title    = document.getElementById('heroSelectTitle');
        const subtitle = document.getElementById('heroSelectSubtitle');
        if (!overlay || !grid) return;

        if (title)    title.textContent    = data?.isMilestone ? 'Choose a New Hero' : 'Choose Your Starting Hero';
        if (subtitle) subtitle.textContent = data?.isMilestone ? 'Add another hero to your roster' : 'Pick a class to begin your roster';

        grid.innerHTML = '';
        const classes = data?.options || [];
        classes.forEach(heroClass => {
            const card = document.createElement('div');
            card.className = 'arena-option-card';
            card.innerHTML = `
                <div class="arena-option-name">${heroClass.label}</div>
                <div class="arena-option-tag">${heroClass.archetype}</div>`;
            card.addEventListener('click', () => {
                this.call.submitHeroSelection(heroClass.id);
                overlay.classList.add('hidden');
            });
            grid.appendChild(card);
        });
        overlay.classList.remove('hidden');
    }

    // Called by game.triggerEvent('onHeroSelectComplete')
    onHeroSelectComplete() {
        document.getElementById('heroSelectOverlay')?.classList.add('hidden');
    }

    updateHUD() {
        // Find local player's playerStats and opponent's
        const myPlayerId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        const playerEntities = this.game.getEntitiesWith('playerStats');
        let myStats = null, opStats = null;

        for (const eid of playerEntities) {
            const s = this.game.getComponent(eid, 'playerStats');
            if (!s) continue;
            if (s.playerId === myPlayerId) myStats = s;
            else opStats = s;
        }

        if (myStats) {
            const hp = Math.max(0, myStats.hp ?? 100);
            if (this.elements.playerHPBar)   this.elements.playerHPBar.style.width   = `${hp}%`;
            if (this.elements.playerHPValue) this.elements.playerHPValue.textContent = hp;
            if (this.elements.goldDisplay)   this.elements.goldDisplay.textContent   = myStats.gold ?? 0;
        }
        if (opStats) {
            const hp = Math.max(0, opStats.hp ?? 100);
            if (this.elements.opponentHPBar)   this.elements.opponentHPBar.style.width   = `${hp}%`;
            if (this.elements.opponentHPValue) this.elements.opponentHPValue.textContent = hp;
        }
        if (this.elements.roundDisplay) {
            this.elements.roundDisplay.textContent = `Round ${this.game.state.round ?? 1}`;
        }
    }

    // ==================== HERO DRAG (PREP PHASE) ====================

    _onHeroDragDown(event) {
        if (event.button !== 0) return;
        if (this.game.state.phase !== this.enums.gamePhase.placement) return;

        const worldPos = this.getWorldPositionFromMouse(event.clientX, event.clientY, false);
        if (!worldPos) return;

        // Prefer SelectedUnitSystem's entity picker (proper unit-size + team filter); fall back to local
        const sel = this.game.selectedUnitSystem;
        let heroId = sel?.getEntityAtWorldPosition?.(worldPos) ?? this._findHeroAtWorldPos(worldPos.x, worldPos.z);
        if (heroId == null) return;

        // Only my-team heroes are draggable
        const team   = this.game.getComponent(heroId, 'team');
        const myTeam = this.call.getActivePlayerTeam();
        if (!team || team.team !== myTeam) return;

        // Must be a hero entity (heroRosterInfo is added by HeroRosterSystem)
        if (!this.game.getComponent(heroId, 'heroRosterInfo')) return;

        this.draggedHeroId = heroId;
        const t = this.game.getComponent(heroId, 'transform');
        this.dragOffset.x = (t?.position?.x ?? worldPos.x) - worldPos.x;
        this.dragOffset.z = (t?.position?.z ?? worldPos.z) - worldPos.z;
        this.dragMoved = false;

        // Cancel any in-progress box selection so its visual doesn't appear while dragging
        sel?.cancelBoxSelection?.();

        document.body.style.cursor = 'grabbing';
    }

    _onHeroDragMove(event) {
        if (this.draggedHeroId == null) return;

        // Keep box selection suppressed for the duration of the drag.
        // SelectedUnitSystem's mousedown handler reactivates it after ours runs,
        // so we cancel again here (this runs before their mousemove handler).
        this.game.selectedUnitSystem?.cancelBoxSelection?.();

        const worldPos = this.getWorldPositionFromMouse(event.clientX, event.clientY, false);
        if (!worldPos) return;

        const newX = worldPos.x + this.dragOffset.x;
        const newZ = worldPos.z + this.dragOffset.z;
        // Optimistic local update so the hero follows the cursor immediately
        this.game.placementSystem?.moveHero(this.draggedHeroId, newX, newZ);
        this.dragMoved = true;
    }

    _onHeroDragUp(event) {
        if (this.draggedHeroId == null) return;

        // Snapshot state, then clear it BEFORE any network call. This guarantees the
        // drag releases even if submitHeroMove or the raycast throws.
        const heroId = this.draggedHeroId;
        const wasMoved = this.dragMoved;
        const offX = this.dragOffset.x;
        const offZ = this.dragOffset.z;
        this.draggedHeroId = null;
        this.dragMoved = false;
        document.body.style.cursor = 'default';

        if (!wasMoved) return;

        try {
            const worldPos = this.getWorldPositionFromMouse(event.clientX, event.clientY, false);
            if (worldPos) {
                this.call.submitHeroMove(heroId, worldPos.x + offX, worldPos.z + offZ);
            }
        } catch (err) {
            console.warn('[PlacementUISystem] submitHeroMove failed:', err);
        }
    }

    // ==================== RIGHT-CLICK TERRAIN PAN ====================

    _onTerrainPanDown(event) {
        if (event.button !== 2) return;

        const worldPos = this.getWorldPositionFromMouse(event.clientX, event.clientY, false);
        if (!worldPos) return;

        // Seed the lookAt from the camera's current target (set by previous cameraLookAt calls)
        const camera = this.call.getCamera?.();
        const look = camera?.userData?.lookAt;
        const initialLookAt = look
            ? { x: look.x, z: look.z }
            : { x: camera?.position?.x ?? 0, z: camera?.position?.z ?? 0 };

        this.panAnchor = { x: worldPos.x, z: worldPos.z };
        this.panLookAt = initialLookAt;
        document.body.style.cursor = 'grabbing';
        event.preventDefault();
    }

    _onTerrainPanMove(event) {
        if (!this.panAnchor) return;

        const wNow = this.getWorldPositionFromMouse(event.clientX, event.clientY, false);
        if (!wNow) return;

        // Shift camera so the anchor world point is once again under the cursor.
        // newLookAt = currentLookAt + (anchor - wNow)
        this.panLookAt.x += this.panAnchor.x - wNow.x;
        this.panLookAt.z += this.panAnchor.z - wNow.z;
        this.call.cameraLookAt(this.panLookAt.x, this.panLookAt.z);
    }

    _onTerrainPanUp(event) {
        if (!this.panAnchor) return;
        this.panAnchor = null;
        this.panLookAt = null;
        document.body.style.cursor = 'default';
    }

    // ==================== HERO ROSTER PANEL ====================

    renderHeroRoster() {
        const container = this.elements.heroRosterCards;
        if (!container) return;

        const myPlayerId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        const playerEntities = this.call.getPlayerEntities() || [];

        let myStats = null;
        for (const eid of playerEntities) {
            const stats = this.game.getComponent(eid, 'playerStats');
            if (stats && stats.playerId === myPlayerId) { myStats = stats; break; }
        }

        const roster = myStats?.heroRoster || [];
        if (roster.length === 0) {
            container.innerHTML = '<div class="hero-slot">No heroes selected yet</div>';
            return;
        }

        container.innerHTML = roster.map((entry, i) => this._renderHeroCard(entry, i)).join('');
    }

    _renderHeroCard(entry, index) {
        const heroClass = entry.heroClass || 'unknown';
        const className = heroClass.charAt(0).toUpperCase() + heroClass.slice(1);
        const level = this._calcHeroLevel(entry.roundsPlayed || 0);
        const eq = entry.equipment || {};
        const abilities = Array.isArray(eq.abilitySlots) ? eq.abilitySlots : [null, null, null, null];

        // Map slot name → required itemType (must match HeroStatSystem.SLOT_ITEM_TYPE)
        const SLOT_TYPE = { mainWeapon: 'weapon', offhand: 'offhand', bodyArmor: 'bodyArmor', helmet: 'helmet' };
        const selectedItem = this._getSelectedInventoryItem();
        // A gear slot is a valid equip target if the selected item's itemType matches.
        // A gem slot is a valid target if the selected item is a gem.
        // Filled gem slots are ALWAYS clickable so the player can open the gem detail panel.

        const slot = (label, slotName, item) => {
            const filled = !!item;
            const rarity = item?.rarity || '';
            const name = item?.baseName || item?.name || (filled ? 'Item' : 'Empty');
            const isTarget = selectedItem && selectedItem.itemType === SLOT_TYPE[slotName];
            const targetCls = isTarget ? 'equip-target' : '';
            return `<div class="hero-slot ${filled ? 'filled' : ''} ${rarity ? 'rarity-' + rarity : ''} ${targetCls}"
                data-action="equip-gear" data-roster-index="${index}" data-slot="${slotName}">
                <span class="hero-slot-label">${label}</span>
                <span class="hero-slot-value">${name}</span>
            </div>`;
        };

        const gemSlot = (item, i) => {
            const filled = !!item;
            const rarity = item?.rarity || '';
            const name = item?.baseName || item?.name || `Gem ${i + 1}`;
            const isTarget = filled || (selectedItem && selectedItem.itemType === 'gem');
            const targetCls = isTarget ? 'equip-target' : '';
            return `<div class="hero-slot ${filled ? 'filled' : ''} ${rarity ? 'rarity-' + rarity : ''} ${targetCls}"
                data-action="socket-gem" data-roster-index="${index}" data-slot-index="${i}">
                <span class="hero-slot-value">${filled ? name : '—'}</span>
            </div>`;
        };

        return `<div class="hero-card" data-roster-index="${index}">
            <div class="hero-card-header">
                <span class="hero-card-name">${className}</span>
                <span class="hero-card-level">Lvl ${level}</span>
            </div>
            <div class="hero-equipment-grid">
                ${slot('Weapon',  'mainWeapon', eq.mainWeapon)}
                ${slot('Offhand', 'offhand',    eq.offhand)}
                ${slot('Body',    'bodyArmor',  eq.bodyArmor)}
                ${slot('Helmet',  'helmet',     eq.helmet)}
                <div class="hero-ability-slots">
                    ${abilities.map((g, i) => gemSlot(g, i)).join('')}
                </div>
            </div>
        </div>`;
    }

    // ==================== INVENTORY PANEL ====================

    renderInventory() {
        const container = this.elements.inventoryItems;
        if (!container) return;

        const stats = this._getMyPlayerStats();
        const inventory = stats?.inventory || [];

        if (inventory.length === 0) {
            container.innerHTML = '<div class="inventory-hint" style="margin:0;">Empty</div>';
            return;
        }

        container.innerHTML = inventory.map((item, i) => this._renderInventoryItem(item, i)).join('');
    }

    _renderInventoryItem(item, index) {
        const rarity   = item?.rarity || '';
        const name     = item?.baseName || item?.name || 'Item';
        const itemType = item?.itemType || '';
        const selected = (index === this.selectedInventoryIndex) ? 'selected' : '';
        return `<div class="inventory-item ${rarity ? 'rarity-' + rarity : ''} ${selected}"
            data-action="select-item" data-inventory-index="${index}">
            <span class="inventory-item-name">${name}</span>
            <span class="inventory-item-type">${itemType}</span>
        </div>`;
    }

    _getSelectedInventoryItem() {
        if (this.selectedInventoryIndex === null) return null;
        const stats = this._getMyPlayerStats();
        return stats?.inventory?.[this.selectedInventoryIndex] || null;
    }

    _getMyPlayerStats() {
        const myPlayerId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        const playerEntities = this.call.getPlayerEntities() || [];
        for (const eid of playerEntities) {
            const stats = this.game.getComponent(eid, 'playerStats');
            if (stats && stats.playerId === myPlayerId) return stats;
        }
        return null;
    }

    // Single delegated click handler for inventory + hero slot interactions.
    _onPrepClick(event) {
        const target = event.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        if (action === 'select-item') {
            const idx = parseInt(target.dataset.inventoryIndex, 10);
            // Toggle: clicking the selected item again deselects it
            this.selectedInventoryIndex = (this.selectedInventoryIndex === idx) ? null : idx;
            this.renderHeroRoster();
            this.renderInventory();
            this._showDetailsForItem(this._getSelectedInventoryItem());
            if (this.openGem) this._renderGemDetail();
        } else if (action === 'equip-gear') {
            const rosterIndex = parseInt(target.dataset.rosterIndex, 10);
            const slot        = target.dataset.slot;
            const stats       = this._getMyPlayerStats();
            const equipped    = stats?.heroRoster?.[rosterIndex]?.equipment?.[slot] || null;
            // If the player has an inventory item selected, equip it. Otherwise show
            // the currently-equipped item's details (mobile-friendly inspection).
            if (this.selectedInventoryIndex !== null) {
                this.call.submitEquipGear(rosterIndex, slot, this.selectedInventoryIndex);
                this.selectedInventoryIndex = null;
                setTimeout(() => { this.renderHeroRoster(); this.renderInventory(); this._showDetailsForItem(null); }, 50);
            } else if (equipped) {
                this._showDetailsForItem(equipped);
            }
        } else if (action === 'socket-gem') {
            const rosterIndex = parseInt(target.dataset.rosterIndex, 10);
            const slotIndex   = parseInt(target.dataset.slotIndex, 10);
            const gem         = this._getGemAt(rosterIndex, slotIndex);
            // If the player has an inventory item selected, socket it. Otherwise, if this slot
            // already has a gem, both show its details AND open the gem detail panel for runes.
            if (this.selectedInventoryIndex !== null) {
                this.call.submitSocketGem(rosterIndex, slotIndex, this.selectedInventoryIndex);
                this.selectedInventoryIndex = null;
                setTimeout(() => { this.renderHeroRoster(); this.renderInventory(); this._showDetailsForItem(null); }, 50);
            } else if (gem) {
                this._showDetailsForItem(gem);
                this._openGemDetail(rosterIndex, slotIndex);
            }
        } else if (action === 'socket-rune') {
            const rosterIndex   = parseInt(target.dataset.rosterIndex, 10);
            const slotIndex     = parseInt(target.dataset.slotIndex, 10);
            const runeSlotIndex = parseInt(target.dataset.runeSlotIndex, 10);
            const stats         = this._getMyPlayerStats();
            const existingRune  = stats?.heroRoster?.[rosterIndex]?.equipment?.abilitySlots?.[slotIndex]?.runes?.[runeSlotIndex] || null;
            if (this.selectedInventoryIndex !== null) {
                this.call.submitSocketRune(rosterIndex, slotIndex, runeSlotIndex, this.selectedInventoryIndex);
                this.selectedInventoryIndex = null;
                setTimeout(() => {
                    this.renderHeroRoster();
                    this.renderInventory();
                    this._showDetailsForItem(null);
                    if (this.openGem) this._renderGemDetail();
                }, 50);
            } else if (existingRune) {
                this._showDetailsForItem(existingRune);
            }
        }
    }

    // ==================== GEM DETAIL PANEL ====================

    _getGemAt(rosterIndex, abilitySlotIndex) {
        const stats = this._getMyPlayerStats();
        const roster = stats?.heroRoster?.[rosterIndex];
        return roster?.equipment?.abilitySlots?.[abilitySlotIndex] || null;
    }

    _openGemDetail(rosterIndex, abilitySlotIndex) {
        this.openGem = { rosterIndex, abilitySlotIndex };
        this._renderGemDetail();
        this.elements.gemDetailPanel?.classList.remove('hidden');
    }

    _closeGemDetail() {
        this.openGem = null;
        this.elements.gemDetailPanel?.classList.add('hidden');
    }

    _renderGemDetail() {
        if (!this.openGem || !this.elements.gemDetailPanel) return;
        const { rosterIndex, abilitySlotIndex } = this.openGem;
        const gem = this._getGemAt(rosterIndex, abilitySlotIndex);

        if (!gem) {
            // Gem was unsocketed externally; close panel
            this._closeGemDetail();
            return;
        }

        const name     = gem.baseName || gem.name || 'Gem';
        const ability  = gem.abilityId || '—';
        const runes    = Array.isArray(gem.runes) ? gem.runes : [];
        const slotsAvailable = Math.max(gem.runeSlots ?? 1, runes.length);

        if (this.elements.gemDetailTitle) this.elements.gemDetailTitle.textContent = name;
        if (this.elements.gemDetailMeta)  this.elements.gemDetailMeta.textContent  = `Grants: ${ability}`;

        const selectedItem = this._getSelectedInventoryItem();
        const isRuneTarget = selectedItem?.itemType === 'rune';
        let html = '';
        for (let i = 0; i < slotsAvailable; i++) {
            const rune = runes[i];
            const filled = !!rune;
            const rarity = rune?.rarity || '';
            const label  = filled ? (rune.baseName || rune.name || 'Rune') : 'Empty';
            const targetCls = isRuneTarget ? 'equip-target' : '';
            html += `<div class="rune-slot ${filled ? 'filled' : 'empty'} ${rarity ? 'rarity-' + rarity : ''} ${targetCls}"
                data-action="socket-rune"
                data-roster-index="${rosterIndex}"
                data-slot-index="${abilitySlotIndex}"
                data-rune-slot-index="${i}">
                <span>${label}</span>
                <span style="color:#555;">#${i + 1}</span>
            </div>`;
        }
        if (this.elements.gemDetailRunes) this.elements.gemDetailRunes.innerHTML = html;
    }

    _calcHeroLevel(roundsPlayed) {
        if (roundsPlayed >= 7) return 7;
        if (roundsPlayed >= 5) return 5;
        if (roundsPlayed >= 3) return 3;
        return 1;
    }

    _findHeroAtWorldPos(worldX, worldZ) {
        const heroEntities = this.game.getEntitiesWith('heroRosterInfo', 'transform');
        const PICK_RADIUS_SQ = 35 * 35;
        let closest = null;
        let closestDistSq = Infinity;
        for (const eid of heroEntities) {
            const t = this.game.getComponent(eid, 'transform');
            if (!t?.position) continue;
            const dx = t.position.x - worldX;
            const dz = t.position.z - worldZ;
            const d2 = dx * dx + dz * dz;
            if (d2 <= PICK_RADIUS_SQ && d2 < closestDistSq) {
                closest = eid;
                closestDistSq = d2;
            }
        }
        return closest;
    }

    // ==================== EVENT LISTENERS ====================

    setupEventListeners() {
        this.elements.readyButton = document.getElementById('placementReadyBtn');

        if (this.elements.readyButton) {
            this.elements.readyButton.addEventListener('click', () => {
                this.togglePlacementReady();
            });
        }

        // Mouse tracking for preview
        if (this.config.enablePreview && this.canvas) {
            this._canvasMouseMoveHandler = (event) => {
                const rect = this.canvas.getBoundingClientRect();
                this.mouseScreenPos.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                this.mouseScreenPos.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            };
            this.canvas.addEventListener('mousemove', this._canvasMouseMoveHandler);

            this._canvasMouseLeaveHandler = () => {
                // Don't clear - just show pending buildings if any
                this.lastPendingBuildingUpdate = 0; // Force refresh
                this.updatePendingBuildingPreview();
                this.cachedValidation = null;
                this.cachedGridPos = null;
                document.body.style.cursor = 'default';
            };
            this.canvas.addEventListener('mouseleave', this._canvasMouseLeaveHandler);
        }

        // Hero drag handlers (prep phase only)
        if (this.canvas) {
            this._heroDragDownHandler = (event) => this._onHeroDragDown(event);
            this._heroDragMoveHandler = (event) => this._onHeroDragMove(event);
            this._heroDragUpHandler   = (event) => this._onHeroDragUp(event);
            this.canvas.addEventListener('mousedown', this._heroDragDownHandler);
            this.canvas.addEventListener('mousemove', this._heroDragMoveHandler);
            window.addEventListener('mouseup', this._heroDragUpHandler);

            // Right-click terrain pan handlers (camera follows so the clicked point stays under cursor)
            this._panDownHandler = (event) => this._onTerrainPanDown(event);
            this._panMoveHandler = (event) => this._onTerrainPanMove(event);
            this._panUpHandler   = (event) => this._onTerrainPanUp(event);
            this._contextMenuHandler = (event) => event.preventDefault();
            this.canvas.addEventListener('mousedown', this._panDownHandler);
            this.canvas.addEventListener('mousemove', this._panMoveHandler);
            window.addEventListener('mouseup', this._panUpHandler);
            this.canvas.addEventListener('contextmenu', this._contextMenuHandler);
        }

        // Mouse raycast interval
        this.mouseRayCastInterval = setInterval(() => {
            this.mouseWorldPos = this.rayCastGround(this.mouseScreenPos.x, this.mouseScreenPos.y);
            this.mouseWorldPos.x += this.mouseWorldOffset.x;
            this.mouseWorldPos.z += this.mouseWorldOffset.z;

            if (this.game.state.phase === this.enums.gamePhase.placement &&
                this.game.state.selectedUnitType) {
                this.updatePlacementPreview();
            }
        }, 100);
    }

    // ==================== UPDATE ====================

    update() {
        // Refresh HUD every tick — needed for HP / round / gold display to reflect
        // changes made by AutobattlerRoundSystem after each battle.
        this.updateHUD();

        // Keep inventory + hero roster panels in sync with server state during prep.
        // Cheap DOM update; the selected-item state is held in this.selectedInventoryIndex
        // (not DOM-derived) so it survives re-renders.
        if (this.game.state.phase === this.enums.gamePhase.placement) {
            const stats = this._getMyPlayerStats();
            const invLen = stats?.inventory?.length ?? 0;
            const rosterLen = stats?.heroRoster?.length ?? 0;
            // Fingerprint to detect actual changes vs unchanged ticks
            const fp = `${invLen}|${rosterLen}|${this.selectedInventoryIndex}`;
            if (fp !== this._lastPrepFingerprint) {
                this._lastPrepFingerprint = fp;
                this.renderInventory();
                this.renderHeroRoster();
                if (this.openGem) this._renderGemDetail();
            }
        }

        // Note: TBW used to self-pause the game here after 30s of battle so the client
        // could wait for the server's BATTLE_END broadcast. In HeroArena (and any mode
        // with autobattlerRoundSystem) the server runs an authoritative intermission via
        // ServerBattlePhaseSystem._completeBattleEnd, and pausing here would freeze that
        // intermission timer — leaving timed-out battles stuck forever. Skip in HeroArena.
        if (!this.game.autobattlerRoundSystem && this.game.state.phase === this.enums.gamePhase.battle) {
            const battleDuration = (this.game.state.now || 0) - this.battleStartTime;
            if (battleDuration >= this.battleDuration && !this.isBattlePaused) {
                this.isBattlePaused = true;
                this.game.state.isPaused = true;
            }
        }

        // Show pending building footprints when not actively placing a unit
        // (updatePlacementPreview handles both pending + current when placing)
        if (!this.game.state.selectedUnitType) {
            this.updatePendingBuildingPreview();
        }

        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            this.lastRaycastTime = 0;
            this.lastValidationTime = 0;
            this.lastUpdateTime = 0;
            this.disablePlacementUI();
            return;
        }

        if (this.game.state.now - this.lastValidationTime > this.config.validationThrottle) {
            this.updateCursorState(this.cachedValidation);
            this.updatePlacementUI();
            this.lastValidationTime = this.game.state.now;
        }
    }

    /**
     * Get world positions for all pending building footprints
     * @returns {Array} Array of world positions for pending building cells
     */
    getPendingBuildingPositions() {
        const buildingStateEntities = this.game.getEntitiesWith('buildingState', 'placement');
        const myTeam = this.call.getActivePlayerTeam();
        const allFootprintCells = [];

        for (const entityId of buildingStateEntities) {
            const buildingState = this.game.getComponent(entityId, 'buildingState');
            if (!buildingState || buildingState.pendingUnitTypeId == null) continue;

            // Only show for my team
            const placement = this.game.getComponent(entityId, 'placement');
            if (!placement || placement.team !== myTeam) continue;

            // Get the building definition
            const buildingUnitType = this.game.getUnitTypeDef( {
                collection: buildingState.pendingCollection,
                type: buildingState.pendingUnitTypeId
            });

            if (!buildingUnitType) continue;

            // Calculate footprint cells using grid position
            const gridPos = buildingState.pendingGridPosition;
            const footprintWidth = buildingUnitType.footprintWidth || 1;
            const footprintHeight = buildingUnitType.footprintHeight || 1;
            const placementWidth = footprintWidth * 2;
            const placementHeight = footprintHeight * 2;

            const startX = gridPos.x - Math.floor(placementWidth / 2);
            const startZ = gridPos.z - Math.floor(placementHeight / 2);

            for (let z = 0; z < placementHeight; z++) {
                for (let x = 0; x < placementWidth; x++) {
                    allFootprintCells.push({ x: startX + x, z: startZ + z });
                }
            }
        }

        if (allFootprintCells.length === 0) return [];

        // Convert grid cells to world positions
        const halfCell = this.call.getPlacementGridSize() / 2;
        return allFootprintCells.map(cell => {
            const pos = this.call.placementGridToWorld( cell.x, cell.z);
            return { x: pos.x + halfCell, z: pos.z + halfCell };
        });
    }

    /**
     * Show footprint preview for pending buildings (buildings not yet spawned)
     * This provides visual feedback when a builder is ordered to construct a building
     */
    updatePendingBuildingPreview() {
        if (!this.config.enablePreview) return;

        // Throttle updates
        const now = performance.now();
        if (now - this.lastPendingBuildingUpdate < 100) return;
        this.lastPendingBuildingUpdate = now;

        const pendingPositions = this.getPendingBuildingPositions();

        if (pendingPositions.length > 0) {
            // Show with yellow color to indicate pending construction
            this.call.showPreviewMultiplePositionSets([
                { positions: pendingPositions, state: 'pending' }
            ], false);
        } else {
            this.call.hidePreview();
        }
    }

    // ==================== PLACEMENT PHASE ====================

    // Called by game.triggerEvent('onPlacementPhaseStart')
    onPlacementPhaseStart() {
        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;

        this.call.clearAllDamageEffects();
        this.call.clearAllEffects();

        // Show the prep controls panel (contains the Ready button)
        if (this.elements.prepControls)     this.elements.prepControls.classList.remove('hidden');
        if (this.elements.heroRosterPanel)  this.elements.heroRosterPanel.classList.remove('hidden');
        if (this.elements.inventoryPanel)   this.elements.inventoryPanel.classList.remove('hidden');
        if (this.elements.itemDetailsPanel) this.elements.itemDetailsPanel.classList.remove('hidden');
        if (this.elements.phaseDisplay)     this.elements.phaseDisplay.textContent = 'PREP PHASE';

        this.enablePlacementUI();
        if (this.elements.readyButton) {
            this.elements.readyButton.textContent = 'Ready for Battle';
        }

        // Move camera to player's side of the board
        this.setupCameraForMySide();

        // Render the player's hero roster + equipment + inventory
        this.selectedInventoryIndex = null;
        this.renderHeroRoster();
        this.renderInventory();
        this._showDetailsForItem(null);
    }

    // Hide the prep panels when leaving placement phase
    onBattleStart() {
        if (this.elements.heroRosterPanel)  this.elements.heroRosterPanel.classList.add('hidden');
        if (this.elements.inventoryPanel)   this.elements.inventoryPanel.classList.add('hidden');
        if (this.elements.itemDetailsPanel) this.elements.itemDetailsPanel.classList.add('hidden');
        this._closeGemDetail();
        this._logEvent(`Round ${this.game.state.round ?? 1} — battle begins!`, 'battle');
    }

    // ==================== COMBAT LOG ====================

    // Called by AbilitySystem.useAbility via game.triggerEvent('onAbilityUsed', ...)
    onAbilityUsed(data) {
        if (!data) return;
        const heroName = this._describeEntity(data.entityId);
        this._logEvent(`${heroName} uses ${data.abilityName}`, 'ability');
    }

    // DeathSystem fires this with the killed entity's ID
    onUnitKilled(entityId) {
        if (entityId == null) return;
        const name = this._describeEntity(entityId);
        this._logEvent(`${name} died`, 'death');
    }

    onBattleEnd() {
        this._logEvent('Battle ends', 'battle');
    }

    _describeEntity(entityId) {
        if (entityId == null) return 'Unknown';
        const unitTypeComp = this.game.getComponent(entityId, 'unitType');
        const unitDef = this.game.getUnitTypeDef?.(unitTypeComp);
        const teamComp = this.game.getComponent(entityId, 'team');
        const teamName = teamComp?.team === this.enums?.team?.left ? 'L' :
                        teamComp?.team === this.enums?.team?.right ? 'R' : '?';
        return `[${teamName}] ${unitDef?.title || unitDef?.id || `#${entityId}`}`;
    }

    // ==================== ITEM DETAILS PANEL (click/tap-driven, no hover) ====================

    _showDetailsForItem(item) {
        const panel   = this.elements.itemDetailsPanel;
        const content = this.elements.itemDetailsContent;
        if (!panel || !content) return;
        if (!item) {
            panel.className = '';
            content.className = 'item-details-empty';
            content.innerHTML = 'Tap an item or hero slot to see details.';
            return;
        }
        panel.className = `rarity-${item.rarity || 'normal'}`;
        content.className = '';
        content.innerHTML = this._renderItemTooltip(item);
    }

    _renderItemTooltip(item) {
        const name     = item.name || item.baseName || 'Item';
        const baseName = item.baseName || '';
        const subtitle = this._tooltipSubtitle(item);

        let parts = [
            `<div class="tt-name">${name}</div>`,
            `<div class="tt-subtitle">${subtitle}</div>`
        ];
        if (baseName && baseName !== name) {
            parts.push(`<div class="tt-stat"><span class="tt-stat-name">Base</span><span class="tt-stat-value">${baseName}</span></div>`);
        }

        // Type-specific stats block
        const statsHtml = this._tooltipStats(item);
        if (statsHtml) parts.push(`<div class="tt-section">${statsHtml}</div>`);

        // Affixes (random rolled modifiers)
        const affixesHtml = this._tooltipAffixes(item);
        if (affixesHtml) parts.push(`<div class="tt-section">${affixesHtml}</div>`);

        // Gem: socketed runes preview + ability stats from the abilities collection
        if (item.itemType === 'gem') {
            const abilityHtml = this._tooltipGemAbility(item);
            if (abilityHtml) parts.push(`<div class="tt-section">${abilityHtml}</div>`);

            if (Array.isArray(item.runes)) {
                const runesPreview = item.runes
                    .map((r, i) => `<div class="tt-stat"><span class="tt-stat-name">Rune ${i + 1}</span><span class="tt-stat-value">${r?.baseName || r?.name || '<em>empty</em>'}</span></div>`)
                    .join('');
                parts.push(`<div class="tt-section">${runesPreview}</div>`);
            }
        }

        // Free-text description
        if (item.description) {
            parts.push(`<div class="tt-description">${item.description}</div>`);
        }

        return parts.join('');
    }

    // Pull the ability's stats (cooldown, range, damage, etc.) from the abilities
    // collection — abilities are data-driven, NOT hardcoded in JS classes anymore.
    _tooltipGemAbility(item) {
        if (!item.abilityId) return '';
        const abilityData = this.collections?.abilities?.[item.abilityId];
        if (!abilityData) return '';

        const stat = (label, value) => `<div class="tt-stat"><span class="tt-stat-name">${label}</span><span class="tt-stat-value">${value}</span></div>`;
        const lines = [];
        if (abilityData.name)        lines.push(stat('Ability',     abilityData.name));
        if (abilityData.cooldown != null) lines.push(stat('Cooldown', `${abilityData.cooldown}s`));
        if (abilityData.range)       lines.push(stat('Range',       abilityData.range));
        if (abilityData.castTime != null) lines.push(stat('Cast Time', `${abilityData.castTime}s`));
        // Damage fields vary by ability (damage, bashDamage, leapDamage, etc.) — show the first one found
        const damageField = ['damage', 'bashDamage', 'leapDamage', 'chargeDamage', 'backstabDamage',
                             'piercingDamage', 'arrowDamage', 'initialDamage', 'drainAmount',
                             'healAmount'].find(k => abilityData[k] != null);
        if (damageField)             lines.push(stat(this._humanizeDamageField(damageField), abilityData[damageField]));
        if (abilityData.element)     lines.push(stat('Element',     abilityData.element));
        if (abilityData.splashRadius)lines.push(stat('Splash',      abilityData.splashRadius));
        if (abilityData.stunDuration)lines.push(stat('Stun',        `${abilityData.stunDuration}s`));

        if (abilityData.description) {
            lines.push(`<div class="tt-description">${abilityData.description}</div>`);
        }
        return lines.join('');
    }

    _humanizeDamageField(field) {
        const m = {
            damage:         'Damage',
            bashDamage:     'Damage',
            leapDamage:     'Damage',
            chargeDamage:   'Damage',
            backstabDamage: 'Damage',
            piercingDamage: 'Damage',
            arrowDamage:    'Damage / Arrow',
            initialDamage:  'Initial Damage',
            drainAmount:    'Drain',
            healAmount:     'Heal'
        };
        return m[field] || field;
    }

    _tooltipSubtitle(item) {
        const r = item.rarity ? item.rarity[0].toUpperCase() + item.rarity.slice(1) : 'Normal';
        switch (item.itemType) {
            case 'weapon':    return `${r} ${item.weaponType ? item.weaponType.toUpperCase() : 'WEAPON'}${item.isTwoHanded ? ' (2H)' : ''}`;
            case 'offhand':   return `${r} ${(item.offhandType || 'OFFHAND').toUpperCase()}`;
            case 'bodyArmor': return `${r} BODY ARMOR`;
            case 'helmet':    return `${r} HELMET`;
            case 'gem':       return `${r} ABILITY GEM`;
            case 'rune':      return `${r} RUNE`;
            default:          return r.toUpperCase();
        }
    }

    _tooltipStats(item) {
        const lines = [];
        const stat = (label, value) => `<div class="tt-stat"><span class="tt-stat-name">${label}</span><span class="tt-stat-value">${value}</span></div>`;

        if (item.itemType === 'weapon') {
            if (item.baseValue != null)   lines.push(stat('Damage',       item.baseValue));
            if (item.attackSpeed != null) lines.push(stat('Attack Speed', `${item.attackSpeed}/s`));
            if (item.range != null)       lines.push(stat('Range',        item.range));
            if (item.projectile != null)  lines.push(stat('Projectile',   item.projectile));
            if (item.element)             lines.push(stat('Element',      item.element));
        } else if (item.itemType === 'bodyArmor' || item.itemType === 'helmet' || item.itemType === 'offhand') {
            if (item.baseValue)           lines.push(stat('Armor',        item.baseValue));
        } else if (item.itemType === 'gem') {
            if (item.abilityId)           lines.push(stat('Grants',       item.abilityId.replace(/Ability$/, '')));
            if (item.runeSlots != null)   lines.push(stat('Rune Slots',   item.runeSlots));
        } else if (item.itemType === 'rune') {
            const mods = item.modifiers || {};
            for (const [k, v] of Object.entries(mods)) {
                lines.push(stat(this._humanizeModName(k), this._humanizeModValue(k, v)));
            }
        }
        return lines.join('');
    }

    _tooltipAffixes(item) {
        const affixes = Array.isArray(item.affixes) ? item.affixes : [];
        if (affixes.length === 0) return '';
        return affixes.map(a => {
            const sign = a.value > 0 ? '+' : '';
            const label = (a.label ? `${a.label} ` : '') + this._humanizeAffixStat(a.stat);
            return `<div class="tt-affix">${sign}${a.value} ${label}</div>`;
        }).join('');
    }

    _humanizeAffixStat(stat) {
        const m = {
            flatDamage: 'Damage',         percentDamage: '% Damage',
            flatHP:     'HP',             percentHP:     '% HP',
            flatArmor:  'Armor',
            evasion:    'Evasion',        critChance:    '% Crit Chance',
            blockChance:'% Block Chance',
            fireResistance:      'Fire Resistance',
            coldResistance:      'Cold Resistance',
            lightningResistance: 'Lightning Resistance',
            percentAttackSpeed:  '% Attack Speed'
        };
        return m[stat] || stat;
    }

    _humanizeModName(k) {
        const m = {
            cooldownReduction: 'Cooldown',
            rangeBonus:        'Range',
            aoeRadius:         'AoE Radius',
            chainCount:        'Chains',
            projectileCount:   'Projectiles'
        };
        return m[k] || k;
    }

    _humanizeModValue(k, v) {
        if (k === 'cooldownReduction') return `${Math.round((1 - v) * 100)}% reduced`;
        if (k === 'rangeBonus')        return `+${v}`;
        if (k === 'aoeRadius')         return `+${v}`;
        if (k === 'chainCount')        return `+${v}`;
        if (k === 'projectileCount')   return `+${v - 1}`;
        return String(v);
    }

    _logEvent(message, type = 'system') {
        const container = this.elements.combatLogEntries;
        if (!container) return;
        const div = document.createElement('div');
        div.className = `combat-log-entry type-${type}`;
        div.textContent = message;
        container.insertBefore(div, container.firstChild);
        // Cap log at 50 entries
        while (container.childElementCount > 50) {
            container.removeChild(container.lastChild);
        }
    }

    enablePlacementUI() {
        if (this.elements.readyButton) this.elements.readyButton.disabled = false;
        if (this.elements.undoButton) this.elements.undoButton.disabled = false;
    }

    disablePlacementUI() {
        if (this.elements.readyButton) this.elements.readyButton.disabled = true;
        if (this.elements.undoButton) this.elements.undoButton.disabled = true;
    }

    updatePlacementUI() {
        if (this.elements.undoButton) {
            this.elements.undoButton.disabled = this.undoStack.length === 0;
            this.elements.undoButton.style.opacity = this.undoStack.length === 0 ? '0.5' : '1';
        }
    }

    togglePlacementReady() {
        if (this.elements.readyButton) {
            this.elements.readyButton.disabled = true;
            this.elements.readyButton.textContent = 'Updating...';
        }

        // Use ui_toggleReadyForBattle - same code path as headless mode
        this.call.ui_toggleReadyForBattle( (success, response) => {
            if (success) {
                this.hasSubmittedPlacements = true;
                if (this.elements.readyButton) {
                    this.elements.readyButton.textContent = 'Waiting for Opponent...';
                }
            } else {
                if (this.elements.readyButton) {
                    this.elements.readyButton.disabled = false;
                    this.elements.readyButton.textContent = 'Ready for Battle';
                }
            }
        });
    }

    handleReadyForBattleUpdate(data) {
        const myPlayerId = this.game.clientNetworkManager?.playerId;
        if (data.playerId === myPlayerId) {
            this.isPlayerReady = data.ready;
            this.updatePlacementUI();
        }

        if (data.allReady) {
            // Sync round from server if available
            if (data.gameState?.round !== undefined) {
                this.game.state.round = data.gameState.round;
            }
            // Always set phase to battle when allReady (server may send stale phase)
            this.game.state.phase = this.enums.gamePhase.battle;

            // Apply network unit data for each opponent (spawns their units with proper renderable)
            // This must happen before entitySync so client-only components are set correctly
            // Skip in local/hunt mode - there are no remote opponents to sync
            if (data.gameState?.players && !this.game.state.isLocalGame) {
                data.gameState.players.forEach((player) => {
                    if (player.id !== myPlayerId) {
                        this.call.applyNetworkUnitData( player.networkUnitData, player.team, player.id);
                    }
                });
            }

            // Initialize deterministic RNG for this battle (must match server seed)
            const roomId = this.game.clientNetworkManager?.roomId || 'default';
            const roomIdHash = GUTS.SeededRandom.hashString(roomId);
            const battleSeed = GUTS.SeededRandom.combineSeed(roomIdHash, this.game.state.round || 1);
            this.game.rng.strand('battle').reseed(battleSeed);

            // Track battle start time for duration limiting
            this.battleStartTime = 0; // Will be set after resetCurrentTime
            this.isBattlePaused = false;

            // Unpause game to allow updates during battle
            this.game.state.isPaused = false;

            this.game.resetCurrentTime();
            this.battleStartTime = this.game.state.now || 0;

            // CRITICAL: Resync entities with server state BEFORE onBattleStart
            // This ensures all clients have identical state (including playerOrder.isHiding)
            // before behavior trees start processing
            if (data.entitySync) {
                console.log('[PlacementUISystem] About to call resyncEntities', {
                    isLocalGame: this.game.state.isLocalGame,
                    isHuntMission: this.game.state.isHuntMission,
                    entitySyncAliveCount: data.entitySync?.entityAlive ? Object.keys(data.entitySync.entityAlive).length : 0
                });
                this.call.resyncEntities( data);
            }

            // DEBUG: Check playerOrder.isHiding after resync
            const allPlayerOrders = this.game.getEntitiesWith('playerOrder');
            for (const entityId of allPlayerOrders) {
                const po = this.game.getComponent(entityId, 'playerOrder');
                const unitTypeComp = this.game.getComponent(entityId, 'unitType');
                const unitTypeDef = this.game.getUnitTypeDef( unitTypeComp);
            }

            this.call.resetAI();
            // In local mode the server-side ServerBattlePhaseSystem.startBattle has
            // already fired onBattleStart in this same process — don't double-fire.
            if (!this.game.state.isLocalGame) {
                this.game.triggerEvent('onBattleStart');
            }

            if (this.game.desyncDebugger) {
                this.game.desyncDebugger.enabled = true;
                this.game.desyncDebugger.displaySync(true);
            }

            if (this.elements.readyButton) {
                this.elements.readyButton.disabled = true;
                this.elements.readyButton.textContent = 'Battling!';
            }
        }
    }

    // ==================== RAYCASTING ====================

    rayCastGround(screenX, screenY) {
        if (!this.raycastHelper) {
            return { x: 0, y: 0, z: 0 };
        }

        // Get ground mesh for raycasting
        const ground = this.call.getGroundMesh();

        // Use RaycastHelper to raycast against ground
        const worldPos = this.raycastHelper.rayCastGround(screenX, screenY, ground);

        if (worldPos) {
            return worldPos;
        }

        return { x: 0, y: 0, z: 0 };
    }

    getFlatWorldPositionFromMouse(screenX, screenY) {
        const worldPos = this.rayCastGround(screenX, screenY);
        if (worldPos) {
            return {
                x: worldPos.x + this.mouseWorldOffset.x,
                z: worldPos.z + this.mouseWorldOffset.z
            };
        }
        return null;
    }

    // ==================== PREVIEW ====================

    updatePlacementPreview() {
        if (!this.config.enablePreview || !this.game.state.selectedUnitType) {
            return;
        }

        if (!this.mouseWorldPos) {
            // No mouse position - show pending buildings instead of clearing
            this.lastPendingBuildingUpdate = 0; // Force refresh
            this.updatePendingBuildingPreview();
            document.body.style.cursor = 'not-allowed';
            return;
        }

        const unitType = this.game.state.selectedUnitType;
        const gridPos = this.call.worldToPlacementGrid( this.mouseWorldPos.x, this.mouseWorldPos.z);

        // Throttle validation checks
        const now = performance.now();
        if (now - this.lastValidationTime < this.config.validationThrottle * 1000) {
            if (this.cachedGridPos?.x === gridPos.x && this.cachedGridPos?.z === gridPos.z) {
                return;
            }
        }

        this.lastValidationTime = now;
        this.cachedGridPos = gridPos;

        // Check if placement is valid
        const squadData = this.call.getSquadData( unitType);
        if (!squadData) return;

        const cells = this.call.getSquadCells( gridPos, squadData);
        let isValid = this.call.isValidGridPlacement( cells, this.call.getActivePlayerTeam());

        // Gold mines can only be placed on unclaimed gold veins
        if (isValid && unitType.id === 'goldMine' && this.game.hasService('isValidGoldMinePlacement')) {
            const footprintWidth = unitType.footprintWidth || 2;
            const footprintHeight = unitType.footprintHeight || 2;
            const gridWidth = footprintWidth * 2;
            const gridHeight = footprintHeight * 2;

            const validation = this.call.isValidGoldMinePlacement( gridPos, gridWidth, gridHeight);
            isValid = validation.valid;
        }

        this.cachedValidation = isValid;

        // Get world positions for cells (offset by half cell to center on cell)
        const halfCell = this.call.getPlacementGridSize() / 2;
        const worldPositions = cells.map(cell => {
            const pos = this.call.placementGridToWorld( cell.x, cell.z);
            return { x: pos.x + halfCell, z: pos.z + halfCell };
        });

        // Get unit positions for squad preview
        let unitPositions = null;
        if (this.call.getSquadSize( squadData) > 1) {
            unitPositions = this.call.calculateUnitPositions( gridPos, unitType);
        }

        // Get pending building positions to show alongside current placement
        const pendingPositions = this.getPendingBuildingPositions();

        // Build position sets with different colors
        const positionSets = [];

        // Pending buildings always show YELLOW
        if (pendingPositions.length > 0) {
            positionSets.push({ positions: pendingPositions, state: 'pending' });
        }

        // Current placement shows GREEN/RED based on validity
        positionSets.push({ positions: worldPositions, state: isValid ? 'valid' : 'invalid' });

        // Update preview with multiple position sets
        this.call.showPreviewMultiplePositionSets(positionSets, false);

        this.updateCursorState(isValid);
    }

    updateCursorState(isValid) {
        if (this.game.state.selectedUnitType) {
            document.body.style.cursor = isValid ? 'pointer' : 'not-allowed';
        } else {
            document.body.style.cursor = 'default';
        }
    }

    // ==================== INPUT RESULT HANDLING ====================

    /**
     * Handle input results from GameInterfaceSystem
     * Called via game event 'onInputResult'
     */
    onInputResult(result) {
        if (!result) return;

        if (result.action === 'place_unit') {
            if (result.success) {
                // Add to undo stack
                this.addToUndoStack({
                    placementId: result.data.placementId,
                    unitType: result.unitType,
                    gridPosition: result.gridPosition,
                    squadUnits: result.data.squadUnits,
                    team: this.call.getActivePlayerTeam()
                });

                // Create visual effects
                this.createPlacementEffects(result.gridPosition, result.unitType);

                // Update UI
                this.updatePlacementUI();
                this.call.updateGoldDisplay();

                // Clear placement mode after successful placement
                this.game.state.selectedUnitType = null;
                this.game.state.peasantBuildingPlacement = null;
                // Show pending buildings (which may have just been added)
                this.lastPendingBuildingUpdate = 0; // Force refresh
                this.updatePendingBuildingPreview();
                document.body.style.cursor = 'default';
            } else {
                this.call.showNotification( result.data?.error || 'Placement failed', 'error', 2000);
            }
        }
    }

    // ==================== UNDO ====================

    addToUndoStack(undoInfo) {
        this.undoStack.push(undoInfo);
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }
        this.updatePlacementUI();
    }

    clearUndoStack() {
        this.undoStack = [];
        this.updatePlacementUI();
    }

    getUndoStatus() {
        return {
            canUndo: this.undoStack.length > 0,
            stackSize: this.undoStack.length,
            maxSize: this.maxUndoSteps
        };
    }

    undoLastPlacement() {
        if (this.undoStack.length === 0) return false;

        const undoInfo = this.undoStack.pop();
        if (!undoInfo) return false;

        // Use ui_undoPlacement - SAME code path as headless mode
        this.call.ui_undoPlacement( undoInfo, (success) => {
            if (success) {
                // Create undo visual effect
                this.createUndoEffects(undoInfo.gridPosition);
                this.updatePlacementUI();
            }
        });

        return true;
    }

    // ==================== VISUAL EFFECTS ====================

    createPlacementEffects(gridPos, unitType) {
        const worldPos = this.call.placementGridToWorld( gridPos.x, gridPos.z);
        if (worldPos) {
            this.call.createParticleEffect(
                worldPos.x,
                0,
                worldPos.z,
                'magic',
                { count: 5, speedMultiplier: 0.8 }
            );
        }
    }

    createUndoEffects(gridPos) {
        const worldPos = this.call.placementGridToWorld( gridPos.x, gridPos.z);
        if (worldPos) {
            this.call.createParticleEffect(
                worldPos.x,
                0,
                worldPos.z,
                'smoke',
                { count: 3, speedMultiplier: 0.5 }
            );
        }
    }

    createRespawnEffect(position, team) {
        const effectType = team === 'player' ? 'magic' : 'heal';
        this.call.createParticleEffect(
            position.x,
            position.y,
            position.z,
            effectType,
            { count: 3, speedMultiplier: 0.6 }
        );
    }

    // ==================== CLEANUP ====================

    dispose() {
        if (this.mouseRayCastInterval) {
            clearInterval(this.mouseRayCastInterval);
            this.mouseRayCastInterval = null;
        }

        // Clean up keyboard listener
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }

        // Clean up canvas listeners
        if (this.canvas) {
            if (this._canvasMouseMoveHandler) {
                this.canvas.removeEventListener('mousemove', this._canvasMouseMoveHandler);
                this._canvasMouseMoveHandler = null;
            }
            if (this._canvasMouseLeaveHandler) {
                this.canvas.removeEventListener('mouseleave', this._canvasMouseLeaveHandler);
                this._canvasMouseLeaveHandler = null;
            }
        }

        this.cachedValidation = null;
        this.cachedGridPos = null;

        this.undoStack = [];
    }

    onSceneUnload() {
        this.dispose();
    }
}
