class SceneManager {
    constructor(game) {
        this.game = game;
        this.game.state.currentScene = null;
        this.currentSceneData = null;
        this.currentSceneName = null;
    }

    addEntityToScene(entity){        
        if(this.game.state.currentScene){
            return this.game.state.currentScene.addChild(entity);  
        }
        return entity;
    }

    load(sceneName){
        this.currentSceneName = sceneName;
        if(this.game.currentScene) {
            this.game.currentScene.destroy();
        } 
        this.currentSceneData = this.game.getCollections().scenes[this.currentSceneName];
        this.game.state.currentScene = this.game.spawn("scene", {sceneData: this.currentSceneData});
        const sceneEntities = this.currentSceneData.sceneData;
        sceneEntities.forEach(async (sceneEntity) => {
            let params = {
                "objectType": sceneEntity.objectType,
                "spawnType": sceneEntity.spawnType,
            };
            sceneEntity.components.forEach((entityComp) => {
                params = {...params, ...entityComp.parameters };
            });                              
            let e = this.game.spawn(sceneEntity.type, params);
            this.addEntityToScene(e);  
            console.log('spawned', e);
        });
    }


}