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


// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.GameState = GameState;
}

// ES6 exports for webpack bundling
export default GameState;
export { GameState };
