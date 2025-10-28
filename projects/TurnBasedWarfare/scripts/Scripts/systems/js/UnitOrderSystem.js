class UnitOrderSystem extends engine.BaseSystem {
    /**
     * Centralized handler for player-issued unit orders (move/target-position).
     * Uses callback-style networking (no async/await).
     */
    constructor(game) {
        super(game);
        this.game = game;
        this.game.unitOrderSystem = this;

        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Targeting session state
        this.isTargeting = false;
        this.pendingCallbacks = 0;

        this._onCanvasClick = this._onCanvasClick.bind(this);
        this._onCancelKey = this._onCancelKey.bind(this);

        // UX
        this.cursorWhenTargeting = 'crosshair';
        this.pingEffect = { count: 12, color: 0x00ff00 };
    }

    init() {}

    showSquadActionPanel(placementId, squadName, squadData) {
        const actionPanel = document.getElementById('actionPanel');
        if (!actionPanel) return;
        
        actionPanel.innerHTML = "";
        
        const componentTypes = this.game.componentManager.getComponentTypes();
        const aliveUnits = squadData.unitIds.filter(id => 
            this.game.getComponent(id, componentTypes.HEALTH)
        ).length;
        
        // Check if this squad can build
        const firstUnit = squadData.unitIds[0];
        const unitType = firstUnit ? this.game.getComponent(firstUnit, componentTypes.UNIT_TYPE) : null;
        const canBuild = unitType && unitType.abilities && unitType.abilities.includes('BuildAbility');
        
        // Squad info panel
        let squadPanel = document.createElement('div');
        squadPanel.id = 'squadActionPanel';
        
        const levelInfo = squadData.level > 1 ? ` (Lvl ${squadData.level})` : '';
        const expProgress = (squadData.experience / squadData.experienceToNextLevel * 100).toFixed(0);
        
        squadPanel.innerHTML = `
            <div class="panel-title">${canBuild ? '⚒️ PEASANT ACTIONS' : '🛡️ SQUAD ACTIONS'}</div>
            <div style="color: var(--primary-gold); font-weight: 600; margin-bottom: 10px;">
                ${squadName}${levelInfo}
            </div>
            <div style="color: var(--stone-gray); font-size: 0.85rem; margin-bottom: 10px;">
                <div>Units: ${aliveUnits}/${squadData.totalUnitsInSquad}</div>
                <div>XP: ${squadData.experience}/${squadData.experienceToNextLevel} (${expProgress}%)</div>
                ${squadData.canLevelUp ? '<div style="color: #4ade80;">✨ Ready to Level Up!</div>' : ''}
            </div>
        `;
        
        actionPanel.appendChild(squadPanel);
        
        // Add building options if this unit can build
        if (canBuild) {
            this.addBuildingOptions(actionPanel, squadData.unitIds);
        }
        
        // Standard squad actions
        const actionsDiv = document.createElement('div');
        actionsDiv.innerHTML = `
            <button id="setTargetBtn" class="btn btn-primary" style="width: 100%; margin-bottom: 8px;">
                🎯 Set Target Position
            </button>
            <button id="deselectSquadBtn" class="btn btn-secondary" style="width: 100%;">
                Close
            </button>
        `;
        squadPanel.appendChild(actionsDiv);
        
        document.getElementById('setTargetBtn').addEventListener('click', () => {
            document.body.style.cursor = 'crosshair';
            this.startTargeting();
        });
        
        document.getElementById('deselectSquadBtn').addEventListener('click', () => {
            actionPanel.innerHTML = '';
        });
    }

    // ADD THIS NEW METHOD to UnitOrderSystem:

    addBuildingOptions(actionPanel, selectedUnitIds) {
        const buildSection = document.createElement('div');
        buildSection.className = 'action-section';

        const buildHeader = document.createElement('div');
        buildHeader.className = 'action-section-header';
        buildHeader.textContent = 'BUILD STRUCTURES';
        buildSection.appendChild(buildHeader);

        const grid = document.createElement('div');
        grid.className = 'action-grid';
        const buildings = this.game.getCollections().buildings;
        
        Object.keys(buildings).forEach(buildingId => {
            if (buildingId === 'underConstruction') return;
            
            const building = buildings[buildingId];
            if (!building.buildTime) building.buildTime = 1;
            
            building.id = buildingId;
            const canAfford = this.game.state.playerGold >= (building.value || 0);
            const isLocked = this.game.shopSystem?.isBuildingLocked(buildingId, building);
            const lockReason = this.game.shopSystem?.getLockReason(buildingId, building);
            
            const btn = this.createBuildingButton(building, canAfford, isLocked, lockReason, selectedUnitIds);
            grid.appendChild(btn);
        });

        buildSection.appendChild(grid);
        
        const squadPanel = document.getElementById('squadActionPanel');
        if (squadPanel) {
            squadPanel.appendChild(buildSection);
        }
    }

    // ADD THIS NEW METHOD to UnitOrderSystem:

    createBuildingButton(building, canAfford, isLocked, lockReason, selectedUnitIds) {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        
        const locked = isLocked || !canAfford;
        if (locked) {
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        }
        
        const icon = document.createElement('div');
        icon.style.cssText = 'font-size: 2rem; margin-bottom: 4px;';
        icon.textContent = building.icon || '🏛️';
        btn.appendChild(icon);

        const title = document.createElement('div');
        title.style.cssText = 'font-size: 0.75rem; font-weight: 600; text-align: center; margin-bottom: 4px;';
        title.textContent = building.title;
        btn.appendChild(title);

        if (building.buildTime) {
            const buildTime = document.createElement('div');
            buildTime.style.cssText = 'font-size: 0.7rem; color: #888;';
            buildTime.textContent = `⏱️ ${building.buildTime}s`;
            btn.appendChild(buildTime);
        }

        const cost = document.createElement('div');
        cost.style.cssText = 'font-size: 0.75rem; margin-top: 4px;';
        if (lockReason) {
            cost.textContent = lockReason;
            cost.style.color = '#f44336';
        } else if (!canAfford) {
            cost.textContent = "Can't afford";
            cost.style.color = '#f44336';
        } else {
            cost.innerHTML = `💰 ${building.value || 0}`;
            cost.style.color = 'var(--primary-gold)';
        }
        btn.appendChild(cost);

        if (!locked) {
            btn.addEventListener('click', () => {
                this.activateBuildingPlacement(building, selectedUnitIds);
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

    // ADD THIS NEW METHOD to UnitOrderSystem:

    activateBuildingPlacement(building, selectedUnitIds) {
        console.log('activate building');
        this.game.state.selectedUnitType = { 
            id: building.id, 
            collection: 'buildings', 
            ...building 
        };
        
        this.game.state.peasantBuildingPlacement = {
            peasantIds: selectedUnitIds,
            buildTime: building.buildTime
        };
        
        if (this.game.placementSystem) {
            this.game.placementSystem.handleUnitSelectionChange();
        }
    }


    /**
     * Begin a single-click targeting session.
     * @param {{placementIds?: string[], cursor?: string}} opts
     */
    startTargeting() {
        // Reset any previous session first
        this.stopTargeting();

        this.isTargeting = true;
        this.pendingCallbacks = 0;

        // Input hooks
        const canvas = this.game.canvas;
        if (canvas) {
            // one-shot: we remove it ourselves, but { once:true } avoids double-fires
            canvas.addEventListener('click', this._onCanvasClick, { once: true });
        }
        document.addEventListener('keydown', this._onCancelKey);

        // Cursor
        document.body.style.cursor = this.cursorWhenTargeting;

        this.game.uiSystem?.showNotification('🎯 Click the ground to set a target for selected units', 'info', 1200);
    }

    stopTargeting() {
        if (!this.isTargeting) return;
        this.isTargeting = false;

        const canvas = this.game.canvas;
        if (canvas) {
            // Remove any residual listener in case we canceled via ESC
            canvas.removeEventListener('click', this._onCanvasClick, { once: true });
        }
        document.removeEventListener('keydown', this._onCancelKey);
        document.body.style.cursor = 'default';
    }

    _onCancelKey(e) {
        if (e.key === 'Escape') {
            this.game.uiSystem?.showNotification('❌ Targeting canceled', 'warning', 800);
            this.stopTargeting();
        }
    }

    _onCanvasClick(event) {
        if (!this.isTargeting) return;

        const canvas = this.game.canvas;
        if (!canvas) {
            this.stopTargeting();
            return;
        }

        // Screen → NDC
        const rect = canvas.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Prefer any helper you already have (same as your placement system)
        const worldPos = this.game.placementSystem?.getWorldPositionFromMouse?.(event, mouseX, mouseY);
        if (!worldPos) {
            this.game.uiSystem?.showNotification('Could not find ground under cursor.', 'error', 1000);
            this.stopTargeting();
            return;
        }

        // Which squads receive the order?
        let placementIds = this.game.selectedUnitSystem.getSelectedSquads() || [];
        
        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            this.stopTargeting();
            return;
        }

        const targetPosition = { x: worldPos.x, y: 0, z: worldPos.z };

        // One visual ping at the clicked spot
        if (this.game.effectsSystem) {
            this.game.effectsSystem.createParticleEffect(worldPos.x, 0, worldPos.z, 'magic', { ...this.pingEffect });
        }

        // Fire one request per squad (callback style), and only stop targeting after all have returned
        this.issueMoveOrders(placementIds, targetPosition);
    }

    issueMoveOrders(placementIds, targetPosition) {
        let targetPositions = [];
        const gridSize = this.game.getCollections().configs.game.gridSize;
        const unitPadding =  0.5;

        for(let i = 0; i < placementIds.length; i++){
            targetPositions.push({
                x: targetPosition.x,
                z: i % 2 == 0 ? targetPosition.z + i * gridSize * unitPadding : targetPosition.z - i * gridSize * unitPadding
            })
        }

        this.game.networkManager.setSquadTargets(
            { placementIds, targetPositions },
            (success /*, response */) => {
                if (success) {         
                    for(let i = 0; i < placementIds.length; i++){
                        this.game.state.targetPositions.set(placementIds[i], targetPositions[i]);            
                    }      
                    this.stopTargeting();                
                }                
            }
        );
        
    }

    applySquadTargetPosition(placementId, targetPosition) {       
        this.game.state.targetPositions.set(placementId, targetPosition);  
    }

    applySquadsTargetPositions(placementIds, targetPositions) {     
        for(let i = 0; i < placementIds.length; i++){  
            let placementId = placementIds[i];
            let targetPosition = targetPositions[i];
            this.game.state.targetPositions.set(placementId, targetPosition);  
        }
    }

    destroy() {
        this.stopTargeting();
    }
}

