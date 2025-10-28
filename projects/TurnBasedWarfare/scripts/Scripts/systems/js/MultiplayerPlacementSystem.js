class MultiplayerPlacementSystem extends engine.BaseSystem {
    constructor(game, sceneManager) {
        super(game);
        this.sceneManager = sceneManager;
        this.game.placementSystem = this;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.canvas = this.game.canvas;
        
        this.playerPlacements = [];
        this.opponentPlacements = [];        
        this.undoStack = [];
        this.maxUndoSteps = 10;
        
        this.game.state.targetPositions = new Map();
        // Track placement state
        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;
        
        // Performance optimizations
        this.lastMouseMoveTime = 0;
        this.lastValidationTime = 0;
        this.cachedValidation = null;
        this.cachedGridPos = null;
        this.groundMeshCache = null;
        this.lastUpdateTime = 0;
        this.config = {
            maxSquadsPerRound: 2,
            enablePreview: true,
            enableUndo: true,
            validationThrottle: .32
        };
        this.elements = {};
    }

    // GUTS Manager Interface
    init(params) {
        this.params = params || {};
        this.initializeSubsystems();
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.initializeControls();
        this.elements.readyButton.addEventListener('click', () => {
            this.togglePlacementReady();
        });
        
        this.elements.undoButton.addEventListener('click', () => {
            this.undoLastPlacement();

            // Visual feedback
            this.elements.undoButton.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.elements.undoButton.style.transform = 'scale(1)';
            }, 150);
            
            // Show feedback message
            this.game.uiSystem.showNotification('↶ Last deployment undone', 'info', 2000);
         
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

    initializeSubsystems() {
        const terrainSize = this.game.worldSystem?.terrainSize || 768;
        
        this.gridSystem = this.game.gridSystem;
        this.gridSystem.init({terrainSize});
        this.squadManager = this.game.squadManager;
        this.unitCreator = this.game.unitCreationManager;
         
        if (this.config.enablePreview) {
            this.placementPreview = new GUTS.PlacementPreview(this.game );
        }
        
        // Cache ground mesh on initialization
        this.groundMeshCache = this.findGroundMesh();
    }

    startGame() {
        this.getStartingState();
        this.startNewPlacementPhase();
    }

    getStartingState() {
         this.game.networkManager.getStartingState((success, response) => {
            if(success){
                const buildingTypes = this.game.getCollections().buildings;
                const unitTypes = this.game.getCollections().buildings;
                response.startingUnits.forEach((unitData) => {
                    const unitId = unitData.type;
                    const unitPos = unitData.position;
                    const collection = this.game.getCollections()[unitData.collection];
                    if(collection){
                        const unitDef = collection[unitId];
                        const placementData = { id: unitId, collection: unitData.collection, ...unitDef };       
                        const placement = this.createPlacementData(unitPos, placementData, this.game.state.mySide);
                        placement.isStartingState = true;
                        this.game.networkManager.submitPlacement(placement, (success, response) => {
                            if(success){
                                this.placeSquad(placement);
                                if(placement.unitType.collection == "buildings"){
                                    this.game.shopSystem.addBuilding(placement.unitType.id, placement.squadUnits[0]);
                                }
                            }
                        });            
                    }          
                });
            }
        });   
    }

    getPlacementsForSide(side){
        if(side == this.game.state.mySide){
            return this.playerPlacements;
        } else {
            return this.opponentPlacements;
        }
    }

    startNewPlacementPhase() { 
 
        
                // Reset placement state for new round
        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;
           
        if (this.game.shopSystem) {
            this.game.shopSystem.reset();
        }  
        if (this.game.damageSystem) {
            this.game.damageSystem.clearAll();
        }
        if(this.game.effectsSystem){
            this.game.effectsSystem.clearAllEffects();
        }
        // Enable placement UI
        this.enablePlacementUI();
        
        this.elements.readyButton.textContent = 'Ready for Battle';
        
    }
    
    respawnEnemyUnits() {
        this.respawnSquads(this.opponentPlacements, this.game.state.mySide == 'left' ? 'right' : 'left');

    }
          
    getTotalUnitCount(placements) {
        return placements.reduce((sum, placement) => {
            return sum + (placement.isSquad ? placement.squadUnits.length : 1);
        }, 0);
    }     
    
    createRespawnEffect(position, team) {
        if (!this.game.effectsSystem) return;
        
        const effectType = team === 'player' ? 'magic' : 'heal';
        this.game.effectsSystem.createParticleEffect(
            position.x,
            position.y,
            position.z,
            effectType,
            { count: 3, speedMultiplier: 0.6 } // Reduced particle count
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
        this.game.networkManager.toggleReadyForBattle((success, response) => {
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
        if (data.playerId === myPlayerId) {
            this.isPlayerReady = data.ready;
            this.updatePlacementUI();
        } 
        
        if (data.allReady) {  
            console.log('All players ready!', data);  
            let opponentPlacements = null;
            data.gameState.players.forEach((player) => {
                if(player.id != myPlayerId){
                    opponentPlacements = player.placements;
                }
            });
            console.log('applying opponent placements', opponentPlacements);
            this.applyOpponentPlacements(opponentPlacements);
            this.applyTargetPositions();
            this.game.state.phase = 'battle';
            this.game.resetCurrentTime();
            this.resetAI();
            this.game.desyncDebugger.displaySync(true);
            if (this.elements.readyButton) {
                this.elements.readyButton.disabled = true;
                this.elements.readyButton.textContent = 'Battling!';
            }
        } else {
            // Show opponent status
            const opponentReady = data.gameState?.players?.find(p => p.id !== myPlayerId)?.ready;
            if (opponentReady) {
                this.game.uiSystem?.showNotification('Opponent is ready for battle!', 'info');
            }
        }
    }

    resetAI() {
        const componentTypes = this.game.componentManager.getComponentTypes();            
        const AIEntities = this.game.getEntitiesWith(componentTypes.AI_STATE, componentTypes.COMBAT);      
        AIEntities.forEach((entityId) => {
            const aiState = this.game.getComponent(entityId, componentTypes.AI_STATE);
            const combat = this.game.getComponent(entityId, componentTypes.COMBAT);
            combat.lastAttack = 0;
            aiState.aiBehavior = {};
        });

    }

    applyTargetPositions(){
        for (const [placementId, targetPosition] of this.game.state.targetPositions.entries()) {
            const squadData = this.game.squadExperienceSystem?.getSquadInfo(placementId);
            if (!squadData) continue;
            
            const componentTypes = this.game.componentManager.getComponentTypes();
            
            squadData.unitIds.forEach(entityId => {
                const aiState = this.game.getComponent(entityId, componentTypes.AI_STATE);
                if (aiState) {
                    if (!aiState.aiBehavior) {
                        aiState.aiBehavior = {};
                    }
                    aiState.targetPosition = { ...targetPosition };
                }
            });
        }
    }

    update() {
        if (this.game.state.phase !== 'placement') {
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
    // Apply opponent placements received from multiplayer server
    applyOpponentPlacements(opponentData) {
      
        // Create enemy units from opponent data
        opponentData.forEach(placement => {
            if(this.game.placementSystem.opponentPlacements.find(p => p.placementId === placement.placementId)) {
                return;
            }
            this.createEnemyFromOpponentPlacement(placement);
            if(this.game.squadExperienceSystem){
                this.game.squadExperienceSystem.initializeSquad(
                    placement.placementId, 
                    placement.unitType, 
                    placement.experience?.unitIds || [], 
                    this.game.state.mySide == 'right' ? 'left' : 'right'
                );
            }
        });

        // Mark opponent as having completed placement
        if (this.game.state) {
            this.game.state.enemyPlacementComplete = true;
        }
    }

    createEnemyFromOpponentPlacement(opponentPlacement) {
      
        if(this.game.squadExperienceSystem){
            this.game.squadExperienceSystem.setSquadInfo(opponentPlacement.placementId, opponentPlacement.experience);
        }


        if (this.game.squadManager && this.game.unitCreationManager) {
            const unitPositions = this.game.squadManager.calculateUnitPositions(
                opponentPlacement.gridPosition,
                opponentPlacement.unitType
            );

            let squadUnits = [];
            unitPositions.forEach((pos, index) => {
                const terrainHeight = this.game.unitCreationManager.getTerrainHeight(pos.x, pos.z);
                const unitY = terrainHeight !== null ? terrainHeight : 0;

                let entityId = this.game.unitCreationManager.create(
                    pos.x,
                    unitY,
                    pos.z,
                    opponentPlacement.targetPosition,
                    opponentPlacement,
                    this.game.state.mySide == 'right' ? 'left' : 'right'
                );
                if (opponentPlacement.unitType.id === 'goldMine') {
                    const gridWidth = opponentPlacement.unitType.placementGridWidth || 2;
                    const gridHeight = opponentPlacement.unitType.placementGridHeight || 2;
                    
                    const opponentSide = this.game.state.mySide === 'right' ? 'left' : 'right';
                    
                    this.game.goldMineSystem.buildGoldMine(
                        entityId,
                        opponentSide,
                        opponentPlacement.gridPosition,
                        gridWidth,
                        gridHeight
                    );
                }
                squadUnits.push(entityId);

            
            });
            opponentPlacement.squadUnits = squadUnits;
        }

        // Occupy the provided cells exactly as given
        if (this.game.gridSystem?.occupyCells && opponentPlacement.cells?.length) {
            this.game.gridSystem.occupyCells(opponentPlacement.cells, opponentPlacement.placementId);
        }

        this.opponentPlacements.push(opponentPlacement);
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

    // Handle canvas clicks for unit placement
    
    handleCanvasClick(event) {
        const state = this.game.state;
        
        if (this.settingTargetPosition) {
          //  this.setSquadTargetPosition(event);
            return;
        }
        
        if (state.phase !== 'placement') {
            return;
        }
        if(!state.selectedUnitType) {
        //    this.game.selectedUnitSystem.checkUnitSelectionClick(event);
            return;
        }
        
        if (this.isPlayerReady) {
            return;
        }
        
        if (!this.canPlayerPlaceSquad()) {
            return;
        }
        
        if (state.playerGold < state.selectedUnitType.value) {
            return;
        }
        
        let isValidPlacement = false;
        let gridPos = null;
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        const worldPosition = this.getWorldPositionFromMouse(event, mouseX, mouseY);
        
        if (worldPosition) {
            gridPos = this.game.gridSystem.worldToGrid(worldPosition.x, worldPosition.z);
            
            if (state.selectedUnitType.collection === 'buildings' && state.selectedUnitType.id === 'goldMine') {
                const gridWidth = state.selectedUnitType.placementGridWidth || 2;
                const gridHeight = state.selectedUnitType.placementGridHeight || 2;
                
                const validation = this.game.goldMineSystem.isValidGoldMinePlacement(gridPos, gridWidth, gridHeight);
                if (!validation.valid) {
                    this.game.uiSystem?.showNotification('Must be placed on a gold vein!', 'error');
                    return;
                }
                isValidPlacement = true;
            } else {
                isValidPlacement = this.isValidGridPlacement(worldPosition);
            }
        }
        
        if (!isValidPlacement || !gridPos) {
            return;
        }
    
        if (this.game.squadManager) {
            const squadData = this.game.squadManager.getSquadData(state.selectedUnitType);
            const validation = this.game.squadManager.validateSquadConfig(squadData);
        
            if (!validation.valid) {
                return;
            }
        }
        
        const placement = this.createPlacementData(gridPos, state.selectedUnitType, this.game.state.mySide);

        this.game.networkManager.submitPlacement(placement, (success, response) => {
            if(success){
                this.placeSquad(placement);
            }
        });        
    }

    
    canPlayerPlaceSquad() {
        return true;
    }

    placeSquad(placement) {
        // Double-check squad limits before placing
        const team = this.game.state.mySide;

        // Early validation check
        const unitPositions = this.game.squadManager.calculateUnitPositions(placement.gridPosition, placement.unitType);
        const undoInfo = this.createUndoInfo(placement);
        
        // Batch unit creation for better performance
        const squadUnits = this.createSquadUnits(placement, unitPositions, team, undoInfo);
        placement.squadUnits = squadUnits;
        placement.isSquad = squadUnits.length > 1;
        this.updateGameStateForPlacement(placement, this.game.state.mySide);
        
        this.game.gridSystem.occupyCells(placement.cells, placement.placementId);
        // Initialize squad in experience system
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.initializeSquad(placement.placementId, placement.unitType, squadUnits, team);
        }
        
        // Batch effects creation
        if (this.game.effectsSystem && squadUnits.length <= 8) {
            this.createPlacementEffects(unitPositions.slice(0, 8), team);
        }
        // Clear caches after placement
        this.cachedValidation = null;
        this.cachedGridPos = null;
        
        if (this.placementPreview) {
            this.placementPreview.clear();
        }

        this.game.state.selectedUnitType = null;
        this.handleUnitSelectionChange();
        
        
        return placement;
            

    }

    createSquadUnits(placement, unitPositions, team, undoInfo) {
        const createdUnits = [];
        
        // Limit unit creation for very large formations
        const maxUnits = Math.min(unitPositions.length, 16);
        const positions = unitPositions.slice(0, maxUnits);
        
        positions.forEach(pos => {
            const terrainHeight = this.game.terrainSystem?.getTerrainHeightAtPosition(pos.x, pos.z) || 0;
            const unitY = terrainHeight !== null ? terrainHeight : 0;
        
            const entityId = this.game.unitCreationManager.create(pos.x, unitY, pos.z, pos, placement, team);
            createdUnits.push(entityId);
            undoInfo.unitIds.push(entityId);
            
            
            if(placement.unitType.id == 'goldMine'){
                const gridWidth = placement.unitType.placementGridWidth || 2;
                const gridHeight = placement.unitType.placementGridHeight || 2;
                this.game.goldMineSystem.buildGoldMine(entityId, team, placement.gridPosition, gridWidth, gridHeight);
            }
            if (placement.peasantInfo && placement.collection === 'buildings') {
                const peasantInfo = placement.peasantInfo;
                const peasantIds = peasantInfo.peasantIds || [];
                const buildTime = peasantInfo.buildTime;
                
                const ComponentTypes = this.game.componentManager.getComponentTypes();
                const placementComponent = this.game.getComponent(entityId, ComponentTypes.PLACEMENT);
                const renderComponent = this.game.getComponent(entityId, ComponentTypes.RENDERABLE);
                
                renderComponent.spawnType = 'underConstruction';
                
                if (placementComponent) {
                    placementComponent.isUnderConstruction = true;
                    placementComponent.buildTime = buildTime;
                    placementComponent.assignedBuilder = peasantIds[0] || null;
                }
                
                // Get the build ability from the peasant's abilities
                if (peasantIds.length > 0) {
                    const peasantAbilities = this.game.abilitySystem.entityAbilities.get(peasantIds[0]);
                    if (peasantAbilities) {
                        console.log("peasantAbilities", peasantAbilities);
                        const buildAbility = peasantAbilities.find(a => a.id === 'build');
                        if (buildAbility) {
                            buildAbility.assignToBuild(peasantIds[0], entityId);
                        }
                    }
                }
                
                // Clear the flag (only once for first building entity)
                this.game.state.peasantBuildingPlacement = null;
            }
        });
        
        return createdUnits;
    }

    createUndoInfo(placement) {
        return {
            type: 'squad_placement',
            placementId: placement.placementId,
            collection: placement.collection,
            unitType: { ...placement.unitType },
            cost: placement.unitType.value || 0,
            gridPosition: { ...placement.gridPosition },
            cells: [...placement.cells],
            unitIds: [],
            team: this.game.state.mySide,
            timestamp: this.game.state.now
        };
    }

    createPlacementData(gridPos, unitType, team) {
        const squadData = this.game.squadManager.getSquadData(unitType);
        const cells = this.game.squadManager.getSquadCells(gridPos, squadData);
        
        const placementId = `squad_${team}_${gridPos.x}_${gridPos.z}_${this.game.state.round}`;
        return {
            placementId: placementId,
            gridPosition: gridPos,
            cells: cells,
            collection: unitType.collection,
            unitType: { ...unitType },
            squadUnits: [],
            team: team,
            targetPosition: this.game.state.targetPositions.get(placementId),
            roundPlaced: this.game.state.round,
            timestamp: this.game.state.now,
            peasantInfo: this.game.state.peasantBuildingPlacement
        };
    }

    updateGameStateForPlacement(placement, team, undoInfo) {                
        if (this.isMyTeam(team)) {
        
            this.addToUndoStack(undoInfo);
            if(!placement.isStartingState){
                this.game.state.playerGold -= (placement.unitType.value || 0);
            }
            this.playerPlacements.push(placement);
        } else {
            this.opponentPlacements.push(placement);
        }
    }

    setPlacementExperience(placements) {
        if (placements && this.game.squadExperienceSystem) {
            placements.forEach(placement => {
                if (placement.experience && placement.placementId) {
                    const experienceData = placement.experience;                
                    let squadData = this.game.squadExperienceSystem.getSquadInfo(placement.placementId);
                    
                    if (squadData) {
                        squadData.level = experienceData.level;
                        squadData.experience = experienceData.experience;
                        squadData.experienceToNextLevel = experienceData.experienceToNextLevel;
                        squadData.canLevelUp = experienceData.canLevelUp;                    
                    }
                }
            });            
        }
        
    }
    

    isMyTeam(team){
        return team == this.game.state.mySide;
    }

    createPlacementEffects(unitPositions, team) {
        if (!this.game.effectsSystem) return;
        
        const effectType = this.isMyTeam(team) ? 'magic' : 'defeat';
        const maxEffects = Math.min(unitPositions.length, 6);
        
        for (let i = 0; i < maxEffects; i++) {
            const pos = unitPositions[i];
            const terrainHeight = this.game.unitCreationManager.getTerrainHeight(pos.x, pos.z);
            const unitY = terrainHeight !== null ? terrainHeight : 0;
            
            this.game.effectsSystem.createParticleEffect(
                pos.x,
                unitY,
                pos.z,
                effectType,
                { count: 3, speedMultiplier: 0.8 }
            );
        }
    }
    // Undo functionality for multiplayer
    undoLastPlacement() {
        if (!this.config.enableUndo) return;
        
        const state = this.game.state;
        
        if (state.phase !== 'placement') {
          
            return;
        }
        
        // Don't allow undo if already ready
        if (this.isPlayerReady) {
       
            return;
        }
        
        if (this.undoStack.length === 0) {
     
            return;
        }
        
        const undoInfo = this.undoStack.pop();
        
        try {
            undoInfo.unitIds.forEach(entityId => {
                if (this.game.destroyEntity) {
                    this.game.destroyEntity(entityId);
                }
            });
            
            state.playerGold += undoInfo.cost;
            
            const placementIndex = this.playerPlacements.findIndex(p => p.placementId === undoInfo.placementId);
            if (placementIndex !== -1) {
                this.playerPlacements.splice(placementIndex, 1);
            }
            
            // Remove from experience system
            if (this.game.squadExperienceSystem) {
                this.game.squadExperienceSystem.removeSquad(undoInfo.placementId);
            }
            
            this.game.gridSystem.freeCells(undoInfo.placementId);
            this.createUndoEffects(undoInfo);
            
            // Clear caches after undo
            this.cachedValidation = null;
            this.cachedGridPos = null;
            
        } catch (error) {
            console.error('Undo failed:', error);
          
        }
    }

    createUndoEffects(undoInfo) {
        if (!this.game.effectsSystem) return;
        
        // Limit undo effects
        const maxEffects = Math.min(undoInfo.cells.length, 4);
        
        for (let i = 0; i < maxEffects; i++) {
            const cell = undoInfo.cells[i];
            const worldPos = this.game.gridSystem.gridToWorld(cell.x, cell.z);
            this.game.effectsSystem.createParticleEffect(
                worldPos.x,
                0,
                worldPos.z,
                'magic',
                { count: 3, speedMultiplier: 0.7 }
            );
        }
    }


    getPlacementById(placementId) {
        // Search in player placements first
        const playerPlacement = this.playerPlacements.find(placement => placement.placementId === placementId);
        if (playerPlacement) {
            return playerPlacement;
        }
        
        // Search in opponent placements
        const opponentPlacement = this.opponentPlacements.find(placement => placement.placementId === placementId);
        if (opponentPlacement) {
            return opponentPlacement;
        }
        
        // Return null if no matching placement is found
        return null;
    }
    collectPlayerPlacements() {
        return this.playerPlacements;
    }

    initializeControls() {
        this.elements.readyButton = document.getElementById('placementReadyBtn');
        this.elements.undoButton = document.getElementById('undoBtn');

        if (this.config.enableUndo) {
            document.addEventListener('keydown', (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
                    event.preventDefault();
                    this.undoLastPlacement();
                }
            });
        }
        
        if (this.config.enablePreview && this.placementPreview) {
            
            let animationFrameId = null;
            let pendingMouseEvent = null;
            
            const throttledMouseMove = (event) => {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                }
                pendingMouseEvent = event;
                
                animationFrameId = requestAnimationFrame(() => {
                    
                    if (this.game.state.now - this.lastUpdateTime < .08) {
                        
                        return;
                    }
                    
                    this.lastUpdateTime = this.game.state.now;
                    if (this.game.state.phase === 'placement' && 
                        this.game.state.selectedUnitType && 
                        !this.isPlayerReady &&
                        pendingMouseEvent) {
                        
                        this.updatePlacementPreview(pendingMouseEvent);
                    }
                    
                    animationFrameId = null;
                    pendingMouseEvent = null;
                });
            };
            
            this.canvas.addEventListener('mousemove', throttledMouseMove);
            
            this.canvas.addEventListener('mouseleave', () => {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
                
                this.placementPreview.clear();
                this.cachedValidation = null;
                this.cachedGridPos = null;
                document.body.style.cursor = 'default';
            });
        }
    }

    updatePlacementPreview(event) {
        if (!this.placementPreview) return;
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.lastMouseX = mouseX;
        this.lastMouseY = mouseY;
        
        const timeSinceLastRaycast = this.game.state.now - (this.lastRaycastTime || 0);
        const shouldRaycast = timeSinceLastRaycast > 0.15;
        
        let worldPosition;
        if (!shouldRaycast) {
            return;
        } else {
            worldPosition = this.getWorldPositionFromMouse(event, mouseX, mouseY);
            
            if (worldPosition) {
                this.cachedWorldPos = worldPosition;
                this.lastRaycastTime = this.game.state.now;
                this.lastRaycastMouseX = mouseX;
                this.lastRaycastMouseY = mouseY;
            }
        }
        
        if (!worldPosition) {
            this.placementPreview.clear();
            document.body.style.cursor = 'not-allowed';
            return;
        }
        
        const gridPos = this.game.gridSystem.worldToGrid(worldPosition.x, worldPosition.z);
        
        let isValid = false;
        const state = this.game.state;
        
        if (state.selectedUnitType?.collection === 'buildings' && state.selectedUnitType.id === 'goldMine') {
            const gridWidth = state.selectedUnitType.placementGridWidth || 2;
            const gridHeight = state.selectedUnitType.placementGridHeight || 2;
            const validation = this.game.goldMineSystem.isValidGoldMinePlacement(gridPos, gridWidth, gridHeight);
            isValid = validation.valid;
        } else {
            isValid = this.isValidGridPlacement(worldPosition);
        }
        
        document.body.style.cursor = isValid ? 'crosshair' : 'not-allowed';
        this.placementPreview.update(gridPos, this.game.state.selectedUnitType, this.game.state.mySide);
    }

    getWorldPositionFromMouse(event, mouseX, mouseY) {
        if (!this.game.scene || !this.game.camera) return null;
        
        if (!this.mouse) {
            this.mouse = new THREE.Vector2();
        }
        
        if (mouseX !== undefined && mouseY !== undefined) {
            this.mouse.set(mouseX, mouseY);
        } else {
            const rect = this.canvas.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        }
        
        if (!this.raycaster) {
            this.raycaster = new THREE.Raycaster();
        }
        this.raycaster.setFromCamera(this.mouse, this.game.camera);
        
        // Mathematical intersection with plane at y = 0
        const ray = this.raycaster.ray;
        
        // Check if ray is pointing downward (or upward if camera is below ground)
        if (Math.abs(ray.direction.y) < 0.0001) {
            return null; // Ray is parallel to ground plane
        }
        
        // Calculate distance to intersection point
        const distance = (0 - ray.origin.y) / ray.direction.y;
        
        // Only return intersection if it's in front of the camera
        if (distance < 0) {
            return null;
        }
        
        // Calculate intersection point
        const intersectionPoint = ray.origin.clone().add(
            ray.direction.clone().multiplyScalar(distance)
        );
        
        return intersectionPoint;
    }

    findGroundMesh() {
        if (this.game.worldSystem?.ground) {
            return this.game.worldSystem.ground;
        }
        
        for (let child of this.game.scene.children) {
            if (child.isMesh && child.geometry?.type === 'PlaneGeometry') {
                return child;
            }
        }
        return null;
    }

    getGroundMesh() {
        return this.findGroundMesh();
    }

    isValidGridPlacement(worldPos, selectedUnitType = null) {
        if (!worldPos) return false;

        const gridPos = this.game.gridSystem.worldToGrid(worldPos.x, worldPos.z);
        if (!this.game.gridSystem.isValidPosition(gridPos)) return false;

        const selectedUnit = selectedUnitType || this.game.state.selectedUnitType;
        if (!selectedUnit) return false;

        // Build cells for the squad
        let cells = [gridPos];
        if (this.game.squadManager) {
            const squadData = this.game.squadManager.getSquadData(selectedUnit);
            const validation = this.game.squadManager.validateSquadConfig(squadData);
            if (!validation.valid) return false;
            cells = this.game.squadManager.getSquadCells(gridPos, squadData);
        }

        // Use grid system's validation which now includes side checking
        return this.game.gridSystem.isValidPlacement(cells, this.game.state.mySide);
    }

    getTotalUnitCount(placements) {
        return placements.reduce((sum, placement) => {
            return sum + (placement.isSquad ? placement.squadUnits.length : 1);
        }, 0);
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

    setTeamSides(sides) {
        // sides = { player: 'left'|'right', enemy: 'left'|'right' }
        this.teamSides = {
            player: sides?.player || 'left',
            enemy: sides?.enemy || 'right'
        };
    }

    updateCursorState() {
        if (this.isPlayerReady) {
            document.body.style.cursor = 'not-allowed';
        } else if (this.game.state.selectedUnitType && this.cachedValidation) {
            document.body.style.cursor = this.cachedValidation.isValid ? 'crosshair' : 'not-allowed';
        } else {
            document.body.style.cursor = 'default';
        }
    }

    handleBattleEnd() {        
        this.removeDeadSquadsAfterRound();
      //  this.updateGridPositionsAfterRound();
    }
        
    removeDeadSquadsAfterRound() {
        if (!this.game.componentManager) return;

        const ComponentTypes = this.game.componentManager.getComponentTypes();
        this.playerPlacements = this.filterDeadSquads(this.playerPlacements, ComponentTypes);
        this.opponentPlacements = this.filterDeadSquads(this.opponentPlacements, ComponentTypes);
    }

    filterDeadSquads(placements, ComponentTypes) {
        return placements.filter(placement => {
            if (!placement.squadUnits || placement.squadUnits.length === 0) {
                this.cleanupDeadSquad(placement);
                return false;
            }

            const aliveUnits = placement.squadUnits.filter(entityId => {
                const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
                const deathState = this.game.getComponent(entityId, ComponentTypes.DEATH_STATE);
                return health && health.current > 0 && (!deathState || !deathState.isDying);
            });

            if (aliveUnits.length === 0) {
                this.cleanupDeadSquad(placement);
                return false;
            }

            placement.squadUnits = aliveUnits;
            return true;
        });
    }

    cleanupDeadSquad(placement) {
        if (this.game.gridSystem && placement.placementId) {
            this.game.gridSystem.freeCells(placement.placementId);
        }

        if (this.game.squadExperienceSystem && placement.placementId) {
            this.game.squadExperienceSystem.removeSquad(placement.placementId);
        }

    }

    updateGridPositionsAfterRound() {
        if (!this.game.gridSystem || !this.game.componentManager) return;

        const ComponentTypes = this.game.componentManager.getComponentTypes();
        this.game.gridSystem.clear();

        [this.playerPlacements, this.opponentPlacements].forEach(placements => {
            placements.forEach(placement => {
                if (!placement.squadUnits || placement.squadUnits.length === 0) return;

                const aliveUnits = placement.squadUnits.filter(entityId => {
                    const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
                    const deathState = this.game.getComponent(entityId, ComponentTypes.DEATH_STATE);
                    return health && health.current > 0 && (!deathState || !deathState.isDying);
                });

                if (aliveUnits.length === 0) return;

                const positions = aliveUnits.map(entityId => {
                    const pos = this.game.getComponent(entityId, ComponentTypes.POSITION);
                    return pos ? { x: pos.x, z: pos.z } : null;
                }).filter(p => p !== null);

                if (positions.length === 0) return;

                const avgX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
                const avgZ = positions.reduce((sum, p) => sum + p.z, 0) / positions.length;
                const newGridPos = this.game.gridSystem.worldToGrid(avgX, avgZ);

                if (this.game.gridSystem.isValidPosition(newGridPos)) {
                    placement.gridPosition = newGridPos;
                    placement.squadUnits = aliveUnits;

                    const squadData = this.game.squadManager?.getSquadData(placement.unitType);
                    if (squadData) {
                        const cells = this.game.squadManager.getSquadCells(newGridPos, squadData);
                        placement.cells = cells;
                        this.game.gridSystem.occupyCells(cells, placement.placementId);
                    }
                }
            });
        });
    }

    resetAllPlacements() {
        // Clean up experience system first
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.reset();
        }
        
        this.playerPlacements = [];
        this.opponentPlacements = [];
        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;
        this.clearUndoStack();
        this.game.gridSystem.clear();
        
 
        
        // Clear caches
        this.cachedValidation = null;
        this.cachedGridPos = null;
        this.groundMeshCache = null;
        this.groundMeshCache = this.findGroundMesh();
        
        if (this.placementPreview) {
            this.placementPreview.clear();
        }
        
    }

    dispose() {
        this.cachedValidation = null;
        this.cachedGridPos = null;
        this.groundMeshCache = null;
        
        if (this.placementPreview) {
            this.placementPreview.dispose();
        }
                
        this.resetAllPlacements();
        
        console.log('MultiplayerPlacementSystem disposed');
    }

    getUnitAtWorldPosition(worldPos) {
        const clickRadius = 30;
        let closestEntityId = null;
        let closestDistance = clickRadius;
        
        const entities = this.game.getEntitiesWith(
            this.game.componentManager.getComponentTypes().POSITION,
            this.game.componentManager.getComponentTypes().TEAM
        );
        
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.game.componentManager.getComponentTypes().POSITION);
            const team = this.game.getComponent(entityId, this.game.componentManager.getComponentTypes().TEAM);
            
            const dx = pos.x - worldPos.x;
            const dz = pos.z - worldPos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closestEntityId = entityId;
            }
        });
        
        return closestEntityId;
    }



}