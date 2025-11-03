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
        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;
        
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

            this.elements.undoButton.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.elements.undoButton.style.transform = 'scale(1)';
            }, 150);
            
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
            this.placementPreview = new GUTS.PlacementPreview(this.game);
        }
        
        this.groundMeshCache = this.findGroundMesh();
    }

    onGameStarted() {
        this.getStartingState();
        this.onPlacementPhaseStart();
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
                const pos = response.camera.position;
                const look = response.camera.lookAt;
                this.game.camera.position.set(pos.x, pos.y, pos.z);
                this.game.camera.lookAt(look.x, look.y, look.z);
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

    onPlacementPhaseStart() { 
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
            let opponentPlacements = null;
            data.gameState.players.forEach((player) => {
                if(player.id != myPlayerId){
                    opponentPlacements = player.placements;
                }
            });
            this.applyOpponentPlacements(opponentPlacements);
            this.applyTargetPositions();
            this.game.state.phase = 'battle';
            this.game.resetCurrentTime();
            this.resetAI();
            this.game.desyncDebugger.enabled = true;
            this.game.desyncDebugger.displaySync(true);
            if (this.elements.readyButton) {
                this.elements.readyButton.disabled = true;
                this.elements.readyButton.textContent = 'Battling!';
            }
        } else {
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
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const allPlacements = [...this.playerPlacements, ...this.opponentPlacements];
        allPlacements.forEach((placement) => {
            placement.squadUnits.forEach(entityId => {
                const aiState = this.game.getComponent(entityId, ComponentTypes.AI_STATE);
                const position = this.game.getComponent(entityId, ComponentTypes.POSITION);
                if (aiState && position) {
                    let targetPosition = aiState.targetPosition;
                    let tempPosition = this.game.unitOrderSystem.temporaryOpponentMoveOrders.get(placement.placementId);
                    if(tempPosition){
                        targetPosition = tempPosition;
                        this.game.unitOrderSystem.temporaryOpponentMoveOrders.delete(placement.placementId);                    
                    }

                    if(targetPosition){
                        if(!aiState.currentAIController || aiState.currentAIController == "OrderSystemMove"){
                            const dx = position.x - targetPosition.x;
                            const dz = position.z - targetPosition.z;
                            const distSq = dx * dx + dz * dz;
                            const threshold = this.game.getCollections().configs.game.gridSize * 0.5;
                            if (distSq <= threshold * threshold) {
                                aiState.currentAIController = null;
                                aiState.targetPosition = null;
                                placement.targetPosition = null;
                            } else {
                                aiState.targetPosition = { ...targetPosition };      
                                aiState.currentAIController = "OrderSystemMove";
                            }
                        }
                    }
                }
            });
        });
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

    applyOpponentPlacements(opponentData) {
        opponentData.forEach(placement => {
            if(this.game.placementSystem.opponentPlacements.find(p => p.placementId === placement.placementId)) {
                return;
            }
            this.placeSquad(placement);         
        });

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

    handleCanvasClick(event) {
        const state = this.game.state;
        
        if (this.settingTargetPosition) {
            return;
        }
        
        if (state.phase !== 'placement') {
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
        
        if (state.playerGold < state.selectedUnitType.value) {
            return;
        }
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        const worldPosition = this.getWorldPositionFromMouse(event, mouseX, mouseY);
        let gridPos = this.game.gridSystem.worldToGrid(worldPosition.x, worldPosition.z);
        
        let isValidPlacement = this.isValidGridPlacement(worldPosition);
       
        if (!isValidPlacement) {
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
        const unitPositions = this.game.squadManager.calculateUnitPositions(placement.gridPosition, placement.unitType);
        const undoInfo = this.createUndoInfo(placement);
        
        const squadUnits = this.createSquadUnits(placement, unitPositions, placement.team, undoInfo);
        placement.squadUnits = squadUnits;
        placement.isSquad = squadUnits.length > 1;
        this.updateGameStateForPlacement(placement, undoInfo);
        
        this.game.gridSystem.occupyCells(placement.cells, placement.placementId);
        
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.initializeSquad(placement.placementId, placement.unitType, squadUnits, placement.team);
        }
        
        if (this.game.effectsSystem && squadUnits.length <= 8) {
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

    createSquadUnits(placement, unitPositions, team, undoInfo) {
        const createdUnits = [];
        
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
                const peasantId = peasantInfo.peasantId;
                const peasantAbilities = this.game.abilitySystem.entityAbilities.get(peasantId);
                if (peasantAbilities) {
                    const buildAbility = peasantAbilities.find(a => a.id === 'build');
                    if (buildAbility) {
                        buildAbility.assignToBuild(peasantId, entityId, peasantInfo);
                    }
                }
                
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

    updateGameStateForPlacement(placement, undoInfo) {                
        if (this.isMyTeam(placement.team)) {
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

    undoLastPlacement() {
        if (!this.config.enableUndo) return;
        
        const state = this.game.state;
        
        if (state.phase !== 'placement') {
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
            
            if (this.game.squadExperienceSystem) {
                this.game.squadExperienceSystem.removeSquad(undoInfo.placementId);
            }
            
            this.game.gridSystem.freeCells(undoInfo.placementId);
            this.createUndoEffects(undoInfo);
            
            this.cachedValidation = null;
            this.cachedGridPos = null;
            
        } catch (error) {
            console.error('Undo failed:', error);
        }
    }

    createUndoEffects(undoInfo) {
        if (!this.game.effectsSystem) return;
        
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
        const playerPlacement = this.playerPlacements.find(placement => placement.placementId === placementId);
        if (playerPlacement) {
            return playerPlacement;
        }
        
        const opponentPlacement = this.opponentPlacements.find(placement => placement.placementId === placementId);
        if (opponentPlacement) {
            return opponentPlacement;
        }
        
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
        const state = this.game.state;
        
        let cells = [];
        let isValid = this.isValidGridPlacement(worldPosition);
        let unitPositions = null;

        if (state.selectedUnitType.collection === 'buildings') {
            cells = this.calculateBuildingCells(gridPos, state.selectedUnitType);            
        } else {
            const squadData = this.game.squadManager.getSquadData(state.selectedUnitType);
            cells = this.game.squadManager.getSquadCells(gridPos, squadData);
            if (this.game.squadManager.getSquadSize(squadData) > 1) {
                unitPositions = this.game.squadManager.calculateUnitPositions(gridPos, state.selectedUnitType);
            }
        }

        const worldPositions = cells.map(cell => 
            this.game.gridSystem.gridToWorld(cell.x, cell.z)
        );

        if (unitPositions && unitPositions.length > 0) {
            this.placementPreview.showWithUnitMarkers(worldPositions, unitPositions, isValid);
        } else {
            this.placementPreview.showAtWorldPositions(worldPositions, isValid);
        }

        document.body.style.cursor = isValid ? 'crosshair' : 'not-allowed';
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
        
        const ray = this.raycaster.ray;
        
        if (Math.abs(ray.direction.y) < 0.0001) {
            return null;
        }
        
        const distance = (0 - ray.origin.y) / ray.direction.y;
        
        if (distance < 0) {
            return null;
        }
        
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

    isValidGridPlacement(worldPos, unitDef) {
        const selectedUnitType = unitDef || this.game.state.selectedUnitType;
        
        let gridPos = this.game.gridSystem.worldToGrid(worldPos.x, worldPos.z);
        let cells = [];
        let isValid = false;
        let gridValid = false;

        if (selectedUnitType.collection === 'buildings') {
            cells = this.calculateBuildingCells(gridPos, selectedUnitType);
            
            if (selectedUnitType.id === 'goldMine') {
                const gridWidth = selectedUnitType.placementGridWidth || 2;
                const gridHeight = selectedUnitType.placementGridHeight || 2;
                const validation = this.game.goldMineSystem.isValidGoldMinePlacement(gridPos, gridWidth, gridHeight);
                isValid = validation.valid;
            } else {
                gridValid = this.game.gridSystem.isValidPlacement(cells, this.game.state.mySide);
                
                let terrainValid = true;
                cells.forEach((cell) => {
                    const terrainTypeId = this.game.terrainSystem.getTerrainTypeAtGridPosition(cell.x, cell.z);
                    if(!terrainTypeId) {
                        terrainValid = false;
                        return;
                    }
                    const terrainType = this.game.worldSystem.tileMap.terrainTypes[terrainTypeId];
                    
                    terrainValid = terrainValid && terrainType.buildable;
                });
                

                isValid = gridValid && terrainValid;
            }
        } else {
            const squadData = this.game.squadManager.getSquadData(selectedUnitType);
            cells = this.game.squadManager.getSquadCells(gridPos, squadData);
            gridValid = this.game.gridSystem.isValidPlacement(cells, this.game.state.mySide);
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

    setTeamSides(sides) {
        this.teamSides = {
            player: sides?.player || 'left',
            enemy: sides?.enemy || 'right'
        };
    }

    calculateBuildingCells(gridPos, building) {
        const cells = [];
        const gridWidth = building.placementGridWidth || 1;
        const gridHeight = building.placementGridHeight || 1;
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
        this.removeDeadSquadsAfterRound();
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
                const buildingState = this.game.getComponent(entityId, ComponentTypes.BUILDING_STATE);
                if(buildingState) return true;
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
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.reset();
        }
        
        this.playerPlacements = [];
        this.opponentPlacements = [];
        this.isPlayerReady = false;
        this.hasSubmittedPlacements = false;
        this.clearUndoStack();
        this.game.gridSystem.clear();
        
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