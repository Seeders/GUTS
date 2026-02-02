/**
 * DeckSystem - Creates and manages the 52-card deck
 */
class DeckSystem extends GUTS.BaseSystem {
    static services = ['createDeck', 'shuffleDeck', 'dealCard', 'getDeckCount', 'setSeed'];

    constructor(game) {
        super(game);
        this.deckOrder = []; // Array of entity IDs in deck order (index 0 = top of deck)
        this.seed = null; // Optional seed for reproducible shuffles
    }

    /**
     * Set seed for reproducible shuffles (headless mode)
     */
    setSeed(seed) {
        this.seed = seed;
    }

    init() {
    }

    postAllInit() {
        this.createDeck();

        // Use fixed deck if TutorialSystem is present (tutorial scene only)
        if (this.game.systemsByName?.has('TutorialSystem')) {
            this.setupTutorialDeck();
        } else {
            this.shuffleDeck();
        }
    }

    onSceneLoad(sceneData, params) {
        // sceneData is the full scene object, get name from sceneManager
        const sceneName = this.game.sceneManager?.currentSceneName;
        console.log('[DeckSystem] onSceneLoad called, sceneName:', sceneName);
        // When game scene loads (e.g., from tutorial), reset all cards to deck and shuffle
        if (sceneName === 'game') {
            console.log('[DeckSystem] Resetting deck...');
            this.resetDeck();
            console.log('[DeckSystem] Shuffling deck...');
            this.shuffleDeck();
            console.log('[DeckSystem] Deck ready, count:', this.getDeckCount());
        }
    }

    /**
     * Return all cards to the deck
     */
    resetDeck() {
        const allCards = this.game.getEntitiesWith('card', 'cardLocation');
        for (const eid of allCards) {
            const loc = this.game.getComponent(eid, 'cardLocation');
            const card = this.game.getComponent(eid, 'card');
            loc.location = 0; // deck
            loc.index = 0;
            loc.columnIndex = -1;
            card.faceUp = 0;
        }
        // Rebuild deck order
        this.deckOrder = [...allCards];
    }

    /**
     * Set up a fixed deck order for the tutorial
     * Creates a fully controlled scenario:
     *
     * Field cards (first 6 dealt to columns 0-5) - ALL RED so no stacking possible:
     * - Column 0: Ace of Hearts (red) - user plays to kingdom, leaves empty column
     * - Column 1: 9 of Hearts (red) - discard target
     * - Column 2: 7 of Diamonds (red)
     * - Column 3: 5 of Hearts (red)
     * - Column 4: 3 of Diamonds (red)
     * - Column 5: 2 of Hearts (red)
     *
     * Hand cards (next 5 dealt) - ALL RED so can't stack on red field:
     * - 8 of Hearts: plays to empty col 0 after Ace removed
     * - 6 of Hearts: can't stack (red on red)
     * - 4 of Diamonds: can't stack (red on red)
     * - 10 of Hearts: can't stack (red on red)
     * - King of Diamonds: can't stack (red on red)
     *
     * After Ace played to kingdom and 8♥ played to empty column:
     * - No valid moves remain (all red cards)
     * - When user draws with full hand, 6♥ discards to col 1 (9♥)
     * - Red on red = invalid placement, demonstrating discards ignore rules
     */
    setupTutorialDeck() {
        const findCard = (suit, rank) => {
            return this.deckOrder.find(eid => {
                const card = this.game.getComponent(eid, 'card');
                return card.suit === suit && card.rank === rank;
            });
        };

        // Suits: 0=hearts, 1=diamonds, 2=clubs, 3=spades
        const tutorialSequence = [
            // Field cards (first 6, dealt to columns 0-5) - ALL RED
            findCard(0, 1),   // Col 0: Ace of Hearts (red) - user plays to kingdom
            findCard(0, 9),   // Col 1: 9 of Hearts (red) - discard target
            findCard(1, 7),   // Col 2: 7 of Diamonds (red)
            findCard(0, 5),   // Col 3: 5 of Hearts (red)
            findCard(1, 3),   // Col 4: 3 of Diamonds (red)
            findCard(0, 2),   // Col 5: 2 of Hearts (red)
            // Hand cards (next 5) - ALL RED, can't stack on red field
            findCard(0, 8),   // 8 of Hearts - plays to empty col 0
            findCard(0, 6),   // 6 of Hearts (can't stack)
            findCard(1, 4),   // 4 of Diamonds (can't stack)
            findCard(0, 10),  // 10 of Hearts (can't stack)
            findCard(1, 13),  // King of Diamonds (can't stack)
            // Draw cards (used to fill hand before discard demonstration)
            findCard(1, 12),  // Queen of Diamonds
            findCard(0, 4),   // 4 of Hearts
            findCard(1, 6),   // 6 of Diamonds
        ];

        // Remove these from deck
        for (const eid of tutorialSequence) {
            if (eid) {
                const idx = this.deckOrder.indexOf(eid);
                if (idx > -1) {
                    this.deckOrder.splice(idx, 1);
                }
            }
        }

        // Add tutorial sequence to front (they'll be dealt/drawn in order)
        this.deckOrder = [...tutorialSequence.filter(e => e), ...this.deckOrder];

        // Update indices
        this.deckOrder.forEach((eid, idx) => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            loc.index = idx;
        });
    }

    createDeck() {
        // Create 52 cards (4 suits x 13 ranks)
        // Suits: 0=hearts, 1=diamonds, 2=clubs, 3=spades
        // Ranks: 1=Ace, 2-10, 11=Jack, 12=Queen, 13=King
        for (let suit = 0; suit < 4; suit++) {
            for (let rank = 1; rank <= 13; rank++) {
                const entityId = this.game.createEntity();

                this.game.addComponent(entityId, 'card', {
                    suit: suit,
                    rank: rank,
                    faceUp: 0
                });

                this.game.addComponent(entityId, 'cardLocation', {
                    location: 0, // deck
                    index: this.deckOrder.length,
                    columnIndex: -1
                });

                this.game.addComponent(entityId, 'cardVisual', {
                    x: -100,
                    y: -100,
                    targetX: -100,
                    targetY: -100,
                    zIndex: 0,
                    animating: 0
                });

                this.game.addComponent(entityId, 'draggable', {
                    isDragging: 0,
                    offsetX: 0,
                    offsetY: 0
                });

                this.deckOrder.push(entityId);
            }
        }
    }

    shuffleDeck(seed = null) {
        // Use provided seed, instance seed, or random
        const useSeed = seed !== null ? seed : this.seed;

        // Create random function (seeded or Math.random)
        let random;
        if (useSeed !== null && this.game.gameInstance?.seededRandom) {
            // Use SeededRandom library if available
            this.game.gameInstance.seededRandom.seed(useSeed);
            random = () => this.game.gameInstance.seededRandom.random();
        } else if (useSeed !== null) {
            // Simple seeded random fallback (mulberry32)
            let state = useSeed;
            random = () => {
                state |= 0;
                state = state + 0x6D2B79F5 | 0;
                let t = Math.imul(state ^ state >>> 15, 1 | state);
                t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            };
        } else {
            random = Math.random;
        }

        // Fisher-Yates shuffle
        for (let i = this.deckOrder.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [this.deckOrder[i], this.deckOrder[j]] = [this.deckOrder[j], this.deckOrder[i]];
        }

        // Update indices
        this.deckOrder.forEach((eid, idx) => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            loc.index = idx;
        });
    }

    dealCard() {
        // Get cards still in deck
        const deckCards = this.deckOrder.filter(eid => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            return loc.location === 0;
        });

        if (deckCards.length === 0) {
            return null;
        }

        // Deal from top of deck (first in deckOrder that's still in deck)
        const cardEid = deckCards[0];
        const card = this.game.getComponent(cardEid, 'card');
        card.faceUp = 1;

        return cardEid;
    }

    returnToDeck(cardEid) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const card = this.game.getComponent(cardEid, 'card');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Put back in deck
        loc.location = 0;
        loc.columnIndex = -1;
        card.faceUp = 0;

        // Move to end of deck order (bottom of deck)
        const idx = this.deckOrder.indexOf(cardEid);
        if (idx > -1) {
            this.deckOrder.splice(idx, 1);
        }
        this.deckOrder.push(cardEid);

        // Update all deck indices
        this.deckOrder.forEach((eid, i) => {
            const l = this.game.getComponent(eid, 'cardLocation');
            if (l.location === 0) {
                l.index = i;
            }
        });

        // Move card off screen
        visual.targetX = -100;
        visual.targetY = -100;
        visual.animating = 1;
    }

    getDeckCount() {
        return this.deckOrder.filter(eid => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            return loc.location === 0;
        }).length;
    }

    update() {
        // Skip DOM updates in headless mode
        const config = this.game.gameInstance?.getConfig() || {};
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
        // 6 layers, each represents ~9 cards (52/6 ≈ 9)
        const layers = deckVisual.querySelectorAll('.deck-card');
        const cardsPerLayer = 52 / layers.length;

        layers.forEach((layer, idx) => {
            // Layer 0 is on top (shows when any cards remain)
            // Layer 5 is bottom (shows only when many cards remain)
            const layerIndex = layers.length - 1 - idx; // Reverse: 5,4,3,2,1,0
            const threshold = Math.ceil((layerIndex) * cardsPerLayer);

            if (count > threshold) {
                layer.style.opacity = '1';
                layer.style.transform = 'scale(1)';
            } else {
                layer.style.opacity = '0';
                layer.style.transform = 'scale(0.95)';
            }
        });

        // Mark as empty when no cards left
        if (count === 0) {
            deckVisual.classList.add('empty');
        } else {
            deckVisual.classList.remove('empty');
        }
    }
}
