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
    assignToBuild(peasantEntityId, buildingEntityId, peasantInfo) {
        const transform = this.game.getComponent(buildingEntityId, "transform");
        const buildingPos = transform?.position;
        if (!buildingPos) return;

        const buildingPlacement = this.game.getComponent(buildingEntityId, "placement");
        const buildTime = peasantInfo.buildTime;

        // Set up building visual state - show as under construction immediately
        const renderComponent = this.game.getComponent(buildingEntityId, "renderable");
        if (renderComponent) {
            renderComponent.spawnType = 'underConstruction';
        }

        // Set up building placement state
        if (buildingPlacement) {
            buildingPlacement.isUnderConstruction = true;
            buildingPlacement.buildTime = buildTime;
            buildingPlacement.assignedBuilder = peasantEntityId;
        }

        // Set playerOrder for building - behavior tree will handle the rest via BuildBehaviorAction
        // If peasant already has a build order, clean up the old building first
        const existingPlayerOrder = this.game.getComponent(peasantEntityId, "playerOrder");
        if (existingPlayerOrder && existingPlayerOrder.meta && existingPlayerOrder.meta.buildingId) {
            const oldBuildingId = existingPlayerOrder.meta.buildingId;
            const oldBuildingPlacement = this.game.getComponent(oldBuildingId, "placement");

            // Cancel old building if it was under construction and assigned to this peasant
            if (oldBuildingPlacement &&
                oldBuildingPlacement.isUnderConstruction &&
                oldBuildingPlacement.assignedBuilder === peasantEntityId) {
                // Use network manager to cancel with proper refund
                if (this.game.multiplayerNetworkSystem && this.game.multiplayerNetworkSystem.cancelBuilding) {
                    this.game.multiplayerNetworkSystem.cancelBuilding({
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

        // Remove existing player order if present, then add new one
        if (this.game.hasComponent(peasantEntityId, "playerOrder")) {
            this.game.removeComponent(peasantEntityId, "playerOrder");
        }
        this.game.addComponent(peasantEntityId, "playerOrder", {
            targetPosition: buildingPos,
            meta: {
                buildingId: buildingEntityId,
                buildingPosition: buildingPos,
                preventCombat: true  // Builder should not be interrupted by combat
            },
            issuedTime: this.game.state.now
        });
        this.game.triggerEvent('onIssuedPlayerOrders', peasantEntityId);

        const aiState = this.game.getComponent(peasantEntityId, "aiState");
        
        if(aiState){
            aiState.currentAction = "";
            aiState.meta = {};
            aiState.shared = {};
        console.log('cleared aiState', peasantEntityId, aiState);
        }
    }

}