export default class BaseBehaviorTreeRootAction extends GUTS.BaseBehaviorAction {

    constructor(game, config){
        super(game, config);
    }

    execute(entityId, game) {
        
        if(!this.behaviorTreeInstance){     
            if(this.config.behaviorTree){
                this.setTree(this.config.behaviorTree);
            }          
        }
        if(this.behaviorTreeInstance){            
            return this.behaviorTreeInstance.evaluate(entityId, game);      
        }
        return null;
    }

    setTree(behaviorTreeType){
        this.behaviorTreeInstance = this.game.gameManager.call('getBehaviorTreeByType', behaviorTreeType);
    }
}
