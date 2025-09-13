class EnergyShield extends engine.Component {

    init(){
        // Get stats component for reference
        let statsComp = this.parent.getComponent('stats');
        
        // Shield configuration with defaults
        this.maxEnergyShield = statsComp.stats.energyShield || 0;
        this.energyShield = this.maxEnergyShield || 0;
        this.rechargeRate = statsComp.stats.rechargeRate || 10; // Shield points per second
        this.rechargeDelay = statsComp.stats.rechargeDelay || 2000; // Milliseconds before recharge starts
        this.lastDamageTime = 0; // Timestamp of last damage taken
        
        // Add relevant stats to the stats component
        statsComp.addStat('maxEnergyShield', this.maxEnergyShield);
        statsComp.addStat('shieldRechargeRate', this.rechargeRate);
        statsComp.addStat('shieldRechargeDelay', this.rechargeDelay);
        
        // Visual settings
        this.shieldColor = 'rgba(77, 166, 255, 0.6)'; // Light blue default
        this.shieldEmptyColor = 'rgba(77, 166, 255, 0.2)';
        this.barWidth = 30;
        this.barHeight = 5;
        this.barOffset = 8; // Distance above health bar
    }
    
    /**
     * Handle incoming damage
     * @param {number} damage - Amount of incoming damage
     * @returns {Object} - Damage breakdown
     */
    absorbDamage(damage) {
        const result = {
            absorbedByShield: 0,
            remainingDamage: 0
        };
        
        // Reset recharge timer when taking damage
        this.lastDamageTime = this.game.state.now;
        
        if (this.energyShield > 0) {
            if (damage <= this.energyShield) {
                // Shield absorbs all damage
                result.absorbedByShield = damage;
                this.energyShield -= damage;
            } else {
                // Shield is depleted, remaining damage goes through
                result.absorbedByShield = this.energyShield;
                result.remainingDamage = damage - this.energyShield;
                this.energyShield = 0;
            }
        } else {
            // No shield available
            result.remainingDamage = damage;
        }
        
        return result;
    }
    
    /**
     * Update shield state (recharging)
     */
    update() {
        let statsComp = this.parent.getComponent('stats');
        this.maxEnergyShield = statsComp.stats.energyShield || 0;
        // Check if enough time has passed since last damage
        const timeSinceLastDamage = this.game.state.now - this.lastDamageTime;
        
        if (timeSinceLastDamage >= this.rechargeDelay && this.energyShield < this.maxEnergyShield) {
            // Calculate recharge amount based on time elapsed and rate
            const deltaTime = this.game.deltaTime || 16; // Fallback to 60fps if deltaTime not available
            const rechargeAmount = (this.rechargeRate * deltaTime) / 1000; // Convert to per-frame amount
            
            // Apply recharge
            this.energyShield = Math.min(this.maxEnergyShield, this.energyShield + rechargeAmount);
        }
    }
    
    /**
     * Draw shield bar
     */
    draw() {
        if (this.maxEnergyShield <= 0) return; // Don't draw if no shield capacity
        
        const shieldPercentage = this.energyShield / this.maxEnergyShield;        
        
        // Shield bar will be slightly above that
        const barY = this.parent.drawPosition.y - this.game.getCollections().configs.game.imageSize * .3 - this.barOffset;
        
        // Draw shield background/empty bar
        this.game.ctx.fillStyle = this.shieldEmptyColor;
        this.game.ctx.fillRect(this.parent.drawPosition.x - this.barWidth/2, barY, this.barWidth, this.barHeight);
        
        // Draw current shield level
        if (shieldPercentage > 0) {
            this.game.ctx.fillStyle = this.shieldColor;
            this.game.ctx.fillRect(
                this.parent.drawPosition.x - this.barWidth/2, 
                barY, 
                this.barWidth * shieldPercentage, 
                this.barHeight
            );
        }
        
        // Draw recharge indicator if currently recharging
        const timeSinceLastDamage = this.game.state.now - this.lastDamageTime;
        if (timeSinceLastDamage < this.rechargeDelay && this.energyShield < this.maxEnergyShield) {
            const rechargePercentage = timeSinceLastDamage / this.rechargeDelay;
            
            // Draw a small indicator below the shield bar
            this.game.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            this.game.ctx.fillRect(
                this.parent.drawPosition.x - this.barWidth/2, 
                barY + this.barHeight + 1, 
                this.barWidth * rechargePercentage, 
                2
            );
        }
    }
    
    /**
     * Get current shield value
     * @returns {number} Current shield amount
     */
    getShieldValue() {
        return this.energyShield;
    }
    
    /**
     * Reset shield to full
     */
    resetShield() {
        this.energyShield = this.maxEnergyShield;
    }
    
    /**
     * Temporarily boost shield capacity
     * @param {number} amount - Amount to boost by
     * @param {number} duration - Duration in milliseconds
     */
    boostShield(amount, duration) {
        const originalMax = this.maxEnergyShield;
        this.maxEnergyShield += amount;
        this.energyShield += amount;
        
        // Reset after duration
        setTimeout(() => {
            this.maxEnergyShield = originalMax;
            this.energyShield = Math.min(this.energyShield, this.maxEnergyShield);
        }, duration);
    }
}