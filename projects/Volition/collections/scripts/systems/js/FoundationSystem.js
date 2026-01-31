/**
 * FoundationSystem - Manages the four foundation piles (Ace to King by suit)
 */
class FoundationSystem extends GUTS.BaseSystem {
    static services = ['canPlayToFoundation', 'playToFoundation', 'getFoundationCards', 'getTopFoundationRank', 'getTotalFoundationCards', 'checkWin', 'refreshFoundationPositions'];
    static serviceDependencies = ['removeFromHand', 'showWinScreen', 'getFoundationPosition', 'onCardPlayed'];

    constructor(game) {
        super(game);
    }

    init() {
        console.log('FoundationSystem initializing...');
    }

    postAllInit() {
        // Layout managed by LayoutSystem
    }

    getFoundationCards(suit) {
        const entities = this.game.getEntitiesWith('card', 'cardLocation');
        return entities.filter(eid => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            const card = this.game.getComponent(eid, 'card');
            return loc.location === 2 && card.suit === suit; // foundation
        });
    }

    getTopFoundationRank(suit) {
        const cards = this.getFoundationCards(suit);
        if (cards.length === 0) return 0;

        let maxRank = 0;
        for (const eid of cards) {
            const card = this.game.getComponent(eid, 'card');
            if (card.rank > maxRank) {
                maxRank = card.rank;
            }
        }
        return maxRank;
    }

    getTotalFoundationCards() {
        let total = 0;
        for (let suit = 0; suit < 4; suit++) {
            total += this.getFoundationCards(suit).length;
        }
        return total;
    }

    canPlayToFoundation(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');
        const topRank = this.getTopFoundationRank(card.suit);

        // Must be exactly one higher than current top (or Ace if empty)
        return card.rank === topRank + 1;
    }

    playToFoundation(cardEid) {
        if (!this.canPlayToFoundation(cardEid)) {
            return false;
        }

        const card = this.game.getComponent(cardEid, 'card');
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Remove from previous location
        if (loc.location === 1) {
            this.call.removeFromHand(cardEid);
        }

        // Add to foundation
        const suit = card.suit;
        const foundationCards = this.getFoundationCards(suit);

        loc.location = 2; // foundation
        loc.index = foundationCards.length;
        loc.columnIndex = suit;

        // Set target position from LayoutSystem
        const pos = this.call.getFoundationPosition(suit);
        visual.targetX = pos.x;
        visual.targetY = pos.y;
        visual.zIndex = 100 + loc.index;
        visual.animating = 1;

        // Check win condition
        this.checkWin();

        // Trigger event for other systems to react to
        this.game.triggerEvent('onCardPlayedToFoundation', {
            cardEid,
            rank: card.rank,
            suit: card.suit
        });

        // Notify tutorial system if active
        if (this.call.onCardPlayed) {
            this.call.onCardPlayed('foundation', cardEid);
        }

        return true;
    }

    checkWin() {
        const total = this.getTotalFoundationCards();
        if (total === 52) {
            console.log('WIN!');
            this.call.showWinScreen();
        }
    }

    refreshFoundationPositions() {
        for (let suit = 0; suit < 4; suit++) {
            const pos = this.call.getFoundationPosition(suit);
            const cards = this.getFoundationCards(suit);
            cards.forEach((eid, idx) => {
                const visual = this.game.getComponent(eid, 'cardVisual');
                visual.targetX = pos.x;
                visual.targetY = pos.y;
                visual.animating = 1;
            });
        }
    }

    update() {
        // Update foundation pile visuals if needed
    }
}
