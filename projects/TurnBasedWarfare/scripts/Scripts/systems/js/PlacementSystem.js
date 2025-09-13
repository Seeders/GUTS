class PlacementSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.placementSystem = this;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.canvas = this.game.canvas;
        
        this.playerPlacements = [];
        this.enemyPlacements = [];
        this.undoStack = [];
        this.maxUndoSteps = 10;
        
        // Performance optimizations
        this.lastMouseMoveTime = 0;
        this.lastValidationTime = 0;
        this.cachedValidation = null;
        this.cachedGridPos = null;
        this.groundMeshCache = null;
        
        this.config = {
            maxUnitsPerRound: 10,
            maxCombinationsToCheck: 1000,
            unitPlacementDelay: 200,
            enablePreview: true,
            enableUndo: true,
            enableGridSnapping: true,
            mouseMoveThrottle: 16, // ~60fps
            validationThrottle: 32, // ~30fps for validation
            raycastThrottle: 16 // Throttle expensive raycasting
        };
        
        this.initializeSubsystems();
        this.initializeControls();
        
        if (this.config.enablePreview) {
            this.placementPreview = new GUTS.PlacementPreview(
                this.game.scene, 
                this.gridSystem, 
                this.squadManager
            );
        }
    }
    
    //game loop update - OPTIMIZED
    update(deltaTime) {
        // Only update if in placement phase - avoid unnecessary work
        if (this.game.state.phase !== 'placement') {
            return;
        }
        
        // Throttled updates only
        const now = performance.now();
        if (now - this.lastValidationTime > this.config.validationThrottle) {
            this.updateCursorState();
            this.lastValidationTime = now;
        }
    }
    
    updateCursorState() {
        // Lightweight cursor update without expensive raycasting
        if (this.game.state.selectedUnitType && this.cachedValidation) {
            document.body.style.cursor = this.cachedValidation.isValid ? 'crosshair' : 'not-allowed';
        } else {
            document.body.style.cursor = 'default';
        }
    }
  
    initializeSubsystems() {
        const terrainSize = this.game.worldSystem?.terrainSize || 768;
        
        this.gridSystem = this.game.gridSystem;
        this.gridSystem.init(terrainSize);
        this.squadManager = this.game.squadManager;
        this.unitCreator = this.game.unitCreationManager;
        this.enemyStrategy = new GUTS.EnemyStrategy();
        
        if (this.config.enablePreview) {
            this.placementPreview = new GUTS.PlacementPreview(
                this.game.scene, 
                this.gridSystem, 
                this.squadManager
            );
        }
        
        // Cache ground mesh on initialization
        this.groundMeshCache = this.findGroundMesh();
    }
    initializeControls() {
        if (this.config.enableUndo) {
            document.addEventListener('keydown', (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
                    event.preventDefault();
                    this.undoLastPlacement();
                }
            });
        }
        
        if (this.config.enablePreview && this.placementPreview) {
            let lastUpdateTime = 0;
            let animationFrameId = null;
            let pendingMouseEvent = null;
            
            const throttledMouseMove = (event) => {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                }
                
                pendingMouseEvent = event;
                
                animationFrameId = requestAnimationFrame(() => {
                    const now = performance.now();
                    
                    if (now - lastUpdateTime < 8) {
                        return;
                    }
                    
                    lastUpdateTime = now;
                    
                    if (this.game.state.phase === 'placement' && 
                        this.game.state.selectedUnitType && 
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
        
        // Only raycast every 50ms or on significant movement
        const now = performance.now();
        const timeSinceLastRaycast = now - (this.lastRaycastTime || 0);
        const shouldRaycast = timeSinceLastRaycast > 150;
        
        let worldPosition;
        if (!shouldRaycast) {
            return;
        } else {
            // Full raycast
            worldPosition = this.getWorldPositionFromMouse(event, mouseX, mouseY);
            if (worldPosition) {
                this.cachedWorldPos = worldPosition;
                this.lastRaycastTime = now;
                this.lastRaycastMouseX = mouseX;
                this.lastRaycastMouseY = mouseY;
                
                // Calculate approximate world scale for interpolation
                if (this.previousWorldPos && this.previousMouseX !== undefined) {
                    const worldDelta = Math.abs(worldPosition.x - this.previousWorldPos.x) + Math.abs(worldPosition.z - this.previousWorldPos.z);
                    const mouseDeltaPrev = Math.abs(mouseX - this.previousMouseX) + Math.abs(mouseY - this.previousMouseY);
                    if (mouseDeltaPrev > 0) {
                        this.approximateWorldScale = worldDelta / mouseDeltaPrev;
                    }
                }
                
                this.previousWorldPos = { ...worldPosition };
                this.previousMouseX = mouseX;
                this.previousMouseY = mouseY;
            }
        }
        
        if (!worldPosition) {
            this.placementPreview.clear();
            document.body.style.cursor = 'not-allowed';
            return;
        }
        
        const gridPos = this.gridSystem.worldToGrid(worldPosition.x, worldPosition.z);
        
        let isValid;
        if (this.cachedGridPos && 
            this.cachedGridPos.x === gridPos.x && 
            this.cachedGridPos.z === gridPos.z) {
            isValid = this.cachedValidation?.isValid || false;
        } else {
            isValid = this.isValidPlayerPlacement(worldPosition);
            this.cachedGridPos = gridPos;
            this.cachedValidation = { isValid, timestamp: performance.now() };
        }
        
        document.body.style.cursor = isValid ? 'crosshair' : 'not-allowed';
        this.placementPreview.update(gridPos, this.game.state.selectedUnitType, 'player');
    }
            
    getWorldPositionFromMouse(event, mouseX, mouseY) {
        if (!this.game.scene || !this.game.camera) return null;
        
        if (!this.groundMeshCache) {
            this.groundMeshCache = this.getGroundMesh();
        }
        
        const ground = this.groundMeshCache;
        if (!ground) return null;
        
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
        
        const intersects = this.raycaster.intersectObject(ground, false);
        return intersects.length > 0 ? intersects[0].point : null;
    }

    handleUnitSelectionChange(newUnitType) {
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

    findGroundMesh() {
        if (this.game.worldSystem?.ground) {
            return this.game.worldSystem.ground;
        }
        
        // Cache the first suitable mesh found
        for (let child of this.game.scene.children) {
            if (child.isMesh && child.geometry?.type === 'PlaneGeometry') {
                return child;
            }
        }
        return null;
    }
    
    handleCanvasClick(event) {
        const state = this.game.state;
        
        if (state.phase !== 'placement' || !state.selectedUnitType) {
            return;
        }
        
        // Check squad limit first
        if (!this.game.phaseSystem.canPlayerPlaceSquad()) {
            this.game.battleLogSystem?.add(`Maximum ${this.game.phaseSystem.config.maxSquadsPerRound} squads per round reached!`, 'log-damage');
            return;
        }
        
        if (state.playerGold < state.selectedUnitType.value) {
            this.game.battleLogSystem?.add('Not enough gold!', 'log-damage');
            return;
        }
        
        // Use cached validation if available and recent
        let isValidPlacement = false;
        let gridPos = null;
        
        if (this.cachedValidation && 
            performance.now() - this.cachedValidation.timestamp < 100) {
            // Use cached validation for recent clicks
            isValidPlacement = this.cachedValidation.isValid;
            gridPos = this.cachedValidation.gridPos;
        } else {
            // Fallback to full validation
            const worldPosition = this.getWorldPositionFromMouse(event);
            if (worldPosition) {
                gridPos = this.gridSystem.worldToGrid(worldPosition.x, worldPosition.z);
                isValidPlacement = this.isValidPlayerPlacement(worldPosition);
            }
        }
        
        if (!isValidPlacement || !gridPos) {
            this.game.battleLogSystem?.add('Invalid placement location!', 'log-damage');
            return;
        }
        
        // Validate squad configuration before placement
        if (this.squadManager) {
            const squadData = this.squadManager.getSquadData(state.selectedUnitType);
            const validation = this.squadManager.validateSquadConfig(squadData);
            
            if (!validation.valid) {
                this.game.battleLogSystem?.add(`Invalid squad configuration: ${validation.errors.join(', ')}`, 'log-damage');
                return;
            }
        }
        
        this.placeSquad(gridPos, state.selectedUnitType, 'player');
    }
            
    placeSquad(gridPos, unitType, team) {
        // Double-check squad limits before placing
        if (team === 'player' && !this.game.phaseSystem.canPlayerPlaceSquad()) {
            this.game.battleLogSystem?.add(`Maximum ${this.game.phaseSystem.config.maxSquadsPerRound} squads per round reached!`, 'log-damage');
            return null;
        }
        
        if (team === 'enemy' && !this.game.phaseSystem.canEnemyPlaceSquad()) {
            return null;
        }
        const squadData = this.squadManager.getSquadData(unitType);
        const cells = this.squadManager.getSquadCells(gridPos, squadData);
        
        // Early validation check
        if (!this.gridSystem.isValidPlacement(cells, team)) {
            if (team === 'player') {
                this.game.battleLogSystem?.add('Cannot place squad at this location!', 'log-damage');
            }
            return null;
        }
        
        const placementId = `${team}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const squadUnits = [];
        const unitPositions = this.squadManager.calculateUnitPositions(gridPos, squadData, this.gridSystem);
        const undoInfo = this.createUndoInfo(placementId, unitType, gridPos, cells, team);
        
        try {
            // Batch unit creation for better performance
            const createdUnits = this.createSquadUnits(unitPositions, unitType, team, undoInfo);
            squadUnits.push(...createdUnits);
            
            this.updateGameStateForPlacement(placementId, gridPos, cells, unitType, squadUnits, team, undoInfo);
            this.gridSystem.occupyCells(cells, placementId);
            
            // Initialize squad in experience system
            if (this.game.squadExperienceSystem) {
                const unitIds = createdUnits.map(unit => unit.entityId);
                this.game.squadExperienceSystem.initializeSquad(placementId, unitType, unitIds, team);
            }
            
            // Batch effects creation
            if (this.game.effectsSystem && createdUnits.length <= 8) { // Limit effects for performance
                this.createPlacementEffects(unitPositions.slice(0, 8), team);
            }
            
            this.logPlacement(unitType, squadUnits.length, team);
            
            // Notify phase system that a squad was placed
            if (team === 'player') {
                this.game.phaseSystem.onPlayerSquadPlaced(unitType);
            } else {
                this.game.phaseSystem.onEnemySquadPlaced(unitType);
            }
            
            // Clear caches after placement
            this.cachedValidation = null;
            this.cachedGridPos = null;
            
            if (this.placementPreview) {
                this.placementPreview.clear();
            }
            
            return placementId;
            
        } catch (error) {
            console.error('Squad placement failed:', error);
            this.cleanupFailedPlacement(undoInfo);
            return null;
        }
    }
    
    // OPTIMIZED: Batch unit creation
    createSquadUnits(unitPositions, unitType, team, undoInfo) {
        const createdUnits = [];
        
        // Limit unit creation for very large formations
        const maxUnits = Math.min(unitPositions.length, 16);
        const positions = unitPositions.slice(0, maxUnits);
        
        positions.forEach(pos => {
            const terrainHeight = this.unitCreator.getTerrainHeight(pos.x, pos.z);
            const unitY = terrainHeight !== null ? terrainHeight : 0;
            
            const entityId = this.unitCreator.create(pos.x, unitY, pos.z, unitType, team);
            createdUnits.push({
                entityId: entityId,
                position: { x: pos.x, y: unitY, z: pos.z }
            });
            undoInfo.unitIds.push(entityId);
        });
        
        return createdUnits;
    }
    
    createUndoInfo(placementId, unitType, gridPos, cells, team) {
        return {
            type: 'squad_placement',
            placementId: placementId,
            unitType: { ...unitType },
            cost: unitType.value || 0,
            gridPosition: { ...gridPos },
            cells: [...cells],
            unitIds: [],
            team: team,
            timestamp: Date.now()
        };
    }
    
    updateGameStateForPlacement(placementId, gridPos, cells, unitType, squadUnits, team, undoInfo) {
        const placement = {
            placementId: placementId,
            gridPosition: gridPos,
            cells: cells,
            unitType: { ...unitType },
            squadUnits: squadUnits,
            roundPlaced: this.game.state.round,
            isSquad: squadUnits.length > 1,
            timestamp: Date.now()
        };
        
        if (team === 'player') {
            this.addToUndoStack(undoInfo);
            this.game.state.playerGold -= (unitType.value || 0);
            this.playerPlacements.push(placement);
        } else {
            this.enemyPlacements.push(placement);
        }
    }
    
    // OPTIMIZED: Limit particle effects for performance
    createPlacementEffects(unitPositions, team) {
        if (!this.game.effectsSystem) return;
        
        const effectType = team === 'player' ? 'magic' : 'defeat';
        const maxEffects = Math.min(unitPositions.length, 6); // Limit effects
        
        for (let i = 0; i < maxEffects; i++) {
            const pos = unitPositions[i];
            const terrainHeight = this.unitCreator.getTerrainHeight(pos.x, pos.z);
            const unitY = terrainHeight !== null ? terrainHeight : 0;
            
            this.game.effectsSystem.createParticleEffect(
                pos.x,
                unitY,
                pos.z,
                effectType,
                { count: 4, speedMultiplier: 0.8 } // Reduced particle count
            );
        }
    }
    
    logPlacement(unitType, unitCount, team) {
        if (!this.game.battleLogSystem || !this.squadManager) return;
        
        const squadInfo = this.squadManager.getSquadInfo(unitType);
        const logClass = team === 'player' ? 'log-victory' : 'log-damage';
        
        // More detailed logging with SquadManager info
        const message = squadInfo.squadSize > 1 
            ? `Deployed ${squadInfo.unitName} squad (${squadInfo.squadSize} units, ${squadInfo.formationType} formation)`
            : `Deployed ${squadInfo.unitName} unit`;
            
        this.game.battleLogSystem.add(message, logClass);
    }
    
    cleanupFailedPlacement(undoInfo) {
        undoInfo.unitIds.forEach(entityId => {
            try {
                if (this.game.destroyEntity) {
                    this.game.destroyEntity(entityId);
                }
            } catch (error) {
                console.warn(`Failed to cleanup entity ${entityId}:`, error);
            }
        });
    }
            
    undoLastPlacement() {
        if (!this.config.enableUndo) return;
        
        const state = this.game.state;
        
        if (state.phase !== 'placement') {
            this.game.battleLogSystem?.add('Can only undo during placement phase!', 'log-damage');
            return;
        }
        
        if (this.undoStack.length === 0) {
            this.game.battleLogSystem?.add('Nothing to undo!', 'log-damage');
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
            
            // Decrement squad counter when undoing
            if (state.playerSquadsPlacedThisRound > 0) {
                state.playerSquadsPlacedThisRound--;
            }
            
            const placementIndex = this.playerPlacements.findIndex(p => p.placementId === undoInfo.placementId);
            if (placementIndex !== -1) {
                this.playerPlacements.splice(placementIndex, 1);
            }
            
            // Remove from experience system
            if (this.game.squadExperienceSystem) {
                this.game.squadExperienceSystem.removeSquad(undoInfo.placementId);
            }
            
            this.gridSystem.freeCells(undoInfo.placementId);
            this.createUndoEffects(undoInfo);
            this.logUndo(undoInfo);
            
            // Clear caches after undo
            this.cachedValidation = null;
            this.cachedGridPos = null;
            
        } catch (error) {
            console.error('Undo failed:', error);
            this.game.battleLogSystem?.add('Undo failed!', 'log-damage');
        }
    }

    
    createUndoEffects(undoInfo) {
        if (!this.game.effectsSystem) return;
        
        // Limit undo effects
        const maxEffects = Math.min(undoInfo.cells.length, 4);
        
        for (let i = 0; i < maxEffects; i++) {
            const cell = undoInfo.cells[i];
            const worldPos = this.gridSystem.gridToWorld(cell.x, cell.z);
            this.game.effectsSystem.createParticleEffect(
                worldPos.x,
                0,
                worldPos.z,
                'magic',
                { count: 3, speedMultiplier: 0.7 } // Reduced particles
            );
        }
    }
    
    logUndo(undoInfo) {
        if (!this.game.battleLogSystem || !this.squadManager) return;
        
        const squadInfo = this.squadManager.getSquadInfo(undoInfo.unitType);
        const message = squadInfo.squadSize > 1 
            ? `Undid placement of ${squadInfo.unitName} squad (+${undoInfo.cost}g)`
            : `Undid placement of ${squadInfo.unitName} unit (+${undoInfo.cost}g)`;
        
        this.game.battleLogSystem.add(message, 'log-victory');
    }
    
    // OPTIMIZED: Simplified enemy placement with performance limits
    placeEnemyUnits(strategy = null, onComplete) {
        this.respawnEnemyUnits();
        const round = this.game.state.round;
        const enemyTotalGold = round == 1 ? this.game.phaseSystem.config.startingGold : this.calculateEnemyTotalGold(round);

        const existingValue = this.calculateExistingEnemyValue();
        const availableGold = Math.max(0, enemyTotalGold - existingValue);
        
        const selectedStrategy = strategy || this.enemyStrategy.selectStrategy(round, this.playerPlacements);
        this.enemyStrategy.current = selectedStrategy;
        this.enemyStrategy.history.push({ round, strategy: selectedStrategy });
        
        if (this.game.battleLogSystem) {
            const strategyName = this.enemyStrategy.strategies[selectedStrategy]?.name || selectedStrategy;
            const maxSquads = this.game.phaseSystem.config.maxSquadsPerRound;
            this.game.battleLogSystem.add(
                `Enemy adopts ${strategyName} strategy! (Max ${maxSquads} squads)`,
                'log-damage'
            );
        }
        
        this.executeEnemyPlacement(availableGold, selectedStrategy, onComplete);
    }
    
    executeEnemyPlacement(budget, strategy, onComplete) {
        if (budget <= 0) {
            if (onComplete && typeof onComplete === 'function') {
                onComplete();
            }
            return;
        }
        
        const UnitTypes = this.game.getCollections().units;
        
        // Keep ID with unit data from the start
        const availableUnits = Object.entries(UnitTypes).map(([id, unitData]) => ({
            id: id,
            ...unitData
        }));
        
        const placableUnits = availableUnits.filter(unit => {
            if (!unit.buyable || unit.value > budget) return false;
            
            const squadData = this.squadManager.getSquadData(unit);
            return this.squadManager.canFitInZone(squadData, this.gridSystem.enemyBounds);
        });
        
        if (placableUnits.length === 0) {
            if (onComplete && typeof onComplete === 'function') {
                onComplete();
            }
            return;
        }
        
        const strategyConfig = this.enemyStrategy.strategies[strategy] || this.enemyStrategy.strategies.balanced;
        const optimalCombination = this.findOptimalUnitCombination(budget, placableUnits, strategyConfig);
        
        if (optimalCombination.units.length === 0) {
            if (onComplete && typeof onComplete === 'function') {
                onComplete();
            }
            return;
        }
        
        this.placeEnemySquadsWithTiming(optimalCombination.units, budget, onComplete);
    }
    
    findOptimalUnitCombination(budget, availableUnits, strategyConfig) {
        const maxSquads = this.game.phaseSystem.config.maxSquadsPerRound;
        const UnitTypes = this.game.getCollections().units;
        const unitKeys = Object.keys(UnitTypes);
        
        const units = availableUnits.map((unit, index) => ({
            id: unitKeys[index],
            ...unit,
            index: index,
            strategyScore: this.enemyStrategy.calculateUnitScore(unit, strategyConfig)
        })).filter(unit => {
            if (!unit.buyable || unit.value > budget) return false;
            
            if (strategyConfig.valueThreshold) {
                const maxValue = budget * strategyConfig.valueThreshold;
                return unit.value <= maxValue;
            }
            
            return true;
        });
        
        if (units.length === 0) {
            return { units: [], totalCost: 0, efficiency: 0 };
        }
        
        const sortedUnits = [...units].sort((a, b) => b.strategyScore - a.strategyScore);
        const selectedUnits = [];
        let remainingBudget = budget;
        let squadsPlaced = 0;
        
        // Limit enemy to maxSquads per round
        for (const unit of sortedUnits) {
            if (squadsPlaced >= maxSquads) break;
            
            if (remainingBudget >= unit.value) {
                selectedUnits.push(unit);
                remainingBudget -= unit.value;
                squadsPlaced++;
            }
        }
        
        return {
            units: selectedUnits,
            totalCost: budget - remainingBudget,
            efficiency: (budget - remainingBudget) / budget
        };
    }
    
    placeEnemySquadsWithTiming(unitsToPlace, budget, onComplete) {
        let placedCount = 0;
        let totalSquadCost = 0;
        let totalUnitsPlaced = 0;
        let squadsSuccessfullyPlaced = 0;
        const maxSquads = this.game.phaseSystem.config.maxSquadsPerRound;
        
        const placeNextSquad = () => {
            if (placedCount >= unitsToPlace.length || squadsSuccessfullyPlaced >= maxSquads) {
                const efficiency = budget > 0 ? (totalSquadCost / budget * 100).toFixed(1) : '0.0';
                this.game.battleLogSystem?.add(
                    `Enemy deployed ${squadsSuccessfullyPlaced}/${maxSquads} squads (${totalUnitsPlaced} total units)! Budget: ${totalSquadCost}/${budget}g (${efficiency}% efficiency)`
                );
                
                if (onComplete && typeof onComplete === 'function') {
                    onComplete();
                }
                return;
            }
            
            const unitType = unitsToPlace[placedCount];
            const gridPos = this.findValidEnemyGridPosition(unitType);
            
            if (gridPos && squadsSuccessfullyPlaced < maxSquads) {
                const placementId = this.placeSquad(gridPos, unitType, 'enemy');
                if (placementId) {
                    const squadData = this.squadManager.getSquadData(unitType);
                    const squadSize = this.squadManager.getSquadSize(squadData);
                    totalSquadCost += unitType.value;
                    totalUnitsPlaced += squadSize;
                    squadsSuccessfullyPlaced++;
                }
            }
            
            placedCount++;
            
            if (placedCount < unitsToPlace.length && squadsSuccessfullyPlaced < maxSquads) {
                setTimeout(placeNextSquad, this.config.unitPlacementDelay);
            } else {
                placeNextSquad();
            }
        };
        
        placeNextSquad();
    }
    
    findValidEnemyGridPosition(unitType) {
        if (!this.squadManager) {
            console.warn('SquadManager not available, falling back to basic positioning');
            return this.findValidEnemyGridPositionFallback(unitType);
        }
        
        const squadData = this.squadManager.getSquadData(unitType);
        const bounds = this.gridSystem.enemyBounds;
        
        // Use SquadManager's validation
        if (!this.squadManager.canFitInZone(squadData, bounds)) {
            return null;
        }
        
        // Get occupied cells from grid system
        const occupiedCells = new Set();
        if (this.gridSystem.state) {
            this.gridSystem.state.forEach((value, key) => {
                occupiedCells.add(key);
            });
        }
        
        // Use SquadManager to find all valid positions
        const validPositions = this.squadManager.findValidPositions(squadData, bounds, occupiedCells);
        
        if (validPositions.length === 0) {
            return null;
        }
        
        // Return random valid position
        return validPositions[Math.floor(Math.random() * validPositions.length)];
    }
    
    findValidEnemyGridPositionFallback(unitType) {
        const squadData = this.squadManager?.getSquadData(unitType) || { placementGridWidth: 1, placementGridHeight: 1 };
        const bounds = this.gridSystem.enemyBounds;
        
        const possiblePositions = [];
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
            for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
                possiblePositions.push({ x, z });
            }
        }
        
        // Shuffle for randomness
        for (let i = possiblePositions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [possiblePositions[i], possiblePositions[j]] = [possiblePositions[j], possiblePositions[i]];
        }
        
        for (const gridPos of possiblePositions) {
            const cells = this.squadManager?.getSquadCells(gridPos, squadData) || [gridPos];
            if (this.gridSystem.isValidPlacement(cells, 'enemy')) {
                return gridPos;
            }
        }
        
        return null;
    }
    
    respawnPlayerUnits() {
        this.respawnSquads(this.playerPlacements, 'player');
        if (this.playerPlacements.length > 0) {
            const totalUnits = this.getTotalUnitCount(this.playerPlacements);
            this.game.battleLogSystem?.add(`Respawned ${totalUnits} player units from previous rounds`);
        }
    }
    
    respawnEnemyUnits() {
        this.respawnSquads(this.enemyPlacements, 'enemy');
        if (this.enemyPlacements.length > 0) {
            const totalUnits = this.getTotalUnitCount(this.enemyPlacements);
            this.game.battleLogSystem?.add(`Enemy respawned ${totalUnits} units from previous rounds`);
        }
    }
           
    respawnSquads(placements, team) {
        placements.forEach(placement => {
            const newUnitIds = [];
            
            if (placement.squadUnits && placement.squadUnits.length > 0) {
                placement.squadUnits.forEach(unit => {
                    const entityId = this.unitCreator.create(
                        unit.position.x,
                        unit.position.y,
                        unit.position.z,
                        placement.unitType,
                        team
                    );
                    unit.entityId = entityId;
                    newUnitIds.push(entityId);
                    
                    // Limit respawn effects for performance
                    if (Math.random() < 0.3) { // Only 30% of units get effects
                        this.createRespawnEffect(unit.position, team);
                    }
                });
            } else {
                const entityId = this.unitCreator.create(
                    placement.x,
                    placement.y,
                    placement.z,
                    placement.unitType,
                    team
                );
                placement.entityId = entityId;
                newUnitIds.push(entityId);
                
                this.createRespawnEffect({ x: placement.x, y: placement.y, z: placement.z }, team);
            }
            
            // Re-initialize in experience system with restored level bonuses
            if (this.game.squadExperienceSystem && placement.placementId) {
                // Initialize squad with the unit type directly
                this.game.squadExperienceSystem.initializeSquad(
                    placement.placementId, 
                    placement.unitType,  // Pass unit type directly
                    newUnitIds, 
                    team
                );
            }
        });
    }
    
    createRespawnEffect(position, team) {
        if (!this.game.effectsSystem) return;
        
        const effectType = team === 'player' ? 'magic' : 'heal';
        this.game.effectsSystem.createParticleEffect(
            position.x,
            position.y,
            position.z,
            effectType,
            { count: 4, speedMultiplier: 0.6 } // Reduced particle count
        );
    }

    resetAllPlacements() {
        // Clean up experience system first
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.reset();
        }
        
        // Batch cleanup effects to avoid lag
        if (this.game.effectsSystem) {
            const allPlacements = [...this.playerPlacements, ...this.enemyPlacements];
            const maxEffects = Math.min(allPlacements.length, 10); // Limit total effects
            
            for (let i = 0; i < maxEffects; i++) {
                const placement = allPlacements[i];
                if (placement.isSquad && placement.squadUnits.length > 0) {
                    const unit = placement.squadUnits[0]; // Only effect first unit
                    this.game.effectsSystem.createParticleEffect(
                        unit.position.x,
                        unit.position.y,
                        unit.position.z,
                        'explosion',
                        { count: 3, speedMultiplier: 0.5 }
                    );
                } else {
                    this.game.effectsSystem.createParticleEffect(
                        placement.x,
                        placement.y,
                        placement.z,
                        'explosion',
                        { count: 3, speedMultiplier: 0.5 }
                    );
                }
            }
        }
        if (this.game.shopSystem) {
            this.game.shopSystem.reset();
        }
        this.playerPlacements = [];
        this.enemyPlacements = [];
        this.clearUndoStack();
        this.enemyStrategy.reset();
        this.gridSystem.clear();
        
        // Clear caches
        this.cachedValidation = null;
        this.cachedGridPos = null;
        this.groundMeshCache = null;
        this.groundMeshCache = this.findGroundMesh(); // Recache ground mesh
        
        if (this.placementPreview) {
            this.placementPreview.clear();
        }
        
        this.game.battleLogSystem?.add('All unit placements cleared');
    }

    startNewPlacementPhase() {
        this.respawnPlayerUnits();
        
        if (this.playerPlacements.length > 0) {
            const totalUnits = this.getTotalUnitCount(this.playerPlacements);
            const maxSquads = this.game.phaseSystem.config.maxSquadsPerRound;
            
            // Use SquadManager to get detailed army composition
            if (this.squadManager) {
                const unitCounts = this.getDetailedUnitCounts(this.playerPlacements);
                const armyDescription = Object.entries(unitCounts)
                    .map(([type, info]) => `${info.squads}x ${type} (${info.totalUnits} units)`)
                    .join(', ');
                
                this.game.battleLogSystem?.add(`Your army: ${armyDescription} ready for battle! (${maxSquads} new squads max)`);
            } else {
                this.game.battleLogSystem?.add(`Your army: ${totalUnits} units ready for battle! (${maxSquads} new squads max)`);
            }
        } else {
            const maxSquads = this.game.phaseSystem.config.maxSquadsPerRound;
            this.game.battleLogSystem?.add(`Place your first units to build your army! (${maxSquads} squads max)`);
        }
    }
    
    getDetailedUnitCounts(placements) {
        const counts = {};
        
        placements.forEach(placement => {
            const unitType = placement.unitType;
            const squadInfo = this.squadManager ? this.squadManager.getSquadInfo(unitType) : null;
            const typeName = squadInfo?.unitName || unitType.title || unitType.id;
            
            if (!counts[typeName]) {
                counts[typeName] = {
                    squads: 0,
                    totalUnits: 0,
                    totalCost: 0
                };
            }
            
            counts[typeName].squads++;
            counts[typeName].totalUnits += squadInfo?.squadSize || 1;
            counts[typeName].totalCost += squadInfo?.cost || unitType.value || 0;
        });
        
        return counts;
    }
    
    // REMOVED: getWorldPositionFromMouse - using optimized version above
    
    calculateEnemyTotalGold(round) {
        let totalGold = 0;
        for (let r = 1; r <= round; r++) {
            totalGold += this.game.phaseSystem.calculateRoundGold(r);
        }
        return totalGold;
    }
    
    calculateExistingEnemyValue() {
        return this.enemyPlacements.reduce((total, placement) => {
            return total + (placement.unitType.value || 0);
        }, 0);
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
    
    getUnitCountsByType(placements) {
        const counts = {};
        placements.forEach(placement => {
            const type = placement.unitType.title || placement.unitType.id;
            const squadSize = placement.isSquad ? placement.squadUnits.length : 1;
            counts[type] = (counts[type] || 0) + squadSize;
        });
        return counts;
    }
    
    getUndoStatus() {
        return {
            canUndo: this.undoStack.length > 0 && this.config.enableUndo,
            undoCount: this.undoStack.length,
            maxUndoSteps: this.maxUndoSteps,
            lastAction: this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : null
        };
    }
    
    // OPTIMIZED: Use cached validation when possible
    isValidPlayerPlacement(worldPos) {
        if (!worldPos) return false;
        
        const gridPos = this.gridSystem.worldToGrid(worldPos.x, worldPos.z);
        if (!this.gridSystem.isValidPosition(gridPos)) return false;
        
        const selectedUnit = this.game.state.selectedUnitType;
        if (!selectedUnit) return false;
        
        // Use SquadManager for comprehensive validation
        if (this.squadManager) {
            const squadData = this.squadManager.getSquadData(selectedUnit);
            const validation = this.squadManager.validateSquadConfig(squadData);
            
            if (!validation.valid) {
                return false;
            }
            
            const cells = this.squadManager.getSquadCells(gridPos, squadData);
            return this.gridSystem.isValidPlacement(cells, 'player');
        }
        
        // Fallback without SquadManager
        return this.gridSystem.isValidPlacement([gridPos], 'player');
    }
    
    // OPTIMIZED: Cleanup with performance considerations
    dispose() {
        // Clear caches first
        this.cachedValidation = null;
        this.cachedGridPos = null;
        this.groundMeshCache = null;
        
        // Cancel any pending animations
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        if (this.placementPreview) {
            this.placementPreview.dispose();
        }
        
        if (this.gridSystem.gridVisualization) {
            this.game.scene.remove(this.gridSystem.gridVisualization);
        }
        
        this.resetAllPlacements();
        
        if (this.unitCreator) {
            this.unitCreator.dispose();
        }
    }
}