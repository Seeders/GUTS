class Engine extends BaseEngine {
    static MAX_DEBT = 0.25;     // seconds of owed ticks past which the loop drops them (gameLoop)

    constructor(target) {
        super();
        this.applicationTarget = document.getElementById(target);
        this.isServer = false;
        this.tickRate = 1 / 20; // 20 TPS
        this.lastTick = 0;
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

        let projectConfig = this.collections.configs.game;

        // Show the app container
        this.applicationTarget.style.display = '';

        // Create game instance
        this.gameInstance = new GUTS[projectConfig.appLibrary](this);

        // Run loader (loaders call game.init() themselves)
        const loader = new GUTS[projectConfig.appLoaderLibrary](this.gameInstance);
        await loader.load();

        // Allow game config to override tick rate (default is 20 TPS)
        if (projectConfig.tickRate) {
            this.tickRate = 1 / projectConfig.tickRate;
            // Also update the game's fixed delta time to match
            if (this.gameInstance && this.gameInstance.FIXED_DELTA_TIME !== undefined) {
                this.gameInstance.FIXED_DELTA_TIME = this.tickRate;
            }
        }

        this.start();
    }

    getCurrentProject(){ 
        return this.currentProjectName;
    }

    getResourcesPath(){
        if(window){
            // Directory of the current page + 'resources/'. Handles '/',
            // '/index.html', and subdirectory hosting alike — the old
            // replace('index.html') broke when the page was served at '/'
            // (nothing to replace → the resources/ prefix was lost and
            // every texture/model request 404'd).
            const dir = window.location.pathname.replace(/[^/]*$/, '');
            return dir + 'resources/';
        }
        return "resources/";
    }

    async loadCollections() {

        // Use compiled collections from webpack build
        if (window.COMPILED_GAME?.collections) {
            return window.COMPILED_GAME.collections;
        }

        // No collections available
        console.warn('No collections found in COMPILED_GAME');
        return {};
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

        // Always accumulate time for fixed timestep
        this.accumulator += deltaTime;

        // Process ticks at fixed rate, limit per frame to catch up gradually
        // This prevents lag spikes while maintaining sync
        // Battle fast-forward: game.state.battleSpeed multiplies how many fixed
        // ticks are consumed per real second (sim dt stays fixed — deterministic).
        const speed = this.gameInstance?.state?.battleSpeed || 1;
        const tickInterval = this.tickRate / speed;
        const maxTicksPerFrame = 3 * speed;
        // A stall (a long first frame, a GPU upload) is not paid back: at 3 ticks a frame, each one
        // rendering, seconds owed would mean minutes of triple work. Small slips still catch up.
        if (this.accumulator > Engine.MAX_DEBT) this.accumulator = tickInterval;
        let ticksProcessed = 0;

        // only the frame's last tick is drawn (BaseECSGame: drawThisTick)
        const ticks = Math.min(maxTicksPerFrame, Math.floor(this.accumulator / tickInterval));
        while (this.accumulator >= tickInterval && ticksProcessed < maxTicksPerFrame) {
            if (this.gameInstance) this.gameInstance.drawThisTick = ticksProcessed >= ticks - 1;
            await this.tick();
            this.accumulator -= tickInterval;
            ticksProcessed++;
        }

        // Schedule next frame using requestAnimationFrame when tab is active
        if (this.useRAF) {
            this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
        }
    }

    /**
     * Reset the accumulator to prevent catchup after sync
     */
    resetAccumulator() {
        this.accumulator = 0;
        this.lastTick = this.getCurrentTime();
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
            // Notify game that tab became visible (for catchup handling)
            if (this.gameInstance?.triggerEvent) {
                this.gameInstance.triggerEvent('onTabVisible');
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