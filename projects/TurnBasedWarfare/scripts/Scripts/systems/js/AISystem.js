class AISystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.aiSystem = this;        
        this.entityAIControllers = new Map();
    }    
    
    setAIControllerData(entityId, aiControllerId, data, overwriteControllerId = true) {
        let entityControllersMap = this.getEntityAIControllers(entityId);
        if(overwriteControllerId) {
            data.aiControllerId = aiControllerId;
        }
        entityControllersMap.set(aiControllerId, data);
    }

    hasAIControllerData(entityId, aiControllerId){
        let entityControllersMap = this.getEntityAIControllers(entityId);
        const CT = this.game.componentManager.getComponents();        
        return entityControllersMap.has(aiControllerId);
    }

    getAIControllerData(entityId, aiControllerId) {
        let entityControllersMap = this.getEntityAIControllers(entityId);
        const CT = this.game.componentManager.getComponents();        
        return entityControllersMap.get(aiControllerId) || CT.AIState('idle');
    }

    setCurrentAIController(entityId, aiControllerId, data) {        
        this.setAIControllerData(entityId, aiControllerId, data);
        this.setAIControllerData(entityId, "AISystem", data, false);

        let aiState = this.game.getComponent(entityId, this.game.componentTypes.AI_STATE);
        aiState.targetPosition = data.targetPosition;
        aiState.target = data.target;
        aiState.meta = data.meta;
        aiState.aiControllerId = aiControllerId;
    }

    getCurrentAIController(entityId) {
        return this.getAIControllerData(entityId, "AISystem");
    }

    getCurrentAIControllerId(entityId) {
        return this.getAIControllerData(entityId, "AISystem").aiControllerId;
    }

    removeAIController(entityId, aiControllerId){
        let entityControllersMap = this.getEntityAIControllers(entityId);
        entityControllersMap.delete(aiControllerId);
    }

    removeCurrentAIController(entityId){    
        const currentAiControllerId = this.getCurrentAIControllerId();
        this.removeAIController(entityId, currentAiControllerId);
        const CT = this.game.componentManager.getComponents();        
        this.setAIControllerData(entityId, "AISystem", CT.AIState('idle'), false);
    }

    getEntityAIControllers(entityId) {
        let entityControllersMap = this.entityAIControllers.get(entityId);
        if(!entityControllersMap){
            entityControllersMap = new Map();
            this.entityAIControllers.set(entityId, entityControllersMap);
        }
        return entityControllersMap;
    }

    entityDestroyed(entityId) {
        this.entityAIControllers.delete(entityId);
    }

}