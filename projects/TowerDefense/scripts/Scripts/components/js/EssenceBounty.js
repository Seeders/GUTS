class EssenceBounty extends GUTS.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
    init(){
        this.statsComp = this.parent.getComponent('stats');
    }
    destroy() {               
        this.game.state.essence += this.statsComp.stats.essence * this.game.state.stats.essenceMultiplier;        
    }
}