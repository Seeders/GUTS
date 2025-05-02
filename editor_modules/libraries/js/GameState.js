class GameState {
    constructor(gameConfig = {}) {
        let state = gameConfig.configs.state;
     
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
        this.entities = [];
        // If stats is present, create defaultStats as a copy
  
    }

    addEntity(entity) {
        this.entities.push(entity);
    }
    removeEntity(entity) {
    
        let index = this.entities.indexOf(entity);
        if( index >= 0 ) {
            this.entities.splice(index, 1);
        }
    }
}