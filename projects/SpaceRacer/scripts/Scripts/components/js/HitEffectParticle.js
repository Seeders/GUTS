class HitEffectParticle extends GUTS.Component {
    
  init( {damageType}) {
        this.damageType = damageType || "default";
        this.particles = [];
        
        // Spawn particles based on damage type
        const particleCount = 5;
        for (let i = 0; i < particleCount; i++) {
            this.particles.push({
                x: 0, // Relative to parent
                y: 0,
                vx: (Math.random() - 0.5) * 4, // Velocity (-2 to 2)
                vy: (Math.random() - 0.5) * 4,
                size: Math.random() * 3 + 1, // 1-4 pixels
                alpha: 1, // Fades from 1 to 0
                color: this.getColor()
            });
        }
    }

    getColor() {
        switch (this.damageType) {
            case "electric": return "rgba(0, 255, 255, "; // Cyan for electric
            case "fire": return "rgba(255, 165, 0, "; // Orange for fire
            case "ice": return "rgba(128, 128, 255, "; // Blue for ice
            case "plasma": return "rgba(255, 0, 255, "; // Purple for plasma
            default: return "rgba(255, 255, 255, "; // White fallback
        }
    }

    update() {
        const lifespanComp = this.parent.getComponent("LifeSpan");
        if (!lifespanComp) return; // Safety check

        const fadeFactor = lifespanComp.lifeSpan / 30; // Normalize to initial lifespan (30 frames)
        for (let particle of this.particles) {
            particle.x += particle.vx * this.game.state.timeScale;
            particle.y += particle.vy * this.game.state.timeScale;
            particle.alpha = fadeFactor; // Fade based on remaining lifespan
            particle.size *= 0.98; // Slight shrink per frame
        }
    }
}