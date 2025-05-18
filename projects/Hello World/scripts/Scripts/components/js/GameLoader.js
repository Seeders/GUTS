class GameLoader extends engine.Component {
    

    init() {}
    
    async load(){
        this.collections = this.game.getCollections();        
        this.game.palette = this.collections.palettes && this.collections.configs.game.palette ? this.collections.palettes[this.collections.configs.game.palette] : null;
        

        this.game.gameEntity = this.game.createEntityFromCollections('game', { gameConfig: this.collections.configs.game }, {x: 0, y: 0, z: 0});
 
    }

    getProject() {
        return this.game.gameEntity;
    }

}