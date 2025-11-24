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

        const buildState = game.getComponent(entityId, 'buildingState');
        if (!buildState || !buildState.targetBuildingEntityId) return null;

        // Building behavior
        return {
            action: "BuildBehaviorAction",
            target: buildState.targetBuildingEntityId,
            priority: 15,
            data: {}
        };
    }

    canExecute(entityId) {
        if(!this.enabled){
            return false;
        }
        let buildingState = this.game.getComponent(entityId, "buildingState");

        // With behavior tree system, just check if buildingState exists
        return buildingState !== undefined;
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

        // Set up building placement state
        if (buildingPlacement) {
            buildingPlacement.isUnderConstruction = true;
            buildingPlacement.buildTime = buildTime;
            buildingPlacement.assignedBuilder = peasantEntityId;
        }

        // Add buildingState component to peasant - behavior tree will handle the rest
        this.peasantId = peasantEntityId;
        this.game.addComponent(peasantEntityId, "buildingState", {
            targetBuildingEntityId: buildingEntityId,
            targetBuildingPosition: buildingPos,
            isPlayerOrder: peasantInfo.isPlayerOrder
        });

        // Add buildingState to building entity
        this.game.addComponent(buildingEntityId, "buildingState", {
            targetBuildingEntityId: buildingEntityId,
            targetBuildingPosition: buildingPos,
            constructionStartTime: null
        });
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
            const aiState = this.game.getComponent(buildState.entityId, "aiState");
            if (aiState) {
                aiState.targetPosition = null;
            }

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
            // Still need to move - update aiState if target changed
            const aiState = this.game.getComponent(buildState.entityId, "aiState");
            if (aiState && aiState.targetPosition != buildState.targetBuildingPosition) {
                aiState.targetPosition = buildState.targetBuildingPosition;
                aiState.meta = this.meta;
            }
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

        // Clear aiState to stop movement
        if (aiState) {
            aiState.targetPosition = null;
            aiState.meta = {};
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