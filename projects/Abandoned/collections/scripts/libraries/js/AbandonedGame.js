/**
 * AbandonedGame - Minimal game class wrapper
 * Game logic is handled by AbandonedGameSystem
 */
class AbandonedGame extends GUTS.BaseECSGame {
    constructor(app) {
        super(app);
        this.gameInstance = this;

        // Check if running in headless mode
        this.isHeadless = app?.isHeadless || false;

        // Minimal state for systems to check
        this.state.gameOver = false;

        // Load settings for config
        this.settings = this.loadSettings();
    }

    /**
     * Override init to pass headless config when in headless mode
     */
    async init(isServer = false, config) {
        // In headless mode, explicitly pass the headless config
        if (this.isHeadless && !config) {
            const collections = this.getCollections();
            const headlessConfig = collections?.configs?.headless;
            if (headlessConfig) {
                return super.init(isServer, headlessConfig);
            }
        }
        return super.init(isServer, config);
    }

    loadSettings() {
        const defaults = {
            cardSpeed: 4000,
            refugeSlots: 6,
            damageThreshold: 10
        };
        try {
            const saved = localStorage.getItem('abandonedSettings');
            if (saved) {
                return { ...defaults, ...JSON.parse(saved) };
            }
        } catch (e) {
            // Silently ignore localStorage errors
        }
        return defaults;
    }

    getConfig() {
        const configs = this.getCollections()?.configs || {};
        // Only use headless config if actually in headless mode
        const baseConfig = this.isHeadless ? (configs.headless || {}) : (configs.game || {});
        return {
            ...baseConfig,
            animationSpeed: this.settings.cardSpeed,
            refugeSlots: this.settings.refugeSlots,
            damageThreshold: this.settings.damageThreshold
        };
    }
}
