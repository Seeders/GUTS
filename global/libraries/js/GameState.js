class GameState {
    constructor(gameConfig = {}) {
        this.collections = gameConfig;
        let state = gameConfig.configs?.state;
     
        // Clear all existing properties
        for (let prop in this) {
            if (Object.prototype.hasOwnProperty.call(this, prop)) {
                delete this[prop];
            }
        }

        // Set only the properties from params
        for (let key in state) {
            if (Object.prototype.hasOwnProperty.call(state, key)) {
                this[key] = state[key];
            }
        }
        // If stats is present, create defaultStats as a copy
  
    }
}

if (typeof window !== 'undefined') {
    window.GameState = GameState;
}

// Make available as ES module export (new for server)  
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameState;
}

// Make available as ES6 export (also new for server)
if (typeof exports !== 'undefined') {
    exports.default = GameState;
    exports.GameState = GameState;
}