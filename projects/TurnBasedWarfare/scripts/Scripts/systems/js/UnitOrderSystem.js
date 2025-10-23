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
        if (actionPanel) {
            actionPanel.innerHTML = "";
            
            let squadPanel = document.createElement('div');
            squadPanel.id = 'squadActionPanel';
            squadPanel.style.cssText = `
                margin-top: 1.5rem;
                padding: 15px;
                background: linear-gradient(145deg, rgba(13, 10, 26, 0.8), rgba(26, 13, 26, 0.8));
                border: 2px solid #ffaa00;
                border-radius: 8px;
            `;
        
            actionPanel.appendChild(squadPanel);
    
        
            const componentTypes = this.game.componentManager.getComponentTypes();
            const aliveUnits = squadData.unitIds.filter(id => 
                this.game.getComponent(id, componentTypes.HEALTH)
            ).length;
            
            const levelInfo = squadData.level > 1 ? ` (Lvl ${squadData.level})` : '';
            const expProgress = (squadData.experience / squadData.experienceToNextLevel * 100).toFixed(0);
            
            squadPanel.innerHTML = `
                <div class="panel-title">🛡️ SQUAD ACTIONS</div>
                <div style="color: var(--primary-gold); font-weight: 600; margin-bottom: 10px;">
                    ${squadName}${levelInfo}
                </div>
                <div style="color: var(--stone-gray); font-size: 0.85rem; margin-bottom: 10px;">
                    <div>Units: ${aliveUnits}/${squadData.totalUnitsInSquad}</div>
                    <div>XP: ${squadData.experience}/${squadData.experienceToNextLevel} (${expProgress}%)</div>
                    ${squadData.canLevelUp ? '<div style="color: #4ade80;">✨ Ready to Level Up!</div>' : ''}
                </div>
                <button id="setTargetBtn" class="btn btn-primary" style="width: 100%; margin-bottom: 8px;">
                    🎯 Set Target Position
                </button>
                <button id="deselectSquadBtn" class="btn btn-secondary" style="width: 100%;">
                    Close
                </button>
            `;
        }
        
        document.getElementById('setTargetBtn').addEventListener('click', () => {
            document.body.style.cursor = 'crosshair';
            this.startTargeting();
        });
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
        this.game.battleLogSystem?.add('🎯 Targeting started');
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

        for(let i = 0; i < placementIds.length; i++){
            targetPositions.push({
                x: targetPosition.x,
                z: i % 2 == 0 ? targetPosition.z + i * gridSize : targetPosition.z - i * gridSize
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

