class Explosion extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
   init( {radius}) {
        this.maxRadius = radius * this.game.config.configs.game.gridSize / 2;
        this.currentRadius = 0;
        this.alpha = 1;
    }

    update() {
        this.currentRadius += this.maxRadius * 0.1;
        this.alpha -= 0.05;
        if( this.alpha < 0 ) {
            this.parent.destroy();
        }
    }

    draw() {
        const pixelX = this.parent.position.x;
        const pixelY = this.parent.position.y;

        // Convert pixel to isometric
        const isoPos = this.game.translator.pixelToIso(pixelX, pixelY);
        const isoRadiusX = this.currentRadius;         // X-axis range remains roughly the same in isometric space
        const isoRadiusY = this.currentRadius * 0.5;   // Y-axis range is halved due to isometric compression

        this.game.ctx.beginPath();
        this.game.ctx.ellipse(
                isoPos.x,           // Center x in isometric coords
                isoPos.y,           // Center y in isometric coords
                isoRadiusX,          // X radius (wider due to isometric projection)
                isoRadiusY,          // Y radius (shorter due to flattening)
                0,                  // Rotation (none needed for isometric)
                0,                  // Start angle
                2 * Math.PI         // End angle (full circle)
            );
        this.game.ctx.fillStyle = `rgba(255, 200, 0, ${this.alpha * 0.5})`;
        this.game.ctx.fill();

        this.game.ctx.beginPath();
        this.game.ctx.ellipse(
                isoPos.x,           // Center x in isometric coords
                isoPos.y,           // Center y in isometric coords
                isoRadiusX * .7,          // X radius (wider due to isometric projection)
                isoRadiusY * .7,          // Y radius (shorter due to flattening)
                0,                  // Rotation (none needed for isometric)
                0,                  // Start angle
                2 * Math.PI         // End angle (full circle)
            );
        this.game.ctx.fillStyle = `rgba(255, 100, 0, ${this.alpha})`;
        this.game.ctx.fill();
    
    }
}