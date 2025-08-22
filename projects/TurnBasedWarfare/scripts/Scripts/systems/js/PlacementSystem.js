class PlacementSystem {
    constructor(app) {
        this.game = app;
        this.game.placementSystem = this;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.canvas = this.game.canvas;
        
        this.playerPlacements = [];
        this.enemyPlacements = [];
        this.undoStack = [];
        this.maxUndoSteps = 10;
        
        this.config = {
            maxUnitsPerRound: 10,
            maxCombinationsToCheck: 1000,
            unitPlacementDelay: 200,
            enablePreview: true,
            enableUndo: true,
            enableGridSnapping: true
        };
        
        this.initializeSubsystems();
        this.initializeControls();
        
        if (this.gridSystem.showGrid) {
            this.gridSystem.createVisualization(this.game.scene);
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
            this.canvas.addEventListener('mousemove', (event) => {
                if (this.game.state.phase === 'placement' && this.game.state.selectedUnitType) {
                    this.updatePlacementPreview(event);
                }
            });
            
            this.canvas.addEventListener('mouseleave', () => {
                this.placementPreview.clear();
            });
        }
    }
    
    updatePlacementPreview(event) {
        if (!this.placementPreview) return;
        
        const worldPosition = this.getWorldPositionFromMouse(event);
        if (!worldPosition) {
            this.placementPreview.clear();
            return;
        }
        
        const gridPos = this.gridSystem.worldToGrid(worldPosition.x, worldPosition.z);
        this.placementPreview.update(gridPos, this.game.state.selectedUnitType, 'player');
    }
    
    handleCanvasClick(event) {
        const state = this.game.state;
        
        if (state.phase !== 'placement' || !state.selectedUnitType) {
            return;
        }
        
        if (state.playerGold < state.selectedUnitType.value) {
            this.game.battleLogSystem?.add('Not enough gold!', 'log-damage');
            return;
        }
        
        if (this.placementPreview) {
            if (!this.placementPreview.isActive || !this.placementPreview.isValid) {
                this.game.battleLogSystem?.add('Invalid placement location!', 'log-damage');
                return;
            }
            
            this.placeSquad(this.placementPreview.gridPosition, state.selectedUnitType, 'player');
        } else {
            const worldPosition = this.getWorldPositionFromMouse(event);
            if (worldPosition) {
                const gridPos = this.gridSystem.worldToGrid(worldPosition.x, worldPosition.z);
                this.placeSquad(gridPos, state.selectedUnitType, 'player');
            }
        }
    }
    
    placeSquad(gridPos, unitType, team) {
        const squadData = this.squadManager.getSquadData(unitType);
        const cells = this.squadManager.getSquadCells(gridPos, squadData);
        
        if (!this.gridSystem.isValidPlacement(cells, team)) {
            this.game.battleLogSystem?.add('Cannot place squad at this location!', 'log-damage');
            return null;
        }
        
        const placementId = `${team}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const squadUnits = [];
        const unitPositions = this.squadManager.calculateUnitPositions(gridPos, squadData, this.gridSystem);
        const undoInfo = this.createUndoInfo(placementId, unitType, gridPos, cells, team);
        
        try {
            unitPositions.forEach(pos => {
                const terrainHeight = this.unitCreator.getTerrainHeight(pos.x, pos.z);
                const unitY = terrainHeight !== null ? terrainHeight : 0;
                
                const entityId = this.unitCreator.create(pos.x, unitY, pos.z, unitType, team);
                squadUnits.push({
                    entityId: entityId,
                    position: { x: pos.x, y: unitY, z: pos.z }
                });
                undoInfo.unitIds.push(entityId);
            });
            
            this.updateGameStateForPlacement(placementId, gridPos, cells, unitType, squadUnits, team, undoInfo);
            this.gridSystem.occupyCells(cells, placementId);
            this.createPlacementEffects(unitPositions, team);
            this.logPlacement(unitType, squadUnits.length, team);
            
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
    
    createPlacementEffects(unitPositions, team) {
        if (!this.game.effectsSystem) return;
        
        const effectType = team === 'player' ? 'magic' : 'defeat';
        
        unitPositions.forEach(pos => {
            const terrainHeight = this.unitCreator.getTerrainHeight(pos.x, pos.z);
            const unitY = terrainHeight !== null ? terrainHeight : 0;
            
            this.game.effectsSystem.createParticleEffect(
                pos.x,
                unitY + 25,
                pos.z,
                effectType,
                { count: 6, speedMultiplier: 0.8 }
            );
        });
    }
    
    logPlacement(unitType, unitCount, team) {
        if (!this.game.battleLogSystem) return;
        
        const squadText = unitCount > 1 ? `squad (${unitCount} units)` : 'unit';
        const logClass = team === 'player' ? 'log-victory' : 'log-damage';
        
        this.game.battleLogSystem.add(
            `Deployed ${unitType.title || unitType.id} ${squadText}`,
            logClass
        );
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
            
            const placementIndex = this.playerPlacements.findIndex(p => p.placementId === undoInfo.placementId);
            if (placementIndex !== -1) {
                this.playerPlacements.splice(placementIndex, 1);
            }
            
            this.gridSystem.freeCells(undoInfo.placementId);
            this.createUndoEffects(undoInfo);
            this.logUndo(undoInfo);
            
        } catch (error) {
            console.error('Undo failed:', error);
            this.game.battleLogSystem?.add('Undo failed!', 'log-damage');
        }
    }
    
    createUndoEffects(undoInfo) {
        if (!this.game.effectsSystem) return;
        
        undoInfo.cells.forEach(cell => {
            const worldPos = this.gridSystem.gridToWorld(cell.x, cell.z);
            this.game.effectsSystem.createParticleEffect(
                worldPos.x,
                2,
                worldPos.z,
                'magic',
                { count: 4, speedMultiplier: 0.7 }
            );
        });
    }
    
    logUndo(undoInfo) {
        if (!this.game.battleLogSystem) return;
        
        const squadSize = undoInfo.unitIds.length;
        const squadText = squadSize > 1 ? `squad (${squadSize} units)` : 'unit';
        
        this.game.battleLogSystem.add(
            `Undid placement of ${undoInfo.unitType.title} ${squadText} (+${undoInfo.cost}g)`,
            'log-victory'
        );
    }
    
    placeEnemyUnits(strategy = null, onComplete) {
        this.respawnEnemyUnits();
        
        const round = this.game.state.round;
        const enemyTotalGold = this.calculateEnemyTotalGold(round);
        const existingValue = this.calculateExistingEnemyValue();
        const availableGold = Math.max(0, enemyTotalGold - existingValue);
        
        const selectedStrategy = strategy || this.enemyStrategy.selectStrategy(round, this.playerPlacements);
        this.enemyStrategy.current = selectedStrategy;
        this.enemyStrategy.history.push({ round, strategy: selectedStrategy });
        
        if (this.game.battleLogSystem) {
            const strategyName = this.enemyStrategy.strategies[selectedStrategy]?.name || selectedStrategy;
            this.game.battleLogSystem.add(
                `Enemy adopts ${strategyName} strategy!`,
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
        const maxUnits = Math.floor((this.config.maxUnitsPerRound || 10) * (strategyConfig.maxUnitsMultiplier || 1.0));
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
        let unitsPlaced = 0;
        
        for (const unit of sortedUnits) {
            while (remainingBudget >= unit.value && unitsPlaced < maxUnits) {
                selectedUnits.push(unit);
                remainingBudget -= unit.value;
                unitsPlaced++;
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
        
        const placeNextSquad = () => {
            if (placedCount >= unitsToPlace.length) {
                const efficiency = (totalSquadCost / budget * 100).toFixed(1);
                this.game.battleLogSystem?.add(
                    `Enemy deployed ${placedCount} squads (${totalUnitsPlaced} total units)! Budget: ${totalSquadCost}/${budget}g (${efficiency}% efficiency)`
                );
                
                if (onComplete && typeof onComplete === 'function') {
                    onComplete();
                }
                return;
            }
            
            const unitType = unitsToPlace[placedCount];
            const gridPos = this.findValidEnemyGridPosition(unitType);
            
            if (gridPos) {
                const placementId = this.placeSquad(gridPos, unitType, 'enemy');
                if (placementId) {
                    const squadData = this.squadManager.getSquadData(unitType);
                    const squadSize = this.squadManager.getSquadSize(squadData);
                    totalSquadCost += unitType.value;
                    totalUnitsPlaced += squadSize;
                }
            }
            
            placedCount++;
            
            if (placedCount < unitsToPlace.length) {
                setTimeout(placeNextSquad, this.config.unitPlacementDelay);
            } else {
                placeNextSquad();
            }
        };
        
        placeNextSquad();
    }
    
    findValidEnemyGridPosition(unitType) {
        const squadData = this.squadManager.getSquadData(unitType);
        const bounds = this.gridSystem.enemyBounds;
        
        if (!this.squadManager.canFitInZone(squadData, bounds)) {
            return null;
        }
        
        const possiblePositions = [];
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
            for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
                possiblePositions.push({ x, z });
            }
        }
        
        for (let i = possiblePositions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [possiblePositions[i], possiblePositions[j]] = [possiblePositions[j], possiblePositions[i]];
        }
        
        for (const gridPos of possiblePositions) {
            const cells = this.squadManager.getSquadCells(gridPos, squadData);
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
                    
                    this.createRespawnEffect(unit.position, team);
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
                
                this.createRespawnEffect({ x: placement.x, y: placement.y, z: placement.z }, team);
            }
        });
    }
    
    createRespawnEffect(position, team) {
        if (!this.game.effectsSystem) return;
        
        const effectType = team === 'player' ? 'magic' : 'heal';
        this.game.effectsSystem.createParticleEffect(
            position.x,
            position.y + 15,
            position.z,
            effectType,
            { count: 8, speedMultiplier: 0.6 }
        );
    }
    
    resetAllPlacements() {
        if (this.game.effectsSystem) {
            [...this.playerPlacements, ...this.enemyPlacements].forEach(placement => {
                if (placement.isSquad) {
                    placement.squadUnits.forEach(unit => {
                        this.game.effectsSystem.createParticleEffect(
                            unit.position.x,
                            unit.position.y + 5,
                            unit.position.z,
                            'explosion',
                            { count: 6, speedMultiplier: 0.5 }
                        );
                    });
                } else {
                    this.game.effectsSystem.createParticleEffect(
                        placement.x,
                        placement.y + 5,
                        placement.z,
                        'explosion',
                        { count: 6, speedMultiplier: 0.5 }
                    );
                }
            });
        }
        
        this.playerPlacements = [];
        this.enemyPlacements = [];
        this.clearUndoStack();
        this.enemyStrategy.reset();
        this.gridSystem.clear();
        
        if (this.placementPreview) {
            this.placementPreview.clear();
        }
        
        this.game.battleLogSystem?.add('All unit placements cleared');
    }
    
    startNewPlacementPhase() {
        this.respawnPlayerUnits();
        
        if (this.playerPlacements.length > 0) {
            const totalUnits = this.getTotalUnitCount(this.playerPlacements);
            this.game.battleLogSystem?.add(`Your army: ${totalUnits} units ready for battle!`);
        } else {
            this.game.battleLogSystem?.add('Place your first units to build your army!');
        }
    }
    
    getWorldPositionFromMouse(event) {
        if (!this.game.scene || !this.game.camera) return null;
        
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.game.camera);
        const ground = this.getGroundMesh();
        if (!ground) return null;
        
        const intersects = this.raycaster.intersectObject(ground, false);
        return intersects.length > 0 ? intersects[0].point : null;
    }
    
    getGroundMesh() {
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
    isValidPlayerPlacement(worldPos) {
        if (!worldPos) return false;
        
        const gridPos = this.gridSystem.worldToGrid(worldPos.x, worldPos.z);
        if (!this.gridSystem.isValidPosition(gridPos)) return false;
        
        const selectedUnit = this.game.state.selectedUnitType;
        if (!selectedUnit) return false;
        
        const squadData = this.squadManager.getSquadData(selectedUnit);
        const cells = this.squadManager.getSquadCells(gridPos, squadData);
        
        return this.gridSystem.isValidPlacement(cells, 'player');
    }
    dispose() {
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
        
        console.log('PlacementSystem disposed');
    }
}