/**
 * KingdomSystem - Manages the four kingdom piles (Ace to King by suit)
 */
class KingdomSystem extends GUTS.BaseSystem {
    static services = ['canPlayToKingdom', 'playToKingdom', 'getKingdomCards', 'getTopKingdomRank', 'getTotalKingdomCards', 'checkWin', 'refreshKingdomPositions'];
    static serviceDependencies = ['removeFromHand', 'showWinScreen', 'getKingdomPosition', 'onCardPlayed'];

    constructor(game) {
        super(game);
    }

    init() {
        console.log('KingdomSystem initializing...');
    }

    postAllInit() {
        // Layout managed by LayoutSystem
    }

    getKingdomCards(suit) {
        const entities = this.game.getEntitiesWith('card', 'cardLocation');
        return entities.filter(eid => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            const card = this.game.getComponent(eid, 'card');
            return loc.location === 2 && card.suit === suit; // kingdom
        });
    }

    getTopKingdomRank(suit) {
        const cards = this.getKingdomCards(suit);
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

    getTotalKingdomCards() {
        let total = 0;
        for (let suit = 0; suit < 4; suit++) {
            total += this.getKingdomCards(suit).length;
        }
        return total;
    }

    canPlayToKingdom(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');
        const topRank = this.getTopKingdomRank(card.suit);

        // Must be exactly one higher than current top (or Ace if empty)
        return card.rank === topRank + 1;
    }

    playToKingdom(cardEid) {
        if (!this.canPlayToKingdom(cardEid)) {
            return false;
        }

        const card = this.game.getComponent(cardEid, 'card');
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Remove from previous location
        if (loc.location === 1) {
            this.call.removeFromHand(cardEid);
        }

        // Add to kingdom
        const suit = card.suit;
        const kingdomCards = this.getKingdomCards(suit);

        loc.location = 2; // kingdom
        loc.index = kingdomCards.length;
        loc.columnIndex = suit;

        // Set target position from LayoutSystem
        const pos = this.call.getKingdomPosition(suit);
        visual.targetX = pos.x;
        visual.targetY = pos.y;
        visual.zIndex = 100 + loc.index;
        visual.animating = 1;

        // Check win condition
        this.checkWin();

        // Trigger event for other systems to react to
        this.game.triggerEvent('onCardPlayedToKingdom', {
            cardEid,
            rank: card.rank,
            suit: card.suit
        });

        // Notify tutorial system if active
        if (this.call.onCardPlayed) {
            this.call.onCardPlayed('kingdom', cardEid);
        }

        return true;
    }

    checkWin() {
        const total = this.getTotalKingdomCards();
        if (total === 52) {
            console.log('WIN!');
            this.call.showWinScreen();
        }
    }

    refreshKingdomPositions() {
        for (let suit = 0; suit < 4; suit++) {
            const pos = this.call.getKingdomPosition(suit);
            const cards = this.getKingdomCards(suit);
            cards.forEach((eid, idx) => {
                const visual = this.game.getComponent(eid, 'cardVisual');
                visual.targetX = pos.x;
                visual.targetY = pos.y;
                visual.animating = 1;
            });
        }
    }

    update() {
        // Update kingdom pile visuals if needed
    }
}
