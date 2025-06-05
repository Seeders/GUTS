class Engine {
    constructor(target) {
        this.entityId = 0;
        this.applicationTarget = document.getElementById(target);
        this.entitiesToAdd = [];
        this.plugins = {};
        this.currentTime = Date.now();
        this.lastTime = Date.now();
        this.deltaTime = 0;
        this.engineClasses = [];
        this.libraries = {};
        this.state = {};
        const urlParams = new URLSearchParams(window.location.search);
        this.isServer = urlParams.get('isServer');
        window.APP = this;
    }

    async init(projectName) {
        this.collections = await this.loadCollections(projectName);
        if (!this.collections) {
            console.error("Failed to load game configuration");
            return;
        }

        // Initialize ModuleManager
        this.moduleManager = new ModuleManager(this, this.collections, this.applicationTarget, this.applicationTarget);
        
        let projectConfig = this.collections.configs.game;
        if (projectConfig.libraries) {
            // Use ModuleManager to load modules
            this.moduleManager.libraryClasses = await this.moduleManager.loadModules({ "game": projectConfig });
            window.GUTS = this.moduleManager.libraryClasses;
        }
        //components, renderers, and functions
        this.setupScriptEnvironment();
        this.preCompileScripts();  

        this.state = new GUTS.GameState(this.collections);  


        this.state.loader = this.createEntityFromCollections(projectConfig.loaderEntity, {}, {x:0, y:0, z:0 }).getComponent(projectConfig.loaderComponent);        
        await this.state.loader.load();
        this.state.projectEntity = this.state.loader.getProject();        
        // Use ModuleManager's script environment

        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());

        requestAnimationFrame(() => {
            this.hideLoadingScreen();
        });    
    }
    
    getCollections() {
        return this.collections;
    }



    hideLoadingScreen() {      
        document.body.style = "";  
        requestAnimationFrame(() => {            
            this.applicationTarget.style = '';
        });
    }

    setupScriptEnvironment() {
        // Use ModuleManager's script environment setup
        this.scriptContext = this.moduleManager.setupScriptEnvironment(this);
    }

    // Pre-compile all scripts to ensure availability
    preCompileScripts() {
        for (let componentType in this.collections.components) {
            const componentDef = this.collections.components[componentType];
            if (componentDef.script) {
                this.moduleManager.compileScript(componentDef.script, componentType);
            }
        }
        for (let componentType in this.collections.renderers) {
            const componentDef = this.collections.renderers[componentType];
            if (componentDef.script) {
                this.moduleManager.compileScript(componentDef.script, componentType);
            }
        }
        for( let funcType in this.collections.functions) {            
            const funcDef = this.collections.functions[funcType];
            this.moduleManager.compileFunction(funcDef.script, funcType);
        }
    }
    
    gameLoop() {    
        if(this.state.projectEntity && this.state.projectEntity.update) {
            this.state.projectEntity.update(); 
            if(!this.isServer){ 
                this.state.projectEntity.draw();   
            }
        }      
        this.entitiesToAdd.forEach((entity) => this.state.addEntity(entity));        
        this.entitiesToAdd = [];
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }


    stopGameLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    spawn(type, params) {
        let entity = this.createEntityFromCollections(type, params);
        this.entitiesToAdd.push(entity);        
        return entity;
    }
    
    createEntityFromCollections(type, params) {

        const entity = this.createEntity(type);
        const def = this.collections.entities[type];

        entity.transform = entity.addComponent("transform");
        
        if (def.components) {
            def.components.forEach((componentType) => {
                const componentDef = this.collections.components[componentType];
                if (componentDef.script) {
                    const ScriptComponent = this.moduleManager.getCompiledScript(componentType, 'components');
                    if (ScriptComponent) {
                        entity.addComponent(componentType);                  
                    }
                }
            });
        }
        if (def.renderers) {
            def.renderers.forEach((rendererType) => {
                const componentDef = this.collections.renderers[rendererType];
                if (componentDef.script) {
                    const ScriptComponent = this.moduleManager.getCompiledScript(rendererType, 'renderers');
                    if (ScriptComponent) {
                        entity.addRenderer(rendererType);                  
                    }
                }
            });
        }
        //this allows components to reference other components on the entity at init, since they will now all exist before init.
        entity.init(params);
        return entity;
    }

    createEntity(type) {
        const entity = new GUTS.Entity(this, type);
        return entity;
    }

    async loadCollections(projectName) {
        let currentProject = projectName;
        let project = {};


        project = JSON.parse(localStorage.getItem(currentProject)); 
        
        if(!project){
            const response = await window.fetch(`config/${currentProject.toUpperCase().replace(/ /g, '_')}.json`);

            if (!response.ok) {                    
                throw new Error(`HTTP error! status: ${response.status}`);
            } else {
                const data = await response.json();  
                project = data;
            }
        }
        return project.objectTypes;
    }

}
