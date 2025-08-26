class MultiplayerPlacementSystem {
    constructor(game, sceneManager) {
        this.game = game;
        this.sceneManager = sceneManager;
        this.game.placementSystem = this;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.canvas = this.game.canvas;
        
        this.playerPlacements = [];
        this.opponentPlacements = [];
        this.enemyPlacements = []; // Converted opponent placements
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
            mouseMoveThrottle: 16,
            validationThrottle: 32,
            raycastThrottle: 16
        };
    }

    // GUTS Manager Interface
    init(params) {
        this.params = params || {};
        this.initializeSubsystems();
        this.initializeControls();
        
        if (this.config.enablePreview) {
            this.placementPreview = new GUTS.PlacementPreview(
                this.game.scene, 
                this.gridSystem, 
                this.squadManager
            );
        }
        
        console.log('MultiplayerPlacementSystem initialized');
    }

    update(deltaTime) {
        if (this.game.state.phase !== 'placement') {
            return;
        }
        
        const now = performance.now();
        if (now - this.lastValidationTime > this.config.validationThrottle) {
            this.updateCursorState();
            this.lastValidationTime = now;
        }
    }

    // No AI enemy placement in multiplayer - opponent placements come from server
    placeEnemyUnits(strategy = null, onComplete) {
        // In multiplayer, enemy units come from opponent's placements via server
        // This method is essentially a no-op but we keep it for compatibility
        if (onComplete && typeof onComplete === 'function') {
            onComplete();
        }
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add('Waiting for opponent deployment...');
        }
    }

    // Apply opponent placements received from multiplayer server
    applyOpponentPlacements(opponentData) {
        console.log('MultiplayerPlacementSystem: Applying opponent placements', opponentData);
        
        // Clear existing enemy placements
        this.enemyPlacements = [];
        this.opponentPlacements = opponentData || [];
        
        // Create enemy units from opponent data
        this.opponentPlacements.forEach(placement => {
            this.createEnemyFromOpponentPlacement(placement);
        });
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(`Opponent deployed ${this.opponentPlacements.length} squads`);
        }
        
        // Mark opponent as having completed placement
        if (this.game.state) {
            this.game.state.enemyPlacementComplete = true;
        }
    }

    // Add to MultiplayerPlacementSystem.createEnemyFromOpponentPlacement()
    createEnemyFromOpponentPlacement(opponentPlacement) {
        console.log('=== ENEMY FROM OPPONENT (no mirror) ===');
        console.log('Opponent placement:', opponentPlacement);

        const enemyPlacement = {
            placementId: `opponent_${opponentPlacement.placementId}`,
            gridPosition: { ...opponentPlacement.gridPosition }, // as-is
            unitType: opponentPlacement.unitType,
            cells: (opponentPlacement.cells || []).map(c => ({ x: c.x, z: c.z })), // as-is
            squadUnits: [],
            isSquad: true,
            roundPlaced: this.game.state.round,
            timestamp: Date.now()
        };

        if (this.game.squadManager && this.game.unitCreationManager) {
            const squadData = this.game.squadManager.getSquadData(opponentPlacement.unitType);

            // Use incoming grid position directly; DON'T mirror
            const unitPositions = this.game.squadManager.calculateUnitPositions(
                enemyPlacement.gridPosition,
                squadData,
                this.game.gridSystem
            );

            console.log(`Creating ${unitPositions.length} enemy units at positions:`, unitPositions);

            unitPositions.forEach((pos, index) => {
                const terrainHeight = this.game.unitCreationManager.getTerrainHeight(pos.x, pos.z);
                const unitY = terrainHeight !== null ? terrainHeight : 0;

                const entityId = this.game.unitCreationManager.create(
                    pos.x,
                    unitY,
                    pos.z,
                    opponentPlacement.unitType,
                    'enemy' // critical
                );

                enemyPlacement.squadUnits.push({
                    entityId: entityId,
                    position: { x: pos.x, y: unitY, z: pos.z }
                });
            });
        }

        // Occupy the provided cells exactly as given
        if (this.game.gridSystem?.occupyCells && enemyPlacement.cells?.length) {
            this.game.gridSystem.occupyCells(enemyPlacement.cells, enemyPlacement.placementId);
        }

        // Track for undo/debug if you keep enemyPlacements array
        this.enemyPlacements.push(enemyPlacement);
    }


    mirrorPlacement(gridPos) {
        // Mirror position from player side to enemy side
        const gridBounds = this.game.gridSystem?.bounds;
        if (!gridBounds) {
            // Fallback if bounds not available
            const gridSize = this.game.gridSystem?.gridSize || 32;
            return {
                x: gridSize - 1 - gridPos.x,
                z: gridPos.z
            };
        }
        
        const centerX = (gridBounds.minX + gridBounds.maxX) / 2;
        return {
            x: centerX + (centerX - gridPos.x),
            z: gridPos.z
        };
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
    // Handle canvas clicks for unit placement
    handleCanvasClick(event) {
        const state = this.game.state;
        
        if (state.phase !== 'placement' || !state.selectedUnitType) {
            return;
        }
        
        // Check squad limit first
        if (!this.game.phaseSystem.canPlayerPlaceSquad()) {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(`Maximum ${this.game.phaseSystem.config.maxSquadsPerRound} squads per round reached!`, 'log-damage');
            }
            return;
        }
        
        if (state.playerGold < state.selectedUnitType.value) {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('Not enough gold!', 'log-damage');
            }
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
                gridPos = this.game.gridSystem.worldToGrid(worldPosition.x, worldPosition.z);
                isValidPlacement = this.isValidPlayerPlacement(worldPosition);
            }
        }
        
        if (!isValidPlacement || !gridPos) {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('Invalid placement location!', 'log-damage');
            }
            return;
        }
        
        // Validate squad configuration before placement
        if (this.game.squadManager) {
            const squadData = this.game.squadManager.getSquadData(state.selectedUnitType);
            const validation = this.game.squadManager.validateSquadConfig(squadData);
            
            if (!validation.valid) {
                if (this.game.battleLogSystem) {
                    this.game.battleLogSystem.add(`Invalid squad configuration: ${validation.errors.join(', ')}`, 'log-damage');
                }
                return;
            }
        }
        
        this.placeSquad(gridPos, state.selectedUnitType, 'player');
    }

    placeSquad(gridPos, unitType, team) {
        // Double-check squad limits before placing
        if (team === 'player' && !this.game.phaseSystem.canPlayerPlaceSquad()) {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(`Maximum ${this.game.phaseSystem.config.maxSquadsPerRound} squads per round reached!`, 'log-damage');
            }
            return null;
        }
        
        const squadData = this.game.squadManager.getSquadData(unitType);
        const cells = this.game.squadManager.getSquadCells(gridPos, squadData);
        
        // Early validation check
        if (!this.game.gridSystem.isValidPlacement(cells, team)) {
            if (team === 'player') {
                if (this.game.battleLogSystem) {
                    this.game.battleLogSystem.add('Cannot place squad at this location!', 'log-damage');
                }
            }
            return null;
        }
        
        const placementId = `${team}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const squadUnits = [];
        const unitPositions = this.game.squadManager.calculateUnitPositions(gridPos, squadData, this.game.gridSystem);
        const undoInfo = this.createUndoInfo(placementId, unitType, gridPos, cells, team);
        
        try {
            // Batch unit creation for better performance
            const createdUnits = this.createSquadUnits(unitPositions, unitType, team, undoInfo);
            squadUnits.push(...createdUnits);
            
            this.updateGameStateForPlacement(placementId, gridPos, cells, unitType, squadUnits, team, undoInfo);
            this.game.gridSystem.occupyCells(cells, placementId);
            
            // Initialize squad in experience system
            if (this.game.squadExperienceSystem) {
                const unitIds = createdUnits.map(unit => unit.entityId);
                this.game.squadExperienceSystem.initializeSquad(placementId, unitType, unitIds, team);
            }
            
            // Batch effects creation
            if (this.game.effectsSystem && createdUnits.length <= 8) {
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

    createSquadUnits(unitPositions, unitType, team, undoInfo) {
        const createdUnits = [];
        
        // Limit unit creation for very large formations
        const maxUnits = Math.min(unitPositions.length, 16);
        const positions = unitPositions.slice(0, maxUnits);
        
        positions.forEach(pos => {
            const terrainHeight = this.game.unitCreationManager.getTerrainHeight(pos.x, pos.z);
            const unitY = terrainHeight !== null ? terrainHeight : 0;
            
            const entityId = this.game.unitCreationManager.create(pos.x, unitY, pos.z, unitType, team);
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

    createPlacementEffects(unitPositions, team) {
        if (!this.game.effectsSystem) return;
        
        const effectType = team === 'player' ? 'magic' : 'defeat';
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
                { count: 4, speedMultiplier: 0.8 }
            );
        }
    }

    logPlacement(unitType, unitCount, team) {
        if (!this.game.battleLogSystem || !this.game.squadManager) return;
        
        const squadInfo = this.game.squadManager.getSquadInfo(unitType);
        const logClass = team === 'player' ? 'log-victory' : 'log-damage';
        
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

    // Undo functionality for multiplayer
    undoLastPlacement() {
        if (!this.config.enableUndo) return;
        
        const state = this.game.state;
        
        if (state.phase !== 'placement') {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('Can only undo during placement phase!', 'log-damage');
            }
            return;
        }
        
        if (this.undoStack.length === 0) {
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('Nothing to undo!', 'log-damage');
            }
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
            
            this.game.gridSystem.freeCells(undoInfo.placementId);
            this.createUndoEffects(undoInfo);
            this.logUndo(undoInfo);
            
            // Clear caches after undo
            this.cachedValidation = null;
            this.cachedGridPos = null;
            
        } catch (error) {
            console.error('Undo failed:', error);
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add('Undo failed!', 'log-damage');
            }
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

    logUndo(undoInfo) {
        if (!this.game.battleLogSystem || !this.game.squadManager) return;
        
        const squadInfo = this.game.squadManager.getSquadInfo(undoInfo.unitType);
        const message = squadInfo.squadSize > 1 
            ? `Undid placement of ${squadInfo.unitName} squad (+${undoInfo.cost}g)`
            : `Undid placement of ${squadInfo.unitName} unit (+${undoInfo.cost}g)`;
        
        this.game.battleLogSystem.add(message, 'log-victory');
    }

    // Respawn units for next round (multiplayer doesn't use this much)
    respawnPlayerUnits() {
        this.respawnSquads(this.playerPlacements, 'player');
        if (this.playerPlacements.length > 0) {
            const totalUnits = this.getTotalUnitCount(this.playerPlacements);
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(`Respawned ${totalUnits} player units from previous rounds`);
            }
        }
    }

    respawnSquads(placements, team) {
        placements.forEach(placement => {
            const newUnitIds = [];
            
            if (placement.squadUnits && placement.squadUnits.length > 0) {
                placement.squadUnits.forEach(unit => {
                    const entityId = this.game.unitCreationManager.create(
                        unit.position.x,
                        unit.position.y,
                        unit.position.z,
                        placement.unitType,
                        team
                    );
                    unit.entityId = entityId;
                    newUnitIds.push(entityId);
                    
                    if (Math.random() < 0.3) {
                        this.createRespawnEffect(unit.position, team);
                    }
                });
            }
            
            // Re-initialize in experience system with restored level bonuses
            if (this.game.squadExperienceSystem && placement.placementId) {
                this.game.squadExperienceSystem.initializeSquad(
                    placement.placementId, 
                    placement.unitType,
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
            { count: 4, speedMultiplier: 0.6 }
        );
    }

    startNewPlacementPhase() {
        this.respawnPlayerUnits();
        
        if (this.playerPlacements.length > 0) {
            const totalUnits = this.getTotalUnitCount(this.playerPlacements);
            const maxSquads = this.game.phaseSystem.config.maxSquadsPerRound;
            
            if (this.game.squadManager) {
                const unitCounts = this.getDetailedUnitCounts(this.playerPlacements);
                const armyDescription = Object.entries(unitCounts)
                    .map(([type, info]) => `${info.squads}x ${type} (${info.totalUnits} units)`)
                    .join(', ');
                
                if (this.game.battleLogSystem) {
                    this.game.battleLogSystem.add(`Your army: ${armyDescription} ready for battle! (${maxSquads} new squads max)`);
                }
            } else {
                if (this.game.battleLogSystem) {
                    this.game.battleLogSystem.add(`Your army: ${totalUnits} units ready for battle! (${maxSquads} new squads max)`);
                }
            }
        } else {
            const maxSquads = this.game.phaseSystem.config.maxSquadsPerRound;
            if (this.game.battleLogSystem) {
                this.game.battleLogSystem.add(`Place your first units to build your army! (${maxSquads} squads max)`);
            }
        }
    }

    getDetailedUnitCounts(placements) {
        const counts = {};
        
        placements.forEach(placement => {
            const unitType = placement.unitType;
            const squadInfo = this.game.squadManager ? this.game.squadManager.getSquadInfo(unitType) : null;
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

    resetAllPlacements() {
        // Clean up experience system first
        if (this.game.squadExperienceSystem) {
            this.game.squadExperienceSystem.reset();
        }
        
        // Batch cleanup effects to avoid lag
        if (this.game.effectsSystem) {
            const allPlacements = [...this.playerPlacements, ...this.enemyPlacements];
            const maxEffects = Math.min(allPlacements.length, 10);
            
            for (let i = 0; i < maxEffects; i++) {
                const placement = allPlacements[i];
                if (placement.isSquad && placement.squadUnits.length > 0) {
                    const unit = placement.squadUnits[0];
                    this.game.effectsSystem.createParticleEffect(
                        unit.position.x,
                        unit.position.y,
                        unit.position.z,
                        'explosion',
                        { count: 3, speedMultiplier: 0.5 }
                    );
                }
            }
        }
        
        this.playerPlacements = [];
        this.enemyPlacements = [];
        this.opponentPlacements = [];
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
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add('All unit placements cleared');
        }
    }

    // Initialize subsystems
    initializeSubsystems() {
        const terrainSize = this.game.worldSystem?.terrainSize || 768;
        
        this.gridSystem = this.game.gridSystem;
        this.gridSystem.init(terrainSize);
        this.squadManager = this.game.squadManager;
        this.unitCreator = this.game.unitCreationManager;
        
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
        
        const now = performance.now();
        const timeSinceLastRaycast = now - (this.lastRaycastTime || 0);
        const shouldRaycast = timeSinceLastRaycast > 150;
        
        let worldPosition;
        if (!shouldRaycast) {
            return;
        } else {
            worldPosition = this.getWorldPositionFromMouse(event, mouseX, mouseY);
            if (worldPosition) {
                this.cachedWorldPos = worldPosition;
                this.lastRaycastTime = now;
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
        
        let isValid;
        if (this.cachedGridPos && 
            this.cachedGridPos.x === gridPos.x && 
            this.cachedGridPos.z === gridPos.z) {
            isValid = this.cachedValidation?.isValid || false;
        } else {
            isValid = this.isValidPlayerPlacement(worldPosition);
            this.cachedGridPos = gridPos;
            this.cachedValidation = { isValid, timestamp: performance.now(), gridPos };
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

    isValidPlayerPlacement(worldPos) {
        if (!worldPos) return false;

        const gridPos = this.game.gridSystem.worldToGrid(worldPos.x, worldPos.z);
        if (!this.game.gridSystem.isValidPosition(gridPos)) return false;

        const selectedUnit = this.game.state.selectedUnitType;
        if (!selectedUnit) return false;

        // Build cells for the squad
        let cells = [gridPos];
        if (this.game.squadManager) {
            const squadData = this.game.squadManager.getSquadData(selectedUnit);
            const validation = this.game.squadManager.validateSquadConfig(squadData);
            if (!validation.valid) return false;
            cells = this.game.squadManager.getSquadCells(gridPos, squadData);
        }

        // If sides are configured, ensure every cell is on my side
        if (this.teamSides && this.teamSides.player) {
            if (!this.cellsWithinSide(cells, this.teamSides.player)) {
                return false;
            }
        }

        // Defer to grid rules (collisions, blocked cells, etc.)
        return this.game.gridSystem.isValidPlacement(cells, 'player');
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
            canUndo: this.undoStack.length > 0 && this.config.enableUndo,
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
        console.log('Team sides set:', this.teamSides);
    }

    // Compute inclusive X bounds for a side based on grid bounds
    getSideBounds(side) {
        const b = this.game.gridSystem?.bounds;
        if (!b) return null;
        const centerX = Math.floor((b.minX + b.maxX) / 2);
        if (side === 'left') {
            return { minX: b.minX, maxX: centerX };
        } else {
            return { minX: centerX + 1, maxX: b.maxX };
        }
    }

    // Check that all cells are inside the given side's X bounds
    cellsWithinSide(cells, side) {
        const bounds = this.getSideBounds(side);
        if (!bounds) return true; // if unknown, don't block
        return cells.every(c => c.x >= bounds.minX && c.x <= bounds.maxX);
    }
    updateCursorState() {
        if (this.game.state.selectedUnitType && this.cachedValidation) {
            document.body.style.cursor = this.cachedValidation.isValid ? 'crosshair' : 'not-allowed';
        } else {
            document.body.style.cursor = 'default';
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
}