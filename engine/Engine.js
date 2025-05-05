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
    }

    async init() {
        this.config = await this.loadCollections();
      
        if (!this.config) {
            console.error("Failed to load game configuration");
            return;
        }

        // Initialize ModuleManager
        this.moduleManager = new ModuleManager(this, this.config, this.applicationTarget, this.applicationTarget);
        
        let projectConfig = this.config.configs.game;
        if (projectConfig.libraries) {
            // Use ModuleManager to load modules
            this.moduleManager.libraryClasses = await this.moduleManager.loadModules({ "game": projectConfig });
            this.libraryClasses = this.moduleManager.libraryClasses;
        }
        //components, renderers, and functions
        this.setupScriptEnvironment();
        this.preCompileScripts();  
        this.loader = this.createEntityFromConfig(0, 0, projectConfig.loaderEntity, {config: this.config}).getComponent(projectConfig.loaderComponent);        
        await this.loader.load({config: this.config });
        this.projectEntity = this.loader.getProject();        
        // Use ModuleManager's script environment

        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());

        requestAnimationFrame(() => {
            this.hideLoadingScreen();
        });
    }
    
    getCollections() {
        return this.config;
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
        for (let componentType in this.config.components) {
            const componentDef = this.config.components[componentType];
            if (componentDef.script) {
                this.moduleManager.compileScript(componentDef.script, componentType);
            }
        }
        for (let componentType in this.config.renderers) {
            const componentDef = this.config.renderers[componentType];
            if (componentDef.script) {
                this.moduleManager.compileScript(componentDef.script, componentType);
            }
        }
        for( let funcType in this.config.functions) {            
            const funcDef = this.config.functions[funcType];
            this.moduleManager.compileFunction(funcDef.script, funcType);
        }
    }
    
    gameLoop() {      
        if(this.projectEntity && this.projectEntity.update) {
            this.projectEntity.update();  
            this.projectEntity.draw();   
        }      
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }


    stopGameLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    spawn(x, y, type, params) {
        return this.addEntity(this.createEntityFromConfig(x, y, type, params));
    }

    addEntity(entity) {
        this.entitiesToAdd.push(entity);
        return entity;
    }
    
    createEntityFromConfig(x, y, type, params) {

        const entity = this.createEntity(x, y, type);
        const def = this.config.entities[type];
        
        if (def.components) {
            def.components.forEach((componentType) => {
                const componentDef = this.config.components[componentType];
                if (componentDef.script) {
                    const ScriptComponent = this.moduleManager.getCompiledScript(componentType, 'components');
                    if (ScriptComponent) {
                        entity.addComponent(componentType, params);                  
                    }
                }
            });
        }
        if (def.renderers) {
            def.renderers.forEach((rendererType) => {
                const componentDef = this.config.renderers[rendererType];
                if (componentDef.script) {
                    const ScriptComponent = this.moduleManager.getCompiledScript(rendererType, 'renderers');
                    if (ScriptComponent) {
                        entity.addRenderer(rendererType, params);                  
                    }
                }
            });
        }
        return entity;
    }

    createEntity(x, y, type) {
        const entity = new (this.libraryClasses.Entity)(this, x, y, type);
        return entity;
    }

    async loadCollections() {
        let currentProject = localStorage.getItem("currentProject");
        let gameData = {};

        if(location.hostname === "localhost"){
            const response = await fetch('/load-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ projectName: currentProject }),
            });

            if (!response.ok) {
                if (response.status === 404) {                
                    gameData = DEFAULT_PROJECT_CONFIG;
                } else {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
            } else {
                const data = await response.json();            
                gameData = data.config;
            }
        } else if(location.hostname !== "") {
            gameData = JSON.parse(localStorage.getItem(currentProject)); 
        }
        return gameData.objectTypes;
    }

}
