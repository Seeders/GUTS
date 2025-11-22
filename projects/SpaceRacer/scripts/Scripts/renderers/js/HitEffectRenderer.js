class HitEffectRenderer extends GUTS.Component {
    
    
    init( ) {
        this.ctx = this.game.ctx;
    }

    draw() {
        const particleComp = this.parent.getComponent("HitEffectParticle");
        if (!particleComp || !particleComp.particles.length) return;

        const basePos = this.game.translator.pixelToIso(this.parent.transform.position.x, this.parent.transform.position.y);

        for (let particle of particleComp.particles) {
            this.ctx.fillStyle = `${particle.color}${particle.alpha})`;
            this.ctx.beginPath();
            const drawX = basePos.x + particle.x;
            const drawY = basePos.y + particle.y;
            this.ctx.arc(drawX, drawY, particle.size, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }
}