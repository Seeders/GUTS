class Component {
    constructor(game, parent, params) { 
        this.game = game;
        this.parent = parent;
        this.init(params);
    }
    init(params) {}
    getComponent(type) {
        return this.parent.getComponent(type);
    }
    update() {}
    postUpdate() {}
    destroy() {}
    
    OnCollision(collidedWith){}
    OnStaticCollision(){}
    OnGrounded(){}
}