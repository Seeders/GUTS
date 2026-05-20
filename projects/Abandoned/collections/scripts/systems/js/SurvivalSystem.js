/**
 * SurvivalSystem - Checks win/loss conditions for the Abandoned survival game
 * Win: Survive until the Night Deck is empty
 * Lose: Damage exceeds threshold
 */
class SurvivalSystem extends GUTS.BaseSystem {
    static services = ['checkGameEnd', 'isGameWon', 'isGameLost', 'showSurvivalScreen', 'showDeathScreen'];
    static serviceDependencies = ['getDeckCount', 'isAlive', 'getCurrentDamage', 'getDamageThreshold', 'playVictory', 'playDeath'];

    constructor(game) {
        super(game);
        this.gameEnded = false;
        this.won = false;
    }

    init() {
        this.gameEnded = false;
        this.won = false;
    }

    /**
     * Check if the game has ended (win or loss)
     * @returns {string|null} - 'won', 'lost', or null if game continues
     */
    checkGameEnd() {
        if (this.gameEnded) {
            return this.won ? 'won' : 'lost';
        }

        // Check loss condition: player is dead
        if (!this.call.isAlive()) {
            this.gameEnded = true;
            this.won = false;
            this.showDeathScreen();
            return 'lost';
        }

        // Check win condition: deck is empty and player is alive
        const deckCount = this.call.getDeckCount();
        if (deckCount <= 0 && this.call.isAlive()) {
            this.gameEnded = true;
            this.won = true;
            this.showSurvivalScreen();
            return 'won';
        }

        return null;
    }

    /**
     * Check if game was won
     */
    isGameWon() {
        return this.gameEnded && this.won;
    }

    /**
     * Check if game was lost
     */
    isGameLost() {
        return this.gameEnded && !this.won;
    }

    /**
     * Show the survival (win) screen
     */
    showSurvivalScreen() {
        // Skip DOM updates in headless mode
        const config = this.game.gameInstance?.getConfig() || {};
        if (config.isHeadless) {
            this.game.triggerEvent('onGameWon', { damage: this.call.getCurrentDamage() });
            return;
        }

        // Play victory sound
        this.call.playVictory?.();

        const overlay = document.getElementById('survivalOverlay');
        const finalDamage = document.getElementById('finalDamage');
        const finalTurns = document.getElementById('finalTurns');

        if (overlay) {
            overlay.classList.remove('hidden');
        }

        if (finalDamage) {
            const damage = this.call.getCurrentDamage();
            const threshold = this.call.getDamageThreshold();
            finalDamage.textContent = `${damage}/${threshold}`;
        }

        if (finalTurns) {
            // Get turn count from game state
            const turnCounter = document.getElementById('turnCounter');
            if (turnCounter) {
                finalTurns.textContent = turnCounter.textContent.replace('Turn ', '');
            }
        }

        // Update game state
        if (this.game.gameInstance) {
            this.game.gameInstance.state.gameOver = true;
        }

        this.game.triggerEvent('onGameWon', { damage: this.call.getCurrentDamage() });
    }

    /**
     * Show the death (loss) screen
     */
    showDeathScreen() {
        // Skip DOM updates in headless mode
        const config = this.game.gameInstance?.getConfig() || {};
        if (config.isHeadless) {
            this.game.triggerEvent('onPlayerDeath', { damage: this.call.getCurrentDamage() });
            return;
        }

        // Play death sound
        this.call.playDeath?.();

        const overlay = document.getElementById('deathOverlay');
        const survivalTurns = document.getElementById('survivalTurns');

        if (overlay) {
            overlay.classList.remove('hidden');
        }

        if (survivalTurns) {
            // Get turn count from game state
            const turnCounter = document.getElementById('turnCounter');
            if (turnCounter) {
                survivalTurns.textContent = turnCounter.textContent.replace('Turn ', '');
            }
        }

        // Update game state
        if (this.game.gameInstance) {
            this.game.gameInstance.state.gameOver = true;
        }

        this.game.triggerEvent('onPlayerDeath', { damage: this.call.getCurrentDamage() });
    }

    /**
     * React to player death event (from DamageSystem)
     */
    onPlayerDeath(data) {
        if (!this.gameEnded) {
            this.gameEnded = true;
            this.won = false;
            this.showDeathScreen();
        }
    }
}
