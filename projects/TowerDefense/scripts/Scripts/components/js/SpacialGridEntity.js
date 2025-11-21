class SpacialGridEntity extends GUTS.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
   update() {
        this.game.spatialGrid.insert(this.parent);
    }
    destroy() {
        this.game.spatialGrid.remove(this.parent);
    }
}