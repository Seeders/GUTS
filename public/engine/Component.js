class Component {
    constructor(game, parent, params) {  // Just use params as a single object
        this.game = game;
        this.parent = parent;
        this.init(params);  // Pass params directly
    }
    init(params) {}
    getComponent(type) {
        return this.parent.getComponent(type);
    }
    update() {}
    postUpdate() {}
    destroy() {}
}

export { Component };