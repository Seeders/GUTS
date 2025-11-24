class ComponentManager {
    constructor(game) {
        this.game = game;
        this.game.componentManager = this;
        this.componentGenerator = new GUTS.ComponentGenerator(this.game.getCollections().components);
        this.game.gameManager.register("getComponents", this.getComponents.bind(this));
        this.game.gameManager.register("getComponentTypes", this.getComponentTypes.bind(this));
    }

    getComponents(){
        if(!this.components){
            this.components = this.componentGenerator.getComponents();
        }
        return this.components;
    }

    getComponentTypes() {
        if(!this.componentTypes){
            this.componentTypes = this.componentGenerator.getComponentTypes();
        }
        return this.componentTypes;
    }
}