class SupplySystem extends GUTS.BaseSystem {
    static services = [
        'getCurrentSupply',
        'getCurrentPopulation',
        'canAffordSupply',
        'invalidateSupplyCache'
    ];

    constructor(game) {
        super(game);
        this.game.supplySystem = this;
        this.supplyElement = null;

        // Cached supply values - recalculated on demand
        this.cachedSupply = new Map(); // team -> { supply, population }
        this.isDirty = true; // Flag to trigger recalculation
    }

    init() {
        if (!this.game.isServer) {
            this.supplyElement = document.getElementById('playerSupplies');
        }
    }

    /**
     * Mark supply cache as dirty - call this when units/buildings are created or destroyed
     */
    invalidateSupplyCache() {
        this.isDirty = true;
    }

    /**
     * Called when a unit dies - invalidate cache
     */
    onUnitKilled(entityId) {
        this.invalidateSupplyCache();
    }

    /**
     * Called when a building is destroyed - invalidate cache
     */
    onDestroyBuilding(entityId) {
        this.invalidateSupplyCache();
    }

    /**
     * Recalculate supply values from actual living entities
     */
    recalculateSupply() {
        if (!this.isDirty) return;

        this.cachedSupply.clear();

        // Get all entities with unitType component (both units and buildings)
        const entities = this.game.getEntitiesWith('unitType');

        for (const entityId of entities) {
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
            const team = this.game.getComponent(entityId, 'team');
            const health = this.game.getComponent(entityId, 'health');
            const deathState = this.game.getComponent(entityId, 'deathState');

            // Skip if no team or dead/dying or no unit type
            if (!unitType) continue;
            if (!team?.team) continue;
            if (health && health.current <= 0) continue;
            if (deathState && deathState.state !== this.enums.deathState.alive) continue;

            const teamId = team.team;

            // Initialize team cache if needed
            if (!this.cachedSupply.has(teamId)) {
                this.cachedSupply.set(teamId, { supply: 0, population: 0 });
            }

            const teamCache = this.cachedSupply.get(teamId);

            // Add supply provided by buildings (e.g., townHall, cottage)
            if (unitType.supplyProvided) {
                teamCache.supply += unitType.supplyProvided;
            }

            // Add population cost of units
            if (unitType.supplyCost) {
                teamCache.population += unitType.supplyCost;
            }
        }

        this.isDirty = false;
    }

    updateSupplyDisplay() {
        if (!this.supplyElement) return;

        const team = this.game.state.myTeam;
        if (!team) return;

        const currentPop = this.getCurrentPopulation(team);
        const currentSupply = this.getCurrentSupply(team);

        this.supplyElement.innerHTML = `${currentPop}/${currentSupply}`;
    }

    update() {
        if (this.game.isServer) return;
        if (this.game.state.phase === this.enums.gamePhase.placement) {
            this.updateSupplyDisplay();
        }
    }

    /**
     * Get total supply capacity for a team (from buildings like townHall, cottage)
     */
    getCurrentSupply(team) {
        this.recalculateSupply();
        const teamCache = this.cachedSupply.get(team);
        return teamCache ? teamCache.supply : 0;
    }

    /**
     * Get current population (supply used) for a team
     */
    getCurrentPopulation(team) {
        this.recalculateSupply();
        const teamCache = this.cachedSupply.get(team);
        return teamCache ? teamCache.population : 0;
    }

    /**
     * Check if team can afford the supply cost of a unit
     */
    canAffordSupply(team, unitType) {
        const currentPop = this.getCurrentPopulation(team);
        const currentSupply = this.getCurrentSupply(team);
        const supplyCost = unitType.supplyCost || 0;

        return (currentPop + supplyCost) <= currentSupply;
    }
}
