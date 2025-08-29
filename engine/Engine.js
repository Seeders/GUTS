class Engine extends BaseEngine {
    constructor(target) {
        super();
        this.applicationTarget = document.getElementById(target);
        this.isServer = false;
        this.tickRate = 1 / 20; // 20 TPS
        this.lastTick = 0;
        this.simulationTime = 0;
        this.accumulator = 0;
        const urlParams = new URLSearchParams(window.location.search);
        this.serverMode = urlParams.get('isServer');
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

    async loadCollections(projectName) {
        let currentProject = projectName;
        let project = {};

        project = JSON.parse(localStorage.getItem(currentProject));
        
        if (!project) {
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

    hideLoadingScreen() {
        document.body.style = "";
        requestAnimationFrame(() => {
            this.applicationTarget.style = '';
        });
    }

    gameLoop() {
        if (!this.running) return;
        
        const now = this.getCurrentTime();
        const deltaTime = (now - this.lastTick) / 1000;
        this.lastTick = now;
        
        this.accumulator += deltaTime;
        while (this.accumulator >= this.tickRate) {
            this.simulationTime += this.tickRate * 1000;
            this.tick(this.tickRate, this.simulationTime);
            this.accumulator -= this.tickRate;
        }
        
        // Use setImmediate for next tick (Node.js specific)
        requestAnimationFrame(() => this.gameLoop());
    }

    tick(deltaTime, now) {
        // Update all active game rooms
        if (this.gameInstance && this.gameInstance.update) {
            this.gameInstance.update(deltaTime, now);        
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
}