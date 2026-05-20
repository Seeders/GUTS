import CardDeckSystem from '../../../../../../global/collections/scripts/systems/js/CardDeckSystem.js';

/**
 * WarDeckSystem - Extends CardDeckSystem for War-specific deck operations
 * Adds dealing cards to two players
 */
class WarDeckSystem extends CardDeckSystem {
    static services = [
        ...CardDeckSystem.services,
        'dealToPlayers', 'getPlayerPile', 'addToPlayerPile',
        'getTableCards', 'addToTable', 'clearTable',
        'flipTopCard', 'getCardRankValue'
    ];

    constructor(game) {
        super(game);
        this.player1Pile = [];  // Bottom of array = bottom of pile
        this.player2Pile = [];
        this.tableCards = [];   // Cards currently in play
    }

    init() {
        super.init();
        this.player1Pile = [];
        this.player2Pile = [];
        this.tableCards = [];
    }

    /**
     * Create deck and deal 26 cards to each player
     */
    dealToPlayers() {
        // Create and shuffle the deck
        this.createStandardDeck();
        this.shuffleDeck();

        // Deal alternating to each player
        const allCards = this.getDeckOrder();

        for (let i = 0; i < allCards.length; i++) {
            const cardEid = allCards[i];
            const warCard = this.game.getComponent(cardEid, 'warCard');

            if (i % 2 === 0) {
                this.player1Pile.push(cardEid);
                if (warCard) warCard.owner = 1;
            } else {
                this.player2Pile.push(cardEid);
                if (warCard) warCard.owner = 2;
            }
        }

        return {
            player1Count: this.player1Pile.length,
            player2Count: this.player2Pile.length
        };
    }

    /**
     * Get a player's pile
     * @param {number} playerId - 1 or 2
     * @returns {number[]} Array of card entity IDs
     */
    getPlayerPile(playerId) {
        return playerId === 1 ? [...this.player1Pile] : [...this.player2Pile];
    }

    /**
     * Add cards to bottom of player's pile
     * @param {number} playerId - 1 or 2
     * @param {number[]} cardEids - Cards to add
     */
    addToPlayerPile(playerId, cardEids) {
        const pile = playerId === 1 ? this.player1Pile : this.player2Pile;

        for (const eid of cardEids) {
            pile.unshift(eid); // Add to bottom

            const warCard = this.game.getComponent(eid, 'warCard');
            if (warCard) {
                warCard.owner = playerId;
                warCard.inPile = 1;
                warCard.onTable = 0;
            }

            const card = this.game.getComponent(eid, 'card');
            if (card) {
                card.faceUp = 0;
            }
        }
    }

    /**
     * Flip top card from player's pile
     * @param {number} playerId - 1 or 2
     * @returns {number|null} Card entity ID or null if pile empty
     */
    flipTopCard(playerId) {
        const pile = playerId === 1 ? this.player1Pile : this.player2Pile;

        if (pile.length === 0) return null;

        const cardEid = pile.pop(); // Remove from top

        const warCard = this.game.getComponent(cardEid, 'warCard');
        if (warCard) {
            warCard.inPile = 0;
            warCard.onTable = 1;
        }

        const card = this.game.getComponent(cardEid, 'card');
        if (card) {
            card.faceUp = 1;
        }

        this.tableCards.push(cardEid);

        return cardEid;
    }

    /**
     * Get cards currently on table
     */
    getTableCards() {
        return [...this.tableCards];
    }

    /**
     * Add card to table (for war face-down cards)
     * @param {number} cardEid - Card to add
     * @param {boolean} faceUp - Whether card is face up
     */
    addToTable(cardEid, faceUp = false) {
        const warCard = this.game.getComponent(cardEid, 'warCard');
        if (warCard) {
            warCard.inPile = 0;
            warCard.onTable = 1;
        }

        const card = this.game.getComponent(cardEid, 'card');
        if (card) {
            card.faceUp = faceUp ? 1 : 0;
        }

        this.tableCards.push(cardEid);
    }

    /**
     * Clear table and return cards
     * @returns {number[]} All cards that were on table
     */
    clearTable() {
        const cards = [...this.tableCards];
        this.tableCards = [];
        return cards;
    }

    /**
     * Get numeric value of card rank for comparison
     * A=14, K=13, Q=12, J=11, 10-2=face value
     * @param {number} cardEid - Card entity ID
     * @returns {number} Rank value
     */
    getCardRankValue(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');
        if (!card) return 0;

        // Ace is high (14), face cards: K=13, Q=12, J=11
        if (card.rank === 1) return 14; // Ace
        return card.rank;
    }

    /**
     * Override createCardEntity to add warCard component
     */
    createCardEntity(suit, rank, location) {
        const eid = super.createCardEntity(suit, rank, location);

        this.game.addComponent(eid, 'warCard', {
            owner: 0,
            inPile: 1,
            onTable: 0
        });

        return eid;
    }
}
