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
        'getActivePlayerTeam',
        'getCameraPositionForTeam',
        'showNotification',
        'getUnitTypeDef',
        'placementGridToWorld',
        'resetShop',
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
        'clearPreview'
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
    }

    init(params) {
        this.params = params || {};

        const gridSize = this.call.getPlacementGridSize();
        this.mouseWorldOffset = {
            x: gridSize / 2,
            z: gridSize / 2
        };
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
        this.onPlacementPhaseStart();
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

        const cameraData = this.call.getCameraPositionForTeam( myTeam);
        const camera = this.call.getCamera();
        if (cameraData && camera) {
            const pos = cameraData.position;
            const look = cameraData.lookAt;
            camera.position.set(pos.x, pos.y, pos.z);
            camera.lookAt(look.x, look.y, look.z);
        }
    }

    // ==================== EVENT LISTENERS ====================

    setupEventListeners() {
        this.elements.readyButton = document.getElementById('placementReadyBtn');
        this.elements.undoButton = document.getElementById('undoBtn');

        if (this.elements.readyButton) {
            this.elements.readyButton.addEventListener('click', () => {
                this.togglePlacementReady();
            });
        }

        if (this.elements.undoButton) {
            this.elements.undoButton.addEventListener('click', () => {
                this.undoLastPlacement();
                this.elements.undoButton.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    this.elements.undoButton.style.transform = 'scale(1)';
                }, 150);
                this.call.showNotification( '↶ Last deployment undone', 'info', 2000);
            });

            this.elements.undoButton.addEventListener('mouseenter', () => {
                if (!this.elements.undoButton.disabled) {
                    this.elements.undoButton.style.background = 'linear-gradient(135deg, #616161, #757575)';
                    this.elements.undoButton.style.transform = 'translateY(-2px)';
                    this.elements.undoButton.style.boxShadow = '0 4px 12px rgba(117, 117, 117, 0.3)';
                }
            });

            this.elements.undoButton.addEventListener('mouseleave', () => {
                if (!this.elements.undoButton.disabled) {
                    this.elements.undoButton.style.background = 'linear-gradient(135deg, var(--stone-gray), #616161)';
                    this.elements.undoButton.style.transform = 'translateY(0)';
                    this.elements.undoButton.style.boxShadow = 'none';
                }
            });
        }

        // Keyboard undo
        if (this.config.enableUndo) {
            this._keydownHandler = (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
                    event.preventDefault();
                    this.undoLastPlacement();
                }
            };
            document.addEventListener('keydown', this._keydownHandler);
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
        // Check battle duration limit during battle phase
        if (this.game.state.phase === this.enums.gamePhase.battle) {
            const battleDuration = (this.game.state.now || 0) - this.battleStartTime;

            // Pause game when client reaches max battle duration
            // This prevents client from running ahead of server
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
            const buildingUnitType = this.call.getUnitTypeDef( {
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

    onPlacementPhaseStart() {
        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;

        this.call.resetShop();
        this.call.clearAllDamageEffects();
        this.call.clearAllEffects();

        this.enablePlacementUI();
        if (this.elements.readyButton) {
            this.elements.readyButton.textContent = 'Ready for Battle';
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
                const unitTypeDef = this.call.getUnitTypeDef( unitTypeComp);
            }

            this.call.resetAI();
            this.game.triggerEvent('onBattleStart');

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
