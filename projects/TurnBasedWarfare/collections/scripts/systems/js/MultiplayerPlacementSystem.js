class MultiplayerPlacementSystem extends GUTS.BasePlacementSystem {
    constructor(game) {
        super(game);

        // Use global RaycastHelper for raycasting operations
        this.raycastHelper = null; // Initialized after scene/camera are available
        this.canvas = this.game.canvas;
        
        // Placements are derived from entities with 'placement' component
        // No cached arrays - query entities directly
        this.undoStack = [];
        this.maxUndoSteps = 10;
        
        this.game.state.targetPositions = new Map();
        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;
        
        this.lastMouseMoveTime = 0;
        this.lastValidationTime = 0;
        this.cachedValidation = null;
        this.cachedGridPos = null;
        this.lastUpdateTime = 0;
        this.config = {
            maxSquadsPerRound: 2,
            enablePreview: true,
            enableUndo: true,
            validationThrottle: .32
        };
        this.elements = {};
        this.mouseWorldOffset = { x: 0, z: 0 };
        this.mouseWorldPos = { x: 0, y: 0, z: 0 };
        this.mouseScreenPos = { x: 0, y: 0 };

        // Battle duration tracking (client-side)
        this.battleDuration = 30; // Must match server
        this.battleStartTime = 0;
        this.isBattlePaused = false;
    }

    init(params) {
        this.params = params || {};

        // Cache team enums for opponent side calculation
        // RaycastHelper initialized in onSceneLoad when scene/camera are available

        this.game.register('getPlacementById', this.getPlacementById.bind(this));
        this.game.register('getPlacementsForSide', this.getPlacementsForSide.bind(this));
        this.game.register('createPlacementData', this.createPlacementData.bind(this));
        this.game.register('placeSquadOnBattlefield', this.placeSquad.bind(this));
        this.game.register('getOpponentPlacements', () => this.getPlacementsForSide(this.getOpponentSide()));
        this.game.register('getWorldPositionFromMouse', () => this.mouseWorldPos);
        this.game.register('handleReadyForBattleUpdate', this.handleReadyForBattleUpdate.bind(this));
        this.mouseWorldOffset = { x: this.game.call('getPlacementGridSize') / 2, z: this.game.call('getPlacementGridSize') / 2 };
    }

    /**
     * Get the opponent's team side (numeric)
     * @returns {number} The opponent's team enum value
     */
    getOpponentSide() {
        const TEAM_LEFT = this.enums.team.left;
        const TEAM_RIGHT = this.enums.team.right;
        return this.game.state.myTeam === TEAM_LEFT ? TEAM_RIGHT : TEAM_LEFT;
    }

    onSceneLoad(sceneData) {
        // Initialize RaycastHelper now that scene and camera are available
        if (this.game.scene && this.game.camera && !this.raycastHelper) {
            this.raycastHelper = new GUTS.RaycastHelper(this.game.camera, this.game.scene);
            console.log('[MultiplayerPlacementSystem] RaycastHelper initialized');
        }

        // Skip if loading from save - entities already exist
        if (!this.game.state.isLoadingSave) {
            // Spawn starting units deterministically (same order as server: left first, then right)
            console.log('[MultiplayerPlacementSystem] onSceneLoad - spawning starting units');
            this.spawnStartingUnits();
        }
    }

    /**
     * Set up camera position based on player's side using level starting locations
     */
    setupCameraForMySide() {
        const myTeam = this.game.state.myTeam;
        if (!myTeam) {
            console.warn('[MultiplayerPlacementSystem] Cannot setup camera - myTeam not set');
            return;
        }

        const cameraData = this.getCameraPositionForTeam(myTeam);
        if (cameraData && this.game.camera) {
            const pos = cameraData.position;
            const look = cameraData.lookAt;
            this.game.camera.position.set(pos.x, pos.y, pos.z);
            this.game.camera.lookAt(look.x, look.y, look.z);
            console.log('[MultiplayerPlacementSystem] Camera set for side:', myTeam);
        }
    }

    setupEventListeners() {
        
        this.elements.readyButton = document.getElementById('placementReadyBtn');
        this.elements.undoButton = document.getElementById('undoBtn');

        this.elements.readyButton.addEventListener('click', () => {
            this.togglePlacementReady();
        });
        
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
        if (this.config.enableUndo) {
            document.addEventListener('keydown', (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
                    event.preventDefault();
                    this.undoLastPlacement();
                }
            });
        }

        if (this.config.enablePreview && this.placementPreview) {       
            
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

    initializeSubsystems() {
       
        this.squadSystem = this.game.squadSystem;
        this.unitCreator = this.game.unitCreationSystem;
         
        if (this.config.enablePreview) {
            this.placementPreview = new GUTS.PlacementPreview(this.game);
        }
    }

    onGameStarted() {
        this.initializeSubsystems();
        this.setupEventListeners();

        // Get player entities from server (gold, upgrades, etc.)
        // Skip if loading from save - entities already exist
        if (!this.game.state.isLoadingSave) {
            this.syncPlayerEntities();
        }

        // Set up camera position for this player's side
        // Done here because myTeam is guaranteed to be set after syncWithServerState
        this.setupCameraForMySide();

        this.onPlacementPhaseStart();
    }

    /**
     * Sync player entities from server (gold, upgrades, etc.)
     * Starting units and camera are set up deterministically in onSceneLoad.
     */
    syncPlayerEntities() {
        console.log('[MultiplayerPlacementSystem] syncPlayerEntities called');

        this.game.call('getStartingState', (success, response) => {
            if (success && response.playerEntities) {
                console.log('[MultiplayerPlacementSystem] Creating player entities:', response.playerEntities);
                for (const playerEntity of response.playerEntities) {
                    if (!this.game.entityExists(playerEntity.entityId)) {
                        this.game.createEntity(playerEntity.entityId);
                    }
                    this.game.addComponent(playerEntity.entityId, 'playerStats', playerEntity.playerStats);
                }
            } else {
                console.error('[MultiplayerPlacementSystem] syncPlayerEntities failed:', response);
            }
        });
    }

    onPlacementPhaseStart() {
        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;

        this.game.call('resetShop');
        this.game.call('clearAllDamageEffects');
        this.game.call('clearAllEffects');

        this.enablePlacementUI();
        this.elements.readyButton.textContent = 'Ready for Battle';
 
    }

    getTotalUnitCount(placements) {
        return placements.reduce((sum, placement) => {
            return sum + (placement.isSquad ? placement.squadUnits.length : 1);
        }, 0);
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
        
    enablePlacementUI() {
        this.elements.readyButton.disabled = false;
        this.elements.undoButton.disabled = false;
    }

    disablePlacementUI() {
        this.elements.readyButton.disabled = true;
        this.elements.undoButton.disabled = true;
    }

    updatePlacementUI() {
        if (this.elements.undoButton) {
            this.elements.undoButton.disabled = this.undoStack.length === 0;
            this.elements.undoButton.style.opacity = this.undoStack.length === 0 ? '0.5' : '1';
        }
    }

    togglePlacementReady(callback) {
        if (this.elements.readyButton) {
            this.elements.readyButton.disabled = true;
            this.elements.readyButton.textContent = 'Updating...';
        }
        this.game.call('toggleReadyForBattle', (success, response) => {
            if(success){
                this.hasSubmittedPlacements = true;
                this.elements.readyButton.textContent = 'Waiting for Opponent...';
            } else {
                if (this.elements.readyButton) {
                    this.elements.readyButton.disabled = false;
                    this.elements.readyButton.textContent = 'Ready for Battle';
                }
            }
        });
    }

    handleReadyForBattleUpdate(data) {
        const myPlayerId = this.game.clientNetworkManager.playerId;
        console.log('[SYNC DEBUG] handleReadyForBattleUpdate received:', {
            allReady: data.allReady,
            hasEntitySync: !!data.entitySync,
            nextEntityIdFromServer: data.nextEntityId,
            clientNextEntityId: this.game.nextEntityId
        });
        if (data.playerId === myPlayerId) {
            this.isPlayerReady = data.ready;
            this.updatePlacementUI();
        }

        if (data.allReady) {
            // FIRST: Apply opponent placements to create entities with correct IDs
            let opponentPlacements = null;
            data.gameState.players.forEach((player) => {
                if(player.id != myPlayerId){
                    opponentPlacements = player.placements;
                }
            });
            this.applyOpponentPlacements(opponentPlacements);
            this.applyTargetPositions();
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
            this.resetAI();
            this.game.triggerEvent("onBattleStart");

            // THEN: Resync entities with server state to ensure both clients match
            // Server serializes AFTER onBattleStart, so client must also run it first
            if (data.entitySync) {
                this.game.call('resyncEntities', data);
            }

            this.game.desyncDebugger.enabled = true;
            this.game.desyncDebugger.displaySync(true);
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

    resetAI() {
        const combatEntities = this.game.getEntitiesWith("combat");
        combatEntities.forEach((entityId) => {
            const combat = this.game.getComponent(entityId, "combat");
            combat.lastAttack = 0;
        });
    }

    applyTargetPositions() {
        // Update placement component data from entity playerOrder components
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        for (const entityId of entitiesWithPlacement) {
            const placementComp = this.game.getComponent(entityId, 'placement');
            const playerOrder = this.game.getComponent(entityId, 'playerOrder');
            const buildingState = this.game.getComponent(entityId, 'buildingState');
            if (placementComp && playerOrder && (playerOrder.targetPositionX !== 0 || playerOrder.targetPositionZ !== 0)) {
                placementComp.targetPosition = {
                    x: playerOrder.targetPositionX,
                    y: playerOrder.targetPositionY,
                    z: playerOrder.targetPositionZ
                };
                // Store meta fields if needed (for legacy placement component)
                placementComp.meta = {
                    buildingId: (buildingState && buildingState.targetBuildingEntityId !== -1) ? buildingState.targetBuildingEntityId : undefined,
                    isMoveOrder: playerOrder.isMoveOrder === 1,
                    preventEnemiesInRangeCheck: playerOrder.preventEnemiesInRangeCheck === 1,
                    completed: playerOrder.completed === 1
                };
            }
        }
    }

    removeOpponentPlacement(placementId) {
        // Get squad units before destroying
        const squadUnits = this.getSquadUnitsForPlacement(placementId);

        if (squadUnits.length === 0) {
            console.warn('Opponent placement not found:', placementId);
            return;
        }

        // Remove render instances first
        for (const entityId of squadUnits) {
            this.game.call('removeInstance', entityId);
        }

        // Destroy entities using base class method
        this.destroyPlacementEntities(placementId);
        console.log('Removed opponent placement:', placementId);
    }

    update() {
        // Check battle duration limit during battle phase
        if (this.game.state.phase === this.enums.gamePhase.battle) {
            const battleDuration = (this.game.state.now || 0) - this.battleStartTime;

            // Pause game when client reaches max battle duration
            // This prevents client from running ahead of server
            if (battleDuration >= this.battleDuration && !this.isBattlePaused) {
                this.isBattlePaused = true;
                this.game.state.isPaused = true;
                console.log(`Client reached max battle duration (${this.battleDuration}s), pausing until server sends BATTLE_END`);
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
            this.updateCursorState();
            this.updatePlacementUI();
            this.lastValidationTime = this.game.state.now;
        }
    }

    applyOpponentPlacements(opponentData) {
        opponentData.forEach(placement => {
            if(this.game.call('getOpponentPlacements').find(p => p.placementId === placement.placementId)) {
                return;
            }
            // placement.playerId already contains the numeric player ID from server
            // Use squadUnits from placement as server entity IDs to ensure both clients use same IDs
            this.placeSquad(placement, placement.squadUnits);

            // Apply playerOrder to opponent units so they move during battle
            // This is critical for visibility - we need to simulate their movement
            if (placement.playerOrder && placement.squadUnits) {
                placement.squadUnits.forEach(unitId => {
                    if (this.game.entityExists(unitId)) {
                        // Remove existing player order if present, then add new one
                        if (this.game.hasComponent(unitId, "playerOrder")) {
                            this.game.removeComponent(unitId, "playerOrder");
                        }
                        this.game.addComponent(unitId, "playerOrder", {
                            targetPositionX: placement.playerOrder.targetPositionX,
                            targetPositionY: placement.playerOrder.targetPositionY,
                            targetPositionZ: placement.playerOrder.targetPositionZ,
                            buildingId: -1,
                            isMoveOrder: placement.playerOrder.isMoveOrder || 0,
                            preventEnemiesInRangeCheck: placement.playerOrder.preventEnemiesInRangeCheck || 0,
                            completed: 0,
                            targetMine: -1,
                            targetMinePositionX: 0,
                            targetMinePositionY: 0,
                            targetMinePositionZ: 0,
                            miningStartTime: 0,
                            issuedTime: placement.playerOrder.issuedTime || 0
                        });
                    }
                });
            }
        });

        if (this.game.state) {
            this.game.state.enemyPlacementComplete = true;
        }
    }

    createEnemyFromOpponentPlacement(opponentPlacement) {
        this.game.call('setSquadInfo', opponentPlacement.placementId, opponentPlacement.experience);

        if (this.game.squadSystem && this.game.unitCreationSystem) {
            // Look up unitType from collections
            const unitType = this.getUnitTypeFromPlacement(opponentPlacement);
            if (!unitType) {
                console.error('[MultiplayerPlacementSystem] Cannot create enemy - unitType not found:', opponentPlacement.unitTypeId, opponentPlacement.collection);
                return;
            }

            const unitPositions = this.game.squadSystem.calculateUnitPositions(
                opponentPlacement.gridPosition,
                unitType
            );

            // Create placementWithUnitType for UnitCreationManager
            const placementWithUnitType = { ...opponentPlacement, unitType };

            let squadUnits = [];
            unitPositions.forEach((pos, index) => {
                const terrainHeight = this.game.unitCreationSystem.getTerrainHeight(pos.x, pos.z);
                const unitY = terrainHeight !== null ? terrainHeight : 0;

                const transform = {
                    position: { x: pos.x, y: unitY, z: pos.z }
                };
                const opponentTeam = this.getOpponentSide();
                let entityId = this.game.call('createPlacement',
                    placementWithUnitType,
                    transform,
                    opponentTeam
                );
                if (unitType.id === 'goldMine') {
                    // Convert footprint (terrain grid units) to placement grid cells
                    const footprintWidth = unitType.footprintWidth || unitType.placementGridWidth || 2;
                    const footprintHeight = unitType.footprintHeight || unitType.placementGridHeight || 2;
                    const gridWidth = footprintWidth * 2;
                    const gridHeight = footprintHeight * 2;

                    this.game.call('buildGoldMine',
                        entityId,
                        opponentTeam,
                        opponentPlacement.gridPosition,
                        gridWidth,
                        gridHeight
                    );
                }
                this.game.call('reserveGridCells', opponentPlacement.cells, entityId);
                squadUnits.push(entityId);
            });
            // squadUnits tracked via placement component on entities, not in arrays
        }
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
        
        if (this.placementPreview) {
            this.placementPreview.clear();
        }
        
        document.body.style.cursor = 'default';
    }

    onActivateBuildingPlacement(){
        this.handleUnitSelectionChange();
    }

    handleCanvasClick(event) {
        const state = this.game.state;
        
        if (this.settingTargetPosition) {
            return;
        }
        
        if (state.phase !== this.enums.gamePhase.placement) {
            return;
        }
        if(!state.selectedUnitType) {
            return;
        }
        
        if (this.isPlayerReady) {
            return;
        }
        
        if (!this.canPlayerPlaceSquad()) {
            return;
        }
        
        if (!this.game.call('canAffordCost', state.selectedUnitType.value)) {
            return;
        }
        if (this.game.supplySystem && !this.game.supplySystem.canAffordSupply(this.game.state.myTeam, state.selectedUnitType)) {
            console.log('Not enough supply to place this unit');
            return;
        }

        let gridPos = this.game.call('worldToPlacementGrid', this.mouseWorldPos.x, this.mouseWorldPos.z);

        let isValidPlacement = this.isValidGridPlacement(this.mouseWorldPos);
       
        if (!isValidPlacement) {
            return;
        }
    
        if (this.game.squadSystem) {
            const squadData = this.game.squadSystem.getSquadData(state.selectedUnitType);
            const validation = this.game.squadSystem.validateSquadConfig(squadData);
        
            if (!validation.valid) {
                return;
            }
        }
        
        const placement = this.createPlacementData(gridPos, state.selectedUnitType, this.game.state.myTeam);

        this.game.call('submitPlacement', placement, (success, response) => {
            if(success){
                // Use server-provided placementId, entity IDs and server time for sync
                // Server's placementId is authoritative to avoid conflicts between clients
                placement.placementId = response.placementId;
                placement.serverTime = response.serverTime;
                console.log(`[MultiplayerPlacementSystem] submitPlacement success, placementId=${response.placementId}, serverEntityIds=${JSON.stringify(response.squadUnits)}, nextEntityId=${response.nextEntityId}`);
                this.placeSquad(placement, response.squadUnits);
                // Sync nextEntityId from server AFTER creating entities
                // Server's nextEntityId is the next available ID after all entities it knows about
                if (response.nextEntityId !== undefined) {
                    this.game.nextEntityId = response.nextEntityId;
                }
            }
        });
    }

    canPlayerPlaceSquad() {
        return true;
    }

    placeSquad(placement, serverEntityIds = null) {
        // Look up unitType from collections
        const unitType = this.getUnitTypeFromPlacement(placement);
        if (!unitType) {
            console.error('[MultiplayerPlacementSystem] Cannot place squad - unitType not found:', placement.unitTypeId, placement.collection);
            return null;
        }

        // Build full placement with unitType
        const fullPlacement = {
            ...placement,
            unitType
        };

        // Create undo info before spawning
        const undoInfo = this.createUndoInfo(placement, unitType);

        // Use playerId from placement if available (already numeric from server)
        // Otherwise use local player's numeric ID for own team units
        let playerId = placement.playerId ?? null;
        if (playerId === null && placement.team === this.game.state.myTeam) {
            playerId = this.game.clientNetworkManager?.numericPlayerId ?? -1;
        }

        // Use shared base class method to spawn squad, passing server entity IDs if available
        const result = this.spawnSquad(fullPlacement, placement.team, playerId, serverEntityIds);

        if (!result.success) {
            console.error('[MultiplayerPlacementSystem] Failed to spawn squad:', result.error);
            return null;
        }

        const squadUnits = result.squad.squadUnits;
        placement.squadUnits = squadUnits;
        placement.isSquad = squadUnits.length > 1;

        // Track units for undo
        undoInfo.unitIds = [...squadUnits];

        this.updateGameStateForPlacement(placement, unitType, undoInfo);

        // Create placement effects (client-only visual feedback)
        const unitPositions = this.game.squadSystem.calculateUnitPositions(placement.gridPosition, unitType);
        if (squadUnits.length <= 8) {
            this.createPlacementEffects(unitPositions.slice(0, 8), placement.team);
        }

        this.cachedValidation = null;
        this.cachedGridPos = null;

        if (this.placementPreview) {
            this.placementPreview.clear();
        }

        this.game.state.selectedUnitType = null;
        this.handleUnitSelectionChange();

        return placement;
    }

    createUndoInfo(placement, unitType) {
        return {
            type: 'squad_placement',
            placementId: placement.placementId,
            collection: placement.collection,
            unitTypeId: placement.unitTypeId,
            cost: unitType.value || 0,
            gridPosition: { ...placement.gridPosition },
            cells: [...placement.cells],
            unitIds: [],
            team: this.game.state.myTeam,
            timestamp: this.game.state.now
        };
    }

    createPlacementData(gridPos, unitType, team) {
        // Calculate cells for grid reservation
        const squadData = this.game.squadSystem.getSquadData(unitType);
        const cells = this.game.squadSystem.getSquadCells(gridPos, squadData);

        // Get enum indices for numeric storage
        const enums = this.game.getEnums();
        const collectionIndex = enums.objectTypeDefinitions?.[unitType.collection] ?? -1;
        const typeIndex = enums[unitType.collection]?.[unitType.id] ?? -1;
        // team is always numeric (from game.state.myTeam which server sets as numeric)

        // Placement data with numeric indices for ECS storage
        // placementId is -1 - server will assign the authoritative ID
        // Include resolved unitType for createPlacement to use
        // playerId is numeric (from clientNetworkManager.numericPlayerId)
        return {
            placementId: -1,  // Server assigns authoritative placementId
            gridPosition: gridPos,
            unitTypeId: typeIndex,
            collection: collectionIndex,
            unitType: unitType,  // Resolved definition for createPlacement
            team: team,  // Already numeric from game.state.myTeam
            playerId: this.game.clientNetworkManager?.numericPlayerId ?? -1,
            roundPlaced: this.game.state.round,
            timestamp: this.game.state.now,
            cells: cells,
            peasantInfo: this.game.state.peasantBuildingPlacement ? {
                ...this.game.state.peasantBuildingPlacement,
                commandCreatedTime: this.game.state.now
            } : null
        };
    }

    updateGameStateForPlacement(placement, unitType, undoInfo) {
        // Placement data is stored in entity's placement component, not in arrays
        // Just handle undo stack and gold deduction for player placements
        if (this.isMyTeam(placement.team)) {
            this.addToUndoStack(undoInfo);
            if (!placement.isStartingState) {
                const cost = unitType.value || 0;
                this.game.call('deductPlayerGold', cost);
            }
        }
    }

    setPlacementExperience(placements) {
        if (placements) {
            placements.forEach(placement => {
                if (placement.experience && placement.placementId) {
                    const experienceData = placement.experience;

                    // Update SquadExperienceSystem Map data
                    let squadData = this.game.call('getSquadInfo', placement.placementId);

                    if (squadData) {
                        squadData.level = experienceData.level;
                        squadData.experience = experienceData.experience;
                        squadData.experienceToNextLevel = experienceData.experienceToNextLevel;
                        squadData.canLevelUp = experienceData.canLevelUp;
                    }

                    // Update the entity's placement component with experience data
                    const entitiesWithPlacement = this.game.getEntitiesWith('placement');
                    for (const entityId of entitiesWithPlacement) {
                        const placementComp = this.game.getComponent(entityId, 'placement');
                        if (placementComp?.placementId === placement.placementId) {
                            placementComp.experience = experienceData;
                            break;
                        }
                    }
                }
            });
        }
    }

    isMyTeam(team){
        return team == this.game.state.myTeam;
    }

    createPlacementEffects(unitPositions, team) {
        const effectType = this.isMyTeam(team) ? 'magic' : 'defeat';
        const maxEffects = Math.min(unitPositions.length, 6);

        for (let i = 0; i < maxEffects; i++) {
            const pos = unitPositions[i];
            const terrainHeight = this.game.unitCreationSystem.getTerrainHeight(pos.x, pos.z);
            const unitY = terrainHeight !== null ? terrainHeight : 0;

            this.game.call('createParticleEffect',
                pos.x,
                unitY,
                pos.z,
                effectType,
                { count: 3, speedMultiplier: 0.8 }
            );
        }
    }

    undoLastPlacement() {
        if (!this.config.enableUndo) return;
        
        const state = this.game.state;
        
        if (state.phase !== this.enums.gamePhase.placement) {
            return;
        }

        if (this.isPlayerReady) {
            return;
        }
        
        if (this.undoStack.length === 0) {
            return;
        }
        
        const undoInfo = this.undoStack.pop();

        try {
            // Destroy entities - this removes them from the ECS
            undoInfo.unitIds.forEach(entityId => {
                if (this.game.destroyEntity) {
                    this.game.destroyEntity(entityId);
                }
            });

            this.game.call('addPlayerGold', this.game.state.myTeam, undoInfo.cost);

            this.game.call('removeSquad', undoInfo.placementId);

            this.game.call('releaseGridCells', undoInfo.placementId);
            this.createUndoEffects(undoInfo);

            this.cachedValidation = null;
            this.cachedGridPos = null;
            
        } catch (error) {
            console.error('Undo failed:', error);
        }
    }

    createUndoEffects(undoInfo) {
        const maxEffects = Math.min(undoInfo.cells.length, 4);

        for (let i = 0; i < maxEffects; i++) {
            const cell = undoInfo.cells[i];
            const worldPos = this.game.call('placementGridToWorld', cell.x, cell.z);
            this.game.call('createParticleEffect',
                worldPos.x,
                0,
                worldPos.z,
                'magic',
                { count: 3, speedMultiplier: 0.7 }
            );
        }
    }

    collectPlayerPlacements() {
        return this.getPlacementsForSide(this.game.state.myTeam);
    }

   
    updatePlacementPreview(event) {
        if (!this.placementPreview) return;
    
        if (!this.mouseWorldPos) {
            this.placementPreview.clear();
            document.body.style.cursor = 'not-allowed';
            return;
        }

        // Adjust world position to account for camera angle and cell centering
        // Add half cell size to snap to nearest cell center

        const gridPos = this.game.call('worldToPlacementGrid', this.mouseWorldPos.x, this.mouseWorldPos.z);
        const state = this.game.state;
        
        let isValid = this.isValidGridPlacement(this.mouseWorldPos);
        let unitPositions = null;
        let isBuilding = state.selectedUnitType.collection === 'buildings';

        const squadData = this.game.squadSystem.getSquadData(state.selectedUnitType);
        const cells = this.game.squadSystem.getSquadCells(gridPos, squadData);
        if (this.game.squadSystem.getSquadSize(squadData) > 1) {
            unitPositions = this.game.squadSystem.calculateUnitPositions(gridPos, state.selectedUnitType);
        }
        
        // For buildings, show footprint-sized preview. For units, show placement grid cells.
        const worldPositions = cells.map(cell =>
            this.game.call('placementGridToWorld', cell.x, cell.z)
        );

        if (unitPositions && unitPositions.length > 0) {
            this.placementPreview.showWithUnitMarkers(worldPositions, unitPositions, isValid, isBuilding);
        } else {
            this.placementPreview.showAtWorldPositions(worldPositions, isValid, isBuilding);
        }

        document.body.style.cursor = isValid ? 'crosshair' : 'not-allowed';
    }

    rayCastGround(mouseX, mouseY) {
        if (!this.raycastHelper) {
            console.warn('MultiplayerPlacementSystem: RaycastHelper not initialized');
            return { x: 0, y: 0, z: 0 };
        }

        // Get ground mesh for raycasting
        const ground = this.game.call('getGroundMesh');

        // Use RaycastHelper to raycast against ground
        const worldPos = this.raycastHelper.rayCastGround(mouseX, mouseY, ground);

        if (worldPos) {
            return worldPos;
        }

        return { x: 0, y: 0, z: 0 };
    }

    getFlatWorldPositionFromMouse(event, mouseX, mouseY) {
        if (!this.raycastHelper) {
            console.warn('MultiplayerPlacementSystem: RaycastHelper not initialized');
            return null;
        }

        // Get base terrain height
        const baseHeight = this.game.call('getBaseTerrainHeight');

        // Use RaycastHelper to raycast to flat plane
        return this.raycastHelper.rayCastFlatPlane(mouseX, mouseY, baseHeight);
    }

    isValidGridPlacement(worldPos, unitDef) {
        const selectedUnitType = unitDef || this.game.state.selectedUnitType;

        let gridPos = this.game.call('worldToPlacementGrid', worldPos.x, worldPos.z);
        let cells = [];
        let isValid = false;
        let gridValid = false;
        if (selectedUnitType.collection === 'buildings') {
            cells = this.calculateBuildingCells(gridPos, selectedUnitType);

            if (selectedUnitType.id === 'goldMine') {
                // Convert footprint to placement grid cells
                const footprintWidth = selectedUnitType.footprintWidth || selectedUnitType.placementGridWidth || 2;
                const footprintHeight = selectedUnitType.footprintHeight || selectedUnitType.placementGridHeight || 2;
                const gridWidth = footprintWidth * 2;
                const gridHeight = footprintHeight * 2;
                const validation = this.game.call('isValidGoldMinePlacement', gridPos, gridWidth, gridHeight);
                isValid = validation.valid;
            } else {
                gridValid = this.game.call('isValidGridPlacement', cells, this.game.state.myTeam);

                let terrainValid = true;
                cells.forEach((cell) => {
                    // Convert placement grid coordinates to terrain grid coordinates
                    const terrainGridX = Math.floor(cell.x / 2);
                    const terrainGridZ = Math.floor(cell.z / 2);
                    const terrainTypeId = this.game.call('getTerrainTypeAtGridPosition', terrainGridX, terrainGridZ);
                    if(!terrainTypeId) {
                        terrainValid = false;
                        return;
                    }
                    const terrainType = this.game.call('getTileMapTerrainType', terrainTypeId);
                    // Check walkability using placement grid cell (already in placement grid coords)
                    const isPositionWalkable = this.game.call('isGridPositionWalkable', cell);
                    terrainValid = terrainValid && terrainType.buildable && isPositionWalkable;
                });

                isValid = gridValid && terrainValid;
            }
        } else {
            const squadData = this.game.squadSystem.getSquadData(selectedUnitType);
            cells = this.game.squadSystem.getSquadCells(gridPos, squadData);
            gridValid = this.game.call('isValidGridPlacement', cells, this.game.state.myTeam);
            isValid = gridValid;
        }
        return isValid;
    }

    addToUndoStack(undoInfo) {
        if (!this.config.enableUndo) return;
        
        this.undoStack.push(undoInfo);
        
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }
    }

    clearUndoStack() {
        this.undoStack = [];
    }

    getUndoStatus() {
        return {
            canUndo: this.undoStack.length > 0 && this.config.enableUndo && !this.isPlayerReady,
            undoCount: this.undoStack.length,
            maxUndoSteps: this.maxUndoSteps,
            lastAction: this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : null
        };
    }

    /**
     * Set team bounds (called by MultiplayerNetworkSystem)
     * Note: This system uses game.state.myTeam directly via getOpponentSide()
     * @param {number} myTeam - Numeric team value (from enums.team)
     */
    setTeamBounds(myTeam) {
        // This system uses game.state.myTeam directly, so no need to store locally
    }

    calculateBuildingCells(gridPos, building) {
        const cells = [];
        // Convert footprint (terrain grid units) to placement grid cells (multiply by 2)
        const footprintWidth = building.footprintWidth || building.placementGridWidth || 1;
        const footprintHeight = building.footprintHeight || building.placementGridHeight || 1;
        const gridWidth = footprintWidth * 2;
        const gridHeight = footprintHeight * 2;

        const startX = gridPos.x - Math.floor(gridWidth / 2);
        const startZ = gridPos.z - Math.floor(gridHeight / 2);

        for (let z = 0; z < gridHeight; z++) {
            for (let x = 0; x < gridWidth; x++) {
                cells.push({
                    x: startX + x,
                    z: startZ + z
                });
            }
        }

        return cells;
    }


    updateCursorState(isValid) {
        if (this.isPlayerReady) {
            document.body.style.cursor = 'not-allowed';
        } else if (this.game.state.selectedUnitType) {
            document.body.style.cursor = isValid ? 'crosshair' : 'not-allowed';
        } else {
            document.body.style.cursor = 'default';
        }
    }

    onBattleEnd() {
        // Dead squad cleanup is handled by DeathSystem destroying entities
        // No need to filter arrays - entities are the source of truth
    }

    cleanupDeadSquad(placementId) {
        if (placementId) {
            this.game.call('releaseGridCells', placementId);
            this.game.call('removeSquad', placementId);
        }
    }

    resetAllPlacements() {
        this.game.call('resetSquadExperience');

        // Destroy all entities with placement component
        const entitiesWithPlacement = this.game.getEntitiesWith('placement');
        for (const entityId of entitiesWithPlacement) {
            this.game.destroyEntity(entityId);
        }

        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;
        this.clearUndoStack();

        this.cachedValidation = null;
        this.cachedGridPos = null;

        if (this.placementPreview) {
            this.placementPreview.clear();
        }
    }

    dispose() {
        // Clear the raycasting interval
        if (this.mouseRayCastInterval) {
            clearInterval(this.mouseRayCastInterval);
            this.mouseRayCastInterval = null;
        }

        // Clean up RaycastHelper
        if (this.raycastHelper) {
            this.raycastHelper.dispose();
            this.raycastHelper = null;
        }

        this.cachedValidation = null;
        this.cachedGridPos = null;

        if (this.placementPreview) {
            this.placementPreview.dispose();
        }

        this.resetAllPlacements();
    }
}
