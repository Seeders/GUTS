class ServerEventManager {
    constructor(engine) {
        this.engine = engine;
        this.listeners = new Map(); // eventType -> [callbacks]
    }
    
    subscribe(eventType, callback) {
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



// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.ServerEventManager = ServerEventManager;
}

// ES6 exports for webpack bundling
export default ServerEventManager;
export { ServerEventManager };
