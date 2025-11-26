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
        const buildingPos = this.game.getComponent(buildingEntityId, "position");
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
        const playerOrder = this.game.getComponent(peasantEntityId, "playerOrder");
        if (playerOrder) {
            playerOrder.meta = {
                buildingId: buildingEntityId,
                buildingPosition: buildingPos
            };
            playerOrder.targetPosition = buildingPos;
            playerOrder.issuedTime = this.game.state.now;
        }
    }

}