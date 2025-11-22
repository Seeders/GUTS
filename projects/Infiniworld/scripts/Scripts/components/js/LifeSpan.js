class LifeSpan extends GUTS.Component {

    
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