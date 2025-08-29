export default class ServerSceneManager {
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
            // Load classes
            sceneEntity.classes.forEach((sceneClassDef) => {
                const collectionName = sceneClassDef.collection;
                const baseClassId = sceneClassDef.baseClass;
                const classCollection = this.game.getCollections()[collectionName];
                
                if (baseClassId) {
                    const collectionClassDef = classCollection[baseClassId];
                    let params = { ...collectionClassDef.parameters, ...sceneClassDef.parameters };
                    const BaseClassDef = this.game.moduleManager.getCompiledScript(baseClassId, collectionName);
                    this.game.addClass(baseClassId, BaseClassDef, params);
                }
                
                for (const collectionClassId in classCollection) {
                    if (baseClassId && collectionClassId === baseClassId) continue;
                    
                    const collectionClassDef = classCollection[collectionClassId];
                    let params = { ...collectionClassDef.parameters, ...sceneClassDef.parameters };
                    const ClassDef = this.game.moduleManager.getCompiledScript(collectionClassId, collectionName);
                    this.game.addClass(collectionClassId, ClassDef, params);
                }
            });

            // Load managers (no canvas needed)
            sceneEntity.managers.forEach((managerDef) => {
                let params = { ...managerDef.parameters };
                const ManagerClass = this.game.moduleManager.getCompiledScript(managerDef.type, 'managers');
                const managerInst = new ManagerClass(this.game, true);
                if (managerInst.init) {
                    managerInst.init(params);
                }
            });

            // Load systems (server-specific systems only)
            sceneEntity.systems.forEach((systemDef) => {
                let params = { ...systemDef.parameters };
                const SystemClass = this.game.moduleManager.getCompiledScript(systemDef.type, 'systems');
                const systemInst = new SystemClass(this.game, true);
                this.game.addSystem(systemInst, params);
            });
        });
    }
}