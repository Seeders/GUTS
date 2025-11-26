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

    // Behavior contribution for UniversalBehaviorTree
    getBehavior(entityId, game) {
        if (!this.enabled) return null;

        // Read from playerOrder component (like move orders)
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (!playerOrder || !playerOrder.meta || !playerOrder.meta.buildingId) return null;

        // Check if building is still under construction
        const buildingId = playerOrder.meta.buildingId;
        const buildingPlacement = game.getComponent(buildingId, 'placement');
        if (!buildingPlacement || !buildingPlacement.isUnderConstruction) {
            // Building is complete or doesn't exist - clear playerOrder and return null
            playerOrder.meta = {};
            playerOrder.targetPosition = null;
            return null;
        }

        // Building behavior
        return {
            action: "BuildBehaviorAction",
            target: buildingId,
            priority: 15,
            data: {}
        };
    }

    canExecute(entityId) {
        if(!this.enabled){
            return false;
        }

        // With behavior tree system, check if playerOrder has buildingId
        const playerOrder = this.game.getComponent(entityId, "playerOrder");
        return playerOrder && playerOrder.meta && playerOrder.meta.buildingId !== undefined;
    }

    execute(entityId, targetData) {
        // Behavior tree system handles building through BuildBehaviorAction
        // This execute() method is no longer used - kept for compatibility with AbilitySystem
        return null;
    }

    updateBuilderState(entityId, buildState, pos, vel) {
        buildState.entityId = entityId;
        
        switch (buildState.state) {
            case 'idle':
                break;
            case 'walking_to_construction':
                this.walkToConstruction(buildState, pos, vel);
                break;
            case 'constructing':
                this.constructBuilding(buildState);
                break;
        }
    }

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

        // Remove health component while under construction
        this.game.removeComponent(buildingEntityId, "health");

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
                buildingPosition: buildingPos,
                isPlayerOrder: true
            };
            playerOrder.targetPosition = buildingPos;
            playerOrder.issuedTime = this.game.state.now;
        }
    }

    walkToConstruction(buildState, pos, vel) {

        if (!buildState.targetBuildingPosition || !buildState.targetBuildingEntityId) {
            buildState.state = 'idle';
            return;
        }

        const buildingPosition = this.game.getComponent(buildState.targetBuildingEntityId, "position");
        const buildingBuildState = this.game.getComponent(buildState.targetBuildingEntityId, "buildingState");
        
        if (!buildingPosition) {
            buildState.targetBuildingEntityId = null;
            buildState.targetBuildingPosition = null;
            buildState.state = 'idle';
            return;
        }

        const dx = buildState.targetBuildingPosition.x - pos.x;
        const dz = buildState.targetBuildingPosition.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < this.buildRange) {
            // Reached building - clear movement target
            // Building reached - velocity targets cleared by behavior action

            pos.x = buildState.targetBuildingPosition.x + this.buildRange;
            pos.z = buildState.targetBuildingPosition.z;
            vel.vx = 0;
            vel.vz = 0;

            // Make the peasant face the building
            const facing = this.game.getComponent(buildState.entityId, "facing");
            if (facing) {
                const dx = buildState.targetBuildingPosition.x - pos.x;
                const dz = buildState.targetBuildingPosition.z - pos.z;
                const angleToBuilding = Math.atan2(dz, dx);
                facing.angle = angleToBuilding;
            }

            buildState.state = 'constructing';
            buildState.constructionStartTime = this.game.state.round;
            buildingBuildState.state = 'under_construction';
            buildingBuildState.constructionStartTime = this.game.state.round;
        } else {
            // Still need to move - velocity targets handled by behavior action
        }
    }

    constructBuilding(buildState) {

        const buildingPlacement = this.game.getComponent(buildState.targetBuildingEntityId, "placement");
        const unitType = this.game.getComponent(buildState.targetBuildingEntityId, "unitType");
        this.game.addComponent(buildState.targetBuildingEntityId, "health", {
            max: unitType.hp,
            current: unitType.hp
        });
        

        const elapsed = this.game.state.round - buildState.constructionStartTime;
        const buildTime = buildingPlacement.buildTime || 1;
        if (this.game.animationSystem) {
            const animState = this.game.animationSystem.entityAnimationStates.get(buildState.entityId);
            if(animState){
                const finished = this.game.animationSystem.isAnimationFinished(buildState.entityId, animState.currentClip);
                if(finished || animState.currentClip != 'attack'){
                    this.game.abilitySystem.startAbilityAnimation(buildState.entityId, { castTime: 1 });
                }
            }
        }

        if (elapsed >= buildTime) {            
            this.completeConstruction(buildState);
        }
    }

    completeConstruction(buildState) {
        const buildingPlacement = this.game.getComponent(buildState.targetBuildingEntityId, "placement");
        const aiState = this.game.getComponent(this.peasantId, "aiState");
        const renderComponent = this.game.getComponent(buildState.targetBuildingEntityId, "renderable");
        renderComponent.spawnType = buildingPlacement.unitType.id;
        this.game.gameManager.call('removeInstance', buildState.targetBuildingEntityId);
        if (!buildingPlacement) {
            buildState.state = 'idle';
            return;
        }
        if(this.game.shopSystem){
            this.game.shopSystem.addBuilding(buildingPlacement.unitType.id, buildingPlacement.squadUnits[0]);
        }

        buildingPlacement.isUnderConstruction = false;
        buildingPlacement.assignedBuilder = null;

        if (this.game.animationSystem) {
            this.game.animationSystem.changeAnimation(buildState.targetBuildingEntityId, 'idle', 1.0, 0);
        }

        buildState.targetBuildingEntityId = null;
        buildState.targetBuildingPosition = null;
        buildState.state = 'idle';

        // Clear aiState meta
        if (aiState) {
            aiState.meta = {};
        }

        // Stop movement
        const buildingVel = this.game.getComponent(buildingId, "velocity");
        if (buildingVel) {
            buildingVel.vx = 0;
            buildingVel.vz = 0;
        }

        this.game.removeComponent(this.peasantId, "buildingState");
    }
    
    onPlacementPhaseStart(entityId) {
        if(this.canExecute(entityId)){
            this.execute(entityId);
        }
    }
    
    logAbilityUsage(entityId) {
    }
}