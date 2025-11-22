class BaseSystem {
    constructor(game) {
        this.game = game;
        this.engine = game.app;
        this.componentTypes = this.game.componentManager.getComponentTypes();
    }
    postAllInit() {

    }
    
    update(){

    }

    render() {

    }

}


// Assign to global.GUTS for server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.BaseSystem = BaseSystem;
}

// ES6 exports for webpack bundling
export default BaseSystem;
export { BaseSystem };
