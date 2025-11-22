class SpacialGridEntity extends GUTS.Component {
    
   update() {
        this.game.spatialGrid.insert(this.parent);
    }
    destroy() {
        this.game.spatialGrid.remove(this.parent);
    }
}