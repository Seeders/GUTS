class GameLoader extends engine.Component {
    

    init() {}
    
    async load({config}){
        this.config = config;        
        this.state = new (this.game.libraryClasses.GameState)(this.config);  
        this.game.state = this.state;
        this.game.palette = this.config.palettes && this.config.configs.game.palette ? this.config.palettes[this.config.configs.game.palette] : null;
        

        this.game.gameEntity = this.game.createEntityFromConfig('game', { gameConfig: this.config.configs.game }, {x: 0, y: 0, z: 0});
 
    }

    getProject() {
        return this.game.gameEntity;
    }

}