class ShopManager {
    constructor(app) {
        this.game = app;
        this.game.shopManager = this;
    }
    
    createShop() {
        const shop = document.getElementById('unitShop');
        shop.innerHTML = '';
        
        const UnitTypes = this.game.getCollections().units;

        Object.keys(UnitTypes).forEach(unitId => {
            const unitType = UnitTypes[unitId];
            const card = this.createUnitCard(unitId, unitType);
            shop.appendChild(card);
        });
    }
    
    createUnitCard(unitId, unitType) {
        const card = document.createElement('div');
        card.className = 'unit-card';
        card.innerHTML = `
            <div class="unit-name">${unitType.title}</div>
            <div class="unit-cost">Cost: ${unitType.value}g</div>
            <div class="unit-stats">${unitType.hp} HP | ${unitType.damage} DMG</div>
        `;
        
        card.addEventListener('click', () => this.selectUnit({ id: unitId, ...unitType }));
        return card;
    }
    
    selectUnit(unitType) {
        const state = this.game.uiManager.getGameState();
        if (state.phase !== 'placement' || state.playerGold < unitType.value) return;
        
        state.selectedUnitType = unitType;
        
        // Update UI selection
        document.querySelectorAll('.unit-card').forEach(card => {
            card.classList.remove('selected');
        });
        event.target.closest('.unit-card').classList.add('selected');
        
        this.game.uiManager.battleLog.add(`Selected ${unitType.title} (${unitType.value}g)`);
    }
    
    updateShop() {
        const state = this.game.uiManager.getGameState();
        const UnitTypes = this.game.getCollections().units;
        
        document.querySelectorAll('.unit-card').forEach((card, index) => {
            const unitType = Object.values(UnitTypes)[index];
            const canAfford = state.playerGold >= unitType.value;
            const inPlacementPhase = state.phase === 'placement';
            
            card.classList.toggle('disabled', !canAfford || !inPlacementPhase);
        });
        
        // Update gold display
        document.getElementById('playerGold').textContent = state.playerGold;
        
        // Update enemy strength
        const strengthLevels = ['Weak', 'Normal', 'Strong', 'Elite', 'Legendary'];
        const strengthIndex = Math.min(Math.floor((state.round - 1) / 2), strengthLevels.length - 1);
       // document.getElementById('enemyStrength').textContent = strengthLevels[strengthIndex];
    }
}