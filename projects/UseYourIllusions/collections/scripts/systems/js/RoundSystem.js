class RoundSystem extends GUTS.BaseSystem {

    static serviceDependencies = [
        'removeInstance',
        'getUnitTypeDef'
    ];

    constructor(game){
        super(game);
        this.game.roundSystem = this;
    }
    //cant place this in UnitOrderSystem because UnitOrderSystem doesn't run on the server.
    onPlacementPhaseStart() {
        // Complete any building upgrades that have finished their buildTime
        this.completeUpgrades();

        // Only clear completed player orders at the start of placement phase
        // Orders that weren't completed (unit didn't reach target) should persist
        // so the unit continues following the order in the next battle
        const entities = this.game.getEntitiesWith('playerOrder');
        entities.forEach((entityId) => {
            const playerOrder = this.game.getComponent(entityId, 'playerOrder');
            if (playerOrder && playerOrder.completed) {
                // Disable the completed order and reset to defaults
                playerOrder.enabled = false;
                playerOrder.targetPositionX = 0;
                playerOrder.targetPositionY = 0;
                playerOrder.targetPositionZ = 0;
                playerOrder.isMoveOrder = false;
                playerOrder.preventEnemiesInRangeCheck = false;
                playerOrder.completed = false;
                playerOrder.issuedTime = 0;
            }
        });
    }

    /**
     * Complete building upgrades that have finished their buildTime.
     * Upgrades don't use a peasant builder - they auto-complete after buildTime rounds.
     */
    completeUpgrades() {
        const buildings = this.game.getEntitiesWith('placement');
        const currentRound = this.game.state.round;

        buildings.forEach((buildingId) => {
            const placement = this.game.getComponent(buildingId, 'placement');

            // Check if this is an upgrade in progress (has upgradeStartRound, no assigned builder)
            if (placement &&
                placement.isUnderConstruction &&
                placement.upgradeStartRound != null &&
                placement.assignedBuilder === -1) {

                const elapsed = currentRound - placement.upgradeStartRound;
                const buildTime = placement.buildTime || 1;

                if (elapsed >= buildTime) {
                    this.completeUpgradeConstruction(buildingId, placement);
                }
            }
        });
    }

    /**
     * Complete upgrade construction for a building (similar to ConstructBuildingBehaviorAction.completeConstruction)
     */
    completeUpgradeConstruction(buildingId, placement) {
        const unitTypeComponent = this.game.getComponent(buildingId, 'unitType');
        if (!unitTypeComponent) return;

        // 1. Update renderable - change from underConstruction to actual building (client only)
        const renderComponent = this.game.getComponent(buildingId, 'renderable');
        if (renderComponent) {
            renderComponent.spawnType = unitTypeComponent.type;
            if (this.game.hasService('removeInstance')) {
                this.call.removeInstance( buildingId);
            }
        }

        // 2. Restore health to full
        const unitTypeDef = this.call.getUnitTypeDef( unitTypeComponent);
        const maxHP = unitTypeDef?.hp || 100;
        const health = this.game.getComponent(buildingId, 'health');
        if (health) {
            health.max = maxHP;
            health.current = maxHP;
        }

        // 3. Mark construction complete
        placement.isUnderConstruction = false;
        placement.upgradeStartRound = null;

        // 4. Change building to idle animation
        if (this.game.animationSystem) {
            const enums = this.game.getEnums();
            this.game.animationSystem.changeAnimation(buildingId, enums.animationType.idle, 1.0, 0);
        }
    }
}
