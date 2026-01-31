/**
 * CardFlowSystem - Handles manual card flow with sequential animations
 * When drawing: oldest card discards, then cards shift one by one, then new card drawn
 */
class CardFlowSystem extends GUTS.BaseSystem {
    static services = ['flowCard', 'getNextDumpColumn', 'isFlowAnimating', 'isAwaitingColumnSelection', 'cancelColumnSelection', 'completeDiscard'];
    static serviceDependencies = [
        'dealCard', 'popFromHandRaw', 'isHandFull', 'getDeckCount', 'dumpToTableau',
        'getTableauColumns', 'findEmptyColumn', 'getOldestHandCard', 'getColumnCards',
        'getTableauPosition', 'getStackOffset', 'getCardWidth', 'getCardHeight',
        'getHandCards', 'getHandPosition', 'getDeckPosition', 'flipCard', 'getCardElement'
    ];

    // Animation states
    static IDLE = 0;
    static DISCARDING = 1;
    static SHIFTING = 2;
    static DRAWING = 3;
    static FLIPPING = 4;

    constructor(game) {
        super(game);
        this.nextDumpColumn = 0;

        // Animation state
        this.animState = CardFlowSystem.IDLE;
        this.animatingCard = null;
        this.shiftIndex = 0;
        this.cardsToShift = [];
        this.newCardEid = null;

        // Timing for animations
        this.flipStartTime = 0;
        this.flipDuration = 400; // ms for flip animation
        this.shiftStartTime = 0;
        this.shiftDuration = 250; // ms per card shift (slower than flight)

        // Column selection state
        this.awaitingColumnSelection = false;
        this.pendingDiscardCard = null;
        this.columnClickHandlers = [];
    }

    init() {
        console.log('CardFlowSystem initializing...');
    }

    postAllInit() {
        this.createGhostCard();
    }

    createGhostCard() {
        this.ghostCard = document.createElement('div');
        this.ghostCard.className = 'card ghost-card';
        this.ghostCard.innerHTML = `
            <div class="card-flipper">
                <div class="card-front">
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
        const suits = ['\u2665', '\u2666', '\u2663', '\u2660'];
        return suits[suit] || '';
    }

    isRedSuit(suit) {
        return suit === 0 || suit === 1;
    }

    isFlowAnimating() {
        return this.animState !== CardFlowSystem.IDLE;
    }

    // Check if a card has finished its movement animation
    isCardDoneAnimating(cardEid) {
        if (!cardEid) return true;
        const visual = this.game.getComponent(cardEid, 'cardVisual');
        return visual.animating === 0;
    }

    flowCard() {
        // Don't start if already animating
        if (this.animState !== CardFlowSystem.IDLE) {
            return false;
        }

        // Don't flow if deck is empty
        if (this.call.getDeckCount() <= 0) {
            return false;
        }

        // Hide ghost card during animation
        if (this.ghostCard) {
            this.ghostCard.style.display = 'none';
        }

        if (this.call.isHandFull()) {
            // Start the discard sequence
            this.startDiscardSequence();
        } else {
            // Just draw a card directly
            this.startDrawSequence();
        }

        return true;
    }

    startDiscardSequence() {
        // Pop the oldest card without auto-reindexing (we animate manually)
        const dumpedCard = this.call.popFromHandRaw();
        if (!dumpedCard) {
            this.animState = CardFlowSystem.IDLE;
            return;
        }

        this.animatingCard = dumpedCard;
        this.animState = CardFlowSystem.DISCARDING;

        // Determine target column
        const numColumns = this.call.getTableauColumns();
        const emptyColumn = this.call.findEmptyColumn();
        let targetColumn;

        if (emptyColumn >= 0) {
            targetColumn = emptyColumn;
            this.nextDumpColumn = (emptyColumn + 1) % numColumns;
        } else {
            targetColumn = this.nextDumpColumn;
            this.nextDumpColumn = (this.nextDumpColumn + 1) % numColumns;
        }

        // Dump to tableau (sets target position and animating = 1)
        this.call.dumpToTableau(dumpedCard, targetColumn);

        // Store the cards that need to shift (current hand after pop)
        this.cardsToShift = [...this.call.getHandCards()];
        this.shiftIndex = 0;

        // update() will check when animation completes
    }

    isAwaitingColumnSelection() {
        return this.awaitingColumnSelection;
    }

    enterColumnSelectionMode() {
        // Get the oldest card that will be discarded
        const oldestCard = this.call.getOldestHandCard();
        if (!oldestCard) return;

        this.awaitingColumnSelection = true;
        this.pendingDiscardCard = oldestCard;

        // Highlight selectable columns
        this.highlightSelectableColumns(true);

        // Setup column click handlers
        this.setupColumnClickHandlers();

        // Update button to show Cancel
        this.updateDrawButtonToCancel(true);
    }

    cancelColumnSelection() {
        this.awaitingColumnSelection = false;
        this.pendingDiscardCard = null;

        // Remove column highlights
        this.highlightSelectableColumns(false);

        // Remove click handlers
        this.removeColumnClickHandlers();

        // Reset button
        this.updateDrawButtonToCancel(false);
    }

    completeDiscard(columnIndex) {
        if (!this.awaitingColumnSelection || !this.pendingDiscardCard) return;

        const cardEid = this.pendingDiscardCard;

        // Exit selection mode
        this.awaitingColumnSelection = false;
        this.pendingDiscardCard = null;
        this.highlightSelectableColumns(false);
        this.removeColumnClickHandlers();
        this.updateDrawButtonToCancel(false);

        // Pop the card from hand
        const dumpedCard = this.call.popFromHandRaw();
        if (!dumpedCard || dumpedCard !== cardEid) {
            console.warn('Card mismatch during discard');
            return;
        }

        this.animatingCard = dumpedCard;
        this.animState = CardFlowSystem.DISCARDING;

        // Update nextDumpColumn for future reference
        const numColumns = this.call.getTableauColumns();
        this.nextDumpColumn = (columnIndex + 1) % numColumns;

        // Dump to the selected column
        this.call.dumpToTableau(dumpedCard, columnIndex);

        // Store the cards that need to shift
        this.cardsToShift = [...this.call.getHandCards()];
        this.shiftIndex = 0;
    }

    highlightSelectableColumns(show) {
        const numColumns = this.call.getTableauColumns();
        for (let i = 0; i < numColumns; i++) {
            const col = document.getElementById(`tableau-${i}`);
            if (col) {
                col.classList.toggle('selectable', show);
            }
        }
    }

    setupColumnClickHandlers() {
        this.removeColumnClickHandlers(); // Clear any existing

        const numColumns = this.call.getTableauColumns();
        for (let i = 0; i < numColumns; i++) {
            const col = document.getElementById(`tableau-${i}`);
            if (col) {
                const handler = (e) => {
                    e.stopPropagation();
                    this.completeDiscard(i);
                };
                col.addEventListener('click', handler);
                this.columnClickHandlers.push({ element: col, handler });
            }
        }
    }

    removeColumnClickHandlers() {
        for (const { element, handler } of this.columnClickHandlers) {
            element.removeEventListener('click', handler);
        }
        this.columnClickHandlers = [];
    }

    updateDrawButtonToCancel(isCancel) {
        const deckLabel = document.getElementById('deckCountLabel');
        const deckArea = document.getElementById('deckArea');
        if (deckLabel) {
            deckLabel.textContent = isCancel ? 'Cancel' : 'Draw';
        }
        if (deckArea) {
            deckArea.classList.toggle('cancel-mode', isCancel);
        }
    }


    startShiftSequence() {
        if (this.cardsToShift.length === 0) {
            // No cards to shift, go straight to drawing
            this.startDrawSequence();
            return;
        }

        this.animState = CardFlowSystem.SHIFTING;
        this.shiftIndex = 0;
        this.shiftCurrentCard();
    }

    shiftCurrentCard() {
        if (this.shiftIndex >= this.cardsToShift.length) {
            // All cards shifted, now draw the new card
            this.startDrawSequence();
            return;
        }

        const cardEid = this.cardsToShift[this.shiftIndex];
        this.animatingCard = cardEid;
        this.shiftStartTime = performance.now();

        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Update the card's index (shift left by 1)
        loc.index = this.shiftIndex;

        // Get target position for this card's new slot
        const pos = this.call.getHandPosition(this.shiftIndex);

        // Set position directly - CSS transition will animate it
        visual.x = pos.x;
        visual.y = pos.y;
        visual.targetX = pos.x;
        visual.targetY = pos.y;
        visual.zIndex = 10 + this.shiftIndex;
        visual.animating = 0; // Don't use RenderSystem animation

        // Add shifting class to card element for CSS transition
        if (this.call.getCardElement) {
            const el = this.call.getCardElement(cardEid);
            if (el) {
                el.classList.add('shifting');
                // Remove class after transition
                setTimeout(() => el.classList.remove('shifting'), this.shiftDuration);
            }
        }

        // update() will wait for shiftDuration before next card
    }

    startDrawSequence() {
        this.animState = CardFlowSystem.DRAWING;

        // Deal card from deck
        const cardEid = this.call.dealCard();
        if (!cardEid) {
            this.animState = CardFlowSystem.IDLE;
            return;
        }

        this.newCardEid = cardEid;
        this.animatingCard = cardEid;

        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const card = this.game.getComponent(cardEid, 'card');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Set location to hand
        const handCards = this.call.getHandCards();
        loc.location = 1; // hand
        loc.index = handCards.length;
        loc.columnIndex = -1;

        // Start face down
        card.faceUp = 0;

        // Start at deck position
        const deckPos = this.call.getDeckPosition();
        visual.x = deckPos.x;
        visual.y = deckPos.y;

        // Set target to hand slot
        const handPos = this.call.getHandPosition(loc.index);
        visual.targetX = handPos.x;
        visual.targetY = handPos.y;
        visual.zIndex = 10 + loc.index;
        visual.animating = 1;

        // update() will check when animation completes
    }

    startFlipSequence() {
        this.animState = CardFlowSystem.FLIPPING;
        this.flipStartTime = performance.now();

        // Flip the card face up
        const card = this.game.getComponent(this.newCardEid, 'card');
        card.faceUp = 1;

        // Trigger flip animation via service
        if (this.call.flipCard) {
            this.call.flipCard(this.newCardEid);
        }

        // update() will check when flip duration completes
    }

    finishFlowSequence() {
        this.animState = CardFlowSystem.IDLE;
        this.animatingCard = null;
        this.newCardEid = null;
        this.cardsToShift = [];
        this.shiftIndex = 0;
    }

    getNextDumpColumn() {
        const emptyColumn = this.call.findEmptyColumn();
        if (emptyColumn >= 0) {
            return emptyColumn;
        }
        return this.nextDumpColumn;
    }

    updateDumpHighlight() {
        if (!this.ghostCard) return;

        // Hide during animation
        if (this.animState !== CardFlowSystem.IDLE) {
            this.ghostCard.style.display = 'none';
            return;
        }

        // Only show if hand is full and deck has cards
        if (!this.call.isHandFull() || this.call.getDeckCount() <= 0) {
            this.ghostCard.style.display = 'none';
            return;
        }

        const oldestCardEid = this.call.getOldestHandCard();
        if (!oldestCardEid) {
            this.ghostCard.style.display = 'none';
            return;
        }

        const card = this.game.getComponent(oldestCardEid, 'card');
        const nextCol = this.getNextDumpColumn();

        const pos = this.call.getTableauPosition(nextCol);
        const columnCards = this.call.getColumnCards(nextCol);
        const stackOffset = this.call.getStackOffset();
        const cardWidth = this.call.getCardWidth();
        const cardHeight = this.call.getCardHeight();

        const targetX = pos.x;
        const targetY = pos.y + columnCards.length * stackOffset;

        const rankDisplay = this.getRankDisplay(card.rank);
        const suitSymbol = this.getSuitSymbol(card.suit);
        const isRed = this.isRedSuit(card.suit);

        this.ghostCard.className = `card ghost-card ${isRed ? 'red' : 'black'}`;
        this.ghostCard.querySelectorAll('.card-rank').forEach(el => el.textContent = rankDisplay);
        this.ghostCard.querySelectorAll('.card-suit').forEach(el => el.textContent = suitSymbol);
        this.ghostCard.querySelector('.card-pips').innerHTML = this.getPipPattern(card.rank, suitSymbol);

        this.ghostCard.style.display = 'block';
        this.ghostCard.style.left = targetX + 'px';
        this.ghostCard.style.top = targetY + 'px';
        this.ghostCard.style.width = cardWidth + 'px';
        this.ghostCard.style.height = cardHeight + 'px';
    }

    update() {
        if (this.game.gameInstance?.state?.gameOver) return;

        // Handle animation state machine - wait for actual animations to complete
        switch (this.animState) {
            case CardFlowSystem.DISCARDING:
                // Wait for discard card to finish animating
                if (this.isCardDoneAnimating(this.animatingCard)) {
                    this.startShiftSequence();
                }
                break;

            case CardFlowSystem.SHIFTING:
                // Wait for shift duration (time-based, not position-based)
                if (performance.now() - this.shiftStartTime >= this.shiftDuration) {
                    this.shiftIndex++;
                    if (this.shiftIndex >= this.cardsToShift.length) {
                        // All shifted, start drawing
                        this.startDrawSequence();
                    } else {
                        // Shift next card
                        this.shiftCurrentCard();
                    }
                }
                break;

            case CardFlowSystem.DRAWING:
                // Wait for new card to finish moving to hand
                if (this.isCardDoneAnimating(this.animatingCard)) {
                    this.startFlipSequence();
                }
                break;

            case CardFlowSystem.FLIPPING:
                // Wait for flip animation duration
                if (performance.now() - this.flipStartTime >= this.flipDuration) {
                    this.finishFlowSequence();
                }
                break;
        }

        // Update dump column highlight
        this.updateDumpHighlight();

        // Disable the deck button if deck is empty OR animating
        const deckArea = document.getElementById('deckArea');
        if (deckArea) {
            deckArea.disabled = this.call.getDeckCount() <= 0 || this.animState !== CardFlowSystem.IDLE;
        }
    }
}
