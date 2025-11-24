class AISystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.aiSystem = this;
        this.entityAIControllers = new Map();
    }

    init() {
        // Register methods with GameManager
        this.game.gameManager.register('getAIControllerData', this.getAIControllerData.bind(this));
        this.game.gameManager.register('setAIControllerData', this.setAIControllerData.bind(this));
        this.game.gameManager.register('setCurrentAIController', this.setCurrentAIController.bind(this));
        this.game.gameManager.register('getCurrentAIController', this.getCurrentAIController.bind(this));
        this.game.gameManager.register('getCurrentAIControllerId', this.getCurrentAIControllerId.bind(this));
        this.game.gameManager.register('removeAIController', this.removeAIController.bind(this));
        this.game.gameManager.register('removeCurrentAIController', this.removeCurrentAIController.bind(this));
        this.game.gameManager.register('hasAIControllerData', this.hasAIControllerData.bind(this));
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
        const CT = this.game.gameManager.call('getComponents');        
        return entityControllersMap.has(aiControllerId);
    }

    getAIControllerData(entityId, aiControllerId) {
        let entityControllersMap = this.getEntityAIControllers(entityId);
        const CT = this.game.gameManager.call('getComponents');        
        return entityControllersMap.get(aiControllerId) || CT.AIState('idle');
    }

    setCurrentAIController(entityId, aiControllerId, data) {
        this.setAIControllerData(entityId, aiControllerId, data);
        this.setAIControllerData(entityId, "AISystem", data, false);

        let aiState = this.game.getComponent(entityId, this.game.gameManager.call('getComponentTypes').AI_STATE);
        aiState.targetPosition = data.targetPosition;
        aiState.target = data.target;
        aiState.meta = data.meta;
        aiState.aiControllerId = aiControllerId;

        // CRITICAL: Always clear path when switching controllers
        // This prevents units from continuing old paths before executing new commands
        aiState.path = [];
        aiState.pathIndex = 0;
        aiState.useDirectMovement = false;
        console.log('setCurrentAIController:', entityId, data.targetPosition, aiState.targetPosition);

        // Update state based on new target
        if (data.targetPosition || data.target) {
            aiState.state = data.state || 'chasing';
        } else {
            aiState.state = data.state || 'idle';
        }
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
        const CT = this.game.gameManager.call('getComponents');        
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