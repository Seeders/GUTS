class ComponentSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.componentSystem = this;
    }

}
