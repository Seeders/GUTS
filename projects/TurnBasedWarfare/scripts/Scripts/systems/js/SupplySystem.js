class SupplySystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.supplySystem = this;
        this.supplyElement = null;
    }

    init() {
        this.game.gameManager.register('getCurrentSupply', this.getCurrentSupply.bind(this));
        this.game.gameManager.register('getCurrentPopulation', this.getCurrentPopulation.bind(this));
        this.game.gameManager.register('canAffordSupply', this.canAffordSupply.bind(this));
        if(!this.game.isServer){
            this.supplyElement = document.getElementById('playerSupplies');
        }
        
    }

    updateSupplyDisplay() {
        if (!this.supplyElement) return;

        const team = this.game.state.mySide;
        if (!team) return;

        const currentPop = this.getCurrentPopulation(team);
        const currentSupply = this.getCurrentSupply(team);

        const isAtLimit = currentPop >= currentSupply;

        this.supplyElement.innerHTML = `${currentPop}/${currentSupply}`;
    }

    update() {
        if(this.game.isServer) return;
        if (this.game.state.phase === 'placement') {
            this.updateSupplyDisplay();
        }
    }

    getCurrentSupply(team) {
        const placements = this.game.gameManager.call('getPlacementsForSide', team);
        if (!placements) return 0;

        let totalSupply = 0;

        placements.forEach(placement => {     
            if(placement.unitType.supplyProvided){      
                totalSupply += placement.unitType.supplyProvided;            
            }
        });
        return totalSupply;
    }


    getCurrentPopulation(team) {
        const placements = this.game.gameManager.call('getPlacementsForSide', team);
        if (!placements) return 0;

        let totalPopulation = 0;

        placements.forEach(placement => {     
            if(placement.unitType.supplyCost){      
                totalPopulation += placement.unitType.supplyCost;            
            }
        });
        return totalPopulation;
    }

    canAffordSupply(team, unitType) {
        const currentPop = this.getCurrentPopulation(team);
        const currentSupply = this.getCurrentSupply(team);
        const supplyCost = unitType.supplyCost || 0;

        return (currentPop + supplyCost) <= currentSupply;
    }


}