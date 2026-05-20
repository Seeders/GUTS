/**
 * RefugeSystem - Manages the 6 face-up refuge cards
 * Handles player actions: using cards against threats, sacrificing cards
 */
class RefugeSystem extends GUTS.BaseSystem {
    static services = [
        'getRefugeCards', 'addToRefuge', 'removeFromRefuge',
        'useActionCard', 'useSupplyCards', 'useHealCard',
        'sacrificeCard', 'getRefugePosition', 'isRefugeFull',
        'getRefugeCapacity', 'dealInitialRefuge'
    ];
    static serviceDependencies = [
        'dealCard', 'getLayoutDimensions', 'removeThreat', 'addToThreatLine', 'returnToDeck',
        'healDamage', 'getActiveThreats', 'playCardPlace', 'playHeal', 'playThreatResolve'
    ];

    constructor(game) {
        super(game);
        this.refugeCards = []; // Array of entity IDs in refuge
        this.capacity = 6; // Default, will be overridden by config
    }

    init() {
        const config = this.game.getConfig?.() || {};
        this.capacity = config.refugeSlots || 6;
        this.refugeCards = [];
    }

    /**
     * Deal initial cards at game start
     * Spades go to threat line (max 3), other suits go to refuge
     * Keeps dealing until refuge is full (6 cards)
     */
    dealInitialRefuge() {
        const maxInitialThreats = 3;
        let threatCount = 0;

        // Deal cards until refuge is full
        // Spades (suit 3) go to threat line (max 3), others go to refuge
        while (!this.isRefugeFull()) {
            const cardEid = this.call.dealCard?.();
            if (!cardEid) break; // Deck empty

            const card = this.game.getComponent(cardEid, 'card');

            if (card.suit === 3) {
                // Spade - goes to threat line if under limit
                if (threatCount < maxInitialThreats) {
                    this.call.addToThreatLine?.(cardEid);
                    threatCount++;
                } else {
                    // Over limit - return to bottom of deck
                    this.call.returnToDeck?.(cardEid, true);
                }
            } else {
                // Hearts, Diamonds, Clubs - go to refuge
                this.addToRefuge(cardEid);
            }
        }
    }

    /**
     * Get all cards in the refuge
     */
    getRefugeCards() {
        return this.refugeCards.filter(eid => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            return loc && loc.location === 2; // refuge
        });
    }

    /**
     * Get refuge capacity
     */
    getRefugeCapacity() {
        return this.capacity;
    }

    /**
     * Check if refuge is full
     */
    isRefugeFull() {
        return this.getRefugeCards().length >= this.capacity;
    }

    /**
     * Add a card to the refuge
     * @param {number} cardEid - Entity ID of the card
     * @returns {boolean} - True if successfully added
     */
    addToRefuge(cardEid) {
        if (this.isRefugeFull()) {
            return false;
        }

        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const card = this.game.getComponent(cardEid, 'card');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Set location to refuge
        loc.location = 2; // refuge
        loc.index = this.refugeCards.length;
        loc.columnIndex = -1;

        // Ensure card is face up
        card.faceUp = 1;

        this.refugeCards.push(cardEid);

        // Set visual position
        const pos = this.getRefugePosition(loc.index);
        visual.targetX = pos.x;
        visual.targetY = pos.y;
        visual.zIndex = 200 + loc.index;
        visual.animating = 1;

        this.game.triggerEvent('onCardAddedToRefuge', { cardEid, suit: card.suit, rank: card.rank });

        return true;
    }

    /**
     * Remove a card from refuge (move to discard)
     * @param {number} cardEid - Entity ID
     */
    removeFromRefuge(cardEid) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Move to discard
        loc.location = 3; // discard
        loc.index = 0;

        // Move off-screen
        if (visual) {
            visual.targetX = -100;
            visual.targetY = -100;
            visual.animating = 1;
        }

        // Remove from refuge array
        const idx = this.refugeCards.indexOf(cardEid);
        if (idx > -1) {
            this.refugeCards.splice(idx, 1);
        }

        // Update indices of remaining cards
        this.updateRefugeIndices();
    }

    /**
     * Use an Action card (Club) against a threat
     * Club rank must >= threat rank to remove it
     * @param {number} clubEid - Entity ID of the club card
     * @param {number} threatEid - Entity ID of the threat to remove
     * @returns {boolean} - True if threat was removed
     */
    useActionCard(clubEid, threatEid) {
        const club = this.game.getComponent(clubEid, 'card');
        const threat = this.game.getComponent(threatEid, 'card');

        // Verify it's a club
        if (club.suit !== 2) {
            return false;
        }

        // Verify club rank >= threat rank
        if (club.rank < threat.rank) {
            this.game.triggerEvent('onInvalidMove', { reason: 'Club rank too low' });
            return false;
        }

        // Remove club from refuge
        this.removeFromRefuge(clubEid);

        // Remove threat
        this.call.removeThreat(threatEid);

        this.call.playThreatResolve?.();

        this.game.triggerEvent('onActionUsed', {
            actionEid: clubEid,
            actionRank: club.rank,
            threatEid: threatEid,
            threatRank: threat.rank
        });

        return true;
    }

    /**
     * Use Supply cards (Diamonds) against a threat
     * Sum of diamond ranks must >= threat rank
     * @param {number[]} diamondEids - Array of diamond card entity IDs
     * @param {number} threatEid - Entity ID of the threat to remove
     * @returns {boolean} - True if threat was removed
     */
    useSupplyCards(diamondEids, threatEid) {
        const threat = this.game.getComponent(threatEid, 'card');

        // Verify all cards are diamonds
        let totalRank = 0;
        for (const eid of diamondEids) {
            const card = this.game.getComponent(eid, 'card');
            if (card.suit !== 1) {
                return false;
            }
            totalRank += card.rank;
        }

        // Verify total rank >= threat rank
        if (totalRank < threat.rank) {
            this.game.triggerEvent('onInvalidMove', { reason: 'Diamond total too low' });
            return false;
        }

        // Remove all diamonds from refuge
        for (const eid of diamondEids) {
            this.removeFromRefuge(eid);
        }

        // Remove threat
        this.call.removeThreat(threatEid);

        this.call.playThreatResolve?.();

        this.game.triggerEvent('onSuppliesUsed', {
            supplyEids: diamondEids,
            totalRank: totalRank,
            threatEid: threatEid,
            threatRank: threat.rank
        });

        return true;
    }

    /**
     * Use a Heart card for healing
     * Heals damage equal to card rank
     * @param {number} heartEid - Entity ID of the heart card
     * @returns {number} - Amount healed
     */
    useHealCard(heartEid) {
        const heart = this.game.getComponent(heartEid, 'card');

        // Verify it's a heart
        if (heart.suit !== 0) {
            return 0;
        }

        // Remove from refuge
        this.removeFromRefuge(heartEid);

        // Heal damage
        const healed = this.call.healDamage(heart.rank);

        this.call.playHeal?.();

        return healed;
    }

    /**
     * Sacrifice a refuge card to prevent incoming damage
     * Returns the card's rank as damage prevention value
     * @param {number} cardEid - Entity ID of the card to sacrifice
     * @returns {number} - Damage prevention value (card rank)
     */
    sacrificeCard(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');
        const loc = this.game.getComponent(cardEid, 'cardLocation');

        // Verify card is in refuge
        if (loc.location !== 2) {
            return 0;
        }

        const preventionValue = card.rank;

        // Remove from refuge
        this.removeFromRefuge(cardEid);

        this.game.triggerEvent('onCardSacrificed', {
            cardEid: cardEid,
            rank: card.rank,
            suit: card.suit,
            preventionValue: preventionValue
        });

        return preventionValue;
    }

    /**
     * Update indices and positions of all cards in refuge after removal
     */
    updateRefugeIndices() {
        this.refugeCards.forEach((eid, idx) => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            const visual = this.game.getComponent(eid, 'cardVisual');
            if (loc) {
                loc.index = idx;
            }
            // Update visual positions
            if (visual) {
                const pos = this.getRefugePosition(idx);
                visual.targetX = pos.x;
                visual.targetY = pos.y;
                visual.zIndex = 200 + idx;
                visual.animating = 1;
            }
        });
    }

    /**
     * Get position for a card in the refuge
     * @param {number} index - Index in refuge
     * @returns {{x: number, y: number}}
     */
    getRefugePosition(index) {
        // Get layout dimensions from LayoutSystem
        const dims = this.call.getLayoutDimensions?.() || {
            refugeX: 50,
            refugeY: 250,
            cardWidth: 70,
            cardGap: 10
        };

        return {
            x: dims.refugeX + (index * (dims.cardWidth + dims.cardGap)),
            y: dims.refugeY
        };
    }

    update() {
        // Skip DOM updates in headless mode
        const config = this.game.getConfig?.() || {};
        if (config.isHeadless) return;

        // Update refuge count display if needed
        const refugeCountEl = document.getElementById('refugeCount');
        if (refugeCountEl) {
            refugeCountEl.textContent = `${this.getRefugeCards().length}/${this.capacity}`;
        }
    }
}
