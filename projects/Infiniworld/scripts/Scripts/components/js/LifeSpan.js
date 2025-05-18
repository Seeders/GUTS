class LifeSpan extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
    init( {lifeSpan}) {
        this.lifeSpan = lifeSpan || this.getComponent('stats').stats.lifeSpan;
    }
    update() {        
        if( this.lifeSpan > 0 ) {
            this.lifeSpan -= this.game.deltaTime;
        } else {
            this.parent.destroy();
        }
    }
}