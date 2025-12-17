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
        'createNetworkUnitData',
        'getWorldPositionFromMouse',
        'undoLastPlacement',
        'getUndoStatus',
        'handleCanvasClick',
        'setBattlePaused',
        'handleReadyForBattleUpdate',
        'handleUnitSelectionChange'
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

        // Intervals
        this.mouseRayCastInterval = null;
    }

    init(params) {
        this.params = params || {};

        this.mouseWorldOffset = {
            x: this.game.call('getPlacementGridSize') / 2,
            z: this.game.call('getPlacementGridSize') / 2
        };

    }

    // Service alias methods
    getWorldPositionFromMouse() {
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

        this.placementPreview?.clear();
        document.body.style.cursor = 'default';
    }

    onSceneLoad(sceneData) {
        // Initialize RaycastHelper when scene and camera are available
        if (this.game.scene && this.game.camera && !this.raycastHelper) {
            this.raycastHelper = new GUTS.RaycastHelper(this.game.camera, this.game.scene);
        }
    }

    /**
     * Called when game scene is fully loaded and ready
     */
    onGameStarted() {
        this.initializeSubsystems();
        this.setupEventListeners();
        this.setupCameraForMySide();
        this.onPlacementPhaseStart();
    }

    initializeSubsystems() {
        if (this.config.enablePreview) {
            this.placementPreview = new GUTS.PlacementPreview(this.game);
        }
    }

    /**
     * Set up camera position based on player's side
     */
    setupCameraForMySide() {
        const myTeam = this.game.state.myTeam;
        if (!myTeam) {
            console.warn('[PlacementUISystem] Cannot setup camera - myTeam not set');
            return;
        }

        const cameraData = this.game.call('getCameraPositionForTeam', myTeam);
        if (cameraData && this.game.camera) {
            const pos = cameraData.position;
            const look = cameraData.lookAt;
            this.game.camera.position.set(pos.x, pos.y, pos.z);
            this.game.camera.lookAt(look.x, look.y, look.z);
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
                this.game.call('showNotification', '↶ Last deployment undone', 'info', 2000);
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
            document.addEventListener('keydown', (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
                    event.preventDefault();
                    this.undoLastPlacement();
                }
            });
        }

        // Mouse tracking for preview
        if (this.config.enablePreview && this.placementPreview && this.canvas) {
            this.canvas.addEventListener('mousemove', (event) => {
                const rect = this.canvas.getBoundingClientRect();
                this.mouseScreenPos.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                this.mouseScreenPos.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            });

            this.canvas.addEventListener('mouseleave', () => {
                this.placementPreview.clear();
                this.cachedValidation = null;
                this.cachedGridPos = null;
                document.body.style.cursor = 'default';
            });
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

    // ==================== PLACEMENT PHASE ====================

    onPlacementPhaseStart() {
        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;

        this.game.call('resetShop');
        this.game.call('clearAllDamageEffects');
        this.game.call('clearAllEffects');

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

        this.game.call('toggleReadyForBattle', (success, response) => {
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
            // Apply network unit data for each team from server data
            data.gameState.players.forEach((player) => {
                if (player.id !== myPlayerId) {
                    // Apply opponent's network unit data (spawns their units)
                    this.game.call('applyNetworkUnitData', player.networkUnitData, player.team, player.id);
                }
            });
            this.game.state.phase = this.enums.gamePhase.battle;

            // Initialize deterministic RNG for this battle (must match server seed)
            const roomId = this.game.clientNetworkManager?.roomId || 'default';
            const roomIdHash = GUTS.SeededRandom.hashString(roomId);
            const battleSeed = GUTS.SeededRandom.combineSeed(roomIdHash, this.game.state.round || 1);
            this.game.rng = new GUTS.SeededRandom(battleSeed);

            // Track battle start time for duration limiting
            this.battleStartTime = 0; // Will be set after resetCurrentTime
            this.isBattlePaused = false;

            this.game.resetCurrentTime();
            this.battleStartTime = this.game.state.now || 0;
            this.game.call('resetAI');
            this.game.triggerEvent('onBattleStart');

            // Resync entities with server state to ensure both clients are in sync
            if (data.entitySync) {
                this.game.call('resyncEntities', data);
            }

            if (this.game.desyncDebugger) {
                this.game.desyncDebugger.enabled = true;
                this.game.desyncDebugger.displaySync(true);
            }

            if (this.elements.readyButton) {
                this.elements.readyButton.disabled = true;
                this.elements.readyButton.textContent = 'Battling!';
            }
        } else {
            const opponentReady = data.gameState?.players?.find(p => p.id !== myPlayerId)?.ready;
            if (opponentReady) {
                this.game.call('showNotification', 'Opponent is ready for battle!', 'info');
            }
        }
    }

    // ==================== RAYCASTING ====================

    rayCastGround(screenX, screenY) {
        if (!this.raycastHelper) {
            return { x: 0, y: 0, z: 0 };
        }

        // Get ground mesh for raycasting
        const ground = this.game.call('getGroundMesh');

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
        if (!this.placementPreview || !this.game.state.selectedUnitType) return;

        if (!this.mouseWorldPos) {
            this.placementPreview.clear();
            document.body.style.cursor = 'not-allowed';
            return;
        }

        const unitType = this.game.state.selectedUnitType;
        const gridPos = this.game.call('worldToPlacementGrid', this.mouseWorldPos.x, this.mouseWorldPos.z);

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
        const squadData = this.game.call('getSquadData', unitType);
        if (!squadData) return;

        const cells = this.game.call('getSquadCells', gridPos, squadData);
        const isValid = this.game.call('isValidGridPlacement', cells, this.game.state.myTeam);

        this.cachedValidation = isValid;

        // Get world positions for cells (offset by half cell to center on cell)
        const halfCell = this.game.call('getPlacementGridSize') / 2;
        const worldPositions = cells.map(cell => {
            const pos = this.game.call('placementGridToWorld', cell.x, cell.z);
            return { x: pos.x + halfCell, z: pos.z + halfCell };
        });

        // Get unit positions for squad preview
        let unitPositions = null;
        if (this.game.call('getSquadSize', squadData) > 1) {
            unitPositions = this.game.call('calculateUnitPositions', gridPos, unitType);
        }

        // Update preview with correct API
        if (unitPositions && unitPositions.length > 0) {
            this.placementPreview.showWithUnitMarkers(worldPositions, unitPositions, isValid);
        } else {
            this.placementPreview.showAtWorldPositions(worldPositions, isValid);
        }

        this.updateCursorState(isValid);
    }

    updateCursorState(isValid) {
        if (this.game.state.selectedUnitType) {
            document.body.style.cursor = isValid ? 'pointer' : 'not-allowed';
        } else {
            document.body.style.cursor = 'default';
        }
    }

    // ==================== CANVAS CLICK HANDLING ====================

    handleCanvasClick(event) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) return;
        if (!this.game.state.selectedUnitType) return;

        const unitType = this.game.state.selectedUnitType;
        const gridPos = this.game.call('worldToPlacementGrid', this.mouseWorldPos.x, this.mouseWorldPos.z);

        // Validate placement
        const squadData = this.game.call('getSquadData', unitType);
        if (!squadData) return;

        const cells = this.game.call('getSquadCells', gridPos, squadData);
        const isValid = this.game.call('isValidGridPlacement', cells, this.game.state.myTeam);

        if (!isValid) {
            this.game.call('showNotification', 'Invalid placement location', 'error', 2000);
            return;
        }

        // Create placement data and submit to server
        const networkUnitData = this.createNetworkUnitData(gridPos, unitType);

        this.game.call('sendPlacementRequest', networkUnitData, (success, response) => {
            if (success) {
                // Domain logic (placePlacement, gold deduction, spawn) now handled by ClientNetworkSystem
                // Here we just handle UI concerns: undo stack, effects, UI updates

                // Add to undo stack
                this.addToUndoStack({
                    placementId: response.placementId,
                    unitType: unitType,
                    gridPosition: gridPos,
                    squadUnits: response.squadUnits
                });

                // Create visual effects
                this.createPlacementEffects(gridPos, unitType);

                // Update UI
                this.updatePlacementUI();
                this.game.call('updateGoldDisplay');

                // Clear placement mode after successful placement
                // This prevents placing multiple buildings in a row without re-selecting
                this.game.state.selectedUnitType = null;
                this.game.state.peasantBuildingPlacement = null;
                if (this.placementPreview) {
                    this.placementPreview.clear();
                }
                document.body.style.cursor = 'default';
            } else {
                this.game.call('showNotification', response.error || 'Placement failed', 'error', 2000);
            }
        });
    }

    // ==================== PLACEMENT DATA ====================

    createNetworkUnitData(gridPosition, unitType) {
        // Get enum indices for numeric storage
        const collectionIndex = this.enums.objectTypeDefinitions?.[unitType.collection] ?? null;
        const typeIndex = this.enums[unitType.collection]?.[unitType.id] ?? null;

        return {
            gridPosition: gridPosition,
            unitTypeId: typeIndex,
            collection: collectionIndex,
            team: this.game.state.myTeam,
            playerId: this.game.clientNetworkManager?.numericPlayerId,
            roundPlaced: this.game.state.round || 1,
            timestamp: this.game.state.now,
            unitType: unitType,
            peasantInfo: this.game.state.peasantBuildingPlacement || null,
            isStartingState: false
        };
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

        // Destroy the entities
        if (undoInfo.squadUnits) {
            for (const entityId of undoInfo.squadUnits) {
                this.game.call('removeInstance', entityId);
                this.game.destroyEntity(entityId);
            }
        }

        // Release grid cells (use entityId, not placementId)
        if (undoInfo.squadUnits) {
            for (const entityId of undoInfo.squadUnits) {
                this.game.call('releaseGridCells', entityId);
            }
        }

        // Refund gold
        if (undoInfo.unitType?.value) {
            this.game.call('addPlayerGold', this.game.state.myTeam, undoInfo.unitType.value);
        }

        // Create undo visual effect
        this.createUndoEffects(undoInfo.gridPosition);

        this.updatePlacementUI();
        return true;
    }

    // ==================== VISUAL EFFECTS ====================

    createPlacementEffects(gridPos, unitType) {
        const worldPos = this.game.call('placementGridToWorld', gridPos.x, gridPos.z);
        if (worldPos) {
            this.game.call('createParticleEffect',
                worldPos.x,
                0,
                worldPos.z,
                'magic',
                { count: 5, speedMultiplier: 0.8 }
            );
        }
    }

    createUndoEffects(gridPos) {
        const worldPos = this.game.call('placementGridToWorld', gridPos.x, gridPos.z);
        if (worldPos) {
            this.game.call('createParticleEffect',
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
        this.game.call('createParticleEffect',
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

        this.cachedValidation = null;
        this.cachedGridPos = null;

        if (this.placementPreview) {
            this.placementPreview.dispose();
        }

        this.undoStack = [];
    }

    onSceneUnload() {
        this.dispose();
    }
}
