/**
 * ConstructBuildingBehaviorAction - Performs construction over time
 *
 * Reads from shared state:
 * - shared.targetBuilding - Building entity ID
 * - shared.buildTime - Construction time required
 *
 * Returns RUNNING while constructing, SUCCESS when complete
 * Handles completion logic (restore model, health, register with systems)
 */
class ConstructBuildingBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'spawnPendingBuilding',
        'getBillboardAnimationState',
        'removeInstance',
        'getUnitTypeDef',
        'getSquadData',
        'getSquadCells',
        'findBuildingAdjacentPosition',
        'placementGridToWorld',
        'getTerrainHeight'
    ];

    execute(entityId, game) {
        const shared = this.getShared(entityId, game);
        const memory = this.getMemory(entityId);

        let buildingId = shared.targetBuilding;

        // Check for pending building that needs to be spawned
        const buildingState = game.getComponent(entityId, 'buildingState');
        if (buildingState?.pendingUnitTypeId != null && (buildingId === undefined || buildingId === null || buildingId < 0)) {
            // Spawn the pending building now that we've arrived
            buildingId = this.call.spawnPendingBuilding( entityId);
            if (buildingId != null) {
                shared.targetBuilding = buildingId;
                shared.buildTime = buildingState.buildTime;
            } else {
                return this.failure();
            }
        }

        // targetBuilding is null/undefined when not set, or could be 0 (valid entity ID)
        if (buildingId === undefined || buildingId === null || buildingId < 0) {
            return this.failure();
        }

        const buildingPlacement = game.getComponent(buildingId, 'placement');
        if (!buildingPlacement || !buildingPlacement.isUnderConstruction) {
            // Building no longer under construction
            return this.failure();
        }

        // Stop builder movement and face the building
        this.stopBuilderMovement(entityId, buildingId, game);

        // Initialize construction start time
        if (!memory.constructionStartTime) {
            memory.constructionStartTime = game.state.round;
        }

        // Play building animation
        this.playBuildAnimation(entityId, game);

        // Check progress
        const elapsed = game.state.round - memory.constructionStartTime;
        const buildTime = shared.buildTime || this.parameters.defaultBuildTime || 5;

        if (elapsed >= buildTime) {
            // Complete construction
            this.completeConstruction(entityId, buildingId, buildingPlacement, game);

            // Clear shared state
            shared.targetBuilding = null;
            shared.targetPosition = null;
            shared.buildTime = null;

            // Clear memory for next construction
            memory.constructionStartTime = null;

            // Clear buildingState so peasant can return to other behaviors (mining)
            this.clearBuildingState(entityId, game);

            // Disable playerOrder so unit returns to normal behaviors (like mining)
            // This allows AbilitiesBehaviorTree to take over since PlayerOrderBehaviorTree
            // returns null when playerOrder.enabled is false
            const playerOrder = game.getComponent(entityId, 'playerOrder');
            if (playerOrder) {
                playerOrder.enabled = false;
                playerOrder.targetPositionX = 0;
                playerOrder.targetPositionY = 0;
                playerOrder.targetPositionZ = 0;
                playerOrder.isMoveOrder = false;
                playerOrder.preventEnemiesInRangeCheck = false;
                playerOrder.completed = false;
                playerOrder.issuedTime = 0;
            }

            // Clean up after build complete
            this.onBuildComplete(entityId, game);

            return this.success();
        }

        // Still building
        return this.running({ progress: elapsed / buildTime });
    }

    stopBuilderMovement(entityId, buildingId, game) {
        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const buildingTransform = game.getComponent(buildingId, 'transform');
        const buildingPos = buildingTransform?.position;
        const vel = game.getComponent(entityId, 'velocity');

        // Stop movement
        if (vel) {
            vel.vx = 0;
            vel.vz = 0;
        }

        // Face the building
        if (pos && buildingPos && transform) {
            const dx = buildingPos.x - pos.x;
            const dz = buildingPos.z - pos.z;
            if (!transform.rotation) transform.rotation = { x: 0, y: 0, z: 0 };
            transform.rotation.y = Math.atan2(dz, dx);
        }
    }

    onBuildComplete(entityId, game) {
        // Clear attack animation - let normal behavior systems take over
        const animState = this.call.getBillboardAnimationState( entityId);
        if (animState && animState.spriteAnimationType === 'attack') {
            animState.spriteAnimationType = null;
        }
    }

    playBuildAnimation(entityId, game) {
        if (!game.animationSystem) return;

        const animState = game.getComponent(entityId, "animationState");
        if (animState) {
            const finished = game.animationSystem.isAnimationFinished(entityId, animState.currentClip);
            if (finished || animState.currentClip !== 'attack') {
                game.abilitySystem?.startAbilityAnimation(entityId, { castTime: 1 });
            }
        }
    }

    completeConstruction(entityId, buildingId, buildingPlacement, game) {
        // Get unitType from the entity's unitType component (not from placement)
        const unitTypeComponent = game.getComponent(buildingId, 'unitType');
        if (!buildingPlacement || !unitTypeComponent) {
            console.error('[ConstructBuildingBehaviorAction] Cannot complete construction - missing placement or unitType', buildingId);
            return;
        }

        // 1. Update renderable - change from underConstruction to actual building
        // unitTypeComponent.type is the numeric spawnType index
        const renderComponent = game.getComponent(buildingId, 'renderable');
        if (renderComponent) {
            renderComponent.spawnType = unitTypeComponent.type;
            if (game.hasService('removeInstance')) {
                this.call.removeInstance( buildingId);
            }
        }

        // 2. Restore health to full - get unit def from collections using numeric indices
        const unitTypeDef = this.call.getUnitTypeDef( unitTypeComponent);
        const maxHP = unitTypeDef?.hp || 100;
        const health = game.getComponent(buildingId, 'health');
        if (health) {
            health.max = maxHP;
            health.current = maxHP;
        }

        // 3. unitType component already has correct data (actualBuildingType is unitTypeComponent)

        // 4. Mark construction complete
        buildingPlacement.isUnderConstruction = false;
        buildingPlacement.assignedBuilder = null;

        // 5. Change building to idle animation
        if (game.animationSystem) {
            const enums = game.getEnums();
            game.animationSystem.changeAnimation(buildingId, enums.animationType.idle, 1.0, 0);
        }

        // 6. Move peasant outside the building footprint
        this.movePeasantOutsideBuilding(entityId, buildingId, buildingPlacement, game);
    }

    /**
     * Move the peasant to a position outside the building footprint
     */
    movePeasantOutsideBuilding(entityId, buildingId, buildingPlacement, game) {
        const buildingGridPos = buildingPlacement.gridPosition;
        if (!buildingGridPos) return;

        // Get the peasant's unit type for finding adjacent position
        const peasantUnitTypeComp = game.getComponent(entityId, 'unitType');
        if (!peasantUnitTypeComp) return;

        const peasantUnitType = this.call.getUnitTypeDef( peasantUnitTypeComp);
        if (!peasantUnitType) return;

        // Get building cells to avoid
        const buildingUnitType = this.call.getUnitTypeDef( {
            collection: buildingPlacement.collection,
            type: buildingPlacement.unitTypeId
        });
        const buildingSquadData = buildingUnitType ? this.call.getSquadData( buildingUnitType) : null;
        const buildingCells = buildingSquadData ? this.call.getSquadCells( buildingGridPos, buildingSquadData) : [];
        const buildingCellSet = new Set(buildingCells.map(cell => `${cell.x},${cell.z}`));

        // Find an adjacent position outside the building
        const adjacentPos = this.call.findBuildingAdjacentPosition( buildingGridPos, buildingCellSet, peasantUnitType, null);
        if (!adjacentPos) return;

        // Convert grid position to world position
        const worldPos = this.call.placementGridToWorld( adjacentPos.x, adjacentPos.z);
        if (!worldPos) return;

        // Teleport the peasant to the new position
        const transform = game.getComponent(entityId, 'transform');
        if (transform?.position) {
            const terrainHeight = this.call.getTerrainHeight( worldPos.x, worldPos.z) || 0;
            transform.position.x = worldPos.x;
            transform.position.y = terrainHeight;
            transform.position.z = worldPos.z;
        }
    }

    onBattleEnd(entityId, game){
        const shared = this.getShared(entityId, game);
        const memory = this.getMemory(entityId);
        const buildingId = shared.targetBuilding;
        // targetBuilding is null/undefined when not set, or could be 0 (valid entity ID)
        if (buildingId === undefined || buildingId === null || buildingId < 0) {
            return;
        }
        const elapsed = game.state.round - memory.constructionStartTime + 1;
        const buildTime = shared.buildTime || this.parameters.defaultBuildTime;

        if (elapsed >= buildTime) {
            const buildingPlacement = game.getComponent(buildingId, 'placement');
            if (!buildingPlacement || !buildingPlacement.isUnderConstruction ||  buildingPlacement.assignedBuilder != entityId) {
                return;
            }
            this.completeConstruction(entityId, buildingId, buildingPlacement, game);

            shared.targetBuilding = null;
            shared.targetPosition = null;
            shared.buildTime = null;

            // Clear memory for next construction
            memory.constructionStartTime = null;

            // Clear buildingState so peasant can return to other behaviors (mining)
            this.clearBuildingState(entityId, game);

            // Disable playerOrder so unit returns to normal behaviors (like mining)
            const playerOrder = game.getComponent(entityId, 'playerOrder');
            if (playerOrder) {
                playerOrder.enabled = false;
                playerOrder.targetPositionX = 0;
                playerOrder.targetPositionY = 0;
                playerOrder.targetPositionZ = 0;
                playerOrder.isMoveOrder = false;
                playerOrder.preventEnemiesInRangeCheck = false;
                playerOrder.completed = false;
                playerOrder.issuedTime = 0;
            }

            this.onBuildComplete(entityId, game);
        }

    }

    clearBuildingState(entityId, game) {
        const buildingState = game.getComponent(entityId, 'buildingState');
        if (buildingState) {
            buildingState.targetBuildingEntityId = -1;
            buildingState.buildTime = 0;
            buildingState.constructionStartTime = 0;
            buildingState.pendingGridPosition.x = 0;
            buildingState.pendingGridPosition.z = 0;
            buildingState.pendingUnitTypeId = null;
            buildingState.pendingCollection = null;
        }
    }

    onEnd(entityId, game) {
        // Clean up animation if action is interrupted
        this.onBuildComplete(entityId, game);

        // Clean up assigned builder reference
        const shared = this.getShared(entityId, game);
        // targetBuilding is null/undefined when not set, or could be 0 (valid entity ID)
        if (shared.targetBuilding !== undefined && shared.targetBuilding !== null && shared.targetBuilding >= 0) {
            const buildingPlacement = game.getComponent(shared.targetBuilding, 'placement');
            if (buildingPlacement && buildingPlacement.assignedBuilder === entityId) {
                buildingPlacement.assignedBuilder = null;
            }
        }

        // Clear memory for next construction
        const memory = this.getMemory(entityId);
        memory.constructionStartTime = null;

        super.onEnd(entityId, game);
    }
}