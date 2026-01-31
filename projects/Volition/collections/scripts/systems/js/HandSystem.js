/**
 * HandSystem - Manages the player's hand as a FIFO queue
 */
class HandSystem extends GUTS.BaseSystem {
    static services = ['getHandCards', 'pushToHand', 'popFromHand', 'removeFromHand', 'isHandFull', 'getHandCapacity', 'getOldestHandCard', 'updateHandLayout'];
    static serviceDependencies = ['dealCard', 'getHandPosition', 'getCardWidth', 'getCardHeight', 'getDeckPosition'];

    constructor(game) {
        super(game);
        this.game.handSystem = this;
        this.handCapacity = 5;
    }

    init() {
        console.log('HandSystem init called');
        const config = this.game.gameInstance?.getConfig() || {};
        this.handCapacity = config.handCapacity || 5;
        console.log('HandSystem: handCapacity =', this.handCapacity);
    }

    postAllInit() {
        console.log('HandSystem postAllInit called');

        // Deal initial hand
        this.dealInitialHand();
        console.log('HandSystem: initial hand dealt, hand cards =', this.getHandCards().length);
    }

    dealInitialHand() {
        // Fill hand with cards
        for (let i = 0; i < this.handCapacity; i++) {
            const cardEid = this.call.dealCard();
            if (cardEid) {
                this.pushToHand(cardEid);
            }
        }
    }

    getHandCards(includeAnimating = true) {
        const entities = this.game.getEntitiesWith('card', 'cardLocation');
        const handCards = entities.filter(eid => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            if (loc.location !== 1) return false; // not in hand

            // Optionally filter out cards still animating
            if (!includeAnimating) {
                const visual = this.game.getComponent(eid, 'cardVisual');
                if (visual.animating === 1) return false;
            }
            return true;
        });

        // Sort by index (oldest first)
        handCards.sort((a, b) => {
            const locA = this.game.getComponent(a, 'cardLocation');
            const locB = this.game.getComponent(b, 'cardLocation');
            return locA.index - locB.index;
        });

        return handCards;
    }

    isHandFull() {
        // Count all cards in hand, including animating ones
        return this.getHandCards(true).length >= this.handCapacity;
    }

    getHandCapacity() {
        return this.handCapacity;
    }

    getOldestHandCard() {
        const handCards = this.getHandCards();
        return handCards.length > 0 ? handCards[0] : null;
    }

    pushToHand(cardEid) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const card = this.game.getComponent(cardEid, 'card');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        const handCards = this.getHandCards();

        // Set card location to hand
        loc.location = 1; // hand
        loc.index = handCards.length; // newest = highest index
        loc.columnIndex = -1;

        // Face up
        card.faceUp = 1;

        // Set initial position to deck (so card animates FROM deck)
        const deckPos = this.call.getDeckPosition();
        visual.x = deckPos.x;
        visual.y = deckPos.y;

        // Set target position
        this.updateHandLayout();
    }

    popFromHand() {
        // Remove oldest card (index 0) and return it
        // Caller is responsible for placing the card somewhere (e.g., tableau dump)
        const handCards = this.getHandCards();
        if (handCards.length === 0) return null;

        const oldestCard = handCards[0];
        const loc = this.game.getComponent(oldestCard, 'cardLocation');

        // Mark as transitioning (caller will set final location)
        loc.location = -1;

        // Re-index remaining cards
        this.reindexHand();

        return oldestCard;
    }

    removeFromHand(cardEid) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        if (loc.location !== 1) return;

        // Mark as transitioning (will be set to proper location by caller)
        loc.location = -1;

        // Re-index remaining cards
        this.reindexHand();
    }

    reindexHand() {
        const handCards = this.getHandCards();
        handCards.forEach((eid, idx) => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            loc.index = idx;
        });

        this.updateHandLayout();
    }

    updateHandLayout() {
        const handCards = this.getHandCards();

        handCards.forEach((eid, idx) => {
            const visual = this.game.getComponent(eid, 'cardVisual');
            const pos = this.call.getHandPosition(idx);

            visual.targetX = pos.x;
            visual.targetY = pos.y;
            visual.zIndex = 10 + idx;
            visual.animating = 1;
        });
    }

    update() {
        // Layout updates handled by updateHandLayout
    }
}
