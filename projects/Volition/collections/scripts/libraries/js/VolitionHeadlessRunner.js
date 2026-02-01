/**
 * VolitionHeadlessRunner - High-level API for running headless Volition simulations
 * Provides programmatic interface for AI to play the game
 */
class VolitionHeadlessRunner {
    constructor(engine) {
        this.engine = engine;
        this.game = null;
        this.simSystem = null;
        this.seed = null;
        this.verbose = false;
        this._lastMove = null; // Track last move to avoid reversals
        this._recentFieldMoves = []; // Track recent field-to-field moves to avoid cycles
        this._maxRecentMoves = 10; // How many moves to remember
    }

    /**
     * Set up a new game
     * @param {Object} config
     * @param {number} config.seed - Random seed for reproducible shuffles
     * @param {boolean} config.verbose - Log moves to console
     */
    async setup(config = {}) {
        this.seed = config.seed || Math.floor(Math.random() * 2147483647);
        this.verbose = config.verbose || false;

        // Get game instance
        this.game = this.engine.gameInstance;

        // Set seed before shuffle
        const deckSystem = this.game.systemsByName.get('DeckSystem');
        if (deckSystem && config.seed !== undefined) {
            deckSystem.setSeed(this.seed);
        }

        // Get simulation system reference
        this.simSystem = this.game.systemsByName.get('VolitionHeadlessSimulationSystem');
        if (!this.simSystem) {
            throw new Error('VolitionHeadlessSimulationSystem not found');
        }

        // Reset simulation state
        this.simSystem.resetSimulation();
        this.simSystem._seed = this.seed;
        this._lastMove = null;
        this._recentFieldMoves = [];

        if (this.verbose) {
            console.log(`[Runner] Game setup with seed: ${this.seed}`);
        }
    }

    /**
     * Run the game with the heuristic AI
     * @param {Object} options
     * @param {number} options.maxMoves - Maximum moves before stopping (default: 1000)
     * @returns {Object} Simulation results
     */
    async run(options = {}) {
        const maxMoves = options.maxMoves || 1000;
        let moveCount = 0;

        while (!this.isGameOver() && moveCount < maxMoves) {
            const moveMade = this._makeHeuristicMove();
            if (!moveMade) {
                // No valid moves and can't draw - game over
                break;
            }
            moveCount++;
        }

        const results = this.getResults();
        if (this.verbose) {
            console.log(`[Runner] Game ${results.won ? 'WON' : 'LOST'} - ${results.kingdomCards}/52 cards, ${results.moveCount} moves`);
        }

        return results;
    }

    // === Action Interface (delegated to simulation system) ===

    getHandCards() {
        return this.simSystem.headless_getHandCards();
    }

    getColumnCards(columnIndex) {
        return this.simSystem.headless_getColumnCards(columnIndex);
    }

    getKingdomState() {
        return this.simSystem.headless_getKingdomState();
    }

    getDeckCount() {
        return this.simSystem.headless_getDeckCount();
    }

    getCard(cardEid) {
        return this.simSystem.headless_getCard(cardEid);
    }

    canPlayToKingdom(cardEid) {
        return this.simSystem.headless_canPlayToKingdom(cardEid);
    }

    canPlayToField(cardEid, columnIndex) {
        return this.simSystem.headless_canPlayToField(cardEid, columnIndex);
    }

    getValidMoves() {
        return this.simSystem.headless_getValidMoves();
    }

    playToKingdom(cardEid) {
        const success = this.simSystem.headless_playToKingdom(cardEid);
        if (success && this.verbose) {
            const card = this.getCard(cardEid);
            console.log(`  -> Kingdom: ${this._cardName(card)}`);
        }
        return success;
    }

    playToField(cardEid, columnIndex) {
        const success = this.simSystem.headless_playToField(cardEid, columnIndex);
        if (success && this.verbose) {
            const card = this.getCard(cardEid);
            console.log(`  -> Field[${columnIndex}]: ${this._cardName(card)}`);
        }
        return success;
    }

    playFieldToKingdom(cardEid) {
        const success = this.simSystem.headless_playFieldToKingdom(cardEid);
        if (success && this.verbose) {
            const card = this.getCard(cardEid);
            console.log(`  -> Field->Kingdom: ${this._cardName(card)}`);
        }
        return success;
    }

    moveFieldToField(cardEid, targetColumn) {
        const success = this.simSystem.headless_moveFieldToField(cardEid, targetColumn);
        if (success && this.verbose) {
            const card = this.getCard(cardEid);
            console.log(`  -> Move: ${this._cardName(card)} to column ${targetColumn}`);
        }
        return success;
    }

    drawCard() {
        const success = this.simSystem.headless_drawCard();
        if (success && this.verbose) {
            console.log(`  -> Draw`);
        }
        return success;
    }

    executeMove(move) {
        switch (move.type) {
            case 'kingdom':
                if (move.source === 'field') {
                    return this.playFieldToKingdom(move.cardEid);
                }
                return this.playToKingdom(move.cardEid);
            case 'field':
                return this.playToField(move.cardEid, move.targetColumn);
            case 'move':
                return this.moveFieldToField(move.cardEid, move.targetColumn);
            case 'draw':
                return this.drawCard();
            default:
                return false;
        }
    }

    // === State Queries ===

    isGameOver() {
        return this.simSystem.isSimulationComplete();
    }

    isWon() {
        return this.simSystem.getSimulationResults().won;
    }

    getResults() {
        return this.simSystem.getSimulationResults();
    }

    // === Heuristic AI ===

    /**
     * Make a single move using heuristic strategy
     * Priority: 1) Kingdom, 2) Hand-to-field, 3) Field-to-field, 4) Draw
     * @returns {boolean} Whether a move was made
     */
    _makeHeuristicMove() {
        const moves = this.getValidMoves();
        if (moves.length === 0) return false;

        // Categorize moves
        const kingdomMoves = moves.filter(m => m.type === 'kingdom');
        const handToFieldMoves = moves.filter(m => m.type === 'field' && m.source === 'hand');
        const fieldToFieldMoves = moves.filter(m => m.type === 'move');
        const drawMoves = moves.filter(m => m.type === 'draw');

        // Debug: Log field-to-field moves if verbose
        if (this.verbose && fieldToFieldMoves.length > 0) {
            console.log(`  [DEBUG] ${fieldToFieldMoves.length} field moves available`);
        }

        // 1. Always do kingdom plays first
        if (kingdomMoves.length > 0) {
            const scored = this._scoreAndSort(kingdomMoves);
            for (const { move } of scored) {
                if (this.executeMove(move)) {
                    this._lastMove = move;
                    return true;
                }
            }
        }

        // 2. Always play from hand if possible
        if (handToFieldMoves.length > 0) {
            const scored = this._scoreAndSort(handToFieldMoves);
            for (const { move, score } of scored) {
                // Skip only truly terrible moves (covering kingdom-next cards)
                if (score < -1500) continue;
                if (this.executeMove(move)) {
                    this._lastMove = move;
                    return true;
                }
            }
        }

        // 3. Field reorganization
        if (fieldToFieldMoves.length > 0) {
            const scored = this._scoreAndSort(fieldToFieldMoves);
            for (const { move, score } of scored) {
                // Skip reversals, cycles, and bad moves
                if (score < -5000) continue;
                if (this._isRecentMove(move)) continue;
                if (this.executeMove(move)) {
                    this._lastMove = move;
                    this._trackFieldMove(move);
                    return true;
                }
            }
        }

        // 4. Draw only as last resort
        if (drawMoves.length > 0) {
            if (this.executeMove(drawMoves[0])) {
                this._lastMove = drawMoves[0];
                return true;
            }
        }

        return false;
    }

    /**
     * Score and sort moves by score (descending)
     */
    _scoreAndSort(moves) {
        const scored = moves.map(move => ({
            move,
            score: this._scoreMove(move)
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored;
    }

    /**
     * Score a move for the heuristic AI
     * Higher scores are better moves
     *
     * Priority order:
     * 1. Kingdom plays (10000+) - always best
     * 2. Field-to-field moves that expose kingdom-playable cards (5000+)
     * 3. Field-to-field moves that build sequences/expose low cards (500-2000)
     * 4. Hand-to-field moves (100-500)
     * 5. Draw (-1000) - absolute last resort
     */
    _scoreMove(move) {
        // Check if this move reverses the last move (moving same card back)
        if (this._isReversal(move)) {
            return -100000; // Never reverse immediately
        }

        const kingdomState = this.getKingdomState();

        switch (move.type) {
            case 'kingdom':
                return this._scoreKingdomMove(move, kingdomState);

            case 'field':
                return this._scoreHandToFieldMove(move, kingdomState);

            case 'move':
                return this._scoreFieldToFieldMove(move, kingdomState);

            case 'draw':
                return this._scoreDrawMove(kingdomState);

            default:
                return 0;
        }
    }

    /**
     * Score kingdom moves - always highest priority
     */
    _scoreKingdomMove(move, kingdomState) {
        let score = 10000;
        const card = this.getCard(move.cardEid);

        // Playing from field is better (exposes more cards)
        if (move.source === 'field') {
            score += 500;

            // Even better if it exposes another kingdom-playable card
            const columnCards = this.getColumnCards(move.sourceColumn);
            const cardIndex = columnCards.indexOf(move.cardEid);
            if (cardIndex > 0) {
                const exposedEid = columnCards[cardIndex - 1];
                const exposed = this.getCard(exposedEid);
                if (exposed.rank === kingdomState[exposed.suit] + 1) {
                    score += 200; // Chain kingdom play possible
                }
            }
        }

        // Prefer lower ranks first (Aces most important)
        score -= card.rank * 10;

        return score;
    }

    /**
     * Score hand-to-field moves
     * Consider which card is oldest (will be dumped if we draw)
     */
    _scoreHandToFieldMove(move, kingdomState) {
        const card = this.getCard(move.cardEid);
        const columnCards = this.getColumnCards(move.targetColumn);
        const handCards = this.getHandCards();

        // Check if this card is the oldest (would be dumped on draw)
        const isOldestCard = handCards.length > 0 && handCards[0] === move.cardEid;
        const oldestCard = handCards.length > 0 ? this.getCard(handCards[0]) : null;

        // Kings on empty columns are excellent - claim the space
        if (card.rank === 13 && columnCards.length === 0) {
            let score = 800;
            // Even better if it's the oldest card (saves it from dump)
            if (isOldestCard) score += 200;
            return score;
        }

        // Non-Kings on empty columns waste valuable space
        if (columnCards.length === 0) {
            // But if it's the oldest card and important, might be worth it
            if (isOldestCard && card.rank <= 4) {
                return 100; // Better than being dumped randomly
            }
            return -500;
        }

        let score = 50; // Base score - lower than field reorganization

        // HUGE bonus for playing the oldest card (prevents bad dump)
        if (isOldestCard) {
            score += 500;
            // Extra bonus if oldest card is low rank (important to save)
            if (card.rank <= 4) {
                score += 300;
            }
        }

        // Get the bottom card we'd be covering
        const bottomCardEid = columnCards[columnCards.length - 1];
        const bottomCard = this.getCard(bottomCardEid);

        // CRITICAL: Avoid covering low cards that are close to kingdom-playable
        const bottomDistToKingdom = bottomCard.rank - kingdomState[bottomCard.suit];
        if (bottomDistToKingdom === 1) {
            // This card is NEXT to play - never cover it!
            // Unless we're saving a very important oldest card
            if (isOldestCard && card.rank <= 2) {
                return 100; // Desperate move but acceptable
            }
            return -2000;
        } else if (bottomDistToKingdom === 2) {
            score -= 800;
        } else if (bottomDistToKingdom <= 4) {
            score -= 300;
        }

        // Prefer covering high cards (they won't be playable for a while anyway)
        score += bottomCard.rank * 8;

        // Bonus for building longer sequences
        const currentSeqLen = this._getSequenceLength(move.targetColumn);
        score += currentSeqLen * 20;

        // Prefer playing high cards from hand (save low cards for kingdom)
        score += card.rank * 3;

        return score;
    }

    /**
     * Score field-to-field moves - key to winning
     * These are generally the most important moves for winning
     */
    _scoreFieldToFieldMove(move, kingdomState) {
        const card = this.getCard(move.cardEid);
        const sourceCards = this.getColumnCards(move.sourceColumn);
        const targetCards = this.getColumnCards(move.targetColumn);
        let score = 200; // Start positive - reorganizing is usually good

        // Find what card would be exposed
        const exposedCardEid = this._getExposedCardAfterMove(move);
        const cardIndex = sourceCards.indexOf(move.cardEid);
        const willFreeColumn = cardIndex === 0; // Moving from top = column becomes empty

        if (exposedCardEid) {
            const exposed = this.getCard(exposedCardEid);
            const distToKingdom = exposed.rank - kingdomState[exposed.suit];

            // HUGE bonus for exposing a kingdom-playable card
            if (distToKingdom === 1) {
                score += 5000;
            }
            // Good bonus for exposing cards close to playable
            else if (distToKingdom === 2) {
                score += 2000;
            } else if (distToKingdom === 3) {
                score += 800;
            } else if (distToKingdom === 4) {
                score += 400;
            } else if (distToKingdom === 5) {
                score += 200;
            }

            // Bonus for exposing low-rank cards (they'll be playable sooner)
            if (exposed.rank <= 5) {
                score += (6 - exposed.rank) * 150;
            }
        }

        // Bonus if this move frees up a column (for Kings)
        if (willFreeColumn) {
            score += 400;

            // Extra bonus if we have Kings in hand that could use this column
            const handCards = this.getHandCards();
            for (const handEid of handCards) {
                const handCard = this.getCard(handEid);
                if (handCard.rank === 13) {
                    score += 200;
                    break;
                }
            }
        }

        // Moving to an empty column with non-King is usually bad (wastes slot)
        if (targetCards.length === 0 && card.rank !== 13) {
            score -= 400;
        }

        // Bonus for building longer sequences
        const sourceSeqLen = this._getMovingSequenceLength(move.cardEid, move.sourceColumn);
        const targetSeqLen = this._getSequenceLength(move.targetColumn);
        const newSeqLen = sourceSeqLen + targetSeqLen;
        score += newSeqLen * 30;

        // BIG bonus for consolidating single cards into sequences
        if (sourceSeqLen === 1 && targetCards.length > 0) {
            score += 300; // Moving a lone card to build a sequence is great
        }

        // Penalty if we're covering a low card on the target
        if (targetCards.length > 0) {
            const targetBottomEid = targetCards[targetCards.length - 1];
            const targetBottom = this.getCard(targetBottomEid);
            const targetDistToKingdom = targetBottom.rank - kingdomState[targetBottom.suit];

            if (targetDistToKingdom === 1) {
                // Covering a card that's next to play - very bad
                score -= 1500;
            } else if (targetDistToKingdom === 2) {
                score -= 600;
            } else if (targetDistToKingdom <= 4) {
                score -= 200;
            }
        }

        return score;
    }

    /**
     * Score draw moves - ABSOLUTE LAST RESORT
     * Only draw when there are no productive field moves
     */
    _scoreDrawMove(kingdomState) {
        // Base score is very negative - only draw if nothing else works
        let score = -2000;

        const handCards = this.getHandCards();
        const handCapacity = 5;

        // If hand is full, a card will be dumped - analyze the impact
        if (handCards.length >= handCapacity) {
            const oldestCardEid = handCards[0];
            const oldestCard = this.getCard(oldestCardEid);
            const distToKingdom = oldestCard.rank - kingdomState[oldestCard.suit];

            // Check if oldest card can be played anywhere
            const canPlayOldest = this._canPlayCardAnywhere(oldestCardEid, kingdomState);
            if (canPlayOldest) {
                // We should play this card instead of drawing!
                score -= 3000;
            }

            // If we're about to discard a low card, it's catastrophic
            if (oldestCard.rank <= 2) {
                score -= 3000;
            } else if (oldestCard.rank <= 4) {
                score -= 1500;
            } else if (distToKingdom <= 2) {
                // Card close to being playable - don't lose it
                score -= 1000;
            }

            // High cards are safer to discard (they won't be playable for a while)
            score += oldestCard.rank * 20;

            // Check where the card would be dumped and if that's bad
            const dumpColumn = this._predictDumpColumn();
            if (dumpColumn >= 0) {
                const colCards = this.getColumnCards(dumpColumn);
                if (colCards.length > 0) {
                    const bottomEid = colCards[colCards.length - 1];
                    const bottomCard = this.getCard(bottomEid);
                    const bottomDist = bottomCard.rank - kingdomState[bottomCard.suit];

                    // Dumping on a card close to kingdom is bad
                    if (bottomDist <= 2) {
                        score -= 500;
                    }
                }
            }
        }

        // If deck is empty, can't draw anyway
        if (this.getDeckCount() === 0) {
            return -100000;
        }

        return score;
    }

    /**
     * Check if a card can be played anywhere (kingdom or field)
     */
    _canPlayCardAnywhere(cardEid, kingdomState) {
        // Check kingdom
        if (this.canPlayToKingdom(cardEid)) {
            return true;
        }

        // Check all field columns
        const numColumns = 6;
        for (let col = 0; col < numColumns; col++) {
            if (this.canPlayToField(cardEid, col)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Predict which column a card would be dumped to
     */
    _predictDumpColumn() {
        // Mirror the logic in headless_drawCard
        const numColumns = 6;

        // First check for empty columns
        for (let col = 0; col < numColumns; col++) {
            if (this.getColumnCards(col).length === 0) {
                return col;
            }
        }

        // Otherwise it's round-robin (we don't have access to the counter, but can estimate)
        return -1; // Unknown
    }

    /**
     * Get the length of a valid sequence in a column (from bottom)
     */
    _getSequenceLength(columnIndex) {
        const cards = this.getColumnCards(columnIndex);
        if (cards.length === 0) return 0;

        let length = 1;
        for (let i = cards.length - 2; i >= 0; i--) {
            const upper = this.getCard(cards[i]);
            const lower = this.getCard(cards[i + 1]);

            if (this._isValidSequence(upper, lower)) {
                length++;
            } else {
                break;
            }
        }

        return length;
    }

    /**
     * Get the length of the sequence being moved (from the moved card down)
     */
    _getMovingSequenceLength(cardEid, columnIndex) {
        const cards = this.getColumnCards(columnIndex);
        const cardIndex = cards.indexOf(cardEid);
        if (cardIndex < 0) return 0;

        // Count cards from this card to bottom
        return cards.length - cardIndex;
    }

    /**
     * Check if two cards form a valid sequence (alternating colors, descending rank)
     */
    _isValidSequence(upperCard, lowerCard) {
        const upperRed = upperCard.suit === 0 || upperCard.suit === 1;
        const lowerRed = lowerCard.suit === 0 || lowerCard.suit === 1;
        return upperRed !== lowerRed && upperCard.rank === lowerCard.rank + 1;
    }

    /**
     * Get the card that would be exposed after a move
     */
    _getExposedCardAfterMove(move) {
        if (move.type !== 'move') return null;

        const columnCards = this.getColumnCards(move.sourceColumn);

        // Find index of the card being moved
        const cardIndex = columnCards.indexOf(move.cardEid);
        if (cardIndex <= 0) return null;

        // The card above it would be exposed
        return columnCards[cardIndex - 1];
    }

    /**
     * Format card for display
     */
    _cardName(card) {
        const suits = ['♥', '♦', '♣', '♠'];
        const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        return ranks[card.rank] + suits[card.suit];
    }

    /**
     * Check if a move reverses the last move or is futile
     */
    _isReversal(move) {
        if (!this._lastMove) return false;

        // If last move was field-to-field, check if this is the reverse
        if (this._lastMove.type === 'move' && move.type === 'move') {
            // Direct reversal: moving same card back
            if (this._lastMove.cardEid === move.cardEid &&
                this._lastMove.sourceColumn === move.targetColumn &&
                this._lastMove.targetColumn === move.sourceColumn) {
                return true;
            }

            // Futile shuffle: moving a King between empty columns
            const card = this.getCard(move.cardEid);
            if (card.rank === 13) {
                const sourceCards = this.getColumnCards(move.sourceColumn);
                const targetCards = this.getColumnCards(move.targetColumn);
                // If King is only card in source and target is empty, it's just shuffling
                if (sourceCards.length === 1 && targetCards.length === 0) {
                    return true;
                }
            }
        }

        return false;
    }
}

// Export for GUTS
if (typeof GUTS !== 'undefined') {
    GUTS.VolitionHeadlessRunner = VolitionHeadlessRunner;
}
