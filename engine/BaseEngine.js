class BaseEngine {
    constructor() {
        this.plugins = {};
        this.currentTime = Date.now();
        this.lastTime = Date.now();
        this.deltaTime = 0;
        this.accumulator = 0;
        this.engineClasses = [];
        this.appClasses = {};
        this.libraries = {};
        this.running = false;
        this.collections = null;
        this.gameInstance = null;
    }

    async loadCollections(projectName) {
        // This method will be overridden by client and server implementations
        throw new Error('loadCollections must be implemented by subclass');
    }

    getCollections() {
        return this.collections;
    }


    resetAccumulator() {
        this.accumulator = 0;
    }


    start() {
        this.running = true;
        this.lastTime = this.getCurrentTime();
    }

    stop() {
        this.running = false;
    }

    getCurrentTime() {
        return Date.now();
    }
}
if(typeof BaseEngine != 'undefined'){
    if (typeof window !== 'undefined') {
        window.BaseEngine = BaseEngine;
    }

    // Make available as ES module export (new for server)  
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = BaseEngine;
    }

    // Make available as ES6 export (also new for server)
    if (typeof exports !== 'undefined') {
        exports.default = BaseEngine;
        exports.BaseEngine = BaseEngine;
    }
}