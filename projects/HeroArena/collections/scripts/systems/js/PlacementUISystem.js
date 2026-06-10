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
        'submitBuyOffer',
        'submitRerollOffers',
        'submitBuyUnlockedUnit',
        'submitGrantSingleAbility',
        'submitSpecializeChoice',
        'submitPlaceBuilding',
        'submitMoveBuilding',
        'submitCancelPlaceBuilding'
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
        this.elements.battleTimer     = document.getElementById('battleTimer');
        this.elements.goldDisplay     = document.getElementById('playerGold');
        this.elements.prepControls    = document.getElementById('prepControls');
        this.elements.combatLogEntries     = document.getElementById('combatLogEntries');

        // Army shop panel
        this.elements.shopPanel       = document.getElementById('shopPanel');
        this.elements.shopOffers      = document.getElementById('shopOffers');
        this.elements.shopRerollBtn   = document.getElementById('shopRerollBtn');
        this.elements.shopPendingBanner = document.getElementById('shopPendingBanner');
        this.elements.shopPendingText   = document.getElementById('shopPendingText');
        this.elements.shopPendingTargets = document.getElementById('shopPendingTargets');
        this.elements.shopPendingCancel = document.getElementById('shopPendingCancel');
        this.elements.unlockedUnitsPanel = document.getElementById('unlockedUnitsPanel');
        this.elements.unlockedUnitsCards = document.getElementById('unlockedUnitsCards');
        this._wireShopHandlers();
    }

    // Idempotent delegated click wiring for the shop + unlocked-units panels.
    // Listeners go through _track so _teardownListeners() can remove them and
    // reset _shopWired — a later scene load may re-inject the shop DOM, and the
    // fresh elements need wiring while the old ones must not hold listeners.
    _wireShopHandlers() {
        if (this._shopWired) return;
        const track = (el, type, fn) => { if (el) this._track(el, type, fn); };
        track(this.elements.shopOffers, 'click', (e) => this._onShopOfferClick(e));
        track(this.elements.shopRerollBtn, 'click', () => {
            this.call.submitRerollOffers((res) => this._renderShop(res?.state || res));
        });
        track(this.elements.unlockedUnitsCards, 'click', (e) => this._onUnlockedUnitClick(e));
        // Target buttons in the pending banner pick which unit receives a
        // single-target ability purchase.
        track(this.elements.shopPendingTargets, 'click', (e) => this._onAbilityTargetClick(e));
        track(this.elements.shopPendingCancel, 'click', () => {
            if (this._placingBuildingId) this._cancelBuildingPlacement();
            else this._cancelAbilityTarget();
        });
        this._shopWired = true;
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

    // Called by game.triggerEvent('onSpecializeSelectStart', data) when one of our
    // units reaches the specialization level. data: { playerId, rosterIndex,
    // currentTitle, level, options: [{id, title}] }
    onSpecializeSelectStart(data) {
        const myId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        if (!data || data.playerId !== myId) return;
        const overlay  = document.getElementById('specializeOverlay');
        const grid     = document.getElementById('specializeOptions');
        const title    = document.getElementById('specializeTitle');
        const subtitle = document.getElementById('specializeSubtitle');
        if (!overlay || !grid) return;

        if (title)    title.textContent    = `${data.currentTitle || 'Unit'} reached Level ${data.level || 3}!`;
        if (subtitle) subtitle.textContent = 'Choose a specialization to transform into';

        grid.innerHTML = '';
        (data.options || []).forEach(opt => {
            const card = document.createElement('div');
            card.className = 'arena-option-card';
            card.innerHTML = `<div class="arena-option-name">${opt.title}</div>`;
            card.addEventListener('click', () => {
                this.call.submitSpecializeChoice(data.rosterIndex, opt.id);
                overlay.classList.add('hidden');   // server prompts again if more remain
            });
            grid.appendChild(card);
        });
        overlay.classList.remove('hidden');
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

        if (myStats && this.elements.goldDisplay) {
            this.elements.goldDisplay.textContent = myStats.gold ?? 0;
        }

        // The HUD health bars show each side's TOWN HALL — destroying the enemy's
        // wins the game. Bars only update when a townhall entity is present
        // client-side (it may not be synced yet in the first prep).
        const myTeam = this.call.getActivePlayerTeam?.();
        if (myTeam != null) {
            const enemyTeam = myTeam === this.enums.team.left ? this.enums.team.right : this.enums.team.left;
            this._renderTownHallBar(this._findTownHallHealth(myTeam),
                this.elements.playerHPBar, this.elements.playerHPValue);
            this._renderTownHallBar(this._findTownHallHealth(enemyTeam),
                this.elements.opponentHPBar, this.elements.opponentHPValue);
        }

        if (this.elements.roundDisplay) {
            this.elements.roundDisplay.textContent = `Round ${this.game.state.round ?? 1}`;
        }

        // Battle countdown — counts down to the round deadline (incl. the siege
        // window extension, which the server publishes via state/broadcast).
        if (this.elements.battleTimer) {
            const inBattle = this.game.state.phase === this.enums.gamePhase.battle;
            if (inBattle && this.game.state.battleEndsAt != null) {
                const remaining = Math.max(0, this.game.state.battleEndsAt - (this.game.state.now || 0));
                this.elements.battleTimer.textContent = `⏳ ${Math.ceil(remaining)}s`;
                this.elements.battleTimer.classList.remove('hidden');
                this.elements.battleTimer.classList.toggle('hud-timer-low', remaining <= 5);
            } else {
                this.elements.battleTimer.classList.add('hidden');
            }
        }
    }

    _renderTownHallBar(th, barEl, valueEl) {
        if (!th) return; // not spawned/synced yet — leave the bar as-is
        if (barEl)   barEl.style.width = `${(th.current / th.max) * 100}%`;
        if (valueEl) valueEl.textContent = `${Math.ceil(th.current)} / ${Math.ceil(th.max)}`;
    }

    // Find a team's Town Hall (any tier: townHall/keep/castle) and return its
    // health, or null if no townhall entity exists on this client yet. Matched
    // by unitType id + team, which works even when the buildingOwner tag hasn't
    // replicated to this client.
    _findTownHallHealth(team) {
        const thTiers = this.game.buildingSystem?.constructor?.TOWNHALL_LEVEL
            || { townHall: 1, keep: 2, castle: 3 };
        for (const eid of this.game.getEntitiesWith('unitType', 'health', 'team')) {
            const t = this.game.getComponent(eid, 'team');
            if (!t || t.team !== team) continue;
            const def = this.game.getUnitTypeDef(this.game.getComponent(eid, 'unitType'));
            if (!def?.id || !thTiers[def.id]) continue;
            const health = this.game.getComponent(eid, 'health');
            if (health) {
                return { current: Math.max(0, health.current), max: health.max || 1 };
            }
        }
        return null;
    }

    // ==================== HERO DRAG (PREP PHASE) ====================

    _onHeroDragDown(event) {
        if (event.button !== 0) return;
        if (this.game.state.phase !== this.enums.gamePhase.placement) return;

        const worldPos = this.getWorldPositionFromMouse(event.clientX, event.clientY, false);
        if (!worldPos) return;

        // Building placement mode: this click chooses where the just-bought building goes.
        if (this._placingBuildingId) {
            const buildingId = this._placingBuildingId;
            this.call.submitPlaceBuilding(buildingId, worldPos.x, worldPos.z, (res) => {
                if (res?.success) {
                    this._exitBuildingPlacementMode();
                } // else: out of radius / invalid — stay in placement mode to retry
                this._renderShop(res?.state || res);
            });
            return;
        }

        // Prefer SelectedUnitSystem's entity picker (proper unit-size + team filter); fall back to local
        const sel = this.game.selectedUnitSystem;
        let heroId = sel?.getEntityAtWorldPosition?.(worldPos) ?? this._findHeroAtWorldPos(worldPos.x, worldPos.z);
        if (heroId == null) return;

        // Only my-team entities are draggable
        const team   = this.game.getComponent(heroId, 'team');
        const myTeam = this.call.getActivePlayerTeam();
        if (!team || team.team !== myTeam) return;

        // Buildings are draggable only on the round they were placed (Town Hall never).
        const building = this.game.getComponent(heroId, 'buildingOwner');
        if (building) {
            if (!this.game.buildingSystem?.canMoveBuilding?.(heroId)) return;
            this.draggedBuildingId = heroId;
            this.draggedBuildingPlacementId = building.placementId;
        } else {
            // Must be a hero entity (heroRosterInfo is added by HeroRosterSystem)
            if (!this.game.getComponent(heroId, 'heroRosterInfo')) return;
            this.draggedHeroId = heroId;
        }

        const t = this.game.getComponent(heroId, 'transform');
        this.dragOffset.x = (t?.position?.x ?? worldPos.x) - worldPos.x;
        this.dragOffset.z = (t?.position?.z ?? worldPos.z) - worldPos.z;
        this.dragMoved = false;

        // Cancel any in-progress box selection so its visual doesn't appear while dragging
        sel?.cancelBoxSelection?.();

        document.body.style.cursor = 'grabbing';
    }

    _onHeroDragMove(event) {
        const draggedId = this.draggedHeroId ?? this.draggedBuildingId;
        if (draggedId == null) return;

        // Keep box selection suppressed for the duration of the drag.
        // SelectedUnitSystem's mousedown handler reactivates it after ours runs,
        // so we cancel again here (this runs before their mousemove handler).
        this.game.selectedUnitSystem?.cancelBoxSelection?.();

        const worldPos = this.getWorldPositionFromMouse(event.clientX, event.clientY, false);
        if (!worldPos) return;

        const newX = worldPos.x + this.dragOffset.x;
        const newZ = worldPos.z + this.dragOffset.z;
        // Optimistic local update so the entity follows the cursor immediately
        this.game.placementSystem?.moveHero(draggedId, newX, newZ);
        this.dragMoved = true;
    }

    _onHeroDragUp(event) {
        const isBuilding = this.draggedBuildingId != null;
        const draggedId = this.draggedHeroId ?? this.draggedBuildingId;
        if (draggedId == null) return;

        // Snapshot state, then clear it BEFORE any network call so the drag always releases.
        const placementId = this.draggedBuildingPlacementId;
        const wasMoved = this.dragMoved;
        const offX = this.dragOffset.x;
        const offZ = this.dragOffset.z;
        this.draggedHeroId = null;
        this.draggedBuildingId = null;
        this.draggedBuildingPlacementId = null;
        this.dragMoved = false;
        document.body.style.cursor = 'default';

        if (!wasMoved) return;

        try {
            const worldPos = this.getWorldPositionFromMouse(event.clientX, event.clientY, false);
            if (worldPos) {
                if (isBuilding) {
                    this.call.submitMoveBuilding(placementId, worldPos.x + offX, worldPos.z + offZ);
                } else {
                    this.call.submitHeroMove(draggedId, worldPos.x + offX, worldPos.z + offZ);
                }
            }
        } catch (err) {
            console.warn('[PlacementUISystem] drag move submit failed:', err);
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

    _titleCase(s) {
        return String(s).charAt(0).toUpperCase() + String(s).slice(1);
    }

    _unitDisplayName(spawnType) {
        return spawnType ? (this.collections?.units?.[spawnType]?.title || null) : null;
    }

    // ==================== ARMY SHOP ====================

    // Only react to our own player's shop state (offers are sent per-player).
    _isMyShopState(state) {
        if (!state) return false;
        const myId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        return state.playerId === myId;
    }

    // Fired by ClientNetworkSystem 'SHOP_OFFERS' / local triggerEvent at round start.
    onShopOffersReady(state) {
        if (!this._isMyShopState(state)) return;
        this._shopState = state;
        this._renderShop(state);
    }

    _renderShop(state) {
        if (!state) return;
        if (this._isMyShopState(state)) this._shopState = state;
        const s = this._shopState;
        if (!s) return;

        const offers = s.offers || [];
        if (this.elements.shopOffers) {
            this.elements.shopOffers.innerHTML = offers.map((o, i) => {
                const affordable = (s.gold ?? 0) >= o.cost;
                const cls = `shop-offer-card kind-${o.kind} ${o.consumed ? 'consumed' : ''} ${affordable ? '' : 'unaffordable'}`;
                const label = o.consumed ? 'Purchased' : `${o.cost}g`;
                return `<div class="${cls}" data-offer-index="${i}">
                    <span class="shop-offer-kind">${o.kind}</span>
                    <span class="shop-offer-name">${o.title}</span>
                    <span class="shop-offer-cost">${label}</span>
                </div>`;
            }).join('');
        }
        if (this.elements.shopRerollBtn) {
            const cost = s.rerollCost ?? 0;
            this.elements.shopRerollBtn.textContent = `Reroll (${cost}g)`;
            this.elements.shopRerollBtn.disabled = (s.gold ?? 0) < cost;
        }
        this._renderUnlockedUnits(s);
        this.updateHUD?.();
    }

    _renderUnlockedUnits(s) {
        if (!this.elements.unlockedUnitsCards) return;
        const unlocked = s.unlocked || [];
        this.elements.unlockedUnitsCards.innerHTML = unlocked.map(u => {
            const affordable = (s.gold ?? 0) >= u.cost;
            return `<div class="unlocked-unit-card ${affordable ? '' : 'unaffordable'}" data-unit-id="${u.id}">
                <span class="unlocked-unit-name">${u.title}</span>
                <span class="unlocked-unit-cost">${u.cost}g</span>
            </div>`;
        }).join('');
    }

    _onShopOfferClick(event) {
        const card = event.target.closest('[data-offer-index]');
        if (!card) return;
        const idx = parseInt(card.dataset.offerIndex, 10);
        const offer = this._shopState?.offers?.[idx];
        if (!offer || offer.consumed) return;
        this.call.submitBuyOffer(idx, (res) => this._handleBuyResult(res));
    }

    _onUnlockedUnitClick(event) {
        const card = event.target.closest('[data-unit-id]');
        if (!card) return;
        this.call.submitBuyUnlockedUnit(card.dataset.unitId, (res) => this._renderShop(res?.state || res));
    }

    _handleBuyResult(res) {
        if (res?.requiresTarget) {
            this._enterAbilityTargetMode(res.pendingAbilityId);
            this._renderShop(res.state);
        } else if (res?.requiresPlacement) {
            this._enterBuildingPlacementMode(res.buildingId);
            this._renderShop(res.state);
        } else {
            this._renderShop(res?.state || res);
        }
    }

    // ── Building placement mode ──────────────────────────────────────────────
    _enterBuildingPlacementMode(buildingId) {
        this._placingBuildingId = buildingId;
        if (this.elements.shopPendingText) {
            const title = this.collections?.buildings?.[buildingId]?.title || buildingId;
            this.elements.shopPendingText.textContent =
                `Click within range of your Town Hall to place the ${title}.`;
        }
        this.elements.shopPendingBanner?.classList.remove('hidden');
    }

    _exitBuildingPlacementMode() {
        this._placingBuildingId = null;
        this.elements.shopPendingBanner?.classList.add('hidden');
    }

    _cancelBuildingPlacement() {
        if (!this._placingBuildingId) return;
        this.call.submitCancelPlaceBuilding((res) => {
            this._exitBuildingPlacementMode();
            this._renderShop(res?.state || res);
        });
    }

    // ── Single-target ability targeting ──────────────────────────────────────
    // The pending banner lists the player's roster units as buttons; clicking
    // one assigns the pending ability to that unit.
    _enterAbilityTargetMode(abilityId) {
        this._pendingAbilityId = abilityId;
        if (this.elements.shopPendingText) {
            this.elements.shopPendingText.textContent = 'Choose a unit to receive the ability:';
        }
        this._renderAbilityTargets();
        this.elements.shopPendingBanner?.classList.remove('hidden');
    }

    _exitAbilityTargetMode() {
        this._pendingAbilityId = null;
        if (this.elements.shopPendingTargets) this.elements.shopPendingTargets.innerHTML = '';
        this.elements.shopPendingBanner?.classList.add('hidden');
    }

    _renderAbilityTargets() {
        const container = this.elements.shopPendingTargets;
        if (!container) return;
        const roster = this._getMyPlayerStats()?.heroRoster || [];
        container.innerHTML = roster.map((entry, i) => {
            const level = entry.level || this._calcHeroLevel(entry.roundsPlayed || 0);
            const name = this._unitDisplayName(entry.spawnType) || this._titleCase(entry.heroClass || 'unknown');
            return `<button class="pending-target-btn" data-roster-index="${i}">
                ${name} <span class="pending-target-level">Lv ${level}</span>
            </button>`;
        }).join('');
    }

    _cancelAbilityTarget() {
        if (!this._pendingAbilityId) return;
        this.call.submitGrantSingleAbility(this._pendingAbilityId, -1, (res) => {
            this._exitAbilityTargetMode();
            this._renderShop(res?.state || res);
        });
    }

    _onAbilityTargetClick(event) {
        if (!this._pendingAbilityId) return;
        const card = event.target.closest('[data-roster-index]');
        if (!card) return;
        const rosterIndex = parseInt(card.dataset.rosterIndex, 10);
        const abilityId = this._pendingAbilityId;
        this.call.submitGrantSingleAbility(abilityId, rosterIndex, (res) => {
            this._exitAbilityTargetMode();
            this._renderShop(res?.state || res);
        });
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

    // Every listener this system registers goes through _track so teardown can
    // remove it. The system instance outlives scene loads — untracked window/
    // canvas listeners would otherwise accumulate (and keep firing with stale
    // state) across matches in one browser session.
    _track(target, type, handler) {
        target.addEventListener(type, handler);
        (this._trackedListeners ||= []).push([target, type, handler]);
    }

    _teardownListeners() {
        for (const [target, type, handler] of this._trackedListeners || []) {
            target.removeEventListener(type, handler);
        }
        this._trackedListeners = [];
        // Shop wiring is tracked too, so it must be re-wired after a teardown
        // (the shop DOM may have been re-injected by the next scene load).
        this._shopWired = false;
        if (this.mouseRayCastInterval) {
            clearInterval(this.mouseRayCastInterval);
            this.mouseRayCastInterval = null;
        }
    }

    setupEventListeners() {
        // Idempotent: drop listeners from a previous match before re-wiring.
        // onGameStarted runs once per match on this same system instance.
        this._teardownListeners();

        this.elements.readyButton = document.getElementById('placementReadyBtn');

        if (this.elements.readyButton) {
            this._track(this.elements.readyButton, 'click', () => {
                this.togglePlacementReady();
            });
        }

        // Mouse tracking for preview
        if (this.config.enablePreview && this.canvas) {
            this._track(this.canvas, 'mousemove', (event) => {
                const rect = this.canvas.getBoundingClientRect();
                this.mouseScreenPos.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                this.mouseScreenPos.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            });

            this._track(this.canvas, 'mouseleave', () => {
                // Don't clear - just show pending buildings if any
                this.lastPendingBuildingUpdate = 0; // Force refresh
                this.updatePendingBuildingPreview();
                this.cachedValidation = null;
                this.cachedGridPos = null;
                document.body.style.cursor = 'default';
            });
        }

        // Hero drag handlers (prep phase only)
        if (this.canvas) {
            this._track(this.canvas, 'mousedown', (event) => this._onHeroDragDown(event));
            this._track(this.canvas, 'mousemove', (event) => this._onHeroDragMove(event));
            this._track(window, 'mouseup', (event) => this._onHeroDragUp(event));

            // Right-click terrain pan handlers (camera follows so the clicked point stays under cursor)
            this._track(this.canvas, 'mousedown', (event) => this._onTerrainPanDown(event));
            this._track(this.canvas, 'mousemove', (event) => this._onTerrainPanMove(event));
            this._track(window, 'mouseup', (event) => this._onTerrainPanUp(event));
            this._track(this.canvas, 'contextmenu', (event) => event.preventDefault());
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
        if (this.elements.shopPanel)        this.elements.shopPanel.classList.remove('hidden');
        if (this.elements.unlockedUnitsPanel) this.elements.unlockedUnitsPanel.classList.remove('hidden');
        if (this.elements.phaseDisplay)     this.elements.phaseDisplay.textContent = 'PREP PHASE';

        this.enablePlacementUI();
        if (this.elements.readyButton) {
            this.elements.readyButton.textContent = 'Ready for Battle';
        }

        // Move camera to player's side of the board
        this.setupCameraForMySide();

        // (Re)render the shop from the latest state
        if (this._shopState) this._renderShop(this._shopState);
    }

    // Hide the prep panels when leaving placement phase
    onBattleStart() {
        // Hide the shop — not actionable mid-battle.
        if (this.elements.shopPanel)          this.elements.shopPanel.classList.add('hidden');
        if (this.elements.unlockedUnitsPanel) this.elements.unlockedUnitsPanel.classList.add('hidden');
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

        // Client-side mirror of ServerBattlePhaseSystem.onBattleEnd cleanup: drop
        // pending scheduled actions (delayed damage / queued projectile spawns)
        // and lingering status effects so this client's intermission sim can't
        // apply stale battle effects to entities that persist into next round.
        // In local mode the server-side handler already ran on this same
        // instance — repeating the clears is harmless.
        this.game.schedulingSystem?.clearAllActions?.();
        this.call.clearAllDamageEffects?.();
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

            // Initialize deterministic RNG for this battle (must match server seed).
            // The server includes its authoritative gameSeed in the broadcast gameState
            // (ServerGameRoom derives it from the room id) — use that rather than
            // re-deriving it here, so a server-side change to seed generation can't
            // silently desync every battle. Fall back to the legacy room-id derivation
            // only if the broadcast carried no seed.
            const gameSeed = data.gameState?.gameSeed ??
                GUTS.SeededRandom.hashString(this.game.clientNetworkManager?.roomId || 'default');
            this.game.state.gameSeed = gameSeed;
            const battleSeed = GUTS.SeededRandom.combineSeed(gameSeed, this.game.state.round || 1);
            this.game.rng.strand('battle').reseed(battleSeed);

            // Track battle start time for duration limiting
            this.battleStartTime = 0; // Will be set after resetCurrentTime
            this.isBattlePaused = false;

            // Unpause game to allow updates during battle
            this.game.state.isPaused = false;

            this.game.resetCurrentTime();
            this.battleStartTime = this.game.state.now || 0;

            // Seed the HUD countdown deadline. In local mode the server-side
            // startBattle() (which runs right after this handler) overwrites it
            // with the same value; online, this is the client's own copy and any
            // siege-window extension arrives via the BATTLE_DEADLINE broadcast.
            this.game.state.battleEndsAt = this.battleStartTime + this.battleDuration;

            // CRITICAL: Resync entities with server state BEFORE onBattleStart
            // This ensures all clients have identical state (including playerOrder.isHiding)
            // before behavior trees start processing
            if (data.entitySync) {
                this.call.resyncEntities( data);
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
        // Removes every tracked window/canvas/shop listener and stops the
        // raycast interval (see _track / _teardownListeners).
        this._teardownListeners();

        this.cachedValidation = null;
        this.cachedGridPos = null;

        this.undoStack = [];
    }

    onSceneUnload() {
        this.dispose();
    }
}
