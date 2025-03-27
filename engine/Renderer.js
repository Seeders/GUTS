import { Component } from "./Component.js";

class Renderer extends Component {
    init( {images, setDirection = -1}) {
        this.images = images;  
        this.setDirection = setDirection;
        this.currentDirection = 0; // Default direction (will be 0-7 now)
        // Rotated direction zones 45 degrees counter-clockwise
        // Each zone covers a 45-degree arc (π/4 radians)
        this.directionZones = [
            { min: Math.PI/8, max: 3*Math.PI/8 },     // 0: Down-Right (Southeast)
            { min: 3*Math.PI/8, max: 5*Math.PI/8 },   // 1: Down
            { min: 5*Math.PI/8, max: 7*Math.PI/8 },   // 2: Down-Left (Southwest)
            { min: 7*Math.PI/8, max: -7*Math.PI/8 },  // 3: Left (West)
            { min: -7*Math.PI/8, max: -5*Math.PI/8 }, // 4: Up-Left (Northwest)
            { min: -5*Math.PI/8, max: -3*Math.PI/8 }, // 5: Up
            { min: -3*Math.PI/8, max: -Math.PI/8 },   // 6: Up-Right (Northeast)
            { min: -Math.PI/8, max: Math.PI/8 }       // 7: Right (East)
        ];
    }
    
    draw() {
        if( this.setDirection < 0 ) {
            const dx = this.parent.position.x - this.parent.lastPosition.x; // Change in x
            const dy = this.parent.position.y - this.parent.lastPosition.y; // Change in y
            
            // Only update direction if there's movement
            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                // Calculate angle of movement in radians
                const angle = Math.atan2(dy, dx);
                
                // Determine which of the 8 directional zones the angle falls into
                for (let i = 0; i < this.directionZones.length; i++) {
                    const zone = this.directionZones[i];
                    
                    // Special handling for the West zone which wraps around from PI to -PI
                    if (i === 3) {
                        if (angle >= zone.min || angle <= zone.max) {
                            this.currentDirection = i;
                            break;
                        }
                    } 
                    // Normal zone check
                    else if (angle >= zone.min && angle < zone.max) {
                        this.currentDirection = i;
                        break;
                    }
                }
            }
        } else {
            this.currentDirection = this.setDirection;
        }

        
        // Draw the image for the current direction
        if (this.images && this.images.length > this.currentDirection) {
            const image = this.images[this.currentDirection];
            if (image) {
                const imgWidth = image.width;
                const imgHeight = image.height;
                
                const drawX = this.parent.drawPosition.x - imgWidth / 2;
                const drawY = this.parent.drawPosition.y - imgHeight / 2;
                
                this.game.ctx.drawImage(image, drawX, drawY);
            }
        }
    }
}

export { Renderer };