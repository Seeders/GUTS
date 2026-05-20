import CardDeckSystem from '../../../../../../global/collections/scripts/systems/js/CardDeckSystem.js';

/**
 * DeckSystem - Game-specific deck management for Volition
 * Extends CardDeckSystem to add game-specific UI updates and tutorial deck setup
 */
class DeckSystem extends CardDeckSystem {
    static services = [
        // Inherit all parent services
        ...CardDeckSystem.services,
        // Add Volition-specific services
        'resetDeck'
    ];

    constructor(game) {
        super(game);
    }

    postAllInit() {
        this.createStandardDeck({ location: 0 });

        if (this.game.systemsByName?.has('TutorialSystem')) {
            this.setupTutorialDeck();
        } else {
            this.shuffleDeck();
        }
    }

    onSceneLoad(sceneData, params) {
        const sceneName = this.game.sceneManager?.currentSceneName;
        if (sceneName === 'game') {
            this.resetDeck();
            this.shuffleDeck();
        }
    }

    resetDeck() {
        this.returnAllToDeck();
    }

    /**
     * Set up a fixed deck order for the tutorial
     */
    setupTutorialDeck() {
        // Suits: 0=hearts, 1=diamonds, 2=clubs, 3=spades
        const tutorialSequence = [
            // Field cards (first 6, dealt to columns 0-5) - ALL RED
            this.findCard(0, 1),   // Col 0: Ace of Hearts
            this.findCard(0, 9),   // Col 1: 9 of Hearts
            this.findCard(1, 7),   // Col 2: 7 of Diamonds
            this.findCard(0, 5),   // Col 3: 5 of Hearts
            this.findCard(1, 3),   // Col 4: 3 of Diamonds
            this.findCard(0, 2),   // Col 5: 2 of Hearts
            // Hand cards (next 5) - ALL RED
            this.findCard(0, 8),   // 8 of Hearts
            this.findCard(0, 6),   // 6 of Hearts
            this.findCard(1, 4),   // 4 of Diamonds
            this.findCard(0, 10),  // 10 of Hearts
            this.findCard(1, 13),  // King of Diamonds
            // Draw cards
            this.findCard(1, 12),  // Queen of Diamonds
            this.findCard(0, 4),   // 4 of Hearts
            this.findCard(1, 6),   // 6 of Diamonds
        ].filter(eid => eid != null);

        this.moveToFront(tutorialSequence);
    }

    update() {
        const config = this.game.getConfig?.() || {};
        if (config.isHeadless) return;

        const count = this.getDeckCount();

        const deckCountEl = document.getElementById('deckCount');
        if (deckCountEl) {
            deckCountEl.textContent = count;
        }

        this.updateDeckVisual(count);
    }

    updateDeckVisual(count) {
        const deckVisual = document.getElementById('deckVisual');
        if (!deckVisual) return;

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
