class RangeIndicator extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
    init() {
        this.ctx = this.game.ctx;
        this.translator = this.game.translator; // Access translator for tileWidth
    }

    draw() {
        let statsComp = this.getComponent('stats');
        if (!statsComp || !statsComp.stats || !statsComp.stats.range) {
            return;
        }
        this.drawRangeIndicator(statsComp.stats.range);
    }

    drawRangeIndicator(range) {    
        const drawRage = range;        
        const pixelX = this.parent.position.x;
        const pixelY = this.parent.position.y;
        let gridPos = this.translator.pixelToGrid(pixelX, pixelY);
        gridPos = this.translator.snapToGrid(gridPos.x, gridPos.y);
        const isoPos = this.translator.pixelToIso(pixelX, pixelY);
    
        let isoRangeX = drawRage * this.game.config.configs.game.gridSize;  // Matches gridToIso X scaling
        let isoRangeY = drawRage * this.game.config.configs.game.gridSize * (this.game.state.isometric ? 0.5 : 1); // Matches gridToIso Y scaling
    
        if( this.game.state.isometric ) {
            isoRangeX *= .56;
            isoRangeY *= .56;
        }

        if (gridPos.x === this.game.state.mousePosition.gridX && gridPos.y === this.game.state.mousePosition.gridY) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            this.ctx.lineWidth = 2;
    
            this.ctx.ellipse(
                isoPos.x,
                isoPos.y,
                isoRangeX,
                isoRangeY,
                0,
                0,
                2 * Math.PI
            );
    
            this.ctx.stroke();
            this.ctx.closePath();
            this.ctx.restore();
        }    
      
    }
}