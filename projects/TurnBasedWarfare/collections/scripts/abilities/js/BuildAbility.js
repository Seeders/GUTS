class BuildAbility extends GUTS.BaseAbility {
    constructor(game, abilityData) {
        super(game, abilityData);
        this.id = 'build';
        this.name = 'Build';
        this.description = 'Construct buildings';
        this.isPassive = true;
        this.autocast = false;
        this.castTime = 0;
        this.cooldown = 0;
        this.priority = 0;
        this.enabled = true;
        this.meta = { preventEnemiesInRangeCheck: true };
        this.buildRange = 50;
    }

    // Setup method called by placement systems to assign a builder to a building
    // This just sets up playerOrder - actual building logic is in BuildBehaviorAction
    // issuedTime should be provided by server for sync - falls back to local time if not provided
    assignToBuild(peasantEntityId, buildingEntityId, peasantInfo, issuedTime) {
        const transform = this.game.getComponent(buildingEntityId, "transform");
        const buildingPos = transform?.position;
        if (!buildingPos) return;

        const buildingPlacement = this.game.getComponent(buildingEntityId, "placement");
        const buildTime = peasantInfo.buildTime;

        // Use provided issuedTime or fall back to current time
        const orderIssuedTime = issuedTime ?? this.game.state.now;

        // Set up building visual state - show as under construction immediately
        const renderComponent = this.game.getComponent(buildingEntityId, "renderable");
        if (renderComponent) {
            const enums = this.game.call('getEnums');
            renderComponent.spawnType = enums.buildings.underConstruction;
        }

        // Set up building placement state
        if (buildingPlacement) {
            buildingPlacement.isUnderConstruction = true;
            buildingPlacement.buildTime = buildTime;
            buildingPlacement.assignedBuilder = peasantEntityId;
        }

        // If peasant already has a build order, clean up the old building first
        const existingBuildingState = this.game.getComponent(peasantEntityId, "buildingState");
        if (existingBuildingState && existingBuildingState.targetBuildingEntityId != null) {
            const oldBuildingId = existingBuildingState.targetBuildingEntityId;
            const oldBuildingPlacement = this.game.getComponent(oldBuildingId, "placement");

            // Cancel old building if it was under construction and assigned to this peasant
            if (oldBuildingPlacement &&
                oldBuildingPlacement.isUnderConstruction &&
                oldBuildingPlacement.assignedBuilder === peasantEntityId) {
                // Use network manager to cancel with proper refund
                if (this.game.clientNetworkSystem && this.game.clientNetworkSystem.cancelBuilding) {
                    this.game.clientNetworkSystem.cancelBuilding({
                        placementId: oldBuildingPlacement.placementId,
                        buildingEntityId: oldBuildingId
                    }, (success) => {
                        if (!success) {
                            console.warn('Failed to cancel old building during reassignment');
                        }
                    });
                } else {
                    // Fallback: destroy directly (no refund in this case)
                    this.game.destroyEntity(oldBuildingId);
                }
            }
        }

        // Set buildingState for the peasant - add if missing, otherwise update
        let buildingState = this.game.getComponent(peasantEntityId, "buildingState");
        if (!buildingState) {
            this.game.addComponent(peasantEntityId, "buildingState", {
                targetBuildingEntityId: buildingEntityId,
                buildTime: buildTime,
                constructionStartTime: 0
            });
        } else {
            buildingState.targetBuildingEntityId = buildingEntityId;
            buildingState.buildTime = buildTime;
            buildingState.constructionStartTime = 0;
        }

        // Set playerOrder for movement to the building site - add if missing, otherwise update
        let playerOrder = this.game.getComponent(peasantEntityId, "playerOrder");
        if (!playerOrder) {
            this.game.addComponent(peasantEntityId, "playerOrder", {
                targetPositionX: buildingPos.x || 0,
                targetPositionY: buildingPos.y || 0,
                targetPositionZ: buildingPos.z || 0,
                isMoveOrder: 0,
                preventEnemiesInRangeCheck: 1,  // Builder should not be interrupted by combat
                completed: 0,
                issuedTime: orderIssuedTime
            });
        } else {
            playerOrder.targetPositionX = buildingPos.x || 0;
            playerOrder.targetPositionY = buildingPos.y || 0;
            playerOrder.targetPositionZ = buildingPos.z || 0;
            playerOrder.isMoveOrder = 0;
            playerOrder.preventEnemiesInRangeCheck = 1;
            playerOrder.completed = 0;
            playerOrder.issuedTime = orderIssuedTime;
        }
        this.game.triggerEvent('onIssuedPlayerOrders', peasantEntityId);

        const aiState = this.game.getComponent(peasantEntityId, "aiState");

        if(aiState){
            aiState.currentAction = -1;
            aiState.currentActionCollection = -1;
            // Clear behavior state via BehaviorSystem
            this.game.call('clearBehaviorState', peasantEntityId);
        }
    }

}
