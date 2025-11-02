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
        this.buildRange = 50;
    }

    canExecute(entityId) {
        if(!this.enabled){
            return false;
        }
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        let buildingState = this.game.getComponent(entityId, ComponentTypes.BUILDING_STATE);
        let aiState = this.game.getComponent(entityId, ComponentTypes.AI_STATE);
        
        if (!buildingState) {
            return false;
        }

        
        return (aiState.currentAIController == ComponentTypes.BUILDING_STATE);
    }
    execute(entityId, targetData) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const buildState = this.game.getComponent(entityId, ComponentTypes.BUILDING_STATE);
        const pos = this.game.getComponent(entityId, ComponentTypes.POSITION);
        const vel = this.game.getComponent(entityId, ComponentTypes.VELOCITY);
        const health = this.game.getComponent(entityId, ComponentTypes.HEALTH);
        
        if (!buildState || !pos || !vel || !health || health.current <= 0) {
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

    assignToBuild(peasantEntityId, buildingEntityId) {
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        const aiState = this.game.getComponent(peasantEntityId, ComponentTypes.AI_STATE);
        const buildingPos = this.game.getComponent(buildingEntityId, ComponentTypes.POSITION);
        const buildingPlacement = this.game.getComponent(buildingEntityId, ComponentTypes.PLACEMENT);
        
        if (!buildingPos) return;
        
        this.peasantId = peasantEntityId;
        this.game.addComponent(peasantEntityId, ComponentTypes.BUILDING_STATE, Components.BuildingState('walking_to_construction', buildingEntityId, buildingPos, this.game.state.round));
        
        if (aiState) {
            aiState.targetPosition = buildingPos;
            aiState.currentAIController = ComponentTypes.BUILDING_STATE;
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
        const buildingHealth = this.game.getComponent(buildState.targetBuildingEntityId, ComponentTypes.HEALTH);
        
        if (!buildingHealth) {
            buildState.targetBuildingEntityId = null;
            buildState.targetBuildingPosition = null;
            buildState.state = 'idle';
            return;
        }

        const dx = buildState.targetBuildingPosition.x - pos.x;
        const dz = buildState.targetBuildingPosition.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < this.buildRange) {
            const aiState = this.game.getComponent(buildState.entityId, ComponentTypes.AI_STATE);
            
            if (aiState) {
                aiState.state = 'idle';
                aiState.targetPosition = null;
            }
            
            pos.x = buildState.targetBuildingPosition.x + this.buildRange;
            pos.z = buildState.targetBuildingPosition.z;
            vel.vx = 0;
            vel.vz = 0;
            buildState.state = 'constructing';
            buildState.constructionStartTime = this.game.state.round;
        } else {
            const aiState = this.game.getComponent(buildState.entityId, ComponentTypes.AI_STATE);
            if (aiState) {
                aiState.state = 'chasing';
                aiState.targetPosition = buildState.targetBuildingPosition;
            }
        }
    }

    constructBuilding(buildState) {

        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const buildingPlacement = this.game.getComponent(buildState.targetBuildingEntityId, ComponentTypes.PLACEMENT);
        const buildingHealth = this.game.getComponent(buildState.targetBuildingEntityId, ComponentTypes.HEALTH);
        
        if (!buildingPlacement || !buildingHealth) {
            buildState.state = 'idle';
            return;
        }

        const elapsed = this.game.state.round - buildState.constructionStartTime;
        const buildTime = buildingPlacement.buildTime || 1;
        if (this.game.animationSystem) {
            const animState = this.game.animationSystem.entityAnimationStates.get(buildState.entityId);
            const finished = this.game.animationSystem.isAnimationFinished(buildState.entityId, animState.currentClip);
            if(finished || animState.currentClip != 'attack'){
                this.game.abilitySystem.startAbilityAnimation(buildState.entityId, { castTime: 1 });
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
        this.game.renderSystem?.removeInstance(buildState.targetBuildingEntityId);
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
        aiState.currentAIController = null;
        
        this.game.removeComponent(this.peasantId, ComponentTypes.BUILDING_STATE);
    }
    
    onBattleEnd(entityId) {
        if(this.canExecute(entityId)){
            this.execute(entityId);
        }
    }
    
    logAbilityUsage(entityId) {
    }
}