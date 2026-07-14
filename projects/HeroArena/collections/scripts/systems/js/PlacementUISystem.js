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
        'tileToWorld',
        'clearAllDamageEffects',
        'clearAllEffects',
        'ui_toggleReadyForBattle',
        'ui_issueMoveOrder',
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
        'submitHeroMove',
        'getPlayerEntities',
        'submitBuyOffer',
        'submitRerollOffers',
        'submitBuyUnlockedUnit',
        'submitBuyUnitTech',
        'submitBuySquadLevel',
        'submitBuyTierUnlock',
        'submitBuyDeploySlot',
        'submitSetSquadFormation',
        'submitBuyUpgradeNode',
        'submitPickReinforcement',
        'submitSkipReinforcement',
        'submitCastCommanderSkill',
        'submitSellUnit',
        'submitGrantSingleAbility',
        'submitEquipSquadItem',
        'submitUnequipSquadItem',
        'submitTakeLoan',
        'submitBuyEliteRecruit',
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
        // When the grabbed hero is part of a multi-selection, every selected hero is
        // dragged together. Each entry is { id, offX, offZ } = the unit's offset from
        // the cursor at grab time, so relative spacing is preserved. null = single drag.
        this.dragUnits = null;

        // Right-click-drag formation state (prep phase). When units are selected,
        // right-click-dragging lines them up into a formation instead of panning.
        this.formationDrag = null;  // { start:{x,z}, units:[id], slots:[{id,x,z,rotationY}] }

        // True while we've disabled the free camera's right-drag mouse-look for the
        // duration of a formation-placement gesture (so the view doesn't swing).
        this._lookSuppressedByDrag = false;
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
        // getActivePlayerTeam() is resilient to the online startup race (it
        // falls back through cached team → onlinePlayers roster), so a null here
        // genuinely means there's no team context yet.
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
        this.elements.combatLog          = document.getElementById('combatLog');
        this.elements.combatLogToggle    = document.getElementById('combatLogToggle');
        this.elements.combatLogEntries   = document.getElementById('combatLogEntries');

        // Combat log is hidden by default; the 📜 button toggles it.
        if (this.elements.combatLogToggle) {
            this._track(this.elements.combatLogToggle, 'click', () => {
                const log = this.elements.combatLog;
                if (!log) return;
                log.classList.toggle('hidden');
                this.elements.combatLogToggle.classList.toggle('active', !log.classList.contains('hidden'));
            });
        }

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
        this.elements.stashPanel = document.getElementById('stashPanel');
        this.elements.stashBody = document.getElementById('stashBody');

        // Selection panel (icons + orders of the selected units, attack-move button)
        this.elements.selectionPanel = document.getElementById('selectionPanel');
        this.elements.selectionCards = document.getElementById('selectionCards');
        this.elements.attackMoveBtn  = document.getElementById('attackMoveBtn'); // legacy (orders removed)
        this.elements.clearOrderBtn  = document.getElementById('clearOrderBtn'); // legacy (orders removed)
        this.elements.formationBtn   = document.getElementById('formationBtn');
        this.elements.levelUpBtn     = document.getElementById('levelUpBtn');
        this.elements.sellUnitBtn    = document.getElementById('sellUnitBtn');
        this.elements.selectionHint  = document.getElementById('selectionHint');
        this.elements.selectionTitle = document.getElementById('selectionTitle');
        this.elements.selectionActions = document.getElementById('selectionActions');
        if (this.elements.attackMoveBtn) {
            this._track(this.elements.attackMoveBtn, 'click', () => this._toggleOrderTargetMode());
        }
        if (this.elements.clearOrderBtn) {
            this._track(this.elements.clearOrderBtn, 'click', () => this._clearSelectedOrders());
        }
        if (this.elements.formationBtn) {
            this._track(this.elements.formationBtn, 'click', () => this._cycleSquadFormation());
        }
        if (this.elements.levelUpBtn) {
            this._track(this.elements.levelUpBtn, 'click', () => this._levelUpSelectedUnits());
        }
        if (this.elements.sellUnitBtn) {
            this._track(this.elements.sellUnitBtn, 'click', () => this._sellSelectedUnits());
        }
        const techTreeClose = document.getElementById('techTreeCloseBtn');
        if (techTreeClose) this._track(techTreeClose, 'click', () => this._closeUpgradeTree());
        const techTreeOverlay = document.getElementById('techTreeOverlay');
        if (techTreeOverlay) {
            this._track(techTreeOverlay, 'click', (e) => {
                if (e.target === techTreeOverlay) this._closeUpgradeTree(); // backdrop click
            });
        }
        this._track(document, 'keydown', (e) => {
            if (e.key === 'Escape') this._closeUpgradeTree();
        });
        this._track(document, 'keydown', (e) => {
            if (e.key === 'Escape') this._cancelOrderTargetMode();
        });

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
        // Item equip: click an inventory item to arm targeting, then click an
        // equipment slot in the selection window to equip it there
        // (see _wireSelectionTechButton). Escape cancels.
        this._track(document, 'keydown', (e) => {
            if (e.key === 'Escape' && this._itemTargeting) this._exitItemTargetMode();
        });
        this._shopWired = true;
    }

    // Called by game.triggerEvent('onLeaderSelectStart', data)
    onLeaderSelectStart(data) {
        const overlay = document.getElementById('leaderSelectOverlay');
        const grid    = document.getElementById('leaderOptions');
        if (!overlay || !grid) return;

        grid.innerHTML = '';
        const myId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        const leaders = data?.draftsByPlayer?.[myId] || data?.options || [];
        const unitName = (id) => this.collections.units?.[id]?.title || id;
        leaders.forEach(leader => {
            const squads = leader.startingSquads || [];
            const squadLine = squads.length
                ? `<div class="arena-option-squads">🛡️ Starts with: ${squads.map(unitName).join(' + ')}</div>`
                : '';
            const card = document.createElement('div');
            card.className = 'arena-option-card';
            card.innerHTML = `
                <div class="arena-option-name">${leader.label}</div>
                <div class="arena-option-desc">${leader.bonus}</div>
                ${squadLine}
                <div class="arena-option-tag">❤️ ${leader.hp || ''} commander HP</div>`;
            card.addEventListener('click', () => {
                this.call.submitLeaderSelection(leader.id);
                overlay.classList.add('hidden');
            });
            grid.appendChild(card);
        });
        overlay.classList.remove('hidden');
    }

    // Round resolution feedback: how much commander damage each side took.
    onRoundResult(data) {
        this._hideSpeedButton();
        const myId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        const mine = (data?.report || []).find(r => r.playerId === myId);
        const theirs = (data?.report || []).find(r => r.playerId !== myId);
        if (!mine || !theirs) return;
        const parts = [];
        if (theirs.damage > 0) parts.push(`Your survivors dealt ${theirs.damage} commander damage`);
        if (mine.damage > 0) parts.push(`you took ${mine.damage}`);
        if (parts.length === 0) parts.push('Both armies fell — no commander damage');
        GUTS.NotificationSystem?.show?.(
            `Round ${data.round}: ${parts.join(', ')}.`,
            mine.damage > theirs.damage ? 'error' : 'success', 6000);
        this._playCommanderDamageOrbs(data);
    }

    // ─── Commander damage orbs (Mechabellum end-of-round cue) ─────────────────
    //
    // Every surviving squad member fires an orb from its battlefield position
    // at the victim's commander HP bar; the bar only drains as orbs land, so
    // you SEE which units hurt you and by how much. The server holds the real
    // subtraction until the volley finishes (AutobattlerRoundSystem's hold),
    // so the bar drains monotonically — it never dips and refills. _hpAnim
    // tracks landed damage per victim, floored at the round's final value.

    static ORB_CAP = 40;             // visual cap — damage beyond it lands with the last orbs
    static ORB_FLIGHT_MS = 850;
    static ORB_STAGGER_MS = 90;

    _playCommanderDamageOrbs(data) {
        const orbs = data?.orbs || [];
        const report = data?.report || [];
        if (!orbs.length) return;
        // One volley per round, ever — a duplicate ROUND_RESULT must not re-fire.
        if (this._orbsPlayedRound === data.round) return;
        this._orbsPlayedRound = data.round;
        const myId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        const teamToPlayer = {};
        for (const r of report) teamToPlayer[r.team] = r.playerId;

        // Per-victim drain animation: `landed` grows as orbs hit, `final` is
        // the round's end value from the report (the server applies the real
        // subtraction only after the volley, so bars never dip early).
        this._hpAnim = {};
        for (const r of report) {
            if (r.damage > 0) this._hpAnim[r.playerId] = { landed: 0, final: r.commanderHP };
        }
        clearTimeout(this._hpAnimTimer);
        this._hpAnimTimer = setTimeout(() => { this._hpAnim = null; }, 6000);

        // Cap the orb count; fold the overflow's damage into the kept orbs
        // (round-robin) so the bar still drains by the full amount.
        let shown = orbs;
        if (orbs.length > PlacementUISystem.ORB_CAP) {
            shown = orbs.slice(0, PlacementUISystem.ORB_CAP).map(o => ({ ...o }));
            orbs.slice(PlacementUISystem.ORB_CAP).forEach((o, i) => {
                shown[i % shown.length].damage += o.damage;
            });
        }

        const perVictimIndex = {};
        for (const orb of shown) {
            const victimId = teamToPlayer[orb.victimTeam];
            if (victimId == null) continue;
            const barEl = victimId === myId ? this.elements.playerHPBar : this.elements.opponentHPBar;
            if (!barEl) continue;
            const idx = perVictimIndex[victimId] = (perVictimIndex[victimId] ?? -1) + 1;
            this._launchOrb(orb, victimId, victimId === myId, barEl,
                idx * PlacementUISystem.ORB_STAGGER_MS);
        }
    }

    // Game over: the HUD tick stops once the game pauses, so a bar frozen
    // mid-orb-drain would show stale HP forever. Drop the drain animation,
    // remove in-flight orbs, and render the true final values one last time.
    onGameEnd() {
        this._hpAnim = null;
        clearTimeout(this._hpAnimTimer);
        document.querySelectorAll('.cmdr-orb').forEach(el => el.remove());
        this.updateHUD();
    }

    _launchOrb(orb, victimId, hitsMe, barEl, delayMs) {
        const start = this._worldToScreenPx(orb.x, orb.y || 0, orb.z)
            || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        const rect = (barEl.parentElement || barEl).getBoundingClientRect();
        const end = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        // Arced flight: control point above the midpoint, with lateral jitter.
        const ctrl = {
            x: (start.x + end.x) / 2 + (Math.random() - 0.5) * 160,
            y: Math.min(start.y, end.y) - 90 - Math.random() * 120
        };

        const size = Math.round(10 + Math.min(14, orb.damage * 2));
        const color = hitsMe ? '255,90,90' : '255,215,90';
        const el = document.createElement('div');
        el.className = 'cmdr-orb';
        el.style.cssText = `position:fixed; left:0; top:0; width:${size}px; height:${size}px;
            margin:${-size / 2}px 0 0 ${-size / 2}px; border-radius:50%; z-index:3000;
            pointer-events:none; opacity:0;
            background:radial-gradient(circle at 35% 35%, #fff, rgb(${color}) 55%, rgba(${color},0) 75%);
            box-shadow:0 0 ${size}px rgba(${color},0.9);`;
        document.body.appendChild(el);

        const flight = PlacementUISystem.ORB_FLIGHT_MS + Math.random() * 250;
        let startTime = null;
        const step = (now) => {
            if (!el.isConnected) return;   // removed externally (game ended)
            if (startTime == null) startTime = now + delayMs;
            const t = (now - startTime) / flight;
            if (t < 0) { requestAnimationFrame(step); return; }
            if (t >= 1) { el.remove(); this._orbLanded(victimId, orb.damage, barEl); return; }
            const u = 1 - t;
            el.style.opacity = t < 0.1 ? String(t / 0.1) : '1';
            el.style.transform = `translate(
                ${u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x}px,
                ${u * u * start.y + 2 * u * t * ctrl.y + t * t * end.y}px)`;
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    _orbLanded(victimId, damage, barEl) {
        const anim = this._hpAnim?.[victimId];
        if (anim) anim.landed += damage;
        // Impact flash on the HP bar.
        const section = barEl.parentElement || barEl;
        section.style.transition = 'none';
        section.style.filter = 'brightness(2)';
        requestAnimationFrame(() => {
            section.style.transition = 'filter 0.25s';
            section.style.filter = '';
        });
    }

    // World → viewport pixel coords (null if behind the camera).
    _worldToScreenPx(x, y, z) {
        const camera = this.call.getCamera?.();
        const canvas = this.canvas || this.game.canvas;
        if (!camera || !canvas) return null;
        const v = new THREE.Vector3(x, y, z).project(camera);
        if (v.z > 1) return null;
        const rect = canvas.getBoundingClientRect();
        return {
            x: rect.left + (v.x + 1) / 2 * rect.width,
            y: rect.top + (-v.y + 1) / 2 * rect.height
        };
    }

    // ─── Commander skills (battle actives) ───────────────────────────────────

    // Called from updateHUD each tick: show banked skill charges during battle.
    _refreshCommanderSkillBar() {
        const bar = document.getElementById('commanderSkillBar');
        if (!bar) return;

        const inBattle = this.game.state.phase === this.enums.gamePhase.battle;
        const myId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        let charges = [];
        for (const eid of this.game.getEntitiesWith('playerStats')) {
            const s = this.game.getComponent(eid, 'playerStats');
            if (s?.playerId === myId) { charges = s.skillCharges || []; break; }
        }

        if (!inBattle || charges.length === 0) {
            bar.classList.add('hidden');
            if (!inBattle) this._skillTargeting = null;
            return;
        }
        bar.classList.remove('hidden');

        const html = charges.map((skillId, i) => {
            const def = this.collections.commanderSkills?.[skillId] || {};
            const targeting = this._skillTargeting === skillId ? 'targeting' : '';
            return `<button class="commander-skill-btn ${targeting}" data-skill="${skillId}"
                title="${def.title || skillId} — ${def.description || ''} (click, then click the battlefield)">
                ${def.icon || '✴️'}</button>`;
        }).join('');
        if (bar._lastHtml !== html) {
            bar.innerHTML = html;
            bar._lastHtml = html;
        }

        if (!bar._wired) {
            bar._wired = true;
            bar.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-skill]');
                if (!btn) return;
                this._skillTargeting = this._skillTargeting === btn.dataset.skill ? null : btn.dataset.skill;
                bar._lastHtml = null; // re-render targeting outline
                document.body.style.cursor = this._skillTargeting ? 'crosshair' : 'default';
            });
            // Ground click casts while targeting (capture so battle clicks reach us)
            this._track(document, 'mousedown', (e) => {
                if (!this._skillTargeting || e.button !== 0) return;
                if (e.target !== this.canvas) return;
                const worldPos = this.getWorldPositionFromMouse(e.clientX, e.clientY, false);
                if (!worldPos) return;
                const skillId = this._skillTargeting;
                this._skillTargeting = null;
                document.body.style.cursor = 'default';
                bar._lastHtml = null;
                this.call.submitCastCommanderSkill(skillId, worldPos.x, worldPos.z, (res) => {
                    if (res?.success === false && res?.reason) {
                        GUTS.NotificationSystem?.show?.(`Skill failed: ${res.reason}`, 'error');
                    }
                });
                e.stopPropagation();
            });
            this._track(document, 'keydown', (e) => {
                if (e.key === 'Escape' && this._skillTargeting) {
                    this._skillTargeting = null;
                    document.body.style.cursor = 'default';
                    bar._lastHtml = null;
                }
            });
        }
    }

    // ─── Battle fast-forward (local games) ──────────────────────────────────────

    _ensureSpeedButton() {
        if (this._speedBtn || !this.game.state?.isLocalGame) return;
        const btn = document.createElement('button');
        btn.id = 'battleSpeedBtn';
        btn.style.cssText = `position:fixed; top:12px; right:200px; z-index:1500;
            padding:6px 16px; background:rgba(20,26,38,0.9); border:1px solid #d8b45a;
            color:#e8d9a0; border-radius:6px; cursor:pointer; font-size:1rem; display:none;`;
        btn.addEventListener('click', () => {
            const cur = this.game.state.battleSpeed || 1;
            this.game.state.battleSpeed = cur >= 4 ? 1 : cur * 2;
            this._updateSpeedButton();
        });
        document.body.appendChild(btn);
        this._speedBtn = btn;
        this._updateSpeedButton();
    }

    _updateSpeedButton() {
        if (!this._speedBtn) return;
        this._speedBtn.textContent = `⏩ ${this.game.state.battleSpeed || 1}×`;
    }

    _showSpeedButton() {
        this._ensureSpeedButton();
        if (this._speedBtn) this._speedBtn.style.display = 'block';
        this._updateSpeedButton();
    }

    _hideSpeedButton() {
        // Speed always resets at the end of the round.
        this.game.state.battleSpeed = 1;
        if (this._speedBtn) this._speedBtn.style.display = 'none';
    }

    // Called by game.triggerEvent('onReinforcementStart', data) at each prep start.
    // Reuses the (otherwise retired) hero-select overlay as the 1-of-3 card pick.
    onReinforcementStart(data) {
        const myId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        if (data?.playerId !== myId) return;

        const overlay  = document.getElementById('heroSelectOverlay');
        const grid     = document.getElementById('heroOptions');
        const title    = document.getElementById('heroSelectTitle');
        const subtitle = document.getElementById('heroSelectSubtitle');
        if (!overlay || !grid) return;

        const skipGold = GUTS.ArmyShopSystem?.SKIP_REINFORCEMENT_GOLD ?? 50;
        if (title)    title.textContent = `Reinforcements — Round ${this.game.state.round || 1}`;
        if (subtitle) subtitle.textContent = `Choose one — or skip for +${skipGold} supply`;

        grid.innerHTML = '';
        const gold = this._shopState?.gold ?? 0;
        (data.options || []).forEach((option, index) => {
            const cost = option.cost || 0;
            const affordable = cost === 0 || gold >= cost;
            const card = document.createElement('div');
            card.className = `arena-option-card ${affordable ? '' : 'arena-option-poor'}`;
            card.innerHTML = `
                <div class="arena-option-name">${this._itemIcon(option, 28)} ${option.title}</div>
                <div class="arena-option-desc">${option.description || ''}</div>
                <div class="arena-option-tag">${cost > 0 ? `${cost}g` : 'Free'}</div>`;
            card.addEventListener('click', () => {
                if (!affordable) { GUTS.NotificationSystem?.show?.('Not enough supply', 'error'); return; }
                this.call.submitPickReinforcement(index, (res) => {
                    if (res?.success === false && res?.reason === 'insufficient_gold') {
                        GUTS.NotificationSystem?.show?.('Not enough supply', 'error');
                    }
                    // Item cards drop into the commander inventory — equip later.
                    this._renderShop(res?.state || res);
                });
                overlay.classList.add('hidden');
            });
            grid.appendChild(card);
        });
        // Mechabellum: decline the card for extra supply.
        const skip = document.createElement('div');
        skip.className = 'arena-option-card arena-option-skip';
        skip.innerHTML = `
            <div class="arena-option-name">⏭ Skip</div>
            <div class="arena-option-desc">Take +${skipGold} supply instead</div>`;
        skip.addEventListener('click', () => {
            this.call.submitSkipReinforcement((res) => this._renderShop(res?.state || res));
            overlay.classList.add('hidden');
        });
        grid.appendChild(skip);
        overlay.classList.remove('hidden');
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
        this._refreshCommanderSkillBar();
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

        // The HUD health bars show each side's COMMANDER HP — surviving enemy
        // units chip it down after every battle; 0 loses the match.
        const FALLBACK_HP_MAX = this.game.autobattlerRoundSystem?.constructor?.COMMANDER_HP || 1000;
        // Max HP is per-player (leaders bring different commander HP).
        const maxHP = (stats) => stats.commanderMaxHP || FALLBACK_HP_MAX;
        // End-of-round orbs: the server holds the real subtraction until the
        // volley lands, so during the volley the bar is commanderHP (still
        // pre-damage) minus what has landed so far — floored at the round's
        // final value so it can only ever go DOWN (_playCommanderDamageOrbs).
        const shownHP = (stats) => {
            const hp = stats.commanderHP ?? maxHP(stats);
            const anim = this._hpAnim?.[stats.playerId];
            return anim ? Math.max(anim.final, hp - anim.landed) : hp;
        };
        if (myStats) {
            this._renderTownHallBar(
                { current: shownHP(myStats), max: maxHP(myStats) },
                this.elements.playerHPBar, this.elements.playerHPValue);
        }
        if (opStats) {
            this._renderTownHallBar(
                { current: shownHP(opStats), max: maxHP(opStats) },
                this.elements.opponentHPBar, this.elements.opponentHPValue);
        }

        if (this.elements.roundDisplay) {
            this.elements.roundDisplay.textContent = `Round ${this.game.state.round ?? 1}`;
        }

        // Battle countdown — counts down to the round deadline (incl. the siege
        // window extension, which the server publishes via state/broadcast).
        if (this.elements.battleTimer) {
            const inBattle = this.game.state.phase === this.enums.gamePhase.battle
                && !this.game.state.battleIntermission;
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

        // Attack-move targeting mode: this click sets the destination for the
        // selected units' battle order.
        if (this._orderTargetMode) {
            this._confirmAttackMoveTarget(worldPos);
            return;
        }

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
            // Deployment is permanent: units that have fought hold their positions.
            if (this._isDeploymentLocked(heroId)) {
                GUTS.NotificationSystem?.show?.('Deployment locked — veterans hold their positions', 'info');
                return;
            }
            this.draggedHeroId = heroId;
        }

        const t = this.game.getComponent(heroId, 'transform');
        this.dragOffset.x = (t?.position?.x ?? worldPos.x) - worldPos.x;
        this.dragOffset.z = (t?.position?.z ?? worldPos.z) - worldPos.z;
        this.dragMoved = false;

        // Units always move as squads: grabbing any member drags the whole squad,
        // and a multi-selection drags every selected squad, formations intact.
        // Buildings always drag singly (they have their own move rules).
        this.dragUnits = null;
        if (this.draggedHeroId != null) {
            const group = this._formationUnits();  // selected, alive, own-team, movable (unlocked) heroes
            const seeds = (group.length > 1 && group.includes(heroId)) ? group : [heroId];
            const all = new Set();
            for (const id of seeds) {
                for (const mate of this._squadMembers(id)) all.add(mate);
            }
            if (all.size > 0) {
                this.dragUnits = [...all].map((id) => {
                    const p = this.game.getComponent(id, 'transform')?.position;
                    return {
                        id,
                        offX: (p?.x ?? worldPos.x) - worldPos.x,
                        offZ: (p?.z ?? worldPos.z) - worldPos.z
                    };
                });
            }
        }

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

        // Mechabellum grid: snap the DRAGGED unit's landing cell (24.5u half-
        // tiles); the group shifts by the same adjustment so formations hold.
        const CELL = 24.5;
        const rawX = worldPos.x + this.dragOffset.x;
        const rawZ = worldPos.z + this.dragOffset.z;
        const snapAdjX = (Math.floor(rawX / CELL) * CELL + CELL / 2) - rawX;
        const snapAdjZ = (Math.floor(rawZ / CELL) * CELL + CELL / 2) - rawZ;

        // Optimistic local update so the entity (or group) follows the cursor immediately
        if (this.dragUnits) {
            for (const u of this.dragUnits) {
                this.game.placementSystem?.moveHero(u.id,
                    worldPos.x + u.offX + snapAdjX, worldPos.z + u.offZ + snapAdjZ);
            }
        } else {
            this.game.placementSystem?.moveHero(draggedId, rawX + snapAdjX, rawZ + snapAdjZ);
        }
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
        const dragUnits = this.dragUnits;
        this.draggedHeroId = null;
        this.draggedBuildingId = null;
        this.draggedBuildingPlacementId = null;
        this.dragUnits = null;
        this.dragMoved = false;
        document.body.style.cursor = 'default';

        if (!wasMoved) return;

        try {
            const worldPos = this.getWorldPositionFromMouse(event.clientX, event.clientY, false);
            if (worldPos) {
                if (isBuilding) {
                    this.call.submitMoveBuilding(placementId, worldPos.x + offX, worldPos.z + offZ);
                } else if (dragUnits) {
                    // Commit the authoritative move for every dragged unit.
                    for (const u of dragUnits) {
                        this.call.submitHeroMove(u.id, worldPos.x + u.offX, worldPos.z + u.offZ);
                    }
                } else {
                    this.call.submitHeroMove(draggedId, worldPos.x + offX, worldPos.z + offZ);
                }
            }
        } catch (err) {
            console.warn('[PlacementUISystem] drag move submit failed:', err);
        }
    }

    // ==================== RIGHT-CLICK-DRAG FORMATION (PREP PHASE) ====================
    // With units selected, right-click-dragging arranges them into a rectangular
    // formation: the drag line is the formation's front row, its length sets the
    // width (more length = wider/fewer rows, down to a single row), and a short
    // drag clamps to a square. Units face perpendicular to the line, toward the enemy.

    // Selected, alive, own-team, non-building hero/army units (the movable ones).
    // Excludes deployment-locked veterans — only units bought this prep can move.
    _formationUnits() {
        if (this.game.state.phase !== this.enums.gamePhase.placement) return [];
        const ids = this.game.selectedUnitSystem?.getSelectedUnits?.() || [];
        const myTeam = this.call.getActivePlayerTeam?.();
        return ids.filter(id => {
            if (this.game.entityAlive?.[id] !== 1) return false;
            const team = this.game.getComponent(id, 'team');
            if (!team || team.team !== myTeam) return false;
            if (this.game.getComponent(id, 'buildingOwner')) return false;
            if (!this.game.getComponent(id, 'heroRosterInfo')) return false;
            return !this._isDeploymentLocked(id);
        });
    }

    // All live entities sharing this entity's roster entry (its squadmates,
    // itself included). Component-scan, so it works on online clients too.
    _squadMembers(entityId) {
        const info = this.game.getComponent(entityId, 'heroRosterInfo');
        if (!info) return [entityId];
        const out = [];
        for (const id of (this.game.getEntitiesWith('heroRosterInfo') || [])) {
            if (this.game.entityAlive?.[id] !== 1) continue;
            const i = this.game.getComponent(id, 'heroRosterInfo');
            if (i?.playerId === info.playerId && i.rosterIndex === info.rosterIndex) out.push(id);
        }
        return out.length ? out : [entityId];
    }

    // Deployment is permanent once a unit has fought a battle (its roster entry
    // carries lastPosition). Component-based check first — heroRosterInfo and
    // playerStats.heroRoster are replicated, so it works on online clients where
    // HeroRosterSystem's server-side entity map is empty. Server remains
    // authoritative regardless (handleHeroMoved rejects locked moves).
    _isDeploymentLocked(entityId) {
        const info = this.game.getComponent(entityId, 'heroRosterInfo');
        if (info) {
            for (const eid of (this.call.getPlayerEntities?.() || [])) {
                const stats = this.game.getComponent(eid, 'playerStats');
                if (stats?.playerId === info.playerId) {
                    return !!stats.heroRoster?.[info.rosterIndex]?.lastPosition;
                }
            }
        }
        return !!this.game.heroRosterSystem?.isUnitLocked?.(entityId);
    }

    // Disable/restore the free-fly camera's right-drag mouse-look. While units are
    // selected, a right-drag is a placement gesture, so we don't want it to also swing
    // the perspective camera. No-op in orthographic mode (it has no mouse-look).
    _setCameraLookEnabled(enabled) {
        this.game.systemsByName?.get?.('FreeCameraSystem')?.setLookEnabled?.(enabled);
    }

    _onFormationDragDown(event) {
        if (event.button !== 2) return;
        const units = this._formationUnits();
        if (units.length === 0) return;  // nothing selected → no formation drag (camera look stays active)

        // Units are selected → claim this right-drag for placement and stop the camera
        // from looking around. Suppress before the worldPos check (and restore on mouseup
        // regardless) so a gesture that starts off-ground can't leave look disabled.
        if (!this._lookSuppressedByDrag) {
            this._setCameraLookEnabled(false);
            this._lookSuppressedByDrag = true;
        }

        const worldPos = this.getWorldPositionFromMouse(event.clientX, event.clientY, false);
        if (!worldPos) return;

        this.formationDrag = { start: { x: worldPos.x, z: worldPos.z }, units, slots: [] };
        // Suppress box selection while we drag the formation out
        this.game.selectedUnitSystem?.cancelBoxSelection?.();
        document.body.style.cursor = 'crosshair';
        event.preventDefault();
    }

    _onFormationDragMove(event) {
        if (!this.formationDrag) return;
        this.game.selectedUnitSystem?.cancelBoxSelection?.();

        const worldPos = this.getWorldPositionFromMouse(event.clientX, event.clientY, false);
        if (!worldPos) return;

        const slots = this._computeSquadFormationPositions(this.formationDrag.start, worldPos, this.formationDrag.units);
        this.formationDrag.slots = slots;
        // Optimistic local preview: move + face each unit as the line is dragged.
        for (const s of slots) {
            this.game.placementSystem?.moveHero(s.id, s.x, s.z, s.rotationY);
        }
    }

    _onFormationDragUp(event) {
        // Always restore camera mouse-look when the right button is released, even if
        // no formation drag actually started (e.g. the gesture began off-ground).
        if (this._lookSuppressedByDrag) {
            this._setCameraLookEnabled(true);
            this._lookSuppressedByDrag = false;
        }

        if (!this.formationDrag) return;
        const slots = this.formationDrag.slots;
        this.formationDrag = null;
        document.body.style.cursor = 'default';
        if (!slots || slots.length === 0) return;

        // Commit the authoritative positions + facing to the server (one per unit).
        for (const s of slots) {
            try {
                this.call.submitHeroMove(s.id, s.x, s.z, s.rotationY);
            } catch (err) {
                console.warn('[PlacementUISystem] formation move submit failed:', err);
            }
        }
    }

    // Squad-aware formation: group the selected entities by roster entry, lay the
    // SQUADS out along the drag line, then expand each squad slot into member
    // positions using its own grid — squads never break apart.
    _computeSquadFormationPositions(start, end, units) {
        const groups = new Map();   // "player:index" → [entityIds]
        for (const id of units) {
            const info = this.game.getComponent(id, 'heroRosterInfo');
            const key = info ? `${info.playerId}:${info.rosterIndex}` : `solo:${id}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(id);
        }
        const reps = [...groups.values()].map(members => members[0]);
        const squadSlots = this._computeFormationPositions(start, end, reps);

        // Orient member grids to the drag line: width runs along the line
        // (shoulder to shoulder), depth runs perpendicular.
        const ldx = end.x - start.x, ldz = end.z - start.z;
        const llen = Math.hypot(ldx, ldz);
        const basis = llen > 8
            ? { across: { x: ldx / llen, z: ldz / llen },
                forward: { x: -ldz / llen, z: ldx / llen } }
            : null;

        const slots = [];
        for (const slot of squadSlots) {
            const members = this._squadMembers(slot.id).filter(id => units.includes(id));
            const info = this.game.getComponent(slot.id, 'heroRosterInfo');
            const entry = info ? this._rosterEntryForInfo(info) : null;
            const def = this.game.getUnitTypeDef(this.game.getComponent(slot.id, 'unitType'));
            const w = entry?.formation?.w || def?.squadWidth || 1;
            const h = entry?.formation?.h || def?.squadHeight || 1;
            members.forEach((id, i) => {
                const off = GUTS.HeroRosterSystem?.memberOffset
                    ? GUTS.HeroRosterSystem.memberOffset(i, w, h, basis)
                    : { x: (i % 2) * 30, z: Math.floor(i / 2) * 30 };
                slots.push({ id, x: slot.x + off.x, z: slot.z + off.z, rotationY: slot.rotationY });
            });
        }
        return slots;
    }

    // Build target slots for the selected units given the drag's start/end world points.
    _computeFormationPositions(start, end, units) {
        const N = units.length;
        if (N === 0) return [];

        const SPACING = 48;       // gap between units along a row (matches spawn STEP)
        const ROW_SPACING = 48;   // gap between rows

        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const width = Math.hypot(dx, dz);

        // Row direction (along the dragged line). Default to the X axis for a zero-length drag.
        const u = width > 1e-3 ? { x: dx / width, z: dz / width } : { x: 1, z: 0 };

        // Columns scale with drag length but never below a square, never above a single row.
        const minCols = Math.ceil(Math.sqrt(N));
        let cols = Math.round(width / SPACING) + 1;
        cols = Math.max(minCols, Math.min(N, cols));
        const rows = Math.ceil(N / cols);

        // Facing normal: perpendicular to the line, pointing toward the enemy.
        const center = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
        const n = this._enemyFacingNormal(u, center);
        const rotationY = Math.atan2(n.z, n.x);

        // Front row sits on the dragged line; subsequent rows recede toward our own side (-n).
        const slots = [];
        for (let i = 0; i < N; i++) {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const unitsInRow = (row < rows - 1) ? cols : (N - cols * (rows - 1));
            const colOffset = (col - (unitsInRow - 1) / 2) * SPACING;
            const rowOffset = -row * ROW_SPACING;
            slots.push({
                id: units[i],
                x: center.x + u.x * colOffset + n.x * rowOffset,
                z: center.z + u.z * colOffset + n.z * rowOffset,
                rotationY
            });
        }
        return slots;
    }

    // Unit normal of `u` (one of the two perpendiculars) pointing toward the enemy side.
    _enemyFacingNormal(u, center) {
        const n = { x: -u.z, z: u.x };  // rotate row direction +90°
        const myTeam = this.call.getActivePlayerTeam?.();
        const locs = this.game.placementSystem?.getStartingLocationsFromLevel?.();
        if (locs && myTeam != null) {
            const enemyTeam = Object.keys(locs).map(Number).find(t => t !== myTeam);
            const enemyTile = enemyTeam != null ? locs[enemyTeam] : null;
            const enemyWorld = enemyTile ? this.call.tileToWorld?.(enemyTile.x, enemyTile.z) : null;
            if (enemyWorld) {
                const toEnemy = { x: enemyWorld.x - center.x, z: enemyWorld.z - center.z };
                if (n.x * toEnemy.x + n.z * toEnemy.z < 0) return { x: -n.x, z: -n.z };
            }
        }
        return n;
    }

    // ==================== SELECTION PANEL + ATTACK-MOVE ORDERS ====================
    // SelectedUnitSystem owns click/box selection and fires these events. The
    // panel shows the selected units' icons + current orders; the Attack Move
    // button arms a targeting mode where the next terrain left-click issues the
    // squad's single battle order (move there, engaging enemies seen en route).

    onMultipleUnitsSelected() {
        this._refreshSelectionPanel();
        // Refresh the destination markers immediately so they track the new
        // selection (the update() poll is throttled / may not run during prep).
        this._updateOrderViz();
    }

    onDeSelectAll() {
        this._cancelOrderTargetMode();
        this._refreshSelectionPanel();
        // No units selected -> no order markers.
        this._clearOrderViz();
    }

    // Selected, living, own-team, non-building units with a squad placement.
    _selectedOwnUnits() {
        const ids = this.game.selectedUnitSystem?.getSelectedUnits?.() || [];
        const myTeam = this.call.getActivePlayerTeam?.();
        return ids.filter(id => {
            if (this.game.entityAlive?.[id] !== 1) return false;
            const team = this.game.getComponent(id, 'team');
            if (!team || team.team !== myTeam) return false;
            if (this.game.getComponent(id, 'buildingOwner')) return false;
            return !!this.game.getComponent(id, 'placement');
        });
    }

    _unitOrderInfo(id) {
        const po = this.game.getComponent(id, 'playerOrder');
        if (po?.enabled && po.isMoveOrder && !po.completed) {
            return { type: 'attackMove', target: { x: po.targetPositionX, z: po.targetPositionZ } };
        }
        return { type: 'hold' };
    }

    // A single selected, living, own-team building. Identified by its collection /
    // unitType def so it works even if the buildingOwner component didn't replicate
    // (online). Returns { entityId, buildingId, hasTree, title } or null.
    _selectedOwnBuilding() {
        const ids = this.game.selectedUnitSystem?.getSelectedUnits?.() || [];
        if (ids.length !== 1) return null;
        const id = ids[0];
        if (this.game.entityAlive?.[id] !== 1) return null;

        const owner = this.game.getComponent(id, 'buildingOwner');
        const def = this.game.getUnitTypeDef?.(this.game.getComponent(id, 'unitType'));
        const isBuilding = !!owner
            || def?.collection === 'buildings'
            || !!this.game.getComponent(id, 'building');
        if (!isBuilding) return null;

        // Own team (skip the check if we can't resolve a team — better to show than hide).
        const myTeam = this.call.getActivePlayerTeam?.();
        const team = this.game.getComponent(id, 'team');
        if (myTeam != null && team && team.team !== myTeam) return null;

        let buildingId = owner?.buildingId || def?.id || null;
        // Town Hall tiers (townHall→keep→castle) all share the Town Hall economy tree.
        if (buildingId && (def?.category === 'townhall'
            || buildingId === 'townHall' || buildingId === 'keep' || buildingId === 'castle')) {
            buildingId = 'townHall';
        }
        const tree = buildingId ? this._deckTree(buildingId) : null;
        return {
            entityId: id,
            buildingId,
            hasTree: !!tree,
            title: tree?.title || def?.title || 'Building'
        };
    }

    _refreshSelectionPanel() {
        const panel = this.elements.selectionPanel;
        if (!panel) return;

        // Building mode: selecting an owned building shows its upgrade tree
        // inline in the bottom-left stack (no modal, no drill-in button); the
        // squad selection panel stays hidden.
        const building = this._selectedOwnBuilding();
        if (building) {
            this._selectedBuildingId = building.hasTree ? building.buildingId : null;
            panel.classList.add('hidden');
            this._renderBuildingTreePanel(building);
            return;
        }

        // Unit mode.
        this._selectedBuildingId = null;
        this._hideBuildingTreePanel();
        this.elements.selectionActions?.classList.remove('hidden');
        if (this.elements.selectionTitle) this.elements.selectionTitle.textContent = 'Selection';

        const units = this._selectedOwnUnits();
        if (units.length === 0) {
            panel.classList.add('hidden');
            return;
        }
        panel.classList.remove('hidden');

        this._wireSelectionTechButton();
        this.elements.selectionCards.innerHTML = this._renderSquadDetail(units);

        // Formation button: shows the first selected multi-member squad's current
        // shape; hidden when nothing selected has squadmates.
        if (this.elements.formationBtn) {
            const squads = this._selectedSquads().filter(sq => sq.members.length > 1 && !sq.locked);
            if (squads.length === 0) {
                this.elements.formationBtn.style.display = 'none';
            } else {
                this.elements.formationBtn.style.display = '';
                const f = squads[0].formation;
                const preset = PlacementUISystem.formationPresets(squads[0].members.length)
                    .find(p => p.w === f.w && p.h === f.h);
                this.elements.formationBtn.textContent =
                    `⬦ ${preset?.name || 'Formation'} ${f.w}×${f.h}`;
                this.elements.formationBtn.disabled =
                    this.game.state.phase !== this.enums.gamePhase.placement;
            }
        }

        // Level-ups and selling only during prep. The Level Up button shows the
        // total cost for the current selection (half price for squads whose
        // combat-XP bar is full — flagged with ★).
        const notPrep = this.game.state.phase !== this.enums.gamePhase.placement;
        if (this.elements.levelUpBtn) {
            const { cost, ready, allMaxed } = this._levelUpCostForSelection(units);
            this.elements.levelUpBtn.textContent = allMaxed
                ? '⬆ Max Level'
                : ready ? `⬆ Promote (${cost}g ★)` : '⬆ Promote (XP not full)';
            this.elements.levelUpBtn.disabled = notPrep || allMaxed || !ready ||
                cost <= 0 || (this._shopState?.gold ?? 0) < cost;
        }
        if (this.elements.sellUnitBtn) this.elements.sellUnitBtn.disabled = notPrep;
    }

    // Full squad detail: portrait, level + XP bar, live stats (tech/level
    // bonuses included, read from the live entity), tags, owned techs.
    _renderSquadDetail(unitIds) {
        const squads = this._selectedSquads();
        if (!squads.length) return '';
        const hx = this.game.heroExperienceSystem;
        const s = this._shopState || {};

        const one = (sq) => {
            const lead = sq.members[0];
            const unitTypeComp = this.game.getComponent(lead, 'unitType');
            const def = this.game.getUnitTypeDef(unitTypeComp) || {};
            const unitId = def.id || '';
            const info = this.game.getComponent(lead, 'heroRosterInfo');
            const entry = this._rosterEntryForInfo(info);
            const level = info?.level || 1;
            const combat = this.game.getComponent(lead, 'combat');
            const health = this.game.getComponent(lead, 'health');
            const alive = sq.members.filter(id => this.game.entityAlive?.[id] === 1).length;

            const xp = entry?.xp || 0;
            const xpMax = hx?.xpToNextLevel?.(entry) || 1;
            const xpPct = Math.min(100, Math.round(xp / xpMax * 100));
            const ready = entry && hx?.isLevelReady?.(entry);
            const maxLevel = hx?.constructor?.MAX_LEVEL || 9;

            const tags = this._unitTags(def, unitId);
            const techsAll = this._deckUnitTechs(unitId);
            const owned = new Set(
                (s.unitTechs?.[unitId]) || (this._myStats()?.unitTechs?.[unitId]) || []);
            const ownedTechs = techsAll.filter(t => owned.has(t.id));

            const dps = Math.round((combat?.damage || 0) * (combat?.attackSpeed || 1) * alive);
            const stats = [
                ['HP', `${Math.round(health?.current ?? 0)}/${Math.round(health?.max ?? def.hp ?? 0)}`],
                ['Damage', `${Math.round(combat?.damage ?? def.damage ?? 0)} @ ${(combat?.attackSpeed ?? def.attackSpeed ?? 1).toFixed(1)}/s`],
                ['Squad DPS', dps],
                ['Range', (combat?.range ?? def.range ?? 1) > 30 ? Math.round(combat.range) : 'Melee'],
                ['Armor', Math.round(combat?.armor ?? def.armor ?? 0)],
                ['Members', `${alive}/${sq.members.length}`]
            ];

            return `<div class="sq-detail">
                <div class="sq-head">
                    ${this._iconImg(def, 'sq-img')}
                    <div class="sq-title">
                        <div class="sq-name">${this._unitModPrefix(unitId, s)}${def.title || unitId} <span class="sq-level">Lv ${level}${level >= maxLevel ? ' MAX' : ''}</span></div>
                        <div class="sq-tags">${tags.map(t => `<span class="ut-tag">${t}</span>`).join('')}</div>
                        ${(GUTS.ArmyShopSystem.unitTier(unitId) ?? 0) < 3 ? this._equipmentGrid(entry, info?.rosterIndex) : ''}
                    </div>
                </div>
                ${level < maxLevel ? `<div class="sq-xp" title="Combat XP — full bar allows promotion">
                    <div class="sq-xp-fill ${ready ? 'sq-xp-ready' : ''}" style="width:${xpPct}%"></div>
                    <span class="sq-xp-label">${ready ? '★ PROMOTION READY' : `XP ${xpPct}%`}</span>
                </div>` : ''}
                <div class="sq-stats">${stats.map(([k, v]) =>
                    `<span class="ut-k">${k}</span><span class="ut-v">${v}</span>`).join('')}</div>
                ${techsAll.length ? `<div class="sq-techlist">
                    <div class="sq-techlist-head">⚙ Technologies ${ownedTechs.length}/${techsAll.length}</div>
                    ${techsAll.map(t => {
                        const isOwned = owned.has(t.id);
                        const escalation = GUTS.ArmyShopSystem.techEscalation(owned.size);
                        const discount = s.techDiscount || 0;
                        const price = Math.max(1, Math.ceil((GUTS.ArmyShopSystem.techBaseCost(t.cost) + escalation) * (1 - discount)));
                        const affordable = (s.gold ?? 0) >= price;
                        const cls = isOwned ? 'owned' : affordable ? 'buyable' : 'poor';
                        const action = isOwned
                            ? '<span class="sq-tech-owned">✔ OWNED</span>'
                            : affordable
                                ? `<button class="sq-tech-buy" data-buy-tech="${t.id}" data-tech-unit-id="${unitId}">BUY ${price}g</button>`
                                : `<span class="sq-tech-cant">${price}g</span>`;
                        const ab = t.unlockAbility ? this._abilityBlurb(t.unlockAbility) : null;
                        return `<div class="sq-techrow ${cls}" title="${t.description || ''}${ab ? ` — ${ab.name}: ${ab.text}` : ''}">
                            <span class="sq-techrow-name">${t.title}</span>
                            <span class="sq-techrow-desc">${t.description || ''}</span>
                            ${action}
                            ${ab ? `<div class="sq-techrow-ability">⚡ ${ab.name} — ${ab.text}</div>` : ''}
                        </div>`;
                    }).join('')}
                </div>` : ''}
            </div>`;
        };

        if (squads.length === 1) return one(squads[0]);
        return `<div class="sq-multi">${squads.length} squads selected</div>` + one(squads[0]);
    }

    // One-line ability summary for tech rows, so "Unlocks X" techs explain
    // what X actually does: the ability's authored description + key numbers.
    _abilityBlurb(abilityId) {
        const a = this.collections.abilities?.[abilityId];
        if (!a) return null;
        const bits = [];
        if (a.damage) bits.push(`${a.damage} dmg`);
        if (a.drainPerSecond) bits.push(`${a.drainPerSecond}/s drain`);
        if (a.stunDuration) bits.push(`${a.stunDuration}s stun`);
        if (a.duration) bits.push(`${a.duration}s duration`);
        if (a.cooldown) bits.push(`${a.cooldown}s cooldown`);
        if (a.range) bits.push(`range ${a.range}`);
        return {
            name: a.name || abilityId.replace(/Ability$/, ''),
            text: `${a.description || ''}${bits.length ? ` (${bits.join(' · ')})` : ''}`
        };
    }

    _wireSelectionTechButton() {
        if (this._selTechWired || !this.elements.selectionCards) return;
        this._selTechWired = true;
        this.elements.selectionCards.addEventListener('click', (e) => {
            // Armed with a stash item → click a valid (lit) equipment slot equips it here.
            if (this._itemTargeting) {
                const cell = e.target.closest('.eq-slot.eq-valid');
                const grid = cell?.closest('[data-equip-roster]');
                if (grid) {
                    const ri = parseInt(grid.dataset.equipRoster, 10);
                    if (Number.isNaN(ri)) return;
                    const itemId = this._itemTargeting;
                    this._exitItemTargetMode();
                    this.call.submitEquipSquadItem(itemId, ri, (res) => {
                        if (res?.success === false && res?.reason) {
                            GUTS.NotificationSystem?.show?.(`Cannot equip: ${res.reason}`, 'error');
                        }
                        this._renderShop(res?.state || res);
                        this._refreshSelectionPanel();
                    });
                    return;
                }
            }
            // Click an equipped item chip → unequip it back to the commander inventory.
            const chip = e.target.closest('[data-unequip-item]');
            if (chip) {
                const ri = parseInt(chip.dataset.unequipRoster, 10);
                if (Number.isNaN(ri)) return;
                this.call.submitUnequipSquadItem(ri, chip.dataset.unequipItem, (res) => {
                    this._renderShop(res?.state || res);
                    this._refreshSelectionPanel();
                });
                return;
            }
            const row = e.target.closest('button[data-buy-tech]');
            if (!row) return;
            this.call.submitBuyUnitTech(row.dataset.techUnitId, row.dataset.buyTech, (res) => {
                if (res?.success === false && res?.reason) {
                    GUTS.NotificationSystem?.show?.(`Cannot buy: ${res.reason}`, 'error');
                }
                this._renderShop(res?.state || res);
                this._refreshSelectionPanel();
            });
        });
    }

    _myStats() {
        const myId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        for (const eid of (this.call.getPlayerEntities?.() || [])) {
            const st = this.game.getComponent(eid, 'playerStats');
            if (st?.playerId === myId) return st;
        }
        return null;
    }

    // Deck-aware effective tech list / building tree for the local player. Routes
    // through ArmyShopSystem's deck helpers (local skirmish/campaign share the game
    // instance); falls back to the raw global collections if unavailable.
    _deckUnitTechs(unitId) {
        const shop = this.game.armyShopSystem, st = this._myStats();
        if (shop?._unitTechsFor && st) return shop._unitTechsFor(st, unitId);
        return (this.collections.unitTechs?.[unitId]?.abilityPool || [])
            .map(id => this.collections.abilityPool?.[id]).filter(Boolean)
            .map(p => { const { requirements, innate, ...t } = p; return { ...t, id: p.id }; });
    }
    _deckTree(buildingId) {
        const shop = this.game.armyShopSystem, st = this._myStats();
        if (shop?._treeFor && st) return shop._treeFor(st, buildingId);
        return this.collections?.upgradeTrees?.[buildingId] || null;
    }

    // Total cost to level every selected own squad once (client-side estimate
    // using the same rules as the server: cost × level, halved when the squad's
    // XP bar is full, hard cap at max level).
    _levelUpCostForSelection(unitIds) {
        const hx = this.game.heroExperienceSystem;
        const maxLevel = hx?.constructor?.MAX_LEVEL || 9;
        let total = 0, ready = false, leveable = 0;
        const seenEntries = new Set();
        for (const id of unitIds) {
            const info = this.game.getComponent(id, 'heroRosterInfo');
            const def = this.game.getUnitTypeDef(this.game.getComponent(id, 'unitType'));
            if (!info || !def) continue;
            // A squad is N entities sharing one roster entry — price it once
            const entryKey = `${info.playerId}:${info.rosterIndex}`;
            if (seenEntries.has(entryKey)) continue;
            seenEntries.add(entryKey);
            const entry = this._rosterEntryForInfo(info);
            const level = info.level || 1;
            if (level >= maxLevel) continue;
            leveable++;
            // Mechabellum: only squads with a FULL XP bar can be promoted.
            const isReady = entry && hx?.isLevelReady?.(entry);
            if (!isReady) continue;
            ready = true;
            // Mechabellum: flat 50% of the unit's base (tiered) recruitment price —
            // must match ArmyShopSystem.squadLevelCost on the server.
            const base = GUTS.ArmyShopSystem.unitPrice(def.id, def);
            total += Math.max(1, Math.ceil(base / 2));
        }
        return { cost: total, ready, allMaxed: unitIds.length > 0 && leveable === 0 };
    }

    // Selected squads (deduped by roster entry): members, current formation, lock.
    _selectedSquads() {
        const groups = new Map();
        for (const id of this._selectedOwnUnits()) {
            const info = this.game.getComponent(id, 'heroRosterInfo');
            if (!info) continue;
            const key = `${info.playerId}:${info.rosterIndex}`;
            if (!groups.has(key)) groups.set(key, { info, members: [] });
            groups.get(key).members.push(id);
        }
        return [...groups.values()].map(g => {
            const entry = this._rosterEntryForInfo(g.info);
            const def = this.game.getUnitTypeDef(this.game.getComponent(g.members[0], 'unitType'));
            return {
                rosterIndex: g.info.rosterIndex,
                members: g.members,
                locked: !!entry?.lastPosition,
                formation: entry?.formation
                    || { w: def?.squadWidth || 1, h: def?.squadHeight || 1 }
            };
        });
    }

    // Formation presets for a squad of n members. Width x depth: Line is the
    // default (everyone shoulder to shoulder facing the enemy).
    static formationPresets(n) {
        if (n >= 4) return [
            { w: 4, h: 1, name: 'Line' }, { w: 2, h: 2, name: 'Block' }, { w: 1, h: 4, name: 'Column' }];
        if (n === 3) return [
            { w: 3, h: 1, name: 'Line' }, { w: 1, h: 3, name: 'Column' }];
        if (n === 2) return [
            { w: 2, h: 1, name: 'Line' }, { w: 1, h: 2, name: 'Column' }];
        return [{ w: 1, h: 1, name: 'Solo' }];
    }

    // Cycle every selected squad to its next formation preset.
    _cycleSquadFormation() {
        if (this.game.state.phase !== this.enums.gamePhase.placement) return;
        for (const sq of this._selectedSquads()) {
            if (sq.members.length <= 1 || sq.locked) continue;
            const presets = PlacementUISystem.formationPresets(sq.members.length);
            const cur = presets.findIndex(p => p.w === sq.formation.w && p.h === sq.formation.h);
            const { w, h } = presets[(cur + 1) % presets.length];
            this.call.submitSetSquadFormation(sq.rosterIndex, w, h, (res) => {
                if (res?.success === false && res?.reason) {
                    GUTS.NotificationSystem?.show?.(`Formation: ${res.reason}`, 'error');
                }
                this._refreshSelectionPanel();
            });
        }
        this._refreshSelectionPanel();
    }

    _rosterEntryForInfo(info) {
        for (const eid of (this.call.getPlayerEntities?.() || [])) {
            const s = this.game.getComponent(eid, 'playerStats');
            if (s?.playerId === info.playerId) return s.heroRoster?.[info.rosterIndex] || null;
        }
        return null;
    }

    _levelUpSelectedUnits() {
        if (this.game.state.phase !== this.enums.gamePhase.placement) return;
        const indices = [...new Set(this._selectedOwnUnits()
            .map(id => this.game.getComponent(id, 'heroRosterInfo')?.rosterIndex)
            .filter(i => i != null))];
        for (const rosterIndex of indices) {
            this.call.submitBuySquadLevel(rosterIndex, (res) => {
                if (res?.success === false && res?.reason === 'insufficient_gold') {
                    GUTS.NotificationSystem?.show?.('Not enough gold to level up', 'error');
                }
                this._renderShop(res?.state || res);
                this._refreshSelectionPanel();
            });
        }
    }

    // Sell every selected own unit for a partial refund (prep only). Resolve each
    // unit's roster index from its heroRosterInfo, then sell highest-index-first so
    // the server's roster splice never invalidates a not-yet-sold lower index.
    _sellSelectedUnits() {
        if (this.game.state.phase !== this.enums.gamePhase.placement) return;
        const indices = [...new Set(this._selectedOwnUnits()
            .map(id => this.game.getComponent(id, 'heroRosterInfo')?.rosterIndex)
            .filter(i => i != null))]
            .sort((a, b) => b - a);
        if (indices.length === 0) return;
        for (const rosterIndex of indices) {
            this.call.submitSellUnit(rosterIndex, (res) => this._renderShop(res?.state || res));
        }
        this._refreshSelectionPanel();
    }

    // ==================== BUILDING UPGRADE TREE (read-only) ====================

    // The local player's owned upgrade ids — authoritative playerStats client-side
    // (local skirmish), falling back to the shop-state broadcast (online).
    _myOwnedUpgrades() {
        const myId = this.game.clientNetworkManager?.numericPlayerId ?? 0;
        for (const eid of this.game.getEntitiesWith('playerStats')) {
            const s = this.game.getComponent(eid, 'playerStats');
            if (s && s.playerId === myId && Array.isArray(s.ownedUpgrades)) {
                return new Set(s.ownedUpgrades);
            }
        }
        const fromShop = this._shopState?.ownedUpgrades;
        return new Set(Array.isArray(fromShop) ? fromShop : []);
    }

    // The unit-tech overlay's close (Esc / backdrop / Close button).
    _closeUpgradeTree() {
        document.getElementById('techTreeOverlay')?.classList.add('hidden');
    }

    // ─── Building upgrade panel (inline, bottom-left stack — no modal) ──────────
    //
    // Selecting an owned building shows its upgrade tree as a regular
    // left-side panel next to the other menus. Branches stack vertically;
    // each node is a compact row: step number, icon, name + description, and
    // a live BUY button (or ✔ owned / 🔒 locked). Re-rendered on every shop
    // broadcast so gold/ownership stay current while the building is selected.

    _renderBuildingTreePanel(building) {
        const panelEl = document.getElementById('buildingTreePanel');
        if (!panelEl) return;
        const tree = building?.hasTree ? this._deckTree(building.buildingId) : null;
        if (!tree) { panelEl.classList.add('hidden'); return; }

        const titleEl = document.getElementById('buildingTreeTitle');
        if (titleEl) titleEl.textContent = `🔬 ${tree.title || building.title} — Upgrades`;

        const body = document.getElementById('buildingTreeBody');
        if (!body) return;
        const owned = this._myOwnedUpgrades();
        const upgrades = this.collections?.upgrades || {};
        const icons = this.collections?.icons || {};
        const gold = this._shopState?.gold ?? 0;
        const notPrep = this.game.state.phase !== this.enums.gamePhase.placement;
        const cost = (v) => Math.max(1, Math.ceil((v || 0) / 5)); // mirrors ArmyShopSystem.shopCost
        const stateOf = (node) => {
            if (owned.has(node.upgrade)) return 'owned';
            return (node.requires || []).every(r => owned.has(r)) ? 'available' : 'locked';
        };

        // Per-round Command Center economy actions (Town Hall / ECON tree only):
        // Loan, Elite Recruitment toggle, Extra Deploy Slot.
        const s = this._shopState || {};
        const econActions = (tree.archetype === 'ECON') ? `
            <div class="bt-branch">
                <div class="bt-branch-head">Command Center
                    <span class="bt-branch-focus">This round</span></div>
                <div class="bt-node ${s.loanTaken ? 'bt-owned' : 'bt-available'}"
                     title="Borrow gold now, repay more next round">
                    <span class="bt-step">💰</span>
                    <span class="bt-info"><span class="bt-name">Loan</span>
                        <span class="bt-desc">+${s.loanGold ?? 200}g now, −${s.loanRepay ?? 300}g next round</span></span>
                    ${s.loanTaken ? '<span class="bt-owned">✔ taken</span>'
                        : notPrep ? '<span class="bt-price">—</span>'
                        : '<button class="bt-buy" data-econ-action="loan">TAKE</button>'}
                </div>
                <div class="bt-node ${s.eliteRecruit ? 'bt-owned' : 'bt-available'}"
                     title="One-time purchase — stays active the rest of the round; every recruit arrives at level 2">
                    <span class="bt-step">⭐</span>
                    <span class="bt-info"><span class="bt-name">Elite Recruitment</span>
                        <span class="bt-desc">Recruits arrive at Lv 2 this round</span></span>
                    ${s.eliteRecruit ? '<span class="bt-owned">✔ active</span>'
                        : notPrep ? '<span class="bt-price">—</span>'
                        : `<button class="bt-buy" data-econ-action="elite">BUY ${s.eliteRecruitCost ?? 100}g</button>`}
                </div>
                <div class="bt-node bt-available"
                     title="One more squad you can recruit from the menu this round">
                    <span class="bt-step">🎖</span>
                    <span class="bt-info"><span class="bt-name">Extra Deploy Slot</span>
                        <span class="bt-desc">Deploys ${s.deploysUsed ?? 0}/${s.deploySlots ?? 2} — +1 this round</span></span>
                    ${notPrep ? '<span class="bt-price">—</span>'
                        : `<button class="bt-buy" data-econ-action="deploy">+1 (${s.nextSlotCost ?? 100}g)</button>`}
                </div>
            </div>` : '';

        body.innerHTML = econActions + (tree.branches || []).map(branch => {
            const rows = (branch.nodes || []).map((node, i) => {
                const def = upgrades[node.upgrade] || {};
                const state = stateOf(node);
                const price = cost(def.value);
                const imagePath = icons[def.icon]?.imagePath;
                const img = imagePath
                    ? `<img class="bt-icon" src="./resources/${imagePath}" alt="">`
                    : `<span class="bt-icon bt-icon-fallback">★</span>`;
                const right = state === 'owned' ? '<span class="bt-owned">✔</span>'
                    : state === 'locked' ? `<span class="bt-price">🔒 ${price}g</span>`
                    : (gold >= price && !notPrep)
                        ? `<button class="bt-buy" data-upgrade-id="${node.upgrade}">BUY ${price}g</button>`
                        : `<span class="bt-price">${price}g</span>`;
                return `<div class="bt-node bt-${state}" title="${def.description || ''}">
                    <span class="bt-step">${i + 1}</span>
                    ${img}
                    <span class="bt-info">
                        <span class="bt-name">${def.title || node.upgrade}</span>
                        <span class="bt-desc">${def.description || ''}</span>
                    </span>
                    ${right}
                </div>`;
            }).join('');
            return `<div class="bt-branch">
                <div class="bt-branch-head">${branch.label || branch.id}
                    <span class="bt-branch-focus">${branch.focus || ''}</span></div>
                ${rows}
            </div>`;
        }).join('');

        if (!body._buyWired) {
            body._buyWired = true;
            body.addEventListener('click', (e) => {
                const done = (res) => {
                    if (res?.success === false && res?.reason === 'insufficient_gold') {
                        GUTS.NotificationSystem?.show?.('Not enough gold', 'error');
                    }
                    this._renderShop(res?.state || res);
                    this._refreshSelectionPanel();   // rows re-render with new gold/ownership
                };
                const act = e.target.closest('[data-econ-action]');
                if (act) {
                    const a = act.dataset.econAction;
                    if (a === 'loan') this.call.submitTakeLoan(done);
                    else if (a === 'elite') this.call.submitBuyEliteRecruit(done);
                    else if (a === 'deploy') this.call.submitBuyDeploySlot(done);
                    return;
                }
                const btn = e.target.closest('[data-upgrade-id]');
                if (!btn) return;
                this.call.submitBuyUpgradeNode(btn.dataset.upgradeId, done);
            });
        }
        panelEl.classList.remove('hidden');
    }

    _hideBuildingTreePanel() {
        document.getElementById('buildingTreePanel')?.classList.add('hidden');
    }

    // Cancel the selected squads' orders: they hold position (and the cleared
    // state is snapshotted at battle start, so nothing persists to next round).
    _clearSelectedOrders() {
        if (this.game.state.phase !== this.enums.gamePhase.placement) return;
        const units = this._selectedOwnUnits();
        const placementIds = [...new Set(
            units.map(id => this.game.getComponent(id, 'placement')?.placementId)
                 .filter(p => p != null)
        )];
        if (placementIds.length === 0) return;
        this._cancelOrderTargetMode();
        this.call.ui_issueMoveOrder(placementIds, { x: 0, z: 0 }, { clearOrder: true }, () => {
            this._refreshSelectionPanel();
            // Orders cleared -> remove their destination markers.
            this._updateOrderViz();
        });
        this._refreshSelectionPanel();
        this._updateOrderViz();
    }

    _toggleOrderTargetMode() {
        if (this._orderTargetMode) {
            this._cancelOrderTargetMode();
            return;
        }
        if (this.game.state.phase !== this.enums.gamePhase.placement) return;
        if (this._selectedOwnUnits().length === 0) return;
        this._orderTargetMode = true;
        this.elements.attackMoveBtn?.classList.add('active');
        this.elements.selectionHint?.classList.remove('hidden');
        document.body.style.cursor = 'crosshair';
    }

    _cancelOrderTargetMode() {
        if (!this._orderTargetMode) return;
        this._orderTargetMode = false;
        this.elements.attackMoveBtn?.classList.remove('active');
        this.elements.selectionHint?.classList.add('hidden');
        document.body.style.cursor = 'default';
    }

    // Issue the attack-move to every selected squad. Routed through
    // ui_issueMoveOrder → SET_SQUAD_TARGETS: server-authoritative, mirrored to
    // the opponent's client for lockstep.
    _confirmAttackMoveTarget(worldPos) {
        const units = this._selectedOwnUnits();
        const placementIds = [...new Set(
            units.map(id => this.game.getComponent(id, 'placement')?.placementId)
                 .filter(p => p != null)
        )];
        this._cancelOrderTargetMode();
        if (placementIds.length === 0) return;

        // Arm the one-shot click guard BEFORE issuing: the same physical click
        // also reaches InputSystem → ui_handleCanvasClick, which would deselect
        // the units. The guard makes that click a no-op for selection, so the
        // panel and destination markers stay up.
        this._orderClickGuardUntil = performance.now() + 600;

        this.call.ui_issueMoveOrder(placementIds, { x: worldPos.x, z: worldPos.z }, {}, () => {
            this._refreshSelectionPanel();
            // Order is applied by now (server callback) -> redraw the marker at
            // the new destination.
            this._updateOrderViz();
        });

        // Target-point feedback at terrain height (y=0 would spawn underground).
        const y = this.call.getTerrainHeight?.(worldPos.x, worldPos.z) ?? 0;
        this.call.createParticleEffect(worldPos.x, y + 5, worldPos.z, 'magic', { count: 10, speedMultiplier: 0.9 });
        this._logEvent(`Attack-move order set (${placementIds.length} squad${placementIds.length > 1 ? 's' : ''})`, 'system');
        this._refreshSelectionPanel();
        this._updateOrderViz();
    }

    // One-shot guard consumed by GameInterfaceSystem.ui_handleCanvasClick.
    // True only for the click event belonging to the order-confirmation
    // mousedown (short wall-clock window; client-side UI only).
    consumeOrderClickGuard() {
        if (this._orderClickGuardUntil && performance.now() < this._orderClickGuardUntil) {
            this._orderClickGuardUntil = 0;
            return true;
        }
        return false;
    }

    // ── Order destination/path visualization ─────────────────────────────────
    // Dashed line from each selected ordered unit to its destination + a ring
    // marker there. Rebuilt only when the (unit, from, to) fingerprint changes.

    _clearOrderViz() {
        if (!this._orderVizGroup) return;
        this._orderVizGroup.traverse(o => {
            o.geometry?.dispose?.();
            o.material?.dispose?.();
        });
        this._orderVizGroup.parent?.remove(this._orderVizGroup);
        this._orderVizGroup = null;
        this._orderVizFp = '';
    }

    // Order-destination markers were removed from HeroArena (attack-move orders
    // are legacy here). Kept as a no-op that tears down any stale viz so the
    // remaining callers stay valid.
    _updateOrderViz() {
        this._clearOrderViz();
    }

    _titleCase(s) {
        return String(s).charAt(0).toUpperCase() + String(s).slice(1);
    }

    _unitDisplayName(spawnType) {
        return spawnType ? (this.collections?.units?.[spawnType]?.title || null) : null;
    }

    // Card-modifier prefixes owned for a unit type, as a "Longshot " / "Fortified
    // Longshot " lead-in (empty string when none). Reads the shop state (defaults
    // to the last dock state) which carries stats.unitModifiers.
    _unitModPrefix(unitId, s) {
        const mods = (s || this._dockState)?.unitModifiers?.[unitId] || [];
        const px = mods.map(m => m.prefix).filter(Boolean);
        return px.length ? px.join(' ') + ' ' : '';
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
        // Keep the inline building panel current (gold/ownership changed).
        const panel = document.getElementById('buildingTreePanel');
        if (panel && !panel.classList.contains('hidden')) {
            this._renderBuildingTreePanel(this._selectedOwnBuilding());
        }
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
            // Mechabellum redesign: no random offers, so nothing to reroll. The
            // button stays hidden until the reinforcement-card pick replaces this
            // panel entirely (phase 5).
            this.elements.shopRerollBtn.classList.add('hidden');
        }
        // Hide the whole offers region when the offer list is empty (always,
        // during the transition) so the shop panel reads as the unit roster.
        if (this.elements.shopPanel) {
            this.elements.shopPanel.classList.toggle('hidden', offers.length === 0);
        }
        this._renderUnlockedUnits(s);
        this.updateHUD?.();
    }

    // ─── Unit dock (Mechabellum-style recruit bar) ──────────────────────────────

    _iconImg(def, cls) {
        const imagePath = this.collections?.icons?.[def?.icon]?.imagePath;
        return imagePath
            ? `<img class="${cls}" src="./resources/${imagePath}" alt="">`
            : `<span class="${cls} ud-fallback">⚔</span>`;
    }

    // Item glyph: `it.icon` is an icon-collection key → render its PNG. Anything
    // whose `icon` is an emoji (no matching icon key — legacy items, non-item
    // reinforcement cards) falls through to rendering that text. Inline-sized so
    // it sits in chips (18px) or card headers (larger) without a CSS change.
    _itemIcon(it, size = 18) {
        const imagePath = this.collections?.icons?.[it?.icon]?.imagePath;
        if (imagePath) {
            return `<img class="item-icon" src="./resources/${imagePath}" alt=""` +
                ` style="width:${size}px;height:${size}px;vertical-align:middle;object-fit:contain">`;
        }
        return it?.icon || '◈';
    }

    // Resolve a stored item INSTANCE ({uid,itemId,prefix,suffix,title}) into a
    // display view: rolled title, base icon key, and a stat+ability summary. Uses
    // the shared server resolver so client and server agree on merged stats.
    _resolveItemView(inst) {
        const S = GUTS.ArmyShopSystem;
        const r = S.resolveItemInstance(this.collections, inst);
        const stats = S.statModsSummary(r.statModifiers);
        const ab = r.unlockAbility
            ? (this.collections.abilities?.[r.unlockAbility]?.name || r.unlockAbility.replace(/Ability$/, ''))
            : null;
        const description = [stats, ab ? `unlocks ${ab}` : ''].filter(Boolean).join('; ');
        return { uid: r.uid, icon: r.icon, title: r.title, description };
    }

    // Paperdoll layout — one cell per equip slot (rings twice). Glyphs are the
    // empty-slot placeholders.
    static SLOT_LAYOUT = [
        { key: 'weapon',  label: 'Weapon',  glyph: '🗡' },
        { key: 'offhand', label: 'Offhand', glyph: '🛡' },
        { key: 'helmet',  label: 'Helmet',  glyph: '⛑' },
        { key: 'armor',   label: 'Armor',   glyph: '🎽' },
        { key: 'cloak',   label: 'Cloak',   glyph: '🧥' },
        { key: 'glove',   label: 'Gloves',  glyph: '🧤' },
        { key: 'boots',   label: 'Boots',   glyph: '🥾' },
        { key: 'ring',    label: 'Ring',    glyph: '💍' },
        { key: 'ring',    label: 'Ring',    glyph: '💍' },
        { key: 'amulet',  label: 'Amulet',  glyph: '📿' },
    ];

    // Which slot an equipped instance occupies: the tag written at equip time, or
    // (legacy items) the first slot its type allows. Mirrors the server's rule.
    _itemSlotOf(inst) {
        if (inst?.slot) return inst.slot;
        const S = GUTS.ArmyShopSystem;
        const r = S.resolveItemInstance(this.collections, inst);
        if (Array.isArray(r.slots) && r.slots.length) return r.slots[0];
        return (S.DEFAULT_SLOTS?.[r.itemType] || [])[0] || null;
    }

    // Slot keys the currently-armed stash item may occupy on THIS squad (null if
    // none armed, or the unit can't equip it — tier/weapon-class/attr gates).
    _armedItemSlots(entry) {
        if (!this._itemTargeting) return null;
        const inv = this._shopState?.itemInventory || [];
        const inst = inv.find(it => this._resolveItemView(it).uid === this._itemTargeting);
        if (!inst) return null;
        const S = GUTS.ArmyShopSystem;
        const r = S.resolveItemInstance(this.collections, inst);
        // Same eligibility gate the server enforces — don't light slots on a unit
        // that would be rejected (T3/T4, wrong weapon class, missing attribute).
        const shop = this.game.armyShopSystem;
        if (shop && entry && shop.itemEquipCheck && !shop.itemEquipCheck(entry, r).ok) return null;
        const slots = (Array.isArray(r.slots) && r.slots.length)
            ? r.slots : (S.DEFAULT_SLOTS?.[r.itemType] || []);
        return new Set(slots);
    }

    // Render the equipment paperdoll for a roster entry. Filled cells show the
    // item icon and unequip on click (via the existing [data-unequip-item]
    // handler); empty cells show the slot glyph, dimmed. When a stash item is
    // armed, only the slots it can occupy light up as equip targets.
    _equipmentGrid(entry, rosterIndex) {
        const bySlot = {};
        for (const inst of (entry?.items || [])) {
            const s = this._itemSlotOf(inst);
            if (!s) continue;
            (bySlot[s] = bySlot[s] || []).push(inst);
        }
        const armed = this._armedItemSlots(entry);
        const seen = {};
        const cells = PlacementUISystem.SLOT_LAYOUT.map(sl => {
            const idx = seen[sl.key] || 0;
            seen[sl.key] = idx + 1;
            const valid = armed?.has(sl.key) ? ' eq-valid' : '';
            const inst = (bySlot[sl.key] || [])[idx];
            if (inst) {
                const v = this._resolveItemView(inst);
                return `<span class="eq-slot filled${valid}" data-unequip-item="${v.uid}" data-unequip-roster="${rosterIndex ?? ''}"
                    title="${sl.label}: ${v.title} — ${v.description} — click to unequip">${this._itemIcon(v, 22)}</span>`;
            }
            return `<span class="eq-slot empty${valid}" title="${sl.label} (empty)">${sl.glyph}</span>`;
        }).join('');
        return `<div class="eq-grid" data-equip-roster="${rosterIndex ?? ''}">${cells}</div>`;
    }

    // Role/trait tags derived from the unit's numbers — the "what does it do".
    _unitTags(def, id) {
        const tags = [];
        const shop = GUTS.ArmyShopSystem;
        const members = (def.squadWidth || 1) * (def.squadHeight || 1);
        if (def.isFlying) tags.push('Flying');
        if ((def.range || 1) >= 260) tags.push('Artillery');
        else if ((def.range || 1) > 30) tags.push('Ranged');
        else tags.push('Melee');
        if (members >= 4) tags.push('Swarm');
        if ((def.armor || 0) >= 10) tags.push('Armored');
        if ((def.speed || 45) >= 60) tags.push('Fast');
        if (def.canTargetAir && !def.isFlying) tags.push('Anti-Air');
        if (def.projectile === 'fireball') tags.push('Splash');
        if ((def.damage || 0) >= 90) tags.push('Alpha');
        const elem = def.element;
        if (elem === 'poison' || elem === 'holy' || elem === 'shadow') tags.push('Unresistable');
        else if (elem && elem !== 'physical') tags.push(elem[0].toUpperCase() + elem.slice(1));
        return tags;
    }

    _statRows(def) {
        const members = (def.squadWidth || 1) * (def.squadHeight || 1);
        const dps = Math.round((def.damage || 0) * (def.attackSpeed || 1) * members);
        return [
            ['Members', members],
            ['HP', `${def.hp || 0}${members > 1 ? ` ×${members}` : ''}`],
            ['Damage', `${def.damage || 0} @ ${def.attackSpeed || 1}/s`],
            ['Squad DPS', dps],
            ['Range', (def.range || 1) > 30 ? def.range : 'Melee'],
            ['Armor', def.armor || 0],
            ['Speed', def.speed || 45]
        ];
    }

    _renderUnlockedUnits(s) {
        if (!this.elements.unlockedUnitsCards) return;
        this._renderDeploySlots(s);
        this._renderItemInventory(s);
        this._dockState = s;
        const fielded = new Set(s.ownedUnitTypes || []);

        const card = (u, locked) => {
            const def = this.collections.units?.[u.id] || {};
            const techs = this._deckUnitTechs(u.id);
            const ownedTechs = (s.unitTechs?.[u.id] || []).length;
            const lockUsed = locked && s.unlockedThisRound;   // one unlock per round
            const affordable = (s.gold ?? 0) >= (locked ? u.unlockCost : u.cost) && !lockUsed;
            const tier = GUTS.ArmyShopSystem.unitTier(u.id) || 1;
            const pips = techs.length && fielded.has(u.id)
                ? `<span class="ud-pips">${'●'.repeat(ownedTechs)}${'○'.repeat(Math.max(0, techs.length - ownedTechs))}</span>` : '';
            const mods = s.unitModifiers?.[u.id] || [];
            const modBadge = mods.length
                ? `<span class="ud-mod" title="${mods.map(m => m.prefix).join(', ')} — reinforcement modifier">✦</span>` : '';
            const eliteBadge = (!locked && s.eliteRecruit)
                ? '<span class="ud-elite" title="Elite Recruitment: arrives at level 2">⭐2</span>' : '';
            const techBtn = '';
            return `<div class="ud-card tier-${tier} ${locked ? 'ud-locked' : ''} ${lockUsed ? 'ud-unlock-used' : ''} ${affordable ? '' : 'ud-poor'}"
                data-${locked ? 'locked-id' : 'unit-id'}="${u.id}" data-hover-id="${u.id}">
                ${this._iconImg(def, 'ud-img')}
                ${locked ? '<span class="ud-lock">🔒</span>' : ''}
                <span class="ud-price">${locked ? `${u.unlockCost}g` : `${u.cost}g`}</span>
                ${eliteBadge}${modBadge}${pips}${techBtn}
            </div>`;
        };

        this.elements.unlockedUnitsCards.innerHTML =
            (s.unlocked || []).map(u => card(u, false)).join('')
            + (s.locked || []).map(u => card(u, true)).join('');

        if (!this._dockHoverWired) {
            this._dockHoverWired = true;
            const cards = this.elements.unlockedUnitsCards;
            cards.addEventListener('mouseover', (e) => {
                const el = e.target.closest('[data-hover-id]');
                if (el) this._showUnitTooltip(el.dataset.hoverId, el);
            });
            cards.addEventListener('mouseleave', () => this._hideUnitTooltip());
        }
    }

    _ensureTooltip() {
        let tip = document.getElementById('unitTooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'unitTooltip';
            document.body.appendChild(tip);
        }
        return tip;
    }

    _showUnitTooltip(unitId, anchorEl) {
        const s = this._dockState || {};
        const def = this.collections.units?.[unitId] || {};
        const tip = this._ensureTooltip();
        const tags = this._unitTags(def, unitId);
        const techs = this._deckUnitTechs(unitId);
        const owned = new Set(s.unitTechs?.[unitId] || []);
        const tier = GUTS.ArmyShopSystem.unitTier(unitId) || 1;
        const locked = (s.locked || []).find(l => l.id === unitId);

        tip.innerHTML = `
            <div class="ut-head">
                ${this._iconImg(def, 'ut-img')}
                <div>
                    <div class="ut-name">${this._unitModPrefix(unitId, s)}${def.title || unitId}</div>
                    <div class="ut-sub">Tier ${tier}${locked ? ` — 🔒 unlock ${locked.unlockCost}g` : ''}</div>
                    <div class="ut-tags">${tags.map(t => `<span class="ut-tag">${t}</span>`).join('')}</div>
                </div>
            </div>
            <div class="ut-stats">${this._statRows(def).map(([k, v]) =>
                `<span class="ut-k">${k}</span><span class="ut-v">${v}</span>`).join('')}</div>
            ${techs.length ? `<div class="ut-techs">${techs.map(t => {
                const ab = t.unlockAbility ? this._abilityBlurb(t.unlockAbility) : null;
                return `<div class="ut-tech ${owned.has(t.id) ? 'owned' : ''}">${owned.has(t.id) ? '✔' : '○'} ${t.title} <span class="ut-tech-d">${t.description || ''}</span>${
                    ab ? `<div class="ut-tech-ability">⚡ ${ab.name} — ${ab.text}</div>` : ''}</div>`;
            }).join('')}</div>` : ''}
            <div class="ut-hint">${locked ? 'Click to unlock' : 'Click to recruit'}</div>`;
        const r = anchorEl.getBoundingClientRect();
        tip.style.display = 'block';
        tip.style.left = Math.max(8, Math.min(window.innerWidth - 328, r.left - 60)) + 'px';
        tip.style.bottom = (window.innerHeight - r.top + 10) + 'px';
    }

    _hideUnitTooltip() {
        const tip = document.getElementById('unitTooltip');
        if (tip) tip.style.display = 'none';
    }

    // "Deploys 1/2  [+slot 7g]" header — Mechabellum recruitment allowance.
    // Commander inventory bar: held items not yet equipped. Click a chip to enter
    // the pick-a-squad banner and equip it (Diablo-style deferred equipment).
    _renderItemInventory(s) {
        const bar = this.elements.stashBody;
        if (!bar) return;
        if (!this._stashWired) {
            this._stashWired = true;
            bar.className = 'stash-panel';
            bar.addEventListener('click', (e) => {
                // Header toggles the stash open/closed.
                if (e.target.closest('[data-stash-toggle]')) {
                    this._stashCollapsed = !this._stashCollapsed;
                    this._renderItemInventory(this._shopState || s);
                    return;
                }
                const chip = e.target.closest('[data-inv-item]');
                if (!chip) return;
                // Click to arm equip-targeting; click the same item again to cancel.
                if (this._itemTargeting === chip.dataset.invItem) this._exitItemTargetMode();
                else this._enterItemTargetMode(chip.dataset.invItem);
            });
        }
        const inv = s.itemInventory || [];
        const hasItems = inv.length > 0;
        const collapsed = !!this._stashCollapsed;
        const chest = this._itemIcon({ icon: hasItems ? 'chest_gold' : 'chest_basic' }, 22);

        // Pad the loot out to a minimum so even one item reads as a stash grid.
        const MIN_CELLS = 12;
        const cells = inv.map(inst => {
            const v = this._resolveItemView(inst);
            const sel = this._itemTargeting === v.uid ? ' selected' : '';
            return `<span class="stash-cell filled${sel}" data-inv-item="${v.uid}"
                title="${v.title}: ${v.description} — click, then click an equipment slot to equip">${this._itemIcon(v, 28)}</span>`;
        });
        while (cells.length < MIN_CELLS) cells.push('<span class="stash-cell empty"></span>');

        this.elements.stashPanel?.classList.remove('hidden');
        bar.style.display = 'block';
        bar.innerHTML = `
            <div class="stash-head" data-stash-toggle
                title="Commander stash — unequipped loot. Click an item, then click a squad to equip it.">
                ${chest}
                <span class="stash-title">Stash</span>
                <span class="stash-count">${inv.length}</span>
                <span class="stash-caret">${collapsed ? '▸' : '▾'}</span>
            </div>
            ${collapsed || !hasItems
                ? (hasItems ? '' : '<div class="stash-empty">empty — win rounds to find loot</div>')
                : `<div class="stash-grid">${cells.join('')}</div>`}`;
    }

    _renderDeploySlots(s) {
        let bar = document.getElementById('deploySlotsBar');
        if (!bar) {
            const host = this.elements.unlockedUnitsCards?.parentElement;
            if (!host) return;
            bar = document.createElement('div');
            bar.id = 'deploySlotsBar';
            bar.style.cssText = 'display:flex; align-items:center; gap:8px; padding:2px 4px 6px; font-size:0.8rem; color:#e8d9a0;';
            host.insertBefore(bar, this.elements.unlockedUnitsCards);
            bar.addEventListener('click', (e) => {
                if (e.target.id !== 'buyDeploySlotBtn') return;
                this.call.submitBuyDeploySlot((res) => {
                    if (res?.success === false && res?.reason === 'insufficient_gold') {
                        GUTS.NotificationSystem?.show?.('Not enough gold', 'error');
                    }
                    this._renderShop(res?.state || res);
                });
            });
        }
        const used = s.deploysUsed ?? 0;
        const slots = s.deploySlots ?? 2;
        bar.innerHTML = `<span title="New squads you can recruit from the menu this round (free card units don't count)">🎖 Deploys ${used}/${slots}</span>`;
    }

    _onUnlockedUnitClick(event) {
        // Tech button opens the unit's technology panel instead of buying
        const techBtn = event.target.closest('[data-tech-unit]');
        if (techBtn) {
            this._openUnitTechPanel(techBtn.dataset.techUnit);
            return;
        }
        // Locked card: one-time unit unlock (T1 free / T2 50 / T3 200 / T4 350),
        // limited to ONE unlock per round.
        const lockCard = event.target.closest('[data-locked-id]');
        if (lockCard) {
            if (this._shopState?.unlockedThisRound) {
                GUTS.NotificationSystem?.show?.('Only one unit unlock per round', 'error');
                return;
            }
            this.call.submitBuyTierUnlock(lockCard.dataset.lockedId, (res) => {
                if (res?.success === false) {
                    const msg = res.reason === 'insufficient_gold' ? 'Not enough gold to unlock'
                        : res.reason === 'unlock_used' ? 'Only one unit unlock per round'
                        : 'Cannot unlock that unit';
                    GUTS.NotificationSystem?.show?.(msg, 'error');
                }
                this._renderShop(res?.state || res);
            });
            return;
        }
        const card = event.target.closest('[data-unit-id]');
        if (!card) return;
        this.call.submitBuyUnlockedUnit(card.dataset.unitId, (res) => this._renderShop(res?.state || res));
    }

    // ─── Unit technology panel (Mechabellum-style, reuses the tech-tree overlay) ──

    _openUnitTechPanel(unitId) {
        this._techPanelUnitId = unitId;
        this._renderUnitTechPanel();
        document.getElementById('techTreeOverlay')?.classList.remove('hidden');
        const closeBtn = document.getElementById('techTreeCloseBtn');
        if (closeBtn && !closeBtn._techWired) {
            closeBtn._techWired = true;
            closeBtn.addEventListener('click', () => {
                document.getElementById('techTreeOverlay')?.classList.add('hidden');
                this._techPanelUnitId = null;
            });
        }
    }

    _renderUnitTechPanel() {
        const unitId = this._techPanelUnitId;
        if (!unitId) return;
        const title = document.getElementById('techTreeTitle');
        const body  = document.getElementById('techTreeBranches');
        if (!body) return;

        const unitDef = this.collections.units?.[unitId] || {};
        const techs = this._deckUnitTechs(unitId);
        const s = this._shopState || {};
        const owned = new Set(s.unitTechs?.[unitId] || []);
        const gold = s.gold ?? 0;
        // Mechabellum escalation: owned techs inflate the rest (+200 supply each, cap +1000)
        const escalation = GUTS.ArmyShopSystem.techEscalation(owned.size);
        const discount = s.techDiscount || 0;
        const priceOf = (t) => Math.max(1, Math.ceil((GUTS.ArmyShopSystem.techBaseCost(t.cost) + escalation) * (1 - discount)));

        if (title) title.textContent = `${unitDef.title || unitId} — Technologies`;
        const subtitle = document.querySelector('#techTreeOverlay .arena-overlay-subtitle');
        if (subtitle) subtitle.textContent = 'Technologies apply to every unit of this type, now and in future rounds.';

        body.innerHTML = `<div class="unit-tech-list">` + techs.map(t => {
            const isOwned = owned.has(t.id);
            const price = priceOf(t);
            const affordable = gold >= price;
            const kind = t.unlockAbility ? 'Ability' : (t.unlockUnit ? 'Unlock' : 'Upgrade');
            const cls = `unit-tech-row ${isOwned ? 'owned' : (affordable ? 'buyable' : 'unaffordable')}`;
            const ab = t.unlockAbility ? this._abilityBlurb(t.unlockAbility) : null;
            return `<div class="${cls}" data-tech-id="${t.id}">
                <span class="unit-tech-kind">${kind}</span>
                <span class="unit-tech-info">
                    <span class="unit-tech-title">${t.title}</span>
                    <span class="unit-tech-desc">${t.description || ''}</span>
                    ${ab ? `<span class="ut-tech-ability">⚡ ${ab.name} — ${ab.text}</span>` : ''}
                </span>
                <span class="unit-tech-cost">${isOwned ? '✔ Owned' : `${price}g`}</span>
            </div>`;
        }).join('') + `</div>`;

        if (!body._techWired) {
            body._techWired = true;
            body.addEventListener('click', (e) => {
                const row = e.target.closest('[data-tech-id]');
                if (!row || row.classList.contains('owned') || !this._techPanelUnitId) return;
                this.call.submitBuyUnitTech(this._techPanelUnitId, row.dataset.techId, (res) => {
                    if (res?.success === false && res?.reason) {
                        GUTS.NotificationSystem?.show?.(`Cannot buy: ${res.reason}`, 'error');
                    }
                    this._renderShop(res?.state || res);
                    this._renderUnitTechPanel();
                });
            });
        }
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

    // ── Squad-item equip: click an inventory item, then an equipment slot in the
    // selection window (see _wireSelectionTechButton) ──
    _enterItemTargetMode(itemId) {
        this._itemTargeting = itemId;
        document.body.style.cursor = 'crosshair';
        const item = this.collections.squadItems?.[itemId] || {};
        GUTS.NotificationSystem?.show?.(
            `Select a squad, then click an equipment slot to equip ${item.icon || ''} ${item.title || 'the item'} (Esc to cancel)`, 'info');
        if (this._shopState) this._renderItemInventory(this._shopState);   // highlight the picked chip
        this._refreshSelectionPanel?.();   // arm slots on the open selection panel
    }

    _exitItemTargetMode() {
        this._itemTargeting = null;
        document.body.style.cursor = 'default';
        if (this._shopState) this._renderItemInventory(this._shopState);
        this._refreshSelectionPanel?.();
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

            // Right-click-drag formation handlers (when units are selected).
            this._track(this.canvas, 'mousedown', (event) => this._onFormationDragDown(event));
            this._track(this.canvas, 'mousemove', (event) => this._onFormationDragMove(event));
            this._track(window, 'mouseup', (event) => this._onFormationDragUp(event));

            // Camera panning is handled by WASD (OrthographicCameraSystem keyboard pan),
            // not right-click. Still suppress the browser context menu since right-click
            // is used for formation drag / unit orders.
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

        // Keep the selected units' order destination/path markers current
        // (throttled on wall-clock — sim time can be frozen during prep — and
        // rebuilds only when the fingerprint actually changed). This is just a
        // backstop; selection/order events refresh the markers immediately.
        const nowMs = (typeof performance !== 'undefined') ? performance.now() : 0;
        if (nowMs - (this._lastOrderVizAt || 0) > 200) {
            this._lastOrderVizAt = nowMs;
            this._updateOrderViz();
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
        if (this.elements.shopPanel)        this.elements.shopPanel.classList.remove('hidden');
        if (this.elements.unlockedUnitsPanel) this.elements.unlockedUnitsPanel.classList.remove('hidden');
        if (this.elements.phaseDisplay)     this.elements.phaseDisplay.textContent = 'PREP PHASE';

        this.enablePlacementUI();
        this._refreshSelectionPanel();
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
        this._showSpeedButton();
        // Orders can't be issued mid-battle; the selection panel stays (read-only).
        this._cancelOrderTargetMode();
        this._refreshSelectionPanel();
        // Hide the shop — not actionable mid-battle.
        if (this.elements.shopPanel)          this.elements.shopPanel.classList.add('hidden');
        if (this.elements.unlockedUnitsPanel) this.elements.unlockedUnitsPanel.classList.add('hidden');
        if (this.elements.stashPanel)         this.elements.stashPanel.classList.add('hidden');
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

    // GoldMineCaptureSystem fires these at round end as veins change hands.
    _isMine(playerId) {
        return playerId === (this.game.clientNetworkManager?.numericPlayerId ?? 0);
    }

    onGoldMineBuilt(data) {
        if (!data) return;
        this._logEvent(
            `${this._isMine(data.playerId) ? 'You' : 'Enemy'} built a Gold Mine`, 'system');
    }

    onGoldMineDestroyed(data) {
        if (!data) return;
        const owned = data.playerId != null && this._isMine(data.playerId);
        this._logEvent(
            `${owned ? 'Your' : 'Enemy'} Gold Mine was destroyed`, 'death');
    }

    onGoldMineIncome(data) {
        if (!data || !this._isMine(data.playerId)) return;
        this._logEvent(`Gold Mine income (+${data.gold}g)`, 'system');
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

        // Keep the raycaster aligned with whichever camera is currently active. The
        // game can switch between the orthographic (default) and free-fly perspective
        // cameras; the helper caches the camera it was built with, so without this the
        // screen→world ray would still come from the orthographic camera and unit
        // moves/placement would land in the wrong spot in free-fly mode.
        const activeCamera = this.call.getCamera?.();
        if (activeCamera) this.raycastHelper.setCamera(activeCamera);

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
        this._cancelOrderTargetMode();
        this._clearOrderViz();

        this.cachedValidation = null;
        this.cachedGridPos = null;

        this.undoStack = [];
    }

    onSceneUnload() {
        this.dispose();
    }
}
