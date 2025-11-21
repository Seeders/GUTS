class BuildAbility extends engine.app.appClasses['BaseAbility'] {
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

    canExecute(entityId) {
        if(!this.enabled){
            return false;
        }
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        let buildingState = this.game.getComponent(entityId, ComponentTypes.BUILDING_STATE);
        
        if (!buildingState) {
            return false;
        }

        return this.game.aiSystem.getCurrentAIControllerId(entityId) == ComponentTypes.BUILDING_STATE;
    }
    execute(entityId, targetData) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const buildState = this.game.getComponent(entityId, ComponentTypes.BUILDING_STATE);
        const pos = this.game.getComponent(entityId, ComponentTypes.POSITION);
        const vel = this.game.getComponent(entityId, ComponentTypes.VELOCITY);
        
        if (!buildState || !pos || !vel) {
            return null;
        }

        this.updateBuilderState(entityId, buildState, pos, vel);
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
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        const aiState = this.game.getComponent(peasantEntityId, ComponentTypes.AI_STATE);
        const buildingPos = this.game.getComponent(buildingEntityId, ComponentTypes.POSITION);

        if (!buildingPos) return;

        const buildingPlacement = this.game.getComponent(buildingEntityId, ComponentTypes.PLACEMENT);
        const renderComponent = this.game.getComponent(buildingEntityId, ComponentTypes.RENDERABLE);
        renderComponent.spawnType = 'underConstruction';

        this.game.removeComponent(buildingEntityId, ComponentTypes.HEALTH);

        const peasantId = peasantInfo.peasantId;
        const buildTime = peasantInfo.buildTime;

        if (buildingPlacement) {
            buildingPlacement.isUnderConstruction = true;
            buildingPlacement.buildTime = buildTime;
            buildingPlacement.assignedBuilder = peasantId || null;
        }

        this.peasantId = peasantEntityId;
        this.game.addComponent(peasantEntityId, ComponentTypes.BUILDING_STATE, Components.BuildingState('walking_to_construction', buildingEntityId, buildingPos, this.game.state.round));
        this.game.addComponent(buildingEntityId, ComponentTypes.BUILDING_STATE, Components.BuildingState('planned_for_construction', buildingEntityId, buildingPos, null));

        // Use command queue system to issue build command
        // This will properly interrupt current movement and clear the path
        if (this.game.commandQueueSystem) {
            this.game.gameManager.call('queueCommand', peasantEntityId, {
                type: 'build',
                controllerId: ComponentTypes.BUILDING_STATE,
                targetPosition: buildingPos,
                target: buildingEntityId,
                meta: this.meta,
                priority: this.game.commandQueueSystem.PRIORITY.BUILD,
                interruptible: true,
                // Use client's timestamp for deterministic command creation
                createdTime: peasantInfo.commandCreatedTime
            }, true); // true = interrupt current command
        } else {
            // Fallback to old method if command queue system not available
            let currentBuildingStateAI = this.game.aiSystem.getAIControllerData(peasantEntityId, ComponentTypes.BUILDING_STATE);
            currentBuildingStateAI.targetPosition = buildingPos;
            currentBuildingStateAI.meta = this.meta;
            this.game.aiSystem.setCurrentAIController(peasantEntityId, ComponentTypes.BUILDING_STATE, currentBuildingStateAI);
        }

        if (buildingPlacement) {
            buildingPlacement.assignedBuilder = peasantEntityId;
            buildingPlacement.isUnderConstruction = true;
        }
    }

    walkToConstruction(buildState, pos, vel) {
        
        if (!buildState.targetBuildingPosition || !buildState.targetBuildingEntityId) {
            buildState.state = 'idle';
            return;
        }

        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const buildingPosition = this.game.getComponent(buildState.targetBuildingEntityId, ComponentTypes.POSITION);
        const buildingBuildState = this.game.getComponent(buildState.targetBuildingEntityId, ComponentTypes.BUILDING_STATE);
        
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
            let currentBuildingStateAI = this.game.aiSystem.getAIControllerData(buildState.entityId, ComponentTypes.BUILDING_STATE);
            currentBuildingStateAI.targetPosition = null;
            currentBuildingStateAI.state = 'idle';
            currentBuildingStateAI.meta = this.meta;
            this.game.aiSystem.setCurrentAIController(buildState.entityId, ComponentTypes.BUILDING_STATE, currentBuildingStateAI);

            pos.x = buildState.targetBuildingPosition.x + this.buildRange;
            pos.z = buildState.targetBuildingPosition.z;
            vel.vx = 0;
            vel.vz = 0;

            // Make the peasant face the building
            const facing = this.game.getComponent(buildState.entityId, ComponentTypes.FACING);
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
            let currentBuildingStateAI = this.game.aiSystem.getAIControllerData(buildState.entityId, ComponentTypes.BUILDING_STATE);
            if(currentBuildingStateAI.targetPosition != buildState.targetBuildingPosition){
                currentBuildingStateAI.targetPosition = buildState.targetBuildingPosition;  
                currentBuildingStateAI.state = 'chasing';                          
                currentBuildingStateAI.meta = this.meta;
                this.game.aiSystem.setCurrentAIController(buildState.entityId, ComponentTypes.BUILDING_STATE, currentBuildingStateAI);   
            }
        }
    }

    constructBuilding(buildState) {

        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        const buildingPlacement = this.game.getComponent(buildState.targetBuildingEntityId, ComponentTypes.PLACEMENT);
        const unitType = this.game.getComponent(buildState.targetBuildingEntityId, ComponentTypes.UNIT_TYPE);
        this.game.addComponent(buildState.targetBuildingEntityId, ComponentTypes.HEALTH, Components.Health(unitType.hp));
        

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
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const buildingPlacement = this.game.getComponent(buildState.targetBuildingEntityId, ComponentTypes.PLACEMENT);
        const aiState = this.game.getComponent(this.peasantId, ComponentTypes.AI_STATE);
        const renderComponent = this.game.getComponent(buildState.targetBuildingEntityId, ComponentTypes.RENDERABLE);
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

        // Mark command as complete in command queue system       
        this.game.gameManager.call('completeCurrentCommand', this.peasantId);
        this.game.removeComponent(this.peasantId, ComponentTypes.BUILDING_STATE);
    }
    
    onPlacementPhaseStart(entityId) {
        if(this.canExecute(entityId)){
            this.execute(entityId);
        }
    }
    
    logAbilityUsage(entityId) {
    }
}