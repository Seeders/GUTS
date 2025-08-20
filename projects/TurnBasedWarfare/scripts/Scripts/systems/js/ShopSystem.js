class ShopSystem {
    constructor(app) {
        this.game = app;
        this.game.shopSystem = this;
    }
    
    createShop() {
        const shop = document.getElementById('unitShop');
        shop.innerHTML = '';
        
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
    
    createUnitCard(unitId, unitType) {
        if(unitType.value < 0) return null;
        
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