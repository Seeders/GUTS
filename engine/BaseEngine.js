class BaseEngine {
    constructor() {
        this.plugins = {};
        this.currentTime = Date.now();
        this.lastTime = Date.now();
        this.deltaTime = 0;
        this.engineClasses = [];
        this.appClasses = {};
        this.libraries = {};
        this.running = false;
        this.collections = null;
        this.moduleManager = null;
        this.gameInstance = null;
        this.simulationTime = 0;
        this.accumulator = 0;
    }

    async loadCollections(projectName) {
        // This method will be overridden by client and server implementations
        throw new Error('loadCollections must be implemented by subclass');
    }

    getCollections() {
        return this.collections;
    }

    setupScriptEnvironment() {
        this.scriptContext = this.moduleManager.setupScriptEnvironment(this);
    }

    preCompileScripts() {
        for (let funcType in this.collections.functions) {
            const funcDef = this.collections.functions[funcType];
            this.moduleManager.compileFunction(funcDef.script, funcType);
        }
    }

    start() {
        this.running = true;
        this.lastTime = this.getCurrentTime();
    }

    stop() {
        this.running = false;
    }

    resetCurrentTime() {
        this.simulationTime = 0;
        this.accumulator = 0;
    }
    getCurrentTime() {
        return Date.now();
    }
}

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