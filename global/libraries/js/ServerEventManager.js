class ServerEventManager {
    constructor(engine) {
        this.engine = engine;
        this.listeners = new Map(); // eventType -> [callbacks]
    }
    
    subscribe(eventType, callback) {
        console.log("subscribing", eventType);
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, []);
        }
        this.listeners.get(eventType).push(callback);
    }
    
    emit(eventType, data) {
        const callbacks = this.listeners.get(eventType) || [];
        const results = [];
        for (const callback of callbacks) {
            try {
                const result = callback(data);
                if (result) results.push(result);
            } catch (error) {
                console.error(`Event handler error for ${eventType}:`, error);
            }
        }
        return results;
    }
}


if(typeof ServerEventManager != 'undefined'){
    if (typeof window !== 'undefined') {
        window.ServerEventManager = ServerEventManager;
    }

    // Make available as ES module export (new for server)  
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ServerEventManager;
    }

    // Make available as ES6 export (also new for server)
    if (typeof exports !== 'undefined') {
        exports.default = ServerEventManager;
        exports.ServerEventManager = ServerEventManager;
    }
}