/**
 * NarratorSystem - Provides atmospheric narration for the Abandoned survival game
 * Replaces HarbingerSystem from Volition with survival-themed messages
 */
class NarratorSystem extends GUTS.BaseSystem {
    static services = ['showNarration', 'hideNarration'];

    constructor(game) {
        super(game);
        this.isShowing = false;
        this.hideTimeout = null;

        // Narration messages by event type
        this.narrations = {
            threatAppeared: [
                "The night grows darker...",
                "Another shadow emerges.",
                "Danger approaches.",
                "The cold creeps closer.",
                "Something stirs in the darkness."
            ],
            multipleThreats: [
                "They're closing in...",
                "The night is relentless.",
                "Surrounded by shadows.",
                "Too many to count..."
            ],
            damageTaken: [
                "The cold bites deep.",
                "You can't hold out forever.",
                "Pain reminds you: this is real.",
                "Every wound tells a story."
            ],
            healed: [
                "A moment of respite.",
                "Warmth returns, if only briefly.",
                "Not dead yet.",
                "Life persists."
            ],
            threatDefeated: [
                "One less shadow.",
                "The night recedes slightly.",
                "A small victory.",
                "Keep fighting."
            ],
            survival: [
                "Dawn breaks. You survived.",
                "Against all odds... you made it.",
                "The longest night is over.",
                "You are not forgotten."
            ],
            death: [
                "The night claims another.",
                "Abandoned... and lost.",
                "Even the strongest fall.",
                "Rest now. The struggle is over."
            ],
            lowDeck: [
                "Dawn approaches...",
                "Almost there. Hold on.",
                "The night is nearly spent."
            ]
        };
    }

    init() {
    }

    postAllInit() {
        // Narration is event-driven
    }

    /**
     * Show a narration message
     * @param {string} text - Message to display
     * @param {number} duration - How long to show (ms)
     */
    showNarration(text, duration = 3000) {
        // Skip DOM updates in headless mode
        const config = this.game.gameInstance?.getConfig() || {};
        if (config.isHeadless) return;

        const overlay = document.getElementById('narratorOverlay');
        const message = document.getElementById('narratorMessage');

        if (!overlay || !message) return;

        // Clear any existing timeout
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }

        message.textContent = text;
        overlay.classList.remove('hidden');
        this.isShowing = true;

        // Auto-hide after duration
        this.hideTimeout = setTimeout(() => {
            this.hideNarration();
        }, duration);
    }

    /**
     * Hide the narration overlay
     */
    hideNarration() {
        const overlay = document.getElementById('narratorOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
        this.isShowing = false;
    }

    /**
     * Get a random message from a category
     */
    getRandomMessage(category) {
        const messages = this.narrations[category];
        if (!messages || messages.length === 0) return null;
        return messages[Math.floor(Math.random() * messages.length)];
    }

    // Event handlers

    onThreatAppeared(data) {
        if (data.threatCount >= 3) {
            this.showNarration(this.getRandomMessage('multipleThreats'));
        } else {
            // Only show threat message sometimes to avoid spam
            if (Math.random() < 0.4) {
                this.showNarration(this.getRandomMessage('threatAppeared'));
            }
        }
    }

    onDamageTaken(data) {
        this.showNarration(this.getRandomMessage('damageTaken'));
    }

    onDamageHealed(data) {
        if (Math.random() < 0.5) {
            this.showNarration(this.getRandomMessage('healed'));
        }
    }

    onThreatResolved(data) {
        if (Math.random() < 0.3) {
            this.showNarration(this.getRandomMessage('threatDefeated'));
        }
    }

    onGameWon(data) {
        this.showNarration(this.getRandomMessage('survival'), 5000);
    }

    onPlayerDeath(data) {
        this.showNarration(this.getRandomMessage('death'), 5000);
    }

    update() {
        // Check for low deck to show suspense messages
        // This could be called from game system instead
    }
}
