/**
 * VolitionHeadlessSimulationSystem - Manages headless solitaire simulations
 * Provides action interface for AI to play the game without animations
 */
class VolitionHeadlessSimulationSystem extends GUTS.BaseSystem {
    static services = [
        // Simulation state
        'isSimulationComplete',
        'getSimulationResults',
        'resetSimulation',

        // Action interface (headless versions that skip animations)
        'headless_getHandCards',
        'headless_getColumnCards',
        'headless_getKingdomState',
        'headless_getDeckCount',
        'headless_getCard',
        'headless_canPlayToKingdom',
        'headless_canPlayToField',
        'headless_getValidMoves',
        'headless_playToKingdom',
        'headless_playToField',
        'headless_playFieldToKingdom',
        'headless_moveFieldToField',
        'headless_drawCard',

        // Win screen stub for service dependency
        'showWinScreen',

        // AI compatibility services (aliases for headless versions)
        'flowCard',
        'flowAfterHandPlay',
        'isFlowAnimating'
    ];

    static serviceDependencies = [
        // Core game services
        'getHandCards', 'pushToHand', 'popFromHandRaw', 'removeFromHand', 'isHandFull', 'getHandCapacity',
        'getColumnCards', 'getFieldColumns', 'getBottomCard', 'getCardsBelow',
        'canPlayToField', 'playToField', 'dumpToField', 'isValidSequence', 'moveFieldToField', 'findEmptyColumn',
        'canPlayToKingdom', 'playToKingdom', 'getTopKingdomRank', 'getTotalKingdomCards',
        'getDeckCount', 'dealCard', 'setSeed'
    ];

    constructor(game) {
        super(game);

        // Simulation state
        this._simulationComplete = false;
        this._won = false;
        this._moveCount = 0;
        this._moveLog = [];
        this._nextDumpColumn = 0;
        this._seed = null;
    }

    init() {
        console.log('[Headless] VolitionHeadlessSimulationSystem initializing...');
    }

    postAllInit() {
        // Event handler method will be called when game triggers 'onGameWon'
    }

    /**
     * Event handler for game won - called by triggerEvent('onGameWon', data)
     */
    onGameWon(data) {
        this._simulationComplete = true;
        this._won = true;
    }

    // === Simulation State ===

    resetSimulation() {
        this._simulationComplete = false;
        this._won = false;
        this._moveCount = 0;
        this._moveLog = [];
        this._nextDumpColumn = 0;
    }

    isSimulationComplete() {
        if (this._simulationComplete) return true;

        // Win: 52 cards in kingdom
        if (this.call.getTotalKingdomCards() === 52) {
            this._simulationComplete = true;
            this._won = true;
            return true;
        }

        // Loss: no valid moves and deck empty and hand can't be drawn
        if (this.call.getDeckCount() === 0) {
            const moves = this.headless_getValidMoves();
            if (moves.length === 0) {
                this._simulationComplete = true;
                this._won = false;
                return true;
            }
        }

        return false;
    }

    getSimulationResults() {
        return {
            won: this._won,
            kingdomCards: this.call.getTotalKingdomCards(),
            moveCount: this._moveCount,
            moveLog: this._moveLog,
            deckRemaining: this.call.getDeckCount(),
            handRemaining: this.call.getHandCards().length,
            seed: this._seed
        };
    }

    // === Stub for service dependency (called by KingdomSystem in headless mode) ===
    showWinScreen() {
        // No-op in headless mode - win is handled by event
        console.log('[Headless] Game won!');
    }

    // === AI compatibility services (same interface as visual mode) ===

    flowCard() {
        // Alias for headless_drawCard
        return this.headless_drawCard();
    }

    flowAfterHandPlay(cardEid, destination, originalIndex) {
        // In headless mode, hand refill is handled automatically by the play methods
        // No-op - just for API compatibility with visual AI
    }

    isFlowAnimating() {
        // No animations in headless mode
        return false;
    }

    // === Query Interface ===

    headless_getHandCards() {
        return this.call.getHandCards();
    }

    headless_getColumnCards(columnIndex) {
        return this.call.getColumnCards(columnIndex);
    }

    headless_getKingdomState() {
        const state = [];
        for (let suit = 0; suit < 4; suit++) {
            state[suit] = this.call.getTopKingdomRank(suit);
        }
        return state;
    }

    headless_getDeckCount() {
        return this.call.getDeckCount();
    }

    headless_getCard(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        return {
            suit: card.suit,
            rank: card.rank,
            faceUp: card.faceUp,
            location: loc.location,
            index: loc.index,
            columnIndex: loc.columnIndex
        };
    }

    headless_canPlayToKingdom(cardEid) {
        return this.call.canPlayToKingdom(cardEid);
    }

    headless_canPlayToField(cardEid, columnIndex) {
        return this.call.canPlayToField(cardEid, columnIndex);
    }

    /**
     * Get all valid moves from current state
     * Returns array of Move objects: { type, cardEid, targetColumn?, sourceColumn? }
     */
    headless_getValidMoves() {
        const moves = [];
        const handCards = this.call.getHandCards();
        const numColumns = this.call.getFieldColumns();

        // 1. Hand to Kingdom moves
        for (const cardEid of handCards) {
            if (this.call.canPlayToKingdom(cardEid)) {
                moves.push({ type: 'kingdom', cardEid, source: 'hand' });
            }
        }

        // 2. Field to Kingdom moves (bottom cards only)
        for (let col = 0; col < numColumns; col++) {
            const bottomCard = this.call.getBottomCard(col);
            if (bottomCard && this.call.canPlayToKingdom(bottomCard)) {
                moves.push({ type: 'kingdom', cardEid: bottomCard, source: 'field', sourceColumn: col });
            }
        }

        // 3. Hand to Field moves
        for (const cardEid of handCards) {
            for (let col = 0; col < numColumns; col++) {
                if (this.call.canPlayToField(cardEid, col)) {
                    moves.push({ type: 'field', cardEid, targetColumn: col, source: 'hand' });
                }
            }
        }

        // 4. Field to Field moves (valid sequences)
        for (let sourceCol = 0; sourceCol < numColumns; sourceCol++) {
            const columnCards = this.call.getColumnCards(sourceCol);
            for (const cardEid of columnCards) {
                // Check if this card starts a valid sequence
                if (this.call.isValidSequence(cardEid)) {
                    // Try moving to other columns
                    for (let targetCol = 0; targetCol < numColumns; targetCol++) {
                        if (targetCol !== sourceCol && this.call.canPlayToField(cardEid, targetCol)) {
                            moves.push({
                                type: 'move',
                                cardEid,
                                sourceColumn: sourceCol,
                                targetColumn: targetCol
                            });
                        }
                    }
                }
            }
        }

        // 5. Draw move (always available if deck has cards or hand can discard)
        if (this.call.getDeckCount() > 0) {
            moves.push({ type: 'draw' });
        }

        return moves;
    }

    // === Action Interface ===

    headless_playToKingdom(cardEid) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const source = loc.location === 1 ? 'hand' : 'field';

        if (!this.call.canPlayToKingdom(cardEid)) return false;

        // If from field, need to check it's a bottom card
        if (loc.location === 3) {
            const bottomCard = this.call.getBottomCard(loc.columnIndex);
            if (bottomCard !== cardEid) return false;
        }

        // Call the actual game service - this handles removal and reindexing via removeFromHand
        const success = this.call.playToKingdom(cardEid);
        if (success) {
            this._moveCount++;
            this._moveLog.push({ type: 'kingdom', cardEid, source });

            // Auto-refill hand if played from hand
            // This mirrors CardFlowSystem.flowAfterHandPlay behavior in graphical mode
            if (source === 'hand') {
                this._autoRefillHand();
            }
        }
        return success;
    }

    headless_playToField(cardEid, columnIndex) {
        if (!this.call.canPlayToField(cardEid, columnIndex)) return false;

        // Call the actual game service - playToField calls removeFromHand which reindexes
        const success = this.call.playToField(cardEid, columnIndex);
        if (success) {
            this._moveCount++;
            this._moveLog.push({ type: 'field', cardEid, targetColumn: columnIndex });
            // Auto-refill hand - mirrors CardFlowSystem.flowAfterHandPlay in graphical mode
            this._autoRefillHand();
        }
        return success;
    }

    headless_playFieldToKingdom(cardEid) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        if (loc.location !== 3) return false; // Not on field

        // Must be bottom card
        const bottomCard = this.call.getBottomCard(loc.columnIndex);
        if (bottomCard !== cardEid) return false;

        if (!this.call.canPlayToKingdom(cardEid)) return false;

        const success = this.call.playToKingdom(cardEid);
        if (success) {
            this._moveCount++;
            this._moveLog.push({ type: 'kingdom', cardEid, source: 'field', sourceColumn: loc.columnIndex });
        }
        return success;
    }

    headless_moveFieldToField(cardEid, targetColumn) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        if (loc.location !== 3) return false;

        const sourceColumn = loc.columnIndex;
        const success = this.call.moveFieldToField(cardEid, targetColumn);
        if (success) {
            this._moveCount++;
            this._moveLog.push({ type: 'move', cardEid, sourceColumn, targetColumn });
        }
        return success;
    }

    /**
     * Draw a card from deck - simplified flow without animation state machine
     * If hand is full, oldest card is dumped to field first
     */
    headless_drawCard() {
        const deckCount = this.call.getDeckCount();
        if (deckCount === 0) return false;

        const handCapacity = this.call.getHandCapacity();

        // If hand is full, dump oldest card to field
        if (this.call.isHandFull()) {
            const oldestCard = this.call.popFromHandRaw();
            if (oldestCard) {
                // Find column for dump - prefer empty, else round-robin
                const emptyCol = this.call.findEmptyColumn();
                const targetCol = emptyCol >= 0 ? emptyCol : this._nextDumpColumn;

                this.call.dumpToField(oldestCard, targetCol);

                // Update round-robin counter
                this._nextDumpColumn = (this._nextDumpColumn + 1) % this.call.getFieldColumns();

                // Reindex remaining hand cards
                this._reindexHand();
            }
        }

        // Deal new card from deck
        const cardEid = this.call.dealCard();
        if (cardEid) {
            // Push to hand
            this.call.pushToHand(cardEid);
            this._moveCount++;
            this._moveLog.push({ type: 'draw', cardEid });
            return true;
        }

        return false;
    }

    // === Internal Helpers ===

    /**
     * Auto-refill hand from deck after playing a card
     * This matches the graphical game behavior where hand auto-refills
     */
    _autoRefillHand() {
        if (this.call.getDeckCount() === 0) return; // No cards left to draw

        const cardEid = this.call.dealCard();
        if (cardEid) {
            this.call.pushToHand(cardEid);
        }
    }

    _reindexHand() {
        const handCards = this.call.getHandCards();
        handCards.forEach((eid, idx) => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            loc.index = idx;
        });
    }

    update() {
        // No per-frame updates needed in headless mode
    }
}
