class ServerSceneManager {
    constructor(game) {
        this.game = game;
        this.game.state.currentScene = null;
        this.currentSceneData = null;
        this.currentSceneName = null;
    }

    load(sceneName) {
        console.log("load scene", sceneName);
        this.currentSceneName = sceneName;
        this.currentSceneData = this.game.getCollections().scenes[this.currentSceneName];

        if (this.currentSceneData.type === "ECS") {
            return this.loadECS();
        }

        console.log(`Loaded server scene: ${sceneName}`);
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
                    if(GUTS?.app?.appClasses){
                        const BaseClassDef = GUTS.app.appClasses[baseClassId];
                        this.game.addClass(baseClassId, BaseClassDef, params);
                    } else {
                        const BaseClassDef = this.game.moduleManager.getCompiledScript(baseClassId, collectionName);
                        this.game.addClass(baseClassId, BaseClassDef, params);
                    }
                }
                for(const collectionClassId in classCollection) {    
                    if(baseClassId && collectionClassId == baseClassId) continue;                
                    const collectionClassDef = classCollection[collectionClassId];
                    let params = { ...collectionClassDef.parameters, ...sceneClassDef.parameters, canvas: this.game.canvas };
                    if(GUTS?.app?.appClasses){
                        const ClassDef = GUTS.app.appClasses[collectionClassId];
                        this.game.addClass(collectionClassId, ClassDef, params);
                    } else {
                        const ClassDef = this.game.moduleManager.getCompiledScript(collectionClassId, collectionName);
                        this.game.addClass(collectionClassId, ClassDef, params);
                    }
                }
            });         
            
            sceneEntity.managers.forEach((managerDef) => {
                let params = {...managerDef.parameters, canvas: this.game.canvas };
                let ManagerClass = null;
                if(GUTS?.app?.appClasses){
                    ManagerClass = GUTS.app.appClasses[managerDef.type];        
                } else {
                    ManagerClass = this.game.moduleManager.getCompiledScript(managerDef.type, 'managers');
                }     
                const managerInst = new ManagerClass(this.game, this);
                if(managerInst.init){
                    managerInst.init(params);
                }  
            });   

            sceneEntity.systems.forEach((systemDef) => {
                let params = {...systemDef.parameters, canvas: this.game.canvas };
             
                let SystemClass = null;
                if(GUTS?.app?.appClasses){
                    SystemClass = GUTS.app.appClasses[systemDef.type];            
                } else {
                    SystemClass = this.game.moduleManager.getCompiledScript(systemDef.type, 'systems');
                }    
                const systemInst = new SystemClass(this.game, this);
   
                this.game.addSystem(systemInst, params);
                
            });   
            this.game.systems.forEach((system) => {
                system.postAllInit();                
            });                      
        });
    }
}
      

// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.ServerSceneManager = ServerSceneManager;
}

// ES6 exports for webpack bundling
export default ServerSceneManager;
export { ServerSceneManager };
