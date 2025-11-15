/**
 * Unified PlacementSystem - Works on both client and server
 * Handles core placement logic, squad management, and battle lifecycle
 */
class PlacementSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.placementSystem = this;

        // Core placement tracking
        this.playerPlacements = new Map(); // Map<playerId, placements[]>
        this.leftPlacements = [];
        this.rightPlacements = [];
        this.placementReadyStates = new Map();
        this.numPlayers = 2;

        // Environment-specific controllers (set by subclasses or externally)
        this.serverController = null;
        this.clientUI = null;
    }

    init(params) {
        this.params = params || {};

        // Register common game manager functions
        this.game.gameManager.register('getPlacementsForSide', this.getPlacementsForSide.bind(this));
        this.game.gameManager.register('getPlacementById', this.getPlacementById.bind(this));
        this.game.gameManager.register('createPlacementData', this.createPlacementData.bind(this));

        // Initialize environment-specific controllers
        if (this.serverController) {
            this.serverController.init(params);
        }
        if (this.clientUI) {
            this.clientUI.init(params);
        }
    }

    // ==================== Placement Queries ====================

    getPlacementById(placementId) {
        // Search in left placements
        const leftPlacement = this.leftPlacements.find(placement => placement.placementId === placementId);
        if (leftPlacement) return leftPlacement;

        // Search in right placements
        const rightPlacement = this.rightPlacements.find(placement => placement.placementId === placementId);
        if (rightPlacement) return rightPlacement;

        return null;
    }

    getPlayerIdByPlacementId(placementId) {
        for (const [playerId, placements] of this.playerPlacements) {
            const foundPlacement = placements.find(placement => placement.placementId === placementId);
            if (foundPlacement) return playerId;
        }
        return null;
    }

    getPlacementsForSide(side) {
        return side === 'left' ? this.leftPlacements : this.rightPlacements;
    }

    // ==================== Placement Creation ====================

    createPlacementData(gridPos, unitType, team) {
        const squadData = this.game.squadManager.getSquadData(unitType);
        const cells = this.game.squadManager.getSquadCells(gridPos, squadData);

        const placementId = `squad_${team}_${gridPos.x}_${gridPos.z}_${this.game.state.round}`;
        return {
            placementId: placementId,
            gridPosition: gridPos,
            cells: cells,
            collection: unitType.collection,
            unitType: { ...unitType },
            squadUnits: [],
            team: team,
            targetPosition: this.game.state.targetPositions?.get(placementId),
            roundPlaced: this.game.state.round,
            timestamp: this.game.state.now,
            peasantInfo: this.game.state.peasantBuildingPlacement
        };
    }

    submitPlayerPlacement(playerId, player, placement) {
        if (this.game.state.phase !== 'placement') {
            return { success: false, error: `Not in placement phase (${this.game.state.phase})` };
        }

        // Validate placements
        if (!this.validatePlacement(placement, player)) {
            return { success: false, error: 'Invalid placement' };
        }

        // Deduct gold only for new units
        if (placement.unitType?.value > 0 && !placement.isStartingState) {
            player.stats.gold -= placement.unitType?.value;
        }

        // Store placements
        let playerPlacements = this.playerPlacements.get(playerId);
        if (playerPlacements) {
            playerPlacements.push(placement);
        } else {
            playerPlacements = [placement];
        }
        this.playerPlacements.set(playerId, playerPlacements);

        // Update side-specific arrays
        if (player.stats.side === 'left') {
            this.leftPlacements = this.playerPlacements.get(playerId);
        } else {
            this.rightPlacements = this.playerPlacements.get(playerId);
        }

        // Spawn the squad
        const result = this.game.gameManager.call('spawnSquadFromPlacement', playerId, placement);

        if (result.success && result.squad) {
            let squadUnits = [];
            result.squad.squadUnits.forEach((entityId) => {
                squadUnits.push(entityId);
            });
            placement.squadUnits = squadUnits;

            if (placement.placementId) {
                this.game.gameManager.call('initializeSquad',
                    placement.placementId,
                    placement.unitType,
                    placement.squadUnits,
                    placement.team
                );
            }

            // Handle peasant building placement
            if (placement.peasantInfo && placement.collection === 'buildings') {
                const peasantInfo = placement.peasantInfo;
                const peasantId = peasantInfo.peasantId;
                const entityId = placement.squadUnits[0];

                const peasantAbilities = this.game.gameManager.call('getEntityAbilities', peasantId);
                if (peasantAbilities) {
                    const buildAbility = peasantAbilities.find(a => a.id === 'build');
                    if (buildAbility) {
                        buildAbility.assignToBuild(peasantId, entityId, peasantInfo);
                    }
                }

                this.game.state.peasantBuildingPlacement = null;
            }
        }

        return { success: result.success };
    }

    // ==================== Validation ====================

    validatePlacement(placement, player) {
        if (placement.isStartingState) return true;

        const newUnitCost = placement.unitType?.value;

        if (newUnitCost > player.stats.gold) {
            console.log(`Player ${player.id} insufficient gold: ${newUnitCost} > ${player.stats.gold}`);
            return false;
        }

        if (this.game.gameManager.has('canAffordSupply') &&
            !this.game.gameManager.call('canAffordSupply', player.stats.side, placement.unitType)) {
            console.log(`Player ${player.id} insufficient supply for unit: ${placement.unitType.id}`);
            return false;
        }

        if (!placement.gridPosition || !placement.unitType) {
            console.log(`Player ${player.id} invalid placement data:`, placement);
            return false;
        }

        // Validate grid placement
        const squadData = this.game.squadManager.getSquadData(placement.unitType);
        const cells = this.game.squadManager.getSquadCells(placement.gridPosition, squadData);

        if (!this.game.gameManager.call('isValidGridPlacement', cells, player.stats.side)) {
            console.log('Invalid Placement', placement);
            for (const cell of cells) {
                const key = `${cell.x},${cell.z}`;
                const cellState = this.game.gridSystem.state.get(key);
                if (cellState && cellState.occupied) {
                    console.log('occupied:', cell, cellState);
                }
            }
            return false;
        }

        return true;
    }

    // ==================== AI & Target Management ====================

    resetAI() {
        const componentTypes = this.game.componentManager.getComponentTypes();
        const AIEntities = this.game.getEntitiesWith(componentTypes.AI_STATE, componentTypes.COMBAT);

        AIEntities.forEach((entityId) => {
            const aiState = this.game.getComponent(entityId, componentTypes.AI_STATE);
            const combat = this.game.getComponent(entityId, componentTypes.COMBAT);
            combat.lastAttack = 0;
            aiState.aiBehavior = {};
        });
    }

    applyTargetPositions() {
        const ComponentTypes = this.game.componentManager.getComponentTypes();

        for (const [playerId, placements] of this.playerPlacements) {
            placements.forEach((placement) => {
                const targetPosition = placement.targetPosition;

                placement.squadUnits.forEach(entityId => {
                    const aiState = this.game.getComponent(entityId, ComponentTypes.AI_STATE);
                    const position = this.game.getComponent(entityId, ComponentTypes.POSITION);

                    if (aiState && position && targetPosition) {
                        const currentAIController = this.game.gameManager.call('getCurrentAIControllerId', entityId);

                        if (!currentAIController || currentAIController === "UnitOrderSystem") {
                            const dx = position.x - targetPosition.x;
                            const dz = position.z - targetPosition.z;
                            const distSq = dx * dx + dz * dz;
                            const threshold = this.game.getCollections().configs.game.gridSize * 0.5;

                            if (distSq <= threshold * threshold) {
                                this.game.gameManager.call('removeCurrentAIController', entityId);
                                placement.targetPosition = null;
                            } else {
                                let currentOrderAI = this.game.gameManager.call('getAIControllerData', entityId, "UnitOrderSystem");
                                currentOrderAI.targetPosition = targetPosition;
                                currentOrderAI.path = [];
                                currentOrderAI.meta = placement.meta || {};
                                this.game.gameManager.call('setCurrentAIController', entityId, "UnitOrderSystem", currentOrderAI);
                            }
                        }
                    }
                });
            });
        }
    }

    // ==================== Battle Lifecycle ====================

    onBattleEnd() {
        this.removeDeadSquadsAfterRound();

        if (this.game.desyncDebugger) {
            this.game.desyncDebugger.displaySync(true);
            this.game.desyncDebugger.enabled = false;
        }
    }

    removeDeadSquadsAfterRound() {
        if (!this.game.componentManager) return;

        const ComponentTypes = this.game.componentManager.getComponentTypes();

        this.playerPlacements.forEach((placements, playerId) => {
            const survivingPlacements = placements.filter(placement => {
                if (!placement.experience?.unitIds || placement.experience.unitIds.length === 0) {
                    this.cleanupDeadSquad(placement);
                    return false;
                }

                const aliveUnits = placement.experience.unitIds.filter(entityId => {
                    const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
                    const deathState = this.game.getComponent(entityId, ComponentTypes.DEATH_STATE);
                    const buildingState = this.game.getComponent(entityId, ComponentTypes.BUILDING_STATE);

                    if (buildingState) return true;
                    return health && health.current > 0 && (!deathState || !deathState.isDying);
                });

                if (aliveUnits.length === 0) {
                    this.cleanupDeadSquad(placement);
                    return false;
                }

                placement.experience.unitIds = aliveUnits;
                return true;
            });

            this.playerPlacements.set(playerId, survivingPlacements);
        });

        // Update side arrays
        this.updateSideArrays();
    }

    cleanupDeadSquad(placement) {
        if (placement.placementId) {
            this.game.gameManager.call('releaseGridCells', placement.placementId);
            this.game.gameManager.call('removeSquad', placement.placementId);
        }
    }

    updateSideArrays() {
        // Update left and right placement arrays from player placements
        for (const [playerId, placements] of this.playerPlacements) {
            if (placements.length > 0) {
                const side = placements[0].team;
                if (side === 'left') {
                    this.leftPlacements = placements;
                } else if (side === 'right') {
                    this.rightPlacements = placements;
                }
            }
        }
    }

    // ==================== Cleanup ====================

    clearAllPlacements() {
        this.playerPlacements.forEach((placements, playerId) => {
            this.clearPlayerPlacements(playerId);
        });

        this.playerPlacements = new Map();
        this.leftPlacements = [];
        this.rightPlacements = [];
        this.placementReadyStates = new Map();
    }

    clearPlayerPlacements(playerId) {
        try {
            const placements = this.playerPlacements.get(playerId) || [];

            placements.forEach(placement => {
                if (placement.squadUnits) {
                    placement.squadUnits.forEach(entityId => {
                        try {
                            if (this.game.destroyEntity) {
                                this.game.destroyEntity(entityId);
                            }
                        } catch (error) {
                            console.warn(`Error destroying entity ${entityId}:`, error);
                        }
                    });
                }

                if (placement.placementId) {
                    this.game.gameManager.call('releaseGridCells', placement.placementId);
                }
            });

            this.playerPlacements.delete(playerId);

            console.log(`Cleared placements for player ${playerId}`);
        } catch (error) {
            console.error(`Error clearing placements for player ${playerId}:`, error);
        }
    }

    update() {
        // Delegate to controllers if they exist
        if (this.serverController && this.serverController.update) {
            this.serverController.update();
        }
        if (this.clientUI && this.clientUI.update) {
            this.clientUI.update();
        }
    }

    dispose() {
        if (this.serverController && this.serverController.dispose) {
            this.serverController.dispose();
        }
        if (this.clientUI && this.clientUI.dispose) {
            this.clientUI.dispose();
        }

        this.clearAllPlacements();
    }
}
