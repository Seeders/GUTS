/**
 * CardDeckSystem - Global system for creating and managing standard playing card decks
 *
 * Provides core deck operations:
 * - Create standard 52-card deck (or custom deck configurations)
 * - Shuffle with optional seeding for reproducibility
 * - Deal cards from deck
 * - Return cards to deck
 * - Query deck state
 *
 * Games should extend this with game-specific location handling.
 */
class CardDeckSystem extends GUTS.BaseSystem {
    static services = [
        'createStandardDeck', 'createDeck', 'shuffleDeck',
        'dealCard', 'dealCards', 'returnToDeck', 'returnAllToDeck',
        'getDeckCount', 'getDeckCards', 'getDeckOrder', 'getAllCards',
        'getCardsBySuit', 'getCardsByRank', 'findCard', 'findCards',
        'setDeckOrder', 'moveToFront', 'setSeed', 'getCard'
    ];

    constructor(game) {
        super(game);
        this.deckOrder = []; // Array of entity IDs in deck order (index 0 = top)
        this.allCards = []; // All created card entities
        this.seed = null;
        this.deckLocation = 0; // Default location value for "in deck"

        // Card component defaults
        this.cardComponents = ['card', 'cardVisual', 'draggable'];
    }

    init() {
        const config = this.game.getConfig?.() || {};
        this.deckLocation = config.deckLocation ?? 0;
    }

    /**
     * Set seed for reproducible shuffles
     * @param {number} seed - Seed value
     */
    setSeed(seed) {
        this.seed = seed;
    }

    /**
     * Create a standard 52-card deck
     * Suits: 0=hearts, 1=diamonds, 2=clubs, 3=spades
     * Ranks: 1=Ace through 13=King
     * @param {Object} options - Optional configuration
     * @param {boolean} options.includeJokers - Include 2 jokers (default false)
     * @param {number} options.location - Initial location value (default 0)
     * @returns {number[]} Array of created card entity IDs
     */
    createStandardDeck(options = {}) {
        const { includeJokers = false, location = this.deckLocation } = options;

        this.deckOrder = [];
        this.allCards = [];

        // Create 52 standard cards
        for (let suit = 0; suit < 4; suit++) {
            for (let rank = 1; rank <= 13; rank++) {
                const eid = this.createCardEntity(suit, rank, location);
                this.deckOrder.push(eid);
                this.allCards.push(eid);
            }
        }

        // Optionally add jokers (suit = 4, rank = 0 for jokers)
        if (includeJokers) {
            for (let i = 0; i < 2; i++) {
                const eid = this.createCardEntity(4, 0, location);
                this.deckOrder.push(eid);
                this.allCards.push(eid);
            }
        }

        return this.allCards;
    }

    /**
     * Create a custom deck with specified cards
     * @param {Array<{suit: number, rank: number}>} cards - Array of card definitions
     * @param {number} location - Initial location value
     * @returns {number[]} Array of created card entity IDs
     */
    createDeck(cards, location = this.deckLocation) {
        this.deckOrder = [];
        this.allCards = [];

        for (const cardDef of cards) {
            const eid = this.createCardEntity(cardDef.suit, cardDef.rank, location);
            this.deckOrder.push(eid);
            this.allCards.push(eid);
        }

        return this.allCards;
    }

    /**
     * Create a single card entity with all required components
     * @param {number} suit - Suit value (0-3 standard, 4 for joker)
     * @param {number} rank - Rank value (1-13 standard, 0 for joker)
     * @param {number} location - Location value
     * @returns {number} Entity ID
     */
    createCardEntity(suit, rank, location) {
        const eid = this.game.createEntity();

        this.game.addComponent(eid, 'card', {
            suit: suit,
            rank: rank,
            faceUp: 0
        });

        this.game.addComponent(eid, 'cardVisual', {
            x: -100,
            y: -100,
            targetX: -100,
            targetY: -100,
            zIndex: 0,
            animating: 0,
            scale: 1,
            rotation: 0
        });

        this.game.addComponent(eid, 'draggable', {
            isDragging: 0,
            offsetX: 0,
            offsetY: 0
        });

        // Add cardLocation if game has it defined
        const collections = this.game.getCollections?.();
        if (collections?.components?.cardLocation) {
            this.game.addComponent(eid, 'cardLocation', {
                location: location,
                index: this.deckOrder.length,
                columnIndex: -1
            });
        }

        return eid;
    }

    /**
     * Shuffle the deck using Fisher-Yates algorithm
     * @param {number|null} seed - Optional seed for reproducibility
     */
    shuffleDeck(seed = null) {
        const useSeed = seed !== null ? seed : this.seed;

        // Create random function (Mulberry32 for seeded, Math.random otherwise)
        let random;
        if (useSeed !== null) {
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
        this.updateDeckIndices();
    }

    /**
     * Update indices of all cards in deck
     */
    updateDeckIndices() {
        this.deckOrder.forEach((eid, idx) => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            if (loc && loc.location === this.deckLocation) {
                loc.index = idx;
            }
        });
    }

    /**
     * Deal one card from the top of the deck
     * @param {boolean} faceUp - Whether to deal face up (default true)
     * @returns {number|null} Entity ID of dealt card, or null if deck empty
     */
    dealCard(faceUp = true) {
        // Find cards still in deck
        const deckCards = this.deckOrder.filter(eid => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            return loc && loc.location === this.deckLocation;
        });

        if (deckCards.length === 0) {
            return null;
        }

        const cardEid = deckCards[0];
        const card = this.game.getComponent(cardEid, 'card');

        if (faceUp) {
            card.faceUp = 1;
        }

        return cardEid;
    }

    /**
     * Deal multiple cards from the deck
     * @param {number} count - Number of cards to deal
     * @param {boolean} faceUp - Whether to deal face up
     * @returns {number[]} Array of dealt card entity IDs
     */
    dealCards(count, faceUp = true) {
        const cards = [];
        for (let i = 0; i < count; i++) {
            const card = this.dealCard(faceUp);
            if (card === null) break;
            cards.push(card);
        }
        return cards;
    }

    /**
     * Return a card to the deck
     * @param {number} cardEid - Entity ID of card to return
     * @param {boolean} toBottom - Add to bottom of deck (default true)
     */
    returnToDeck(cardEid, toBottom = true) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const card = this.game.getComponent(cardEid, 'card');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        if (loc) {
            loc.location = this.deckLocation;
            loc.columnIndex = -1;
        }

        if (card) {
            card.faceUp = 0;
        }

        // Remove from current position in order
        const idx = this.deckOrder.indexOf(cardEid);
        if (idx > -1) {
            this.deckOrder.splice(idx, 1);
        }

        // Add to deck
        if (toBottom) {
            this.deckOrder.push(cardEid);
        } else {
            this.deckOrder.unshift(cardEid);
        }

        // Move card off screen
        if (visual) {
            visual.targetX = -100;
            visual.targetY = -100;
            visual.animating = 1;
        }

        this.updateDeckIndices();
    }

    /**
     * Return all cards to the deck
     */
    returnAllToDeck() {
        for (const eid of this.allCards) {
            const loc = this.game.getComponent(eid, 'cardLocation');
            const card = this.game.getComponent(eid, 'card');

            if (loc) {
                loc.location = this.deckLocation;
                loc.index = 0;
                loc.columnIndex = -1;
            }

            if (card) {
                card.faceUp = 0;
            }
        }

        this.deckOrder = [...this.allCards];
        this.updateDeckIndices();
    }

    /**
     * Get count of cards remaining in deck
     * @returns {number}
     */
    getDeckCount() {
        return this.deckOrder.filter(eid => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            return loc && loc.location === this.deckLocation;
        }).length;
    }

    /**
     * Get all cards currently in deck
     * @returns {number[]} Array of entity IDs
     */
    getDeckCards() {
        return this.deckOrder.filter(eid => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            return loc && loc.location === this.deckLocation;
        });
    }

    /**
     * Get all cards of a specific suit
     * @param {number} suit - Suit value
     * @returns {number[]} Array of entity IDs
     */
    getCardsBySuit(suit) {
        return this.allCards.filter(eid => {
            const card = this.game.getComponent(eid, 'card');
            return card && card.suit === suit;
        });
    }

    /**
     * Get all cards of a specific rank
     * @param {number} rank - Rank value
     * @returns {number[]} Array of entity IDs
     */
    getCardsByRank(rank) {
        return this.allCards.filter(eid => {
            const card = this.game.getComponent(eid, 'card');
            return card && card.rank === rank;
        });
    }

    /**
     * Get card component data
     * @param {number} cardEid - Entity ID
     * @returns {Object|null} Card component or null
     */
    getCard(cardEid) {
        return this.game.getComponent(cardEid, 'card');
    }

    /**
     * Get the current deck order (all cards, not just those in deck)
     * @returns {number[]} Array of entity IDs in deck order
     */
    getDeckOrder() {
        return [...this.deckOrder];
    }

    /**
     * Get all cards ever created (regardless of location)
     * @returns {number[]} Array of all card entity IDs
     */
    getAllCards() {
        return [...this.allCards];
    }

    /**
     * Find a card by suit and rank
     * @param {number} suit - Suit value
     * @param {number} rank - Rank value
     * @returns {number|null} Entity ID or null if not found
     */
    findCard(suit, rank) {
        return this.allCards.find(eid => {
            const card = this.game.getComponent(eid, 'card');
            return card && card.suit === suit && card.rank === rank;
        }) || null;
    }

    /**
     * Find multiple cards by suit/rank pairs
     * @param {Array<{suit: number, rank: number}>} cardDefs - Array of card definitions
     * @returns {number[]} Array of entity IDs (nulls filtered out)
     */
    findCards(cardDefs) {
        return cardDefs.map(def => this.findCard(def.suit, def.rank)).filter(eid => eid !== null);
    }

    /**
     * Set a custom deck order
     * @param {number[]} orderedEids - Array of entity IDs in desired order
     */
    setDeckOrder(orderedEids) {
        // Validate all eids are in allCards
        const validEids = orderedEids.filter(eid => this.allCards.includes(eid));

        // Add any missing cards to the end
        const missingCards = this.allCards.filter(eid => !validEids.includes(eid));

        this.deckOrder = [...validEids, ...missingCards];
        this.updateDeckIndices();
    }

    /**
     * Move specific cards to the front of the deck order
     * Useful for setting up tutorials or specific scenarios
     * @param {number[]} cardEids - Array of entity IDs to move to front
     */
    moveToFront(cardEids) {
        // Remove these cards from current positions
        const remaining = this.deckOrder.filter(eid => !cardEids.includes(eid));

        // Add them to front in order
        const validCards = cardEids.filter(eid => this.allCards.includes(eid));

        this.deckOrder = [...validCards, ...remaining];
        this.updateDeckIndices();
    }

    update() {
        // Base deck system doesn't need per-frame updates
        // Game-specific systems handle deck visualization
    }
}
