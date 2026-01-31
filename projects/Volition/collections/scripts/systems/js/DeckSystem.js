/**
 * DeckSystem - Creates and manages the 52-card deck
 */
class DeckSystem extends GUTS.BaseSystem {
    static services = ['createDeck', 'shuffleDeck', 'dealCard', 'getDeckCount'];

    constructor(game) {
        super(game);
        this.game.deckSystem = this;
        this.deckOrder = []; // Array of entity IDs in deck order (index 0 = top of deck)
    }

    init() {
        console.log('DeckSystem init called');
    }

    postAllInit() {
        console.log('DeckSystem postAllInit called');
        this.createDeck();
        this.shuffleDeck();
        console.log('DeckSystem: Deck created and shuffled, total cards:', this.deckOrder.length);
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

        console.log(`DeckSystem: Created ${this.deckOrder.length} cards`);
    }

    shuffleDeck() {
        // Fisher-Yates shuffle
        for (let i = this.deckOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
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
        // Update deck count display
        const deckCountEl = document.getElementById('deckCount');
        if (deckCountEl) {
            deckCountEl.textContent = this.getDeckCount();
        }
    }
}
