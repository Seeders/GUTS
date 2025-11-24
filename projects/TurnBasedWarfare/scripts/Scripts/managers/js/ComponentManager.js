class ComponentManager {
    constructor(game) {
        this.game = game;
        this.game.componentManager = this;
        this.componentGenerator = new GUTS.ComponentGenerator(this.game.getCollections().components);
        this.game.componentTypes = this.getComponentTypes();
        this.game.gameManager.register("getComponents", this.getComponents.bind(this));
        this.game.gameManager.register("getComponentTypes", this.getComponentTypes.bind(this));
    }

    getComponents(){
        return this.componentGenerator.getComponents();
    }

    getComponentTypes() {
        return this.componentGenerator.getComponentTypes();
    }
}