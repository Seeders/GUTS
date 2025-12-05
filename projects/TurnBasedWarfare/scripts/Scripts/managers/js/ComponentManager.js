class ComponentManager {
    constructor(game) {
        this.game = game;
        this.game.componentManager = this;
        this.componentGenerator = new GUTS.ComponentGenerator(this.game.getCollections().components);
        this.game.gameManager.register("getComponents", this.getComponents.bind(this));
    }

    getComponents(){
        if(!this.components){
            this.components = this.componentGenerator.getComponents();
        }
        return this.components;
    }

    onSceneUnload() {
        // Clear cached components to allow fresh generation on next scene load
        this.components = null;
        console.log('[ComponentManager] Scene unloaded - resources cleaned up');
    }
}