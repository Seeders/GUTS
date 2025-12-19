class GameServices {
    constructor() {
        this.services = new Map();
    }
    // Systems call this in constructor or init()
    register(key, method) {  
        this.services.set(key, method);
    }

    has(key){
        return this.services.has(key);
    }

    // Public API
    call(key, ...args) {
        const method = this.services.get(key);
        if (!method) {
            console.warn('[GameServices] missing method', key);
            return undefined;
        }
        return method(...args);
    }

    // Debug
    listServices() {
        return Array.from(this.services.keys());
    }
}