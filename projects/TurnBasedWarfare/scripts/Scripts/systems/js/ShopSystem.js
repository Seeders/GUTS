class ShopSystem {
    constructor(app) {
        this.game = app;
        this.game.shopSystem = this;
    }
    
    createShop() {
        const shop = document.getElementById('unitShop');
        shop.innerHTML = '';
        
        // Add undo button at the top of the shop
        const undoButton = this.createUndoButton();
        shop.appendChild(undoButton);
        
        const UnitTypes = this.game.getCollections().units;

        // Get all valid units and sort by price (cheapest first)
        const sortedUnits = Object.keys(UnitTypes)
            .map(unitId => ({ id: unitId, ...UnitTypes[unitId] }))
            .filter(unit => unit.value >= 0)
            .sort((a, b) => a.value - b.value);

        sortedUnits.forEach(unit => {
            const card = this.createUnitCard(unit.id, unit);
            if(card){
                shop.appendChild(card);
            }
        });
    }
    
    createUndoButton() {
        const undoContainer = document.createElement('div');
        undoContainer.className = 'undo-container';
        undoContainer.style.cssText = `
            margin-bottom: 10px;
            padding: 10px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 5px;
            border: 1px solid #444;
        `;
        
        const undoButton = document.createElement('button');
        undoButton.id = 'undoButton';
        undoButton.className = 'undo-button';
        undoButton.innerHTML = '↶ Undo (Ctrl+Z)';
        undoButton.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            background: #444;
            color: #fff;
            border: 1px solid #666;
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s ease;
        `;
        
        undoButton.addEventListener('click', () => {
            if (this.game.placementSystem) {
                this.game.placementSystem.undoLastPlacement();
            }
        });
        
        undoButton.addEventListener('mouseenter', () => {
            if (!undoButton.disabled) {
                undoButton.style.background = '#555';
                undoButton.style.borderColor = '#777';
            }
        });
        
        undoButton.addEventListener('mouseleave', () => {
            if (!undoButton.disabled) {
                undoButton.style.background = '#444';
                undoButton.style.borderColor = '#666';
            }
        });
        
        undoContainer.appendChild(undoButton);
        return undoContainer;
    }
    
    createUnitCard(unitId, unitType) {
        if(unitType.value < 0 || !unitType.buyable) return null;
        
        const card = document.createElement('div');
        card.className = 'unit-card';
        // Store the unit ID directly on the element for reliable lookup
        card.dataset.unitId = unitId;
        card.innerHTML = `
            <div class="unit-name">${unitType.title}</div>
            <div class="unit-cost">Cost: ${unitType.value}g</div>
            <div class="unit-stats"><p>${unitType.hp} HP</p><p>${unitType.damage} DMG</p></div>
        `;
        
        card.addEventListener('click', () => this.selectUnit({ id: unitId, ...unitType }));
        return card;
    }
    
    selectUnit(unitType) {
        const state = this.game.state;
        if (state.phase !== 'placement' || state.playerGold < unitType.value) return;
        
        state.selectedUnitType = unitType;
        this.game.placementSystem.handleUnitSelectionChange(unitType);
        // Update UI selection
        document.querySelectorAll('.unit-card').forEach(card => {
            card.classList.remove('selected');
        });
        event.target.closest('.unit-card').classList.add('selected');
        
        this.game.battleLogSystem.add(`Selected ${unitType.title} (${unitType.value}g)`);
    }
    
    update(deltaTime) {
        const state = this.game.state;
        const UnitTypes = this.game.getCollections().units;
        const inPlacementPhase = state.phase === 'placement';
        
        // Update undo button
        this.updateUndoButton(inPlacementPhase);
        
        // Use dataset.unitId to reliably match cards with unit types
        document.querySelectorAll('.unit-card').forEach(card => {
            const unitId = card.dataset.unitId;
            const unitType = UnitTypes[unitId];
            
            if (!unitType) {
                console.warn(`Unit type not found for ID: ${unitId}`);
                return;
            }
            
            const canAfford = state.playerGold >= unitType.value;
            
            // Update card state
            card.classList.toggle('disabled', !canAfford || !inPlacementPhase);
            
            // Optional: Update card display with current affordability
            const costElement = card.querySelector('.unit-cost');
            if (costElement) {
                costElement.textContent = `Cost: ${unitType.value}g`;
                costElement.style.color = canAfford ? '' : '#ff4444';
            }
        });
        
        // Update gold display
        const goldElement = document.getElementById('playerGold');
        if (goldElement) {
            goldElement.textContent = state.playerGold;
        }
        
        // Update enemy strength
        const strengthLevels = ['Weak', 'Normal', 'Strong', 'Elite', 'Legendary'];
        const strengthIndex = Math.min(Math.floor((state.round - 1) / 2), strengthLevels.length - 1);
        const strengthElement = document.getElementById('enemyStrength');
        if (strengthElement) {
            strengthElement.textContent = strengthLevels[strengthIndex];
        }
    }
    
    updateUndoButton(inPlacementPhase) {
        const undoButton = document.getElementById('undoButton');
        if (!undoButton || !this.game.placementSystem) return;
        
        const undoStatus = this.game.placementSystem.getUndoStatus();
        const canUndo = undoStatus.canUndo && inPlacementPhase;
        
        undoButton.disabled = !canUndo;
        
        if (canUndo) {
            undoButton.style.background = '#444';
            undoButton.style.color = '#fff';
            undoButton.style.cursor = 'pointer';
            undoButton.style.opacity = '1';
            
            // Show what can be undone
            if (undoStatus.lastAction) {
                const lastAction = undoStatus.lastAction;
                undoButton.innerHTML = `↶ Undo ${lastAction.unitType.title} (+${lastAction.cost}g)`;
            } else {
                undoButton.innerHTML = '↶ Undo (Ctrl+Z)';
            }
        } else {
            undoButton.style.background = '#222';
            undoButton.style.color = '#666';
            undoButton.style.cursor = 'not-allowed';
            undoButton.style.opacity = '0.5';
            undoButton.innerHTML = undoStatus.undoCount === 0 ? '↶ Nothing to undo' : '↶ Undo (placement phase only)';
        }
    }
    
    // Helper method to get all purchasable units
    getPurchasableUnits() {
        const UnitTypes = this.game.getCollections().units;
        return Object.keys(UnitTypes)
            .filter(unitId => UnitTypes[unitId].value >= 0)
            .map(unitId => ({ id: unitId, ...UnitTypes[unitId] }));
    }
    
    // Helper method to check if a specific unit is affordable
    isUnitAffordable(unitId) {
        const UnitTypes = this.game.getCollections().units;
        const unitType = UnitTypes[unitId];
        return unitType && this.game.state.playerGold >= unitType.value;
    }
    
    // Method to clear selection
    clearSelection() {
        this.game.state.selectedUnitType = null;
        document.querySelectorAll('.unit-card').forEach(card => {
            card.classList.remove('selected');
        });
    }
    
    // Method to update a specific unit card
    updateUnitCard(unitId) {
        const card = document.querySelector(`[data-unit-id="${unitId}"]`);
        if (!card) return;
        
        const UnitTypes = this.game.getCollections().units;
        const unitType = UnitTypes[unitId];
        if (!unitType) return;
        
        const state = this.game.state;
        const canAfford = state.playerGold >= unitType.value;
        const inPlacementPhase = state.phase === 'placement';
        
        card.classList.toggle('disabled', !canAfford || !inPlacementPhase);
        
        // Update cost display color
        const costElement = card.querySelector('.unit-cost');
        if (costElement) {
            costElement.style.color = canAfford ? '' : '#ff4444';
        }
    }
    
    // Method to refresh the entire shop
    refreshShop() {
        this.createShop();
    }
}