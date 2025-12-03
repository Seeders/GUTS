class UnitOrderSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game = game;
        this.game.unitOrderSystem = this;

        this.isTargeting = false;
        this.isForceMove = false;
        this.pendingCallbacks = 0;

        this._onCanvasClick = this._onCanvasClick.bind(this);
       // this._onCanvasMouseMove = this._onCanvasMouseMove.bind(this);

        this.cursorWhenTargeting = 'crosshair';
        this.pingEffect = { count: 12, color: 0x00ff00 };
        this.targetingPreview = new GUTS.PlacementPreview(this.game);
        this.targetingPreview.updateConfig({
            cellOpacity: 0.3,
            borderOpacity: 0.6
        });
    }

    init() {
        // No longer needed - entity sync at battle start handles opponent orders
    }


    showSquadActionPanel(placementId) {
        const actionPanel = document.getElementById('actionPanel');
        if (!actionPanel) return;


        const placement = this.game.gameManager.call('getPlacementById', placementId);
        
        actionPanel.innerHTML = "";
          


        const firstUnit = placement.squadUnits[0];
        const unitType = firstUnit ? this.game.getComponent(firstUnit, "unitType") : null;
        
        let squadPanel = document.createElement('div');
        squadPanel.id = 'squadActionPanel';
        
        actionPanel.appendChild(squadPanel);
        
        this.displayActionSet(null, squadPanel, firstUnit, unitType);
    }

    displayActionSet(actionSetId, panel, selectedUnitId, unitType) {
        panel.innerHTML = ``;
        const actionSection = document.createElement('div');
        actionSection.className = 'action-section';

        const grid = document.createElement('div');
        grid.className = 'action-grid';
        
        let actions = [];

        if(!unitType.actionSet){
            if(unitType.collection == 'units'){
                unitType.actionSet = 'defaultUnitActions';
            } 
        } 

        if(actionSetId || unitType.actionSet){
            if(!actionSetId) {
                actionSetId = unitType.actionSet;
            }
            let currentActionSet = this.game.getCollections().actionSets[actionSetId];
            if(currentActionSet.actions){
                actions = currentActionSet.actions;
                const actionsCollection = this.game.getCollections().actions;
                actions.forEach((actionId) => {
                    let action = actionsCollection[actionId];
                    const btn = this.createActionButton(action, panel, selectedUnitId, unitType);
                    grid.appendChild(btn);
                });
            } else if(currentActionSet.buildings){
                const buildings = this.game.getCollections().buildings;
                currentActionSet.buildings.forEach(buildingId => {
                    if (buildingId === 'underConstruction') return;
                    
                    const building = buildings[buildingId];            
                    if (!building.buildTime) building.buildTime = 1;
                    
                    building.id = buildingId;
                    building.collection = "buildings";
                    const canAfford = this.game.state.playerGold >= (building.value || 0);
                    const isLocked = this.game.shopSystem?.isBuildingLocked(buildingId, building);
                    const lockReason = this.game.shopSystem?.getLockReason(buildingId, building);
                    
                    const btn = this.createBuildingButton(building, canAfford, isLocked, lockReason, selectedUnitId);
                    grid.appendChild(btn);
                });
            }
        }
        actionSection.appendChild(grid);
    
        panel.appendChild(actionSection);
    }

    createActionButton(action, panel, selectedUnitId, unitType) {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.title = `${action.title}`;

        const iconEl = document.createElement('div');
        iconEl.className = 'action-btn-icon';
        if(action.icon){
            const icon = this.game.getCollections().icons[action.icon];
            if(icon && icon.imagePath){
                const img = document.createElement('img');
                img.src = `./resources/${icon.imagePath}`;
                iconEl.append(img);
            } else {
                iconEl.textContent =  '🏛️';
            }
        } else {
            iconEl.textContent =  '🏛️';
        }
        btn.append(iconEl);

        if(action.order){
            btn.addEventListener('click', () => {
                this[action.order]();
            });
        } else if(action.actionSet){
            btn.addEventListener('click', () => {
                this.displayActionSet(action.actionSet, panel, selectedUnitId, unitType);
            });
        }
        return btn;
    }

    createBuildingButton(building, canAfford, isLocked, lockReason, selectedUnitId) {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.title = `${building.title} 💰${building.value}`;
        const locked = isLocked || !canAfford;
        if (locked) {
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.title = `${building.title} ${lockReason}`;
        }
        
        const iconEl = document.createElement('div');
        iconEl.className = 'action-btn-icon';
        if(building.icon){
            const icon = this.game.getCollections().icons[building.icon];
            if(icon && icon.imagePath){
                const img = document.createElement('img');
                img.src = `./resources/${icon.imagePath}`;
                iconEl.append(img);
            } else {
                iconEl.textContent =  '🏛️';
            }
        } else {
            iconEl.textContent =  '🏛️';
        }
        btn.append(iconEl);

        if (!locked) {
            btn.addEventListener('click', () => {
                this.activateBuildingPlacement(building, selectedUnitId);
            });
            
            btn.addEventListener('mouseenter', () => {
                btn.style.border = '2px solid var(--primary-gold)';
                btn.style.transform = 'translateY(-2px)';
            });
            
            btn.addEventListener('mouseleave', () => {
                btn.style.border = '2px solid rgba(255, 170, 0, 0.3)';
                btn.style.transform = 'translateY(0)';
            });
        }

        return btn;
    }

    activateBuildingPlacement(building, selectedUnitId) {
        this.game.state.selectedUnitType = {...building};

        this.game.state.peasantBuildingPlacement = {
            peasantId: selectedUnitId,
            buildTime: building.buildTime
        };

        this.stopTargeting();

        this.game.triggerEvent('onActivateBuildingPlacement', this.game.state.selectedUnitType);
    }
    moveOrderAction() {
        this.startTargeting({preventEnemiesInRangeCheck: true, preventCombat: true});
    }

    startTargeting(meta = {}) {
        this.stopTargeting();
        if(this.game.state.phase != 'placement') return;
        this.isTargeting = true;
        this.orderMeta = meta;
        this.pendingCallbacks = 0;

        const canvas = this.game.canvas;
        if (canvas) {
            canvas.addEventListener('contextmenu', this._onCanvasClick, { once: true });
           // canvas.addEventListener('mousemove', this._onCanvasMouseMove);
        }

    }

    stopTargeting() {
        if (!this.isTargeting) return;
        this.isTargeting = false;

        const canvas = this.game.canvas;
        if (canvas) {
            canvas.removeEventListener('contextmenu', this._onCanvasClick, { once: true });
       //     canvas.removeEventListener('mousemove', this._onCanvasMouseMove);
        }
        
        this.targetingPreview.clear();
    }

    holdPosition() {
        this.stopTargeting();

        let placementIds = this.game.gameManager.call('getSelectedSquads') || [];

        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            return;
        }
        placementIds.forEach((placementId) => {
            const placement = this.game.gameManager.call('getPlacementById', placementId);
            placement.squadUnits.forEach((unitId) => {
                const transform = this.game.getComponent(unitId, "transform");
                const position = transform?.position;
                if (this.game.effectsSystem && position) {
                    this.game.gameManager.call('createParticleEffect', position.x, 0, position.z, 'magic', { ...this.pingEffect });
                }
                // Set player order - behavior tree will read this and handle it
                const playerOrder = this.game.getComponent(unitId, "playerOrder");
                if (playerOrder) {
                    playerOrder.targetPosition = position;
                    playerOrder.meta = {
                        allowMovement: false
                    };
                    playerOrder.issuedTime = this.game.state.now;
                }

                // Clear path in pathfinding component
                const pathfinding = this.game.getComponent(unitId, "pathfinding");
                if (pathfinding) {
                    pathfinding.path = [];
                }
            });
        });

    }

    onKeyDown(key) {
        if (key === 'Escape' && this.isTargeting) {
            this.game.uiSystem?.showNotification('❌ Targeting canceled', 'warning', 800);
            this.stopTargeting();
        }
    }
    onUnitSelected(entityId){
        const unitType = this.game.getComponent(entityId, "unitType");
        if(unitType.collection == "units") {
            const placement = this.game.getComponent(entityId, "placement");        
            const placementId = placement.placementId;
            this.showSquadActionPanel(placementId);   
            this.startTargeting();     
        } else {
            this.stopTargeting();
        }
        this.showMoveTargets();
    }
    showMoveTargets() {
        this.targetingPreview.clear();
        const placementIds = this.game.gameManager.call('getSelectedSquads') || [];
        const targetPositions = [];
        placementIds.forEach((placementId) => {
            const placement = this.game.gameManager.call('getPlacementById', placementId);
            placement.squadUnits.forEach((entityId) => {
                const playerOrder = this.game.getComponent(entityId, "playerOrder");
                if(playerOrder && playerOrder.targetPosition) {
                    targetPositions.push(playerOrder.targetPosition);
                }
            });
        });

        this.targetingPreview.showAtWorldPositions(targetPositions, true);
    }
    // _onCanvasMouseMove(event) {
    //     if (!this.isTargeting) return;

    //     const canvas = this.game.canvas;
    //     if (!canvas) {
    //         this.stopTargeting();
    //         this.targetingPreview.clear();
    //         return;
    //     }

    //     const rect = canvas.getBoundingClientRect();
    //     const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    //     const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    //     const worldPos = this.game.placementSystem?.getWorldPositionFromMouse?.(event, mouseX, mouseY);
    //     if (!worldPos) {
    //         this.game.uiSystem?.showNotification('Could not find ground under cursor.', 'error', 1000);
    //         this.targetingPreview.clear();
    //         this.stopTargeting();
    //         return;
    //     }
    //     const placementIds = this.game.selectedUnitSystem.getSelectedSquads() || [];
    //     let isBuilding = false;
    //     placementIds.forEach((placementId) => {
    //         const placement = this.game.placementSystem.getPlacementById(placementId);
    //         if(placement.unitType.collection == "buildings"){
    //             isBuilding = true;
    //         }
    //         targetPositions.push(placement.targetPosition);
    //     });
    //     if(isBuilding){
    //         const targetPosition = { x: worldPos.x, z: worldPos.z };
    //         const targetPositions = this.getFormationTargetPositions(targetPosition, placementIds);
    //         this.targetingPreview.showAtWorldPositions(targetPositions, true);
    //     }
    // }

    _onCanvasClick(event) {
        if (!this.isTargeting) return;

        const canvas = this.game.canvas;
        if (!canvas) {
            this.stopTargeting();
            return;
        }

        const worldPos = this.game.gameManager.call('getWorldPositionFromMouse');
        if (!worldPos) {
            this.game.uiSystem?.showNotification('Could not find ground under cursor.', 'error', 1000);
            this.stopTargeting();
            return;
        }

        let placementIds = this.game.gameManager.call('getSelectedSquads') || [];

        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            this.stopTargeting();
            return;
        }

        // Check if clicking on a building under construction
        const buildingUnderConstruction = this.getBuildingUnderConstructionAtPosition(worldPos);
        if (buildingUnderConstruction) {
            // Check if any selected units have BuildAbility
            const builderUnit = this.getBuilderUnitFromSelection(placementIds);
            if (builderUnit) {
                this.assignBuilderToConstruction(builderUnit, buildingUnderConstruction);
                this.startTargeting();
                return;
            }
        }

        const targetPosition = { x: worldPos.x, y: 0, z: worldPos.z };

        if (this.game.effectsSystem) {
            this.game.gameManager.call('createParticleEffect', worldPos.x, 0, worldPos.z, 'magic', { ...this.pingEffect });
        }

        this.issueMoveOrders(placementIds, targetPosition);
    }

    getBuildingUnderConstructionAtPosition(worldPos) {
        const buildings = this.game.getEntitiesWith("placement", "transform", "unitType");

        for (const entityId of buildings) {
            const placement = this.game.getComponent(entityId, "placement");
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            const unitType = this.game.getComponent(entityId, "unitType");

            if (!placement || !pos || !unitType) continue;
            if (unitType.collection !== 'buildings') continue;
            if (!placement.isUnderConstruction) continue;

            // Check if click is within building bounds (use collision radius or default)
            const radius = unitType.collisionRadius || 50;
            const dx = worldPos.x - pos.x;
            const dz = worldPos.z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist <= radius) {
                return entityId;
            }
        }

        return null;
    }

    getBuilderUnitFromSelection(placementIds) {
        for (const placementId of placementIds) {
            const placement = this.game.gameManager.call('getPlacementById', placementId);
            if (!placement) continue;

            for (const unitId of placement.squadUnits) {
                // Check if unit has BuildAbility
                if (this.game.abilitySystem) {
                    const abilities = this.game.abilitySystem.getEntityAbilities(unitId);
                    if (abilities) {
                        for (const ability of abilities) {
                            if (ability.id === 'build') {
                                return unitId;
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    //this is desynced.
    assignBuilderToConstruction(builderEntityId, buildingEntityId) {
        const Components = this.game.gameManager.call('getComponents');

        const buildingTransform = this.game.getComponent(buildingEntityId, "transform");
        const buildingPos = buildingTransform?.position;
        const buildingPlacement = this.game.getComponent(buildingEntityId, "placement");

        if (!buildingPos || !buildingPlacement) return;

        // Get BuildAbility from the peasant
        if (this.game.abilitySystem) {
            const abilities = this.game.abilitySystem.getEntityAbilities(builderEntityId);
            if (abilities) {
                for (const ability of abilities) {
                    if (ability.id === 'build') {

                        // Update building's assigned builder
                        buildingPlacement.assignedBuilder = builderEntityId;

                        // Set player order for building - behavior tree will handle execution
                        const playerOrder = this.game.getComponent(builderEntityId, "playerOrder");
                        if (playerOrder) {
                            playerOrder.meta = {
                                buildingId: buildingEntityId,
                                buildingPosition: buildingPos
                            };
                            playerOrder.targetPosition = buildingPos;
                            playerOrder.issuedTime = this.game.state.now;
                            this.game.triggerEvent('onIssuedPlayerOrders', builderEntityId);
                        }

                        // Store peasantId in ability for completion tracking
                        ability.peasantId = builderEntityId;

                        if (this.game.effectsSystem) {
                            this.game.gameManager.call('createParticleEffect', buildingPos.x, 0, buildingPos.z, 'magic', { count: 8, color: 0xffaa00 });
                        }

                        this.game.uiSystem?.showNotification('Peasant assigned to continue construction', 'success', 1000);
                        return;
                    }
                }
            }
        }
    }

    issueMoveOrders(placementIds, targetPosition) {
        if(this.game.state.phase != "placement") {
            return;
        };
        const meta = { ...this.orderMeta, isMoveOrder: true };
        this.orderMeta = {};
        const targetPositions = this.getFormationTargetPositions(targetPosition, placementIds);
        // Capture client time for deterministic command creation
        const commandCreatedTime = this.game.state.now;
        this.game.networkManager.setSquadTargets(
            { placementIds, targetPositions, meta, commandCreatedTime },
            (success, responseData) => {
                if (success) {
                    // Use the time from the response (which came from our original request)
                    const createdTime = responseData?.commandCreatedTime || commandCreatedTime;
                    for(let i = 0; i < placementIds.length; i++){
                        let placementId = placementIds[i];
                        const targetPosition = targetPositions[i];
                        const placement = this.game.gameManager.call('getPlacementById', placementId);
                        // Set placement targetPosition to match server
                        placement.targetPosition = targetPosition;
                        placement.squadUnits.forEach((unitId) => {
                            if (this.game.effectsSystem && targetPosition) {
                                this.game.gameManager.call('createParticleEffect', targetPosition.x, 0, targetPosition.z, 'magic', { ...this.pingEffect });
                            }
                            if(targetPosition){
                                // Remove existing player order if present, then add new one
                                if (this.game.hasComponent(unitId, "playerOrder")) {
                                    this.game.removeComponent(unitId, "playerOrder");
                                }
                                this.game.addComponent(unitId, "playerOrder", {
                                    targetPosition: targetPosition,
                                    meta: meta,
                                    issuedTime: createdTime
                                });
                                this.game.triggerEvent('onIssuedPlayerOrders', unitId);

                                const aiState = this.game.getComponent(unitId, "aiState");
                                if(aiState){
                                    aiState.currentAction = "";
                                    aiState.meta = {};
                                    aiState.shared = {};
                                }
                            }
                        });

                    }
                    this.startTargeting();
                    this.showMoveTargets();
                }
            }
        );
    }

    getFormationTargetPositions(targetPosition, placementIds){
        let targetPositions = [];
        // Use placement grid size (half of terrain grid) for unit formation spacing
        const placementGridSize = this.game.gameManager.call('getPlacementGridSize');
        const unitPadding = 1;

        // Round to 2 decimal places to avoid floating-point precision issues that cause desync
        const roundPos = (val) => Math.round(val * 100) / 100;

        for(let i = 0; i < placementIds.length; i++){
            targetPositions.push({
                x: roundPos(targetPosition.x),
                z: roundPos(i % 2 == 0 ? targetPosition.z + i * placementGridSize * unitPadding : targetPosition.z - i * placementGridSize * unitPadding)
            });
        }
        return targetPositions;
    }

    applySquadTargetPosition(placementId, targetPosition, meta, commandCreatedTime) {
        const placement = this.game.gameManager.call('getPlacementById', placementId);
        if(!placement){
            // Placement doesn't exist yet on client - entity sync at battle start will handle it
            return;
        }
        const createdTime = commandCreatedTime || this.game.state.now;
        placement.targetPosition = targetPosition;
        placement.squadUnits.forEach((unitId) => {
            if(targetPosition){
                // Remove existing player order if present, then add new one
                if (this.game.hasComponent(unitId, "playerOrder")) {
                    this.game.removeComponent(unitId, "playerOrder");
                }
                this.game.addComponent(unitId, "playerOrder", {
                    targetPosition: targetPosition,
                    meta: meta,
                    issuedTime: createdTime
                });
            }
        });
    }

    applySquadsTargetPositions(placementIds, targetPositions, meta, commandCreatedTime) {
        for(let i = 0; i < placementIds.length; i++){
            let placementId = placementIds[i];
            let targetPosition = targetPositions[i];
            this.applySquadTargetPosition(placementId, targetPosition, meta, commandCreatedTime);
        }
    }
    onBattleStart() {
        this.stopTargeting();
    }
    onDeSelectAll() {        
        this.targetingPreview.clear();
    }

    destroy() {
        this.stopTargeting();
        if (this.targetingPreview) {
            this.targetingPreview.dispose();
        }
    }
}