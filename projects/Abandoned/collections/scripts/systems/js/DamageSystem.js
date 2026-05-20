/**
 * DamageSystem - Tracks player damage state
 * Handles damage, healing, and death detection
 */
class DamageSystem extends GUTS.BaseSystem {
    static services = ['takeDamage', 'healDamage', 'getCurrentDamage', 'getDamageThreshold', 'isAlive', 'resetDamage'];

    constructor(game) {
        super(game);
        this.damage = 0;
        this.threshold = 10; // Default, will be overridden by config
    }

    init() {
        // Get threshold from config
        const config = this.game.gameInstance?.getConfig() || {};
        this.threshold = config.damageThreshold || 10;
        this.damage = 0;
    }

    /**
     * Reset damage to 0 (for new game)
     */
    resetDamage() {
        this.damage = 0;
        this.updateDamageDisplay();
    }

    /**
     * Take damage
     * @param {number} amount - Amount of damage to take
     * @returns {boolean} - True if player died from this damage
     */
    takeDamage(amount) {
        if (amount <= 0) return false;

        this.damage += amount;
        this.game.triggerEvent('onDamageTaken', { amount, total: this.damage });
        this.updateDamageDisplay();

        if (this.damage >= this.threshold) {
            this.game.triggerEvent('onPlayerDeath', { damage: this.damage });
            return true;
        }

        return false;
    }

    /**
     * Heal damage
     * @param {number} amount - Amount to heal
     * @returns {number} - Amount actually healed
     */
    healDamage(amount) {
        if (amount <= 0) return 0;

        const actualHeal = Math.min(amount, this.damage);
        this.damage = Math.max(0, this.damage - amount);

        if (actualHeal > 0) {
            this.game.triggerEvent('onDamageHealed', { amount: actualHeal, total: this.damage });
        }

        this.updateDamageDisplay();
        return actualHeal;
    }

    /**
     * Get current damage
     */
    getCurrentDamage() {
        return this.damage;
    }

    /**
     * Get damage threshold (max damage before death)
     */
    getDamageThreshold() {
        return this.threshold;
    }

    /**
     * Check if player is still alive
     */
    isAlive() {
        return this.damage < this.threshold;
    }

    /**
     * Update the damage display in the UI
     */
    updateDamageDisplay() {
        // Skip DOM updates in headless mode
        const config = this.game.gameInstance?.getConfig() || {};
        if (config.isHeadless) return;

        const damageFill = document.getElementById('damageFill');
        const damageAmount = document.getElementById('damageAmount');

        if (damageFill) {
            const percent = Math.min(100, (this.damage / this.threshold) * 100);
            damageFill.style.width = `${percent}%`;

            // Change color based on danger level
            if (percent >= 80) {
                damageFill.classList.add('critical');
                damageFill.classList.remove('warning');
            } else if (percent >= 50) {
                damageFill.classList.add('warning');
                damageFill.classList.remove('critical');
            } else {
                damageFill.classList.remove('warning', 'critical');
            }
        }

        if (damageAmount) {
            damageAmount.textContent = `${this.damage}/${this.threshold}`;
        }
    }

    update() {
        // Damage display is updated on damage/heal events
    }
}
