/**
 * CardFlowSystem - Handles manual card flow
 * New cards push to back of hand, oldest card gets dumped to tableau when full
 */
class CardFlowSystem extends GUTS.BaseSystem {
    static services = ['flowCard', 'getNextDumpColumn'];
    static serviceDependencies = ['dealCard', 'pushToHand', 'popFromHand', 'isHandFull', 'getDeckCount', 'dumpToTableau', 'getTableauColumns', 'findEmptyColumn', 'getOldestHandCard', 'getColumnCards', 'getTableauPosition', 'getStackOffset', 'getCardWidth', 'getCardHeight'];

    constructor(game) {
        super(game);
        this.game.cardFlowSystem = this;
        this.nextDumpColumn = 0; // Round-robin column for dumping cards
    }

    init() {
        console.log('CardFlowSystem initializing...');
    }

    postAllInit() {
        // Create ghost card element for dump preview
        this.createGhostCard();
    }

    createGhostCard() {
        this.ghostCard = document.createElement('div');
        this.ghostCard.className = 'card ghost-card';
        this.ghostCard.innerHTML = `
            <div class="card-inner">
                <div class="card-corner top-left">
                    <span class="card-rank"></span>
                    <span class="card-suit"></span>
                </div>
                <div class="card-pips"></div>
                <div class="card-corner bottom-right">
                    <span class="card-rank"></span>
                    <span class="card-suit"></span>
                </div>
            </div>
        `;
        this.ghostCard.style.display = 'none';
        document.getElementById('cardContainer')?.appendChild(this.ghostCard);
    }

    getPipPattern(rank, suit) {
        if (rank >= 11) {
            const faces = { 11: 'J', 12: 'Q', 13: 'K' };
            return `<span class="face-letter">${faces[rank]}</span>`;
        }
        if (rank === 1) {
            return `<span class="pip ace">${suit}</span>`;
        }
        const patterns = {
            2: ['tc', 'bc-flip'],
            3: ['tc', 'mc', 'bc-flip'],
            4: ['tl', 'tr', 'bl-flip', 'br-flip'],
            5: ['tl', 'tr', 'mc', 'bl-flip', 'br-flip'],
            6: ['tl', 'tr', 'ml', 'mr', 'bl-flip', 'br-flip'],
            7: ['tl', 'tr', 'ml', 'mr', 'bl-flip', 'br-flip', 'tc2'],
            8: ['tl', 'tr', 'ml', 'mr', 'bl-flip', 'br-flip', 'tc2', 'bc2-flip'],
            9: ['tl', 'tr', 'tl2', 'tr2', 'mc', 'bl2-flip', 'br2-flip', 'bl-flip', 'br-flip'],
            10: ['tl', 'tr', 'tc2', 'tl2', 'tr2', 'bl2-flip', 'br2-flip', 'bc2-flip', 'bl-flip', 'br-flip']
        };
        const positions = patterns[rank] || [];
        return positions.map(pos => {
            const isFlipped = pos.includes('-flip');
            const posClass = pos.replace('-flip', '');
            return `<span class="pip ${posClass}${isFlipped ? ' flip' : ''}">${suit}</span>`;
        }).join('');
    }

    getRankDisplay(rank) {
        const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        return ranks[rank] || '';
    }

    getSuitSymbol(suit) {
        const suits = ['\u2665', '\u2666', '\u2663', '\u2660']; // hearts, diamonds, clubs, spades
        return suits[suit] || '';
    }

    isRedSuit(suit) {
        return suit === 0 || suit === 1; // hearts or diamonds
    }

    flowCard() {
        // Don't flow if deck is empty
        if (this.call.getDeckCount() <= 0) {
            return false;
        }

        // If hand is full, pop oldest card and dump to tableau
        if (this.call.isHandFull()) {
            const dumpedCard = this.call.popFromHand();
            if (dumpedCard) {
                const numColumns = this.call.getTableauColumns();

                // First, check for empty slot starting from the left
                const emptyColumn = this.call.findEmptyColumn();
                if (emptyColumn >= 0) {
                    // Fill empty slot and set round-robin to next slot
                    this.call.dumpToTableau(dumpedCard, emptyColumn);
                    this.nextDumpColumn = (emptyColumn + 1) % numColumns;
                } else {
                    // No empty columns - use round-robin position
                    this.call.dumpToTableau(dumpedCard, this.nextDumpColumn);
                    this.nextDumpColumn = (this.nextDumpColumn + 1) % numColumns;
                }
            }
        }

        // Deal new card from deck
        const cardEid = this.call.dealCard();
        if (cardEid) {
            this.call.pushToHand(cardEid);
            return true;
        }
        return false;
    }

    getNextDumpColumn() {
        // Check for empty column first (same logic as flowCard)
        const emptyColumn = this.call.findEmptyColumn();
        if (emptyColumn >= 0) {
            return emptyColumn;
        }
        return this.nextDumpColumn;
    }

    updateDumpHighlight() {
        if (!this.ghostCard) return;

        // Only show if hand is full and deck has cards
        if (!this.call.isHandFull() || this.call.getDeckCount() <= 0) {
            this.ghostCard.style.display = 'none';
            return;
        }

        // Get the oldest card (would be discarded)
        const oldestCardEid = this.call.getOldestHandCard();
        if (!oldestCardEid) {
            this.ghostCard.style.display = 'none';
            return;
        }

        const card = this.game.getComponent(oldestCardEid, 'card');
        const nextCol = this.getNextDumpColumn();

        // Get position from LayoutSystem
        const pos = this.call.getTableauPosition(nextCol);
        const columnCards = this.call.getColumnCards(nextCol);
        const stackOffset = this.call.getStackOffset();
        const cardWidth = this.call.getCardWidth();
        const cardHeight = this.call.getCardHeight();

        const targetX = pos.x;
        const targetY = pos.y + columnCards.length * stackOffset;

        // Update ghost card content
        const rankDisplay = this.getRankDisplay(card.rank);
        const suitSymbol = this.getSuitSymbol(card.suit);
        const isRed = this.isRedSuit(card.suit);

        this.ghostCard.className = `card ghost-card ${isRed ? 'red' : 'black'}`;
        this.ghostCard.querySelectorAll('.card-rank').forEach(el => el.textContent = rankDisplay);
        this.ghostCard.querySelectorAll('.card-suit').forEach(el => el.textContent = suitSymbol);
        this.ghostCard.querySelector('.card-pips').innerHTML = this.getPipPattern(card.rank, suitSymbol);

        // Position the ghost card
        this.ghostCard.style.display = 'block';
        this.ghostCard.style.left = targetX + 'px';
        this.ghostCard.style.top = targetY + 'px';
        this.ghostCard.style.width = cardWidth + 'px';
        this.ghostCard.style.height = cardHeight + 'px';
    }

    update() {
        if (this.game.gameInstance?.state?.gameOver) return;

        // Update dump column highlight
        this.updateDumpHighlight();

        // Disable the Draw button if deck is empty
        const nextCardBtn = document.getElementById('nextCardBtn');
        if (nextCardBtn) {
            nextCardBtn.disabled = this.call.getDeckCount() <= 0;
        }
    }
}
