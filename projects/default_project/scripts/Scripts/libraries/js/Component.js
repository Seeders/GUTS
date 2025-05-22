class Component {
    constructor(game, parent) { 
        this.game = game;
        this.parent = parent;
    }
    init(params) {}
    getComponent(type) {
        return this.parent.getComponent(type);
    }
    update() {}
    postUpdate() {}
    destroy() {}
}
