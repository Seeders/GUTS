class UnitOrderSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game = game;
        this.game.unitOrderSystem = this;

        this.componentTypes = this.game.componentManager.getComponentTypes();

        this.isTargeting = false;
        this.pendingCallbacks = 0;

        this._onCanvasClick = this._onCanvasClick.bind(this);
        this._onCanvasMouseMove = this._onCanvasMouseMove.bind(this);

        this.cursorWhenTargeting = 'crosshair';
        this.pingEffect = { count: 12, color: 0x00ff00 };
        this.temporaryOpponentMoveOrders = new Map();
        this.targetingPreview = new GUTS.PlacementPreview(this.game);
        this.targetingPreview.updateConfig({
            cellOpacity: 0.3,
            borderOpacity: 0.6
        });
    }

    init() {}

    showSquadActionPanel(placementId) {
        const actionPanel = document.getElementById('actionPanel');
        if (!actionPanel) return;

        
        const placement = this.game.placementSystem.getPlacementById(placementId);
        
        actionPanel.innerHTML = "";
        
        const componentTypes = this.game.componentManager.getComponentTypes();
  
        
        const firstUnit = placement.squadUnits[0];
        const unitType = firstUnit ? this.game.getComponent(firstUnit, componentTypes.UNIT_TYPE) : null;
        
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
            if(icon && icon.filePath){
                const img = document.createElement('img');
                img.src = `./${icon.filePath}`;
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
            if(icon && icon.filePath){
                const img = document.createElement('img');
                img.src = `./${icon.filePath}`;
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
        this.game.state.selectedUnitType = { 
            id: building.id, 
            collection: 'buildings', 
            ...building 
        };
        
        this.game.state.peasantBuildingPlacement = {
            peasantId: selectedUnitId,
            buildTime: building.buildTime
        };
        
        this.stopTargeting();
        
        this.game.triggerEvent('onActivateBuildingPlacement', this.game.state.selectedUnitType);
    }

    startTargeting() {
        this.stopTargeting();

        this.isTargeting = true;
        this.pendingCallbacks = 0;

        const canvas = this.game.canvas;
        if (canvas) {
            canvas.addEventListener('contextmenu', this._onCanvasClick, { once: true });
            canvas.addEventListener('mousemove', this._onCanvasMouseMove);
        }

        document.body.style.cursor = this.cursorWhenTargeting;

        this.game.uiSystem?.showNotification('🎯 Click the ground to set a target for selected units', 'info', 1200);
    }

    stopTargeting() {
        if (!this.isTargeting) return;
        this.isTargeting = false;

        const canvas = this.game.canvas;
        if (canvas) {
            canvas.removeEventListener('contextmenu', this._onCanvasClick, { once: true });
            canvas.removeEventListener('mousemove', this._onCanvasMouseMove);
        }
        document.body.style.cursor = 'default';
        
        this.targetingPreview.clear();
    }

    holdPosition() {
        this.stopTargeting();
        
        let placementIds = this.game.selectedUnitSystem.getSelectedSquads() || [];
        
        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            return;
        }
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        placementIds.forEach((placementId) => {
            const placement = this.game.placementSystem.getPlacementById(placementId);
            placement.squadUnits.forEach((unitId) => {
                const position = this.game.getComponent(unitId, ComponentTypes.POSITION);
                const aiState = this.game.getComponent(unitId, ComponentTypes.AI_STATE);
                if (this.game.effectsSystem && position) {
                    this.game.effectsSystem.createParticleEffect(position.x, 0, position.z, 'magic', { ...this.pingEffect });
                }
                if(aiState){
                    aiState.targetPosition = position; 
                    aiState.currentAIController = "OrderSystemHold";
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

    _onCanvasMouseMove(event) {
        if (!this.isTargeting) return;

        const canvas = this.game.canvas;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const worldPos = this.game.placementSystem?.getWorldPositionFromMouse?.(event, mouseX, mouseY);
        if (!worldPos) {
            this.targetingPreview.clear();
            return;
        }

        const placementIds = this.game.selectedUnitSystem?.getSelectedSquads() || [];
        if (placementIds.length === 0) {
            this.targetingPreview.clear();
            return;
        }

        const targetPosition = { x: worldPos.x, z: worldPos.z };
        const targetPositions = this.getFormationTargetPositions(targetPosition, placementIds);

        this.targetingPreview.showAtWorldPositions(targetPositions, true);
    }

    _onCanvasClick(event) {
        if (!this.isTargeting) return;

        const canvas = this.game.canvas;
        if (!canvas) {
            this.stopTargeting();
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const worldPos = this.game.placementSystem?.getWorldPositionFromMouse?.(event, mouseX, mouseY);
        if (!worldPos) {
            this.game.uiSystem?.showNotification('Could not find ground under cursor.', 'error', 1000);
            this.stopTargeting();
            return;
        }

        let placementIds = this.game.selectedUnitSystem.getSelectedSquads() || [];
        
        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            this.stopTargeting();
            return;
        }

        const targetPosition = { x: worldPos.x, y: 0, z: worldPos.z };

        if (this.game.effectsSystem) {
            this.game.effectsSystem.createParticleEffect(worldPos.x, 0, worldPos.z, 'magic', { ...this.pingEffect });
        }

        this.issueMoveOrders(placementIds, targetPosition);
    }

    issueMoveOrders(placementIds, targetPosition) {
        const targetPositions = this.getFormationTargetPositions(targetPosition, placementIds);
        this.game.networkManager.setSquadTargets(
            { placementIds, targetPositions },
            (success) => {
                if (success) { 
                    const ComponentTypes = this.game.componentManager.getComponentTypes();        
                    for(let i = 0; i < placementIds.length; i++){
                        let placementId = placementIds[i];
                        const targetPosition = targetPositions[i];
                        const placement = this.game.placementSystem.getPlacementById(placementId);
                        placement.squadUnits.forEach((unitId) => {
                            const aiState = this.game.getComponent(unitId, ComponentTypes.AI_STATE);
                            if (this.game.effectsSystem && targetPosition) {
                                this.game.effectsSystem.createParticleEffect(targetPosition.x, 0, targetPosition.z, 'magic', { ...this.pingEffect });
                            }
                            if(aiState && targetPosition){
                                aiState.targetPosition = targetPosition;
                                aiState.currentAIController = "OrderSystemMove";
                            }
                        });
                                
                    }      
                    this.stopTargeting();                
                }                
            }
        );
    }

    getFormationTargetPositions(targetPosition, placementIds){
        let targetPositions = [];
        const gridSize = this.game.getCollections().configs.game.gridSize;
        const unitPadding = 1;

        for(let i = 0; i < placementIds.length; i++){
            targetPositions.push({
                x: targetPosition.x,
                z: i % 2 == 0 ? targetPosition.z + i * gridSize * unitPadding : targetPosition.z - i * gridSize * unitPadding
            });
        }
        return targetPositions;
    }

    applySquadTargetPosition(placementId, targetPosition) {   
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const placement = this.game.placementSystem.getPlacementById(placementId);
        if(!placement){
            this.temporaryOpponentMoveOrders.set(placementId, targetPosition);
            return;
        }
        placement.targetPosition = targetPosition;
        placement.squadUnits.forEach((unitId) => {
            const aiState = this.game.getComponent(unitId, ComponentTypes.AI_STATE);
            if(aiState && targetPosition){
                aiState.targetPosition = targetPosition;
                aiState.currentAIController = "OrderSystemMove";
            }
        });            
    }

    applySquadsTargetPositions(placementIds, targetPositions) {     
        for(let i = 0; i < placementIds.length; i++){  
            let placementId = placementIds[i];
            let targetPosition = targetPositions[i];
            this.applySquadTargetPosition(placementId, targetPosition);
        }
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