class Engine extends BaseEngine {
    constructor(target) {
        super();
        this.applicationTarget = document.getElementById(target);
        this.isServer = false;
        this.tickRate = 1 / 20; // 20 TPS
        this.lastTick = 0;
        this.accumulator = 0;
        const urlParams = new URLSearchParams(window.location.search);
        this.serverMode = urlParams.get('isServer');
        this.services = new Map();
        window.APP = this;
    }

    async init(projectName) {
        this.currentProjectName = projectName;
        this.collections = await this.loadCollections();
        if (!this.collections) {
            console.error("Failed to load game configuration");
            return;
        }

        // Initialize ModuleManager
        this.moduleManager = new ModuleManager(this, this.collections, this.applicationTarget, this.applicationTarget);
        
        let projectConfig = this.collections.configs.game;
        if (projectConfig.libraries) {
            this.moduleManager.libraryClasses = await this.moduleManager.loadModules({ "game": projectConfig });
            window.GUTS = this.moduleManager.libraryClasses;
        }

        this.setupScriptEnvironment();
        this.preCompileScripts();

        this.gameInstance = new GUTS[projectConfig.appLibrary](this);
        this.loader = new GUTS[projectConfig.appLoaderLibrary](this.gameInstance);
        await this.loader.load();
        
        this.start();
    }

    getCurrentProject(){ 
        return this.currentProjectName;
    }

    getResourcesPath(){ 
        if(window){
            let path = window.location.pathname.replace('index.html', 'resources/');
            return path.slice(1, path.length);
        }
        return "resources/";
    }

    async loadCollections() {        ;
        let project = {};

        project = JSON.parse(localStorage.getItem(this.currentProjectName));
        
        if (!project) {
            const response = await window.fetch(`config/${this.currentProjectName.toUpperCase().replace(/ /g, '_')}.json`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            } else {
                const data = await response.json();
                project = data;
            }
        }
        return project.objectTypes;
    }

    hideLoadingScreen() {
        document.body.style = "";
        requestAnimationFrame(() => {
            this.applicationTarget.style = '';
        });
    }

    async gameLoop() {
        if (!this.running) return;
        
        const now = this.getCurrentTime();
        const deltaTime = (now - this.lastTick) / 1000;
        this.lastTick = now;
        
        this.accumulator += deltaTime;
        while (this.accumulator >= this.tickRate) {
            await this.tick();
            this.accumulator -= this.tickRate;
        }
        
        // Use setImmediate for next tick (Node.js specific)
        requestAnimationFrame(() => this.gameLoop());
    }

    async tick() {
        // Update all active game rooms
        if (this.gameInstance && this.gameInstance.update) {
            await this.gameInstance.update(this.tickRate);        
        }
        
    }
    start() {
        super.start();
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
        requestAnimationFrame(() => {
            this.hideLoadingScreen();
        });
    }

    stop() {
        super.stop();
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
    getCurrentTime() {
        return performance.now();
    }

    addService(key, serviceInstance) {
        if(!this.services.get(key)){
            this.services.set(key, serviceInstance);
        } else {
            console.warn('duplicate service key', key);
        }
    }
}