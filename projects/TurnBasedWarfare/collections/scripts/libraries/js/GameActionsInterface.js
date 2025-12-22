/**
 * GameActionsInterface - Single interface for all game interactions
 *
 * Both the GUI (ShopSystem, PlacementUISystem) and headless mode use this
 * interface to interact with the game. This ensures identical code paths
 * regardless of whether a human or simulation is playing.
 *
 * This interface calls the existing services (sendPlacementRequest,
 * setSquadTargets, etc.) - it does NOT duplicate their logic.
 */
class GameActionsInterface {
    constructor(game) {
        this.game = game;
    }

    get collections() {
        return this.game.getCollections();
    }

    get enums() {
        return this.game.getEnums();
    }

    // ==================== PLACEMENT / BUILDING ====================

    /**
     * Send a placement request (unit or building)
     * This is what PlacementUISystem and ShopSystem use
     */
    sendPlacementRequest(networkUnitData, callback) {
        this.game.call('sendPlacementRequest', networkUnitData, callback);
    }

    /**
     * Create network unit data for a placement
     * Same logic as PlacementUISystem.createNetworkUnitData
     */
    createNetworkUnitData(gridPosition, unitType, team, playerId, peasantInfo = null) {
        const collectionIndex = this.enums.objectTypeDefinitions?.[unitType.collection] ?? null;
        const typeIndex = this.enums[unitType.collection]?.[unitType.id] ?? null;

        return {
            gridPosition: gridPosition,
            unitTypeId: typeIndex,
            collection: collectionIndex,
            team: team,
            playerId: playerId,
            roundPlaced: this.game.state.round || 1,
            timestamp: this.game.state.now,
            unitType: unitType,
            peasantInfo: peasantInfo,
            isStartingState: false
        };
    }

    /**
     * Find spawn position for a unit near a building
     * Wraps findBuildingSpawnPosition service
     */
    findBuildingSpawnPosition(placementId, unitDef) {
        return this.game.call('findBuildingSpawnPosition', placementId, unitDef);
    }

    // ==================== ORDERS ====================

    /**
     * Set squad target position (move/attack order)
     * This is what the UI uses for right-click orders
     */
    setSquadTarget(placementId, targetPosition, meta, callback) {
        this.game.call('setSquadTarget', {
            placementId,
            targetPosition,
            meta
        }, callback);
    }

    /**
     * Set multiple squad targets at once
     */
    setSquadTargets(placementIds, targetPositions, meta, callback) {
        this.game.call('setSquadTargets', {
            placementIds,
            targetPositions,
            meta
        }, callback);
    }

    // ==================== BATTLE PHASE ====================

    /**
     * Toggle ready for battle
     * This is what the "Ready for Battle" button calls
     */
    toggleReadyForBattle(callback) {
        this.game.call('toggleReadyForBattle', callback);
    }

    /**
     * Start battle directly (for local/skirmish mode)
     */
    startBattle() {
        if (this.game.hasService('startBattle')) {
            this.game.call('startBattle');
        }
    }

    // ==================== SHOP / UPGRADES ====================

    /**
     * Purchase an upgrade
     * This is what ShopSystem uses for upgrade buttons
     */
    purchaseUpgrade(upgradeId, callback) {
        this.game.call('purchaseUpgrade', { upgradeId }, callback);
    }

    /**
     * Upgrade a building to a higher tier
     */
    upgradeBuildingRequest(buildingEntityId, placementId, targetBuildingId, callback) {
        this.game.call('upgradeBuildingRequest', {
            buildingEntityId,
            placementId,
            targetBuildingId
        }, callback);
    }

    /**
     * Cancel building construction
     */
    cancelBuilding(placementId, buildingEntityId, callback) {
        this.game.call('cancelBuilding', {
            placementId,
            buildingEntityId
        }, callback);
    }

    // ==================== SELECTION ====================

    /**
     * Select a unit/building
     */
    selectUnit(entityId) {
        if (this.game.hasService('selectUnit')) {
            this.game.call('selectUnit', entityId);
        } else {
            this.game.state.selectedEntity = { entityId, collection: null };
        }
    }

    /**
     * Deselect all units
     */
    deselectAll() {
        if (this.game.hasService('deselectAllUnits')) {
            this.game.call('deselectAllUnits');
        } else {
            this.game.state.selectedEntity = { entityId: null, collection: null };
        }
    }

    // ==================== QUERIES ====================

    /**
     * Get placements for a team
     */
    getPlacementsForSide(team) {
        return this.game.call('getPlacementsForSide', team);
    }

    /**
     * Get placement by ID
     */
    getPlacementById(placementId) {
        return this.game.call('getPlacementById', placementId);
    }

    /**
     * Check if player can afford a cost
     */
    canAffordCost(cost) {
        return this.game.call('canAffordCost', cost);
    }

    /**
     * Check if player can afford supply for a unit
     */
    canAffordSupply(team, unitDef) {
        if (!this.game.hasService('canAffordSupply')) return true;
        return this.game.call('canAffordSupply', team, unitDef) ?? true;
    }

    /**
     * Get player stats by team
     */
    getPlayerStatsByTeam(team) {
        return this.game.call('getPlayerStatsByTeam', team);
    }

    /**
     * Convert grid position to world position
     */
    placementGridToWorld(x, z) {
        return this.game.call('placementGridToWorld', x, z);
    }

    /**
     * Convert world position to grid position
     */
    worldToPlacementGrid(x, z) {
        return this.game.call('worldToPlacementGrid', x, z);
    }

    // ==================== LEVEL UP ====================

    /**
     * Level up a squad
     */
    levelUpSquad(placementId, team, callback) {
        this.game.call('levelUpSquad', placementId, team, null, callback);
    }

    // ==================== UNIT DEFINITIONS ====================

    /**
     * Get unit type definition from unitType component
     * Heavily used by all GUI systems
     */
    getUnitTypeDef(unitTypeComp) {
        return this.game.call('getUnitTypeDef', unitTypeComp);
    }

    /**
     * Get squad data (formation, size) for a unit type
     * Used for placement validation
     */
    getSquadData(unitType) {
        return this.game.call('getSquadData', unitType);
    }

    /**
     * Get grid cells occupied by a squad at a position
     * Used for placement validation
     */
    getSquadCells(gridPos, squadData) {
        return this.game.call('getSquadCells', gridPos, squadData);
    }

    /**
     * Check if grid placement is valid
     * Used by PlacementUISystem for placement validation
     */
    isValidGridPlacement(cells, team) {
        return this.game.call('isValidGridPlacement', cells, team);
    }

    // ==================== GOLD MANAGEMENT ====================

    /**
     * Add gold to a player (used for refunds/undo)
     */
    addPlayerGold(team, amount) {
        this.game.call('addPlayerGold', team, amount);
    }

    /**
     * Get local player stats (gold, upgrades bitmask)
     */
    getLocalPlayerStats() {
        return this.game.call('getLocalPlayerStats');
    }

    // ==================== GRID / COORDINATES ====================

    /**
     * Get placement grid size
     * Used for coordinate translation
     */
    getPlacementGridSize() {
        return this.game.call('getPlacementGridSize');
    }

    /**
     * Release grid cells (for undo/cancel)
     */
    releaseGridCells(entityId) {
        this.game.call('releaseGridCells', entityId);
    }
}

GUTS.GameActionsInterface = GameActionsInterface;
