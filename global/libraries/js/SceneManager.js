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

        if(this.currentSceneData.type == "ECS") {
            return this.loadECS();
        }

        const sceneEntities = this.currentSceneData.sceneData;
        sceneEntities.forEach(async (sceneEntity) => {
            let params = {
                "objectType": sceneEntity.objectType,
                "spawnType": sceneEntity.spawnType,
            };
            sceneEntity.components.forEach((entityComp) => {
                params = {...params, ...entityComp.parameters, canvas: this.game.canvas };
            });                              
            let e = this.game.spawn(sceneEntity.type, params);
            this.addEntityToScene(e);  
        });
    }

    loadECS() {
        
        const sceneEntities = this.currentSceneData.sceneData;
          sceneEntities.forEach(async (sceneEntity) => {   

            sceneEntity.classes.forEach((classDef) => {
                let params = {...classDef.parameters, canvas: this.game.canvas };
                const ClassDef = this.game.moduleManager.getCompiledScript(classDef.type, classDef.collection);
                this.game.addClass(classDef, ClassDef);
                
            });         
            
            sceneEntity.managers.forEach((managerDef) => {
                let params = {...managerDef.parameters, canvas: this.game.canvas };
                const ManagerClass = this.game.moduleManager.getCompiledScript(managerDef.type, 'managers');
                const managerInst = new ManagerClass(this.game, this);
                if(managerInst.init){
                    managerInst.init(params);
                }                
            });   

            sceneEntity.systems.forEach((systemDef) => {
                let params = {...systemDef.parameters, canvas: this.game.canvas };
                const SystemClass = this.game.moduleManager.getCompiledScript(systemDef.type, 'systems');
                const systemInst = new SystemClass(this.game, this);
                if(systemInst.init){
                    systemInst.init(params);
                }
                this.game.addSystem(systemInst);
                
            });                        
        });
    }

}