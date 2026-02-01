/**
 * CardFlowSystem - Handles manual card flow with sequential animations
 * When drawing: oldest card discards, then cards shift one by one, then new card drawn
 */
class CardFlowSystem extends GUTS.BaseSystem {
    static services = ['flowCard', 'flowAfterHandPlay', 'getNextDumpColumn', 'isFlowAnimating', 'isAwaitingColumnSelection', 'cancelColumnSelection', 'completeDiscard'];
    static serviceDependencies = [
        'dealCard', 'popFromHandRaw', 'isHandFull', 'getDeckCount', 'dumpToField',
        'getFieldColumns', 'findEmptyColumn', 'getOldestHandCard', 'getColumnCards',
        'getFieldPosition', 'getStackOffset', 'getCardWidth', 'getCardHeight',
        'getHandCards', 'getHandPosition', 'getDeckPosition', 'flipCard', 'getCardElement',
        'playCardDraw', 'playCardPlace', 'playCardFlip', 'playCardPickup'
    ];

    // Animation states
    static IDLE = 0;
    static DISCARDING = 1;
    static SHIFTING = 2;
    static DRAWING = 3;
    static FLIPPING = 4;
    static PLAYING_TO_KINGDOM = 5;
    static PLAYING_TO_FIELD = 6;

    constructor(game) {
        super(game);
        this.nextDumpColumn = 0;

        // Animation state
        this.animState = CardFlowSystem.IDLE;
        this.animatingCard = null;
        this.shiftIndex = 0;
        this.shiftFromIndex = 0; // Starting index for shift animation
        this.cardsToShift = [];
        this.newCardEid = null;
        this.skipDrawAfterShift = false; // When true, don't draw after shifting (deck empty)

        // Timing for animations
        this.flipStartTime = 0;
        this.flipDuration = 400; // ms for flip animation
        this.shiftStartTime = 0;
        this.shiftDuration = 250; // ms per card shift (slower than flight)
        this.shiftSoundPlayed = false; // Track if sound has been played for current shift
        this.shiftLandingGap = 80; // ms gap after sound before next card starts

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
        const suits = ['\u2665', '\u2662', '\u2667', '\u2660'];
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

        const deckEmpty = this.call.getDeckCount() <= 0;
        const handCards = this.call.getHandCards();
        const hasHandCards = handCards.length > 0;

        // Don't flow if deck is empty AND hand is empty
        if (deckEmpty && !hasHandCards) {
            return false;
        }

        // Hide ghost card during animation
        if (this.ghostCard) {
            this.ghostCard.style.display = 'none';
        }

        if (deckEmpty && hasHandCards) {
            // Deck is empty but hand has cards - just discard without drawing
            this.startDiscardOnlySequence();
        } else if (this.call.isHandFull()) {
            // Start the discard sequence (followed by draw)
            this.startDiscardSequence();
        } else {
            // Just draw a card directly
            this.startDrawSequence();
        }

        return true;
    }

    /**
     * Called after a card is played from hand (to kingdom or field)
     * Waits for the played card animation, then shifts remaining hand cards, then draws
     * @param {number} playedCardEid - The card that was played
     * @param {string} targetType - 'kingdom' or 'field'
     * @param {number} playedFromIndex - The original hand index of the played card
     */
    flowAfterHandPlay(playedCardEid, targetType = 'kingdom', playedFromIndex = 0) {
        // Don't start if already animating
        if (this.animState !== CardFlowSystem.IDLE) {
            return false;
        }

        // Hide ghost card during animation
        if (this.ghostCard) {
            this.ghostCard.style.display = 'none';
        }

        this.animatingCard = playedCardEid;

        if (targetType === 'kingdom') {
            this.animState = CardFlowSystem.PLAYING_TO_KINGDOM;
        } else {
            this.animState = CardFlowSystem.PLAYING_TO_FIELD;
        }

        // Store the cards that need to shift (current hand after the card was removed)
        // Only cards that were AFTER the played card need to shift
        const allHandCards = this.call.getHandCards();
        this.cardsToShift = [];

        // Cards at indices >= playedFromIndex need to shift left
        // They're now at indices playedFromIndex, playedFromIndex+1, etc.
        // But their visual positions were already updated by updateHandLayout, so restore them
        for (let i = playedFromIndex; i < allHandCards.length; i++) {
            const cardEid = allHandCards[i];
            this.cardsToShift.push(cardEid);

            // Restore visual position to one slot to the right (where it was before shift)
            const visual = this.game.getComponent(cardEid, 'cardVisual');
            const oldPos = this.call.getHandPosition(i + 1);
            visual.x = oldPos.x;
            visual.y = oldPos.y;
            visual.targetX = oldPos.x;
            visual.targetY = oldPos.y;
            visual.animating = 0; // Stop RenderSystem animation - we'll use CSS transitions
        }

        this.shiftIndex = 0;
        this.shiftFromIndex = playedFromIndex; // Track where shifting starts

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
        const numColumns = this.call.getFieldColumns();
        const emptyColumn = this.call.findEmptyColumn();
        let targetColumn;

        if (emptyColumn >= 0) {
            targetColumn = emptyColumn;
            this.nextDumpColumn = (emptyColumn + 1) % numColumns;
        } else {
            targetColumn = this.nextDumpColumn;
            this.nextDumpColumn = (this.nextDumpColumn + 1) % numColumns;
        }

        // Dump to field (sets target position and animating = 1)
        this.call.dumpToField(dumpedCard, targetColumn);

        // Play liftoff sound when card leaves hand
        if (this.call.playCardPickup) {
            this.call.playCardPickup();
        }

        // Store the cards that need to shift (current hand after pop)
        this.cardsToShift = [...this.call.getHandCards()];
        this.shiftIndex = 0;
        this.shiftFromIndex = 0; // Discard always removes from index 0

        // update() will check when animation completes
    }

    /**
     * Discard from hand without drawing - used when deck is empty
     */
    startDiscardOnlySequence() {
        // Pop the oldest card without auto-reindexing (we animate manually)
        const dumpedCard = this.call.popFromHandRaw();
        if (!dumpedCard) {
            this.animState = CardFlowSystem.IDLE;
            return;
        }

        this.animatingCard = dumpedCard;
        this.animState = CardFlowSystem.DISCARDING;
        this.skipDrawAfterShift = true; // Don't draw after shifting

        // Determine target column
        const numColumns = this.call.getFieldColumns();
        const emptyColumn = this.call.findEmptyColumn();
        let targetColumn;

        if (emptyColumn >= 0) {
            targetColumn = emptyColumn;
            this.nextDumpColumn = (emptyColumn + 1) % numColumns;
        } else {
            targetColumn = this.nextDumpColumn;
            this.nextDumpColumn = (this.nextDumpColumn + 1) % numColumns;
        }

        // Dump to field (sets target position and animating = 1)
        this.call.dumpToField(dumpedCard, targetColumn);

        // Play liftoff sound when card leaves hand
        if (this.call.playCardPickup) {
            this.call.playCardPickup();
        }

        // Store the cards that need to shift (current hand after pop)
        this.cardsToShift = [...this.call.getHandCards()];
        this.shiftIndex = 0;
        this.shiftFromIndex = 0; // Discard always removes from index 0
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
        const numColumns = this.call.getFieldColumns();
        this.nextDumpColumn = (columnIndex + 1) % numColumns;

        // Dump to the selected column
        this.call.dumpToField(dumpedCard, columnIndex);

        // Store the cards that need to shift
        this.cardsToShift = [...this.call.getHandCards()];
        this.shiftIndex = 0;
    }

    highlightSelectableColumns(show) {
        const numColumns = this.call.getFieldColumns();
        for (let i = 0; i < numColumns; i++) {
            const col = document.getElementById(`field-${i}`);
            if (col) {
                col.classList.toggle('selectable', show);
            }
        }
    }

    setupColumnClickHandlers() {
        this.removeColumnClickHandlers(); // Clear any existing

        const numColumns = this.call.getFieldColumns();
        for (let i = 0; i < numColumns; i++) {
            const col = document.getElementById(`field-${i}`);
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
            // No cards to shift
            if (this.skipDrawAfterShift) {
                // Deck is empty - just finish
                this.finishFlowSequence();
            } else {
                // Go straight to drawing
                this.startDrawSequence();
            }
            return;
        }

        this.animState = CardFlowSystem.SHIFTING;
        this.shiftIndex = 0;
        this.shiftCurrentCard();
    }

    shiftCurrentCard() {
        if (this.shiftIndex >= this.cardsToShift.length) {
            // All cards shifted
            if (this.skipDrawAfterShift) {
                // Deck is empty - just finish
                this.finishFlowSequence();
            } else {
                // Draw the new card
                this.startDrawSequence();
            }
            return;
        }

        const cardEid = this.cardsToShift[this.shiftIndex];
        this.animatingCard = cardEid;
        this.shiftStartTime = performance.now();
        this.shiftSoundPlayed = false;

        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Calculate target index (shiftFromIndex + current shift step)
        const targetIndex = this.shiftFromIndex + this.shiftIndex;

        // Update the card's index
        loc.index = targetIndex;

        // Get target position for this card's new slot
        const pos = this.call.getHandPosition(targetIndex);

        // Set position directly - CSS transition will animate it
        visual.x = pos.x;
        visual.y = pos.y;
        visual.targetX = pos.x;
        visual.targetY = pos.y;
        visual.zIndex = 10 + targetIndex;
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

        // Play draw sound
        if (this.call.playCardDraw) {
            this.call.playCardDraw();
        }

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

        // Play flip sound
        if (this.call.playCardFlip) {
            this.call.playCardFlip();
        }

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
        this.skipDrawAfterShift = false;
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

        const deckEmpty = this.call.getDeckCount() <= 0;
        const handCards = this.call.getHandCards();
        const hasHandCards = handCards.length > 0;

        // Show ghost card when:
        // - Hand is full and deck has cards (normal discard preview), OR
        // - Deck is empty but hand has cards (emptying hand preview)
        const shouldShowGhost = (this.call.isHandFull() && !deckEmpty) || (deckEmpty && hasHandCards);
        if (!shouldShowGhost) {
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

        const pos = this.call.getFieldPosition(nextCol);
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
                    // Play place sound when card lands
                    if (this.call.playCardPlace) {
                        this.call.playCardPlace();
                    }
                    this.startShiftSequence();
                }
                break;

            case CardFlowSystem.SHIFTING:
                // Wait for shift duration (time-based, not position-based)
                const shiftElapsed = performance.now() - this.shiftStartTime;

                // Play sound when card lands (at shiftDuration)
                if (!this.shiftSoundPlayed && shiftElapsed >= this.shiftDuration) {
                    if (this.call.playCardPlace) {
                        this.call.playCardPlace();
                    }
                    this.shiftSoundPlayed = true;
                }

                // Wait for landing gap after sound, then start next card
                if (shiftElapsed >= this.shiftDuration + this.shiftLandingGap) {
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

            case CardFlowSystem.PLAYING_TO_KINGDOM:
            case CardFlowSystem.PLAYING_TO_FIELD:
                // Wait for played card to finish animating to its destination
                if (this.isCardDoneAnimating(this.animatingCard)) {
                    // Play place sound when card lands
                    if (this.call.playCardPlace) {
                        this.call.playCardPlace();
                    }
                    // Now shift remaining hand cards and draw
                    this.startShiftSequence();
                }
                break;
        }

        // Update dump column highlight
        this.updateDumpHighlight();

        // Disable the deck button if:
        // - Currently animating, OR
        // - Deck is empty AND hand is empty (nothing left to discard)
        const deckArea = document.getElementById('deckArea');
        if (deckArea) {
            const deckEmpty = this.call.getDeckCount() <= 0;
            const handEmpty = this.call.getHandCards().length === 0;
            const isAnimating = this.animState !== CardFlowSystem.IDLE;
            deckArea.disabled = isAnimating || (deckEmpty && handEmpty);
        }
    }
}
