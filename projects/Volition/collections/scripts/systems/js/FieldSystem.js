/**
 * FieldSystem - Manages field columns for temporary card stacking
 * Rules: Alternating colors, descending rank (K->Q->J->10...->A)
 */
class FieldSystem extends GUTS.BaseSystem {
    static services = ['canPlayToField', 'playToField', 'dumpToField', 'getColumnCards', 'getFieldColumns', 'getBottomCard', 'getCardsBelow', 'isValidSequence', 'moveFieldToField', 'findEmptyColumn', 'refreshFieldPositions'];
    static serviceDependencies = ['removeFromHand', 'getFieldPosition', 'getStackOffset', 'refreshLayout', 'onCardPlayed', 'setNextDumpColumn'];

    constructor(game) {
        super(game);
        this.numColumns = 4;
    }

    init() {
        const config = this.game.gameInstance?.getConfig() || {};
        this.numColumns = config.fieldColumns || 4;
    }

    postAllInit() {
        this.createFieldColumns();
    }

    createFieldColumns() {
        // Skip DOM creation in headless mode
        const config = this.game.gameInstance?.getConfig() || {};
        if (config.isHeadless) return;

        const fieldArea = document.getElementById('fieldArea');
        if (!fieldArea) return;

        // Clear existing columns
        fieldArea.innerHTML = '';

        // Create columns based on numColumns setting
        for (let i = 0; i < this.numColumns; i++) {
            const col = document.createElement('div');
            col.className = 'field-column';
            col.id = `field-${i}`;
            fieldArea.appendChild(col);
        }

        // Notify LayoutSystem to refresh after creating columns
        this.call.refreshLayout();
    }

    getFieldColumns() {
        return this.numColumns;
    }

    findEmptyColumn() {
        for (let i = 0; i < this.numColumns; i++) {
            const cards = this.getColumnCards(i);
            if (cards.length === 0) {
                return i;
            }
        }
        return -1;
    }

    getColumnCards(columnIndex, includeAnimating = true) {
        const entities = this.game.getEntitiesWith('card', 'cardLocation', 'cardVisual');
        const columnCards = entities.filter(eid => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            if (loc.location !== 3 || loc.columnIndex !== columnIndex) return false;

            // Optionally filter out cards still animating (flying)
            if (!includeAnimating) {
                const visual = this.game.getComponent(eid, 'cardVisual');
                if (visual.animating === 1) return false;
            }
            return true;
        });

        // Sort by index (bottom to top)
        columnCards.sort((a, b) => {
            const locA = this.game.getComponent(a, 'cardLocation');
            const locB = this.game.getComponent(b, 'cardLocation');
            return locA.index - locB.index;
        });

        return columnCards;
    }

    getBottomCard(columnIndex) {
        const cards = this.getColumnCards(columnIndex);
        if (cards.length === 0) return null;
        return cards[cards.length - 1]; // Last card is the bottom (playable) card
    }

    isRedSuit(suit) {
        return suit === 0 || suit === 1; // hearts or diamonds
    }

    canPlayToField(cardEid, columnIndex) {
        const card = this.game.getComponent(cardEid, 'card');
        // Only check against landed cards (not flying/animating)
        const columnCards = this.getColumnCards(columnIndex, false);

        if (columnCards.length === 0) {
            // Empty column - any card can be placed
            return true;
        }

        // Get the bottom (top visually) landed card of the column
        const bottomCard = columnCards[columnCards.length - 1];
        const bottomCardData = this.game.getComponent(bottomCard, 'card');

        // Must be alternating colors
        const cardIsRed = this.isRedSuit(card.suit);
        const bottomIsRed = this.isRedSuit(bottomCardData.suit);
        if (cardIsRed === bottomIsRed) {
            return false; // Same color - not allowed
        }

        // Must be one rank lower
        return card.rank === bottomCardData.rank - 1;
    }

    playToField(cardEid, columnIndex) {
        if (!this.canPlayToField(cardEid, columnIndex)) {
            return false;
        }

        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Remove from previous location
        if (loc.location === 1) {
            this.call.removeFromHand(cardEid);
        }

        // Add to field - use landed cards only for correct index
        const landedCards = this.getColumnCards(columnIndex, false);

        loc.location = 3; // field
        loc.index = landedCards.length;
        loc.columnIndex = columnIndex;

        // Set target position from LayoutSystem
        const pos = this.call.getFieldPosition(columnIndex);
        const stackOffset = this.call.getStackOffset();
        visual.targetX = pos.x;
        visual.targetY = pos.y + loc.index * stackOffset;
        visual.zIndex = 50 + loc.index;

        // In headless mode, don't set animating (no render system to clear it)
        const config = this.game.gameInstance?.getConfig() || {};
        visual.animating = config.isHeadless ? 0 : 1;

        // Trigger event for other systems to react to
        const card = this.game.getComponent(cardEid, 'card');
        const bottomCardRank = landedCards.length > 0
            ? this.game.getComponent(landedCards[landedCards.length - 1], 'card').rank
            : null;

        this.game.triggerEvent('onCardPlayedToField', {
            cardEid,
            rank: card.rank,
            suit: card.suit,
            columnIndex,
            wasEmptyColumn: landedCards.length === 0,
            bottomCardRank
        });

        // Notify tutorial system if active
        if (this.call.onCardPlayed) {
            this.call.onCardPlayed('field', cardEid);
        }

        // Update round-robin discard column ONLY when filling an empty column
        if (landedCards.length === 0 && this.call.setNextDumpColumn) {
            this.call.setNextDumpColumn(columnIndex);
        }

        return true;
    }

    /**
     * Dump a card to field - ignores stacking rules (chaos mode)
     * Used when cards overflow from hand
     */
    dumpToField(cardEid, columnIndex) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const card = this.game.getComponent(cardEid, 'card');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Get current column cards BEFORE changing location
        const columnCards = this.getColumnCards(columnIndex);

        // Set card location to field (no validation)
        loc.location = 3; // field
        loc.index = columnCards.length;
        loc.columnIndex = columnIndex;

        // Ensure face up
        card.faceUp = 1;

        // Set target position from LayoutSystem
        const pos = this.call.getFieldPosition(columnIndex);
        const stackOffset = this.call.getStackOffset();
        visual.targetX = pos.x;
        visual.targetY = pos.y + loc.index * stackOffset;
        visual.zIndex = 50 + loc.index;

        // In headless mode, don't set animating (no render system to clear it)
        const config = this.game.gameInstance?.getConfig() || {};
        visual.animating = config.isHeadless ? 0 : 1;
    }

    /**
     * Get all cards at or below a given card in its column
     * Returns array sorted from the given card to the bottom (top visually)
     */
    getCardsBelow(cardEid) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        if (loc.location !== 3) return []; // Not on field

        const columnCards = this.getColumnCards(loc.columnIndex);
        const cardIndex = loc.index;

        // Return this card and all cards below it (higher index = lower in stack visually)
        return columnCards.filter(eid => {
            const l = this.game.getComponent(eid, 'cardLocation');
            return l.index >= cardIndex;
        });
    }

    /**
     * Check if a card and all cards below it form a valid Klondike sequence
     * (alternating colors, descending ranks)
     */
    isValidSequence(cardEid) {
        const cardsBelow = this.getCardsBelow(cardEid);
        if (cardsBelow.length === 0) return false;
        if (cardsBelow.length === 1) return true; // Single card is always valid

        // Check each pair of adjacent cards
        for (let i = 0; i < cardsBelow.length - 1; i++) {
            const upperCard = this.game.getComponent(cardsBelow[i], 'card');
            const lowerCard = this.game.getComponent(cardsBelow[i + 1], 'card');

            // Must be alternating colors
            const upperIsRed = this.isRedSuit(upperCard.suit);
            const lowerIsRed = this.isRedSuit(lowerCard.suit);
            if (upperIsRed === lowerIsRed) {
                return false; // Same color - invalid sequence
            }

            // Must be descending (upper card rank = lower card rank + 1)
            if (upperCard.rank !== lowerCard.rank + 1) {
                return false; // Not descending
            }
        }

        return true;
    }

    /**
     * Move a card (and all valid cards below it) from one field column to another
     */
    moveFieldToField(cardEid, targetColumn) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        if (loc.location !== 3) return false; // Not on field

        const sourceColumn = loc.columnIndex;
        if (sourceColumn === targetColumn) return false; // Same column

        // Check if the sequence is valid
        if (!this.isValidSequence(cardEid)) {
            return false; // Can't move chaotic stacks
        }

        // Check if the top card can be placed on target column
        if (!this.canPlayToField(cardEid, targetColumn)) {
            return false;
        }

        // Get all cards to move
        const cardsToMove = this.getCardsBelow(cardEid);

        // Get target column's landed card count for correct index
        const targetCards = this.getColumnCards(targetColumn, false);
        let targetIndex = targetCards.length;

        // In headless mode, don't set animating (no render system to clear it)
        const config = this.game.gameInstance?.getConfig() || {};
        const isHeadless = config.isHeadless || false;

        // Move each card
        for (const moveEid of cardsToMove) {
            const moveLoc = this.game.getComponent(moveEid, 'cardLocation');
            const moveVisual = this.game.getComponent(moveEid, 'cardVisual');

            moveLoc.columnIndex = targetColumn;
            moveLoc.index = targetIndex;

            // Set target position from LayoutSystem
            const pos = this.call.getFieldPosition(targetColumn);
            const stackOffset = this.call.getStackOffset();
            moveVisual.targetX = pos.x;
            moveVisual.targetY = pos.y + targetIndex * stackOffset;
            moveVisual.zIndex = 50 + targetIndex;
            moveVisual.animating = isHeadless ? 0 : 1;

            targetIndex++;
        }

        // Re-index source column
        this.reindexColumn(sourceColumn);

        // Trigger event for other systems to react to (e.g., king claiming empty column)
        const card = this.game.getComponent(cardEid, 'card');
        const wasEmptyColumn = targetCards.length === 0;
        const bottomCardRank = targetCards.length > 0
            ? this.game.getComponent(targetCards[targetCards.length - 1], 'card').rank
            : null;

        this.game.triggerEvent('onCardPlayedToField', {
            cardEid,
            rank: card.rank,
            suit: card.suit,
            columnIndex: targetColumn,
            wasEmptyColumn,
            bottomCardRank
        });

        // Update round-robin discard column ONLY when filling an empty column
        if (wasEmptyColumn && this.call.setNextDumpColumn) {
            this.call.setNextDumpColumn(targetColumn);
        }

        return true;
    }

    /**
     * Re-index cards in a column after removal
     */
    reindexColumn(columnIndex) {
        const columnCards = this.getColumnCards(columnIndex);
        const pos = this.call.getFieldPosition(columnIndex);
        const stackOffset = this.call.getStackOffset();
        columnCards.forEach((eid, idx) => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            const visual = this.game.getComponent(eid, 'cardVisual');

            loc.index = idx;
            visual.targetX = pos.x;
            visual.targetY = pos.y + idx * stackOffset;
            visual.zIndex = 50 + idx;
            visual.animating = 1;
        });
    }

    refreshFieldPositions() {
        const stackOffset = this.call.getStackOffset();
        for (let col = 0; col < this.numColumns; col++) {
            const pos = this.call.getFieldPosition(col);
            const columnCards = this.getColumnCards(col);
            columnCards.forEach((eid, idx) => {
                const visual = this.game.getComponent(eid, 'cardVisual');
                visual.targetX = pos.x;
                visual.targetY = pos.y + idx * stackOffset;
                visual.animating = 1;
            });
        }
    }

    update() {
        // Update field visuals if needed
    }
}
