import CardDeckSystem from '../../../../../../global/collections/scripts/systems/js/CardDeckSystem.js';

/**
 * DeckSystem - Game-specific deck management for Abandoned
 * Extends CardDeckSystem to add game-specific UI updates (deck visual, count display)
 */
class DeckSystem extends CardDeckSystem {
    static services = [
        // Inherit all parent services
        ...CardDeckSystem.services,
        // Add Abandoned-specific services
        'resetDeck'
    ];

    constructor(game) {
        super(game);
    }

    postAllInit() {
        // Create and shuffle deck at game start
        this.createStandardDeck({ location: 0 });
        this.shuffleDeck();
    }

    /**
     * Reset deck - return all cards to deck
     */
    resetDeck() {
        this.returnAllToDeck();
    }

    update() {
        // Skip DOM updates in headless mode
        const config = this.game.getConfig?.() || {};
        if (config.isHeadless) return;

        const count = this.getDeckCount();

        // Update deck count display in header
        const deckCountEl = document.getElementById('deckCount');
        if (deckCountEl) {
            deckCountEl.textContent = count;
        }

        // Update deck visual layers
        this.updateDeckVisual(count);
    }

    updateDeckVisual(count) {
        const deckVisual = document.getElementById('deckVisual');
        if (!deckVisual) return;

        // Show/hide layers based on remaining cards
        const layers = deckVisual.querySelectorAll('.deck-card');
        const cardsPerLayer = 52 / layers.length;

        layers.forEach((layer, idx) => {
            const layerIndex = layers.length - 1 - idx;
            const threshold = Math.ceil((layerIndex) * cardsPerLayer);

            if (count > threshold) {
                layer.style.opacity = '1';
                layer.style.transform = 'scale(1)';
            } else {
                layer.style.opacity = '0';
                layer.style.transform = 'scale(0.95)';
            }
        });

        if (count === 0) {
            deckVisual.classList.add('empty');
        } else {
            deckVisual.classList.remove('empty');
        }
    }
}

export default DeckSystem;
