class ComponentSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.componentSystem = this;
        this.componentGenerator = new GUTS.ComponentGenerator(this.game.getCollections().components);
        this.game.register("getComponents", this.getComponents.bind(this));
    }

    getComponents(){
        if(!this.components){
            this.components = this.componentGenerator.getComponents();
        }
        return this.components;
    }

    onSceneUnload() {
        this.components = null;
    }
}