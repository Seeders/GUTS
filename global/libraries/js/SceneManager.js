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

        
        if(this.currentSceneData.type == "ECS") {
            return this.loadECS();
        }
        this.game.state.currentScene = this.game.spawn("scene", {sceneData: this.currentSceneData});

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

            sceneEntity.classes.forEach((sceneClassDef) => {
                const collectionName = sceneClassDef.collection;
                const baseClassId = sceneClassDef.baseClass;
                const classCollection = this.game.getCollections()[collectionName];
                
                if(baseClassId){
                    const collectionClassDef = classCollection[baseClassId];
                    let params = { ...collectionClassDef.parameters, ...sceneClassDef.parameters, canvas: this.game.canvas };
                    const BaseClassDef = this.game.moduleManager.getCompiledScript(baseClassId, collectionName);
                    this.game.addClass(baseClassId, BaseClassDef, params);
                }
                for(const collectionClassId in classCollection) {    
                    if(baseClassId && collectionClassId == baseClassId) continue;                
                    const collectionClassDef = classCollection[collectionClassId];
                    let params = { ...collectionClassDef.parameters, ...sceneClassDef.parameters, canvas: this.game.canvas };
                    const ClassDef = this.game.moduleManager.getCompiledScript(collectionClassId, collectionName);
                    this.game.addClass(collectionClassId, ClassDef, params);
                }
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
   
                this.game.addSystem(systemInst, params);
                
            });   
            this.game.systems.forEach((system) => {
                system.postAllInit();                
            });                      
        });
    }

}