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

if(typeof BaseSystem != 'undefined'){
    if (typeof window !== 'undefined') {
        window.BaseSystem = BaseSystem;
    }

    // Make available as ES module export (new for server)  
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = BaseSystem;
    }

    // Make available as ES6 export (also new for server)
    if (typeof exports !== 'undefined') {
        exports.default = BaseSystem;
        exports.BaseSystem = BaseSystem;
    }
}