class Engine {
    constructor(target) {
        this.applicationTarget = document.getElementById(target);
        this.plugins = {};
        this.currentTime = Date.now();
        this.lastTime = Date.now();
        this.deltaTime = 0;
        this.engineClasses = [];
        this.libraries = {};
        this.running = false;
        const urlParams = new URLSearchParams(window.location.search);
        this.isServer = urlParams.get('isServer');
        console.log("isServer", this.isServer);
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
 
        this.gameInstance = new GUTS[projectConfig.appLibrary](this);    

        this.loader = new GUTS[projectConfig.appLoaderLibrary](this.gameInstance);     
        await this.loader.load();
            
        // Use ModuleManager's script environment
        this.start();
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
        for (let systemType in this.collections.systems) {
            const systemDef = this.collections.systems[systemType];
            if (systemDef.script) {
                this.moduleManager.compileScript(systemDef.script, systemType);
            }
        }
        for( let funcType in this.collections.functions) {            
            const funcDef = this.collections.functions[funcType];
            this.moduleManager.compileFunction(funcDef.script, funcType);
        }
    }
    
    gameLoop() {    
        if (!this.running) return;
        if(this.gameInstance && this.gameInstance.update) {
            this.gameInstance.update(); 
        }      
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }

    start() {
        this.running = true;
        this.lastTime = performance.now();
        
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
        requestAnimationFrame(() => {
            this.hideLoadingScreen();
        }); 
    }
    
    stop() {
        this.running = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
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
