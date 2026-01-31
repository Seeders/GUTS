/**
 * VolitionGame - Minimal game class wrapper
 * Game logic is handled by VolitionGameSystem
 */
class VolitionGame extends GUTS.BaseECSGame {
    constructor(app) {
        super(app);
        this.gameInstance = this;

        // Minimal state for systems to check
        this.state.gameOver = false;

        // Load settings for config
        this.settings = this.loadSettings();
    }

    loadSettings() {
        const defaults = {
            cardSpeed: 4000,
            tableauColumns: 6
        };
        try {
            const saved = localStorage.getItem('volitionSettings');
            if (saved) {
                return { ...defaults, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
        return defaults;
    }

    getConfig() {
        const baseConfig = this.getCollections()?.configs?.game || {};
        return {
            ...baseConfig,
            animationSpeed: this.settings.cardSpeed,
            tableauColumns: this.settings.tableauColumns
        };
    }
}
