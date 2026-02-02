/**
 * HandSystem - Manages the player's hand as a FIFO queue
 */
class HandSystem extends GUTS.BaseSystem {
    static services = ['getHandCards', 'pushToHand', 'popFromHand', 'popFromHandRaw', 'removeFromHand', 'isHandFull', 'getHandCapacity', 'getOldestHandCard', 'updateHandLayout', 'dealInitialHand'];
    static serviceDependencies = ['dealCard', 'getHandPosition', 'getCardWidth', 'getCardHeight', 'getDeckPosition', 'isTutorialActive', 'getFieldColumns', 'findEmptyColumn', 'dumpToField', 'getFieldPosition', 'getStackOffset'];

    constructor(game) {
        super(game);
        this.handCapacity = 5;
    }

    init() {
        const config = this.game.gameInstance?.getConfig() || {};
        this.handCapacity = config.handCapacity || 5;
    }

    postAllInit() {
        // Skip dealing if TutorialSystem is present - it will trigger the deal after user chooses
        if (this.call.isTutorialActive?.()) {
            return;
        }

        // Deal initial hand
        this.dealInitialHand();
    }

    onSceneLoad(sceneData, params) {
        // sceneData is the full scene object, get name from sceneManager
        const sceneName = this.game.sceneManager?.currentSceneName;
        console.log('[HandSystem] onSceneLoad called, sceneName:', sceneName);
        // When game scene loads (e.g., from tutorial), deal cards if hand is empty
        if (sceneName === 'game') {
            const handCards = this.getHandCards();
            console.log('[HandSystem] Hand cards count:', handCards.length);
            if (handCards.length === 0) {
                console.log('[HandSystem] Dealing initial hand...');
                this.dealInitialHand();
            } else {
                console.log('[HandSystem] Hand not empty, skipping deal');
            }
        }
    }

    dealInitialHand() {
        // First, fill all empty field columns
        const numColumns = this.call.getFieldColumns?.() || 4;
        for (let col = 0; col < numColumns; col++) {
            const cardEid = this.call.dealCard();
            if (cardEid) {
                this.dealToField(cardEid, col);
            }
        }

        // Then, fill hand with cards
        for (let i = 0; i < this.handCapacity; i++) {
            const cardEid = this.call.dealCard();
            if (cardEid) {
                this.pushToHand(cardEid);
            }
        }
    }

    /**
     * Deal a card directly to a field column (initial deal, no stacking rules)
     */
    dealToField(cardEid, columnIndex) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const card = this.game.getComponent(cardEid, 'card');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Set card location to field
        loc.location = 3; // field
        loc.index = 0; // first card in column
        loc.columnIndex = columnIndex;

        // Face up
        card.faceUp = 1;

        // Set initial position to deck (so card animates FROM deck)
        const deckPos = this.call.getDeckPosition();
        visual.x = deckPos.x;
        visual.y = deckPos.y;

        // Set target position
        const pos = this.call.getFieldPosition(columnIndex);
        visual.targetX = pos.x;
        visual.targetY = pos.y;
        visual.zIndex = 50;
        visual.animating = 1;
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
        // Caller is responsible for placing the card somewhere (e.g., field dump)
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

    popFromHandRaw() {
        // Remove oldest card WITHOUT reindexing - caller handles animations manually
        const handCards = this.getHandCards();
        if (handCards.length === 0) return null;

        const oldestCard = handCards[0];
        const loc = this.game.getComponent(oldestCard, 'cardLocation');

        // Mark as transitioning (caller will set final location)
        loc.location = -1;

        // Don't reindex - caller will animate cards sequentially
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
            visual.zIndex = 200 + idx; // Higher than field cards (50+) so hand is always on top
            visual.animating = 1;
        });
    }

    update() {
        // Layout updates handled by updateHandLayout
    }
}
