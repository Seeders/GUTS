  init( {owner}) {
        this.ctx = this.game.ctx;
        const ownerStats = owner.getComponent("stats").stats;
        this.startOffsetY = ownerStats.projectileStartOffsetY || this.game.configs.game.GRID_SIZE / 2;
    }

    draw() {
        const projectile = this.parent.getComponent("ChainProjectile");
        if (!projectile || !projectile.chainTargets.length) return;

        this.ctx.strokeStyle = "rgba(0, 255, 255, 0.8)"; // Cyan lightning
        this.ctx.lineWidth = 2;
        let stats = this.parent.getComponent('stats').stats;
        // Start from Tesla Coil (parent position)
        let startPos = this.game.translator.pixelToIso(this.parent.position.x, this.parent.position.y);
        startPos.y -= this.startOffsetY;//dont shoot off the ground
        for (let i = 0; i < projectile.chainTargets.length; i++) {
            const target = projectile.chainTargets[i];
            if (!target || target.destroyed) continue;

            const endPos = this.game.translator.pixelToIso(target.position.x, target.position.y);
            this.drawLightning(startPos, endPos);

            // Next arc starts from this target
            startPos = endPos;
        }
    }

    drawLightning(startPos, endPos) {
        this.ctx.beginPath();            
        this.ctx.moveTo(startPos.x, startPos.y);

        const segments = 8; // Number of zigzag points
        const dx = (endPos.x - startPos.x) / segments;
        const dy = (endPos.y - startPos.y) / segments;

        let currentX = startPos.x;
        let currentY = startPos.y;

        for (let i = 1; i < segments; i++) {
            currentX += dx;
            currentY += dy;

            // Add random offset for jagged effect
            const offsetX = (Math.random() - 0.5) * 10; // Max 10px jitter
            const offsetY = (Math.random() - 0.5) * 10;

            this.ctx.lineTo(currentX + offsetX, currentY + offsetY);
        }

        this.ctx.lineTo(endPos.x, endPos.y);
        this.ctx.stroke();
    }