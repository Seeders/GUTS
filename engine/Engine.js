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

        // If using webpack bundle, libraries are already loaded in window.GUTS
        if (window.COMPILED_GAME) {
            // Libraries already bundled and available in window.GUTS
            this.moduleManager.libraryClasses = window.GUTS;
            console.log('✅ Using webpack-bundled libraries');
        } else {
            // Legacy mode: dynamically load libraries
            if (projectConfig.libraries) {
                this.moduleManager.libraryClasses = await this.moduleManager.loadModules({ "game": projectConfig });
                window.GUTS = this.moduleManager.libraryClasses;
            }
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

    async loadCollections() {        
        
        let project = {};

        project = JSON.parse(localStorage.getItem(this.currentProjectName));
        
        if (!project) {

            if(window.COMPILED_GAME?.collections){
                return window.COMPILED_GAME.collections;
            }
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

        // Process ticks, but limit per frame to catch up gradually
        // This prevents lag spikes while maintaining sync
        const maxTicksPerFrame = 3;
        let ticksProcessed = 0;

        while (this.accumulator >= this.tickRate && ticksProcessed < maxTicksPerFrame) {
            await this.tick();
            this.accumulator -= this.tickRate;
            ticksProcessed++;
        }

        // Schedule next frame using requestAnimationFrame when tab is active
        if (this.useRAF) {
            this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
        }
    }

    handleVisibilityChange() {
        if (document.hidden) {
            // Tab is hidden - switch to setInterval
            this.useRAF = false;
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            // Use setInterval to keep running in background
            this.intervalId = setInterval(() => this.gameLoop(), 16);
        } else {
            // Tab is visible - switch to requestAnimationFrame
            this.useRAF = true;
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
            this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
        }
    }

    async tick() {
        // Update all active game rooms
        if (this.gameInstance && this.gameInstance.update) {
            await this.gameInstance.update(this.tickRate);        
        }
        
    }
    start() {
        super.start();
        this.lastTick = this.getCurrentTime();
        this.useRAF = true;

        // Listen for tab visibility changes
        this.visibilityHandler = () => this.handleVisibilityChange();
        document.addEventListener('visibilitychange', this.visibilityHandler);

        // Start with requestAnimationFrame
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
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
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