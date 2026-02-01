/**
 * VolitionAIPlayerSystem - AI player for visual simulation mode
 *
 * Uses the SAME interface as human player (InputSystem):
 * - Calls playToKingdom, playToField, moveFieldToField services
 * - Calls flowAfterHandPlay after playing from hand
 * - Calls flowCard to draw
 *
 * This ensures the AI uses the same code paths as the player,
 * making it a true simulation of the game.
 */
class VolitionAIPlayerSystem extends GUTS.BaseSystem {
    static services = ['startAISimulation', 'stopAISimulation', 'setAISpeed', 'getMoveCount', 'isActive'];
    static serviceDependencies = [
        // Game query services
        'getHandCards', 'getColumnCards', 'getFieldColumns', 'getBottomCard',
        'canPlayToKingdom', 'canPlayToField', 'isValidSequence',
        'getDeckCount', 'getTopKingdomRank', 'getTotalKingdomCards', 'isHandFull',
        'isGameOver',
        // Game action services (same as InputSystem uses)
        'playToKingdom', 'playToField', 'moveFieldToField',
        'flowAfterHandPlay', 'flowCard', 'isFlowAnimating',
        // Game over services
        'showLossScreen', 'showWinScreen'
    ];

    constructor(game) {
        super(game);
        this._active = false;
        this._moveDelay = 1000; // ms between moves
        this._lastMoveTime = 0;
        this._moveCount = 0;
        this._recentMoves = []; // Track recent moves to avoid cycles
        this._isHeadless = false;
    }

    init() {
        console.log('[AI] VolitionAIPlayerSystem initializing...');
        // Detect headless mode and scale move delay based on animation speed
        const config = this.game.getConfig?.() || {};
        this._isHeadless = config.isHeadless || false;
        if (this._isHeadless) {
            console.log('[AI] Running in headless mode');
        }

        // Scale AI move delay based on animation speed
        // Default speed is 4000, scale delay inversely (faster animations = shorter delay)
        const animSpeed = config.animationSpeed !== undefined ? config.animationSpeed : 4000;
        const speedMultiplier = 4000 / Math.max(animSpeed, 1);
        this._moveDelay = Math.max(1000 * speedMultiplier, 100); // Min 100ms delay
        this._isInstant = animSpeed >= 10000; // Consider "instant" if speed >= 10000
        console.log(`[AI] Move delay set to ${this._moveDelay}ms based on animation speed ${animSpeed}`);
    }

    postAllInit() {
        // Check if we should auto-start (simulation mode via config or URL param)
        // Usage: index.html?ai=true or index.html?ai=true&speed=500
        const config = this.game.getConfig?.() || {};
        const urlParams = new URLSearchParams(window.location?.search || '');
        const isSimulation = config.isSimulation || urlParams.get('ai') === 'true';

        // Get speed from URL if provided (default 1000ms)
        const speedParam = urlParams.get('speed');
        if (speedParam) {
            this._moveDelay = parseInt(speedParam, 10);
            console.log(`[AI] Speed set to ${this._moveDelay}ms from URL`);
        }

        if (isSimulation) {
            // Delay start to let cards be dealt and animations settle
            setTimeout(() => {
                console.log('[AI] Auto-starting simulation mode');
                this.startAISimulation();
            }, 2000);
        }
    }

    onSceneLoad() {
        // Auto-start AI when game scene loads (if in simulation mode)
        const config = this.game.getConfig?.() || {};
        const urlParams = new URLSearchParams(window.location?.search || '');
        const isSimulation = config.isSimulation || urlParams.get('ai') === 'true';

        if (isSimulation) {
            setTimeout(() => {
                console.log('[AI] Scene loaded - starting AI');
                this.startAISimulation();
            }, 2000);
        }
    }

    // === Public Services ===

    startAISimulation() {
        console.log('[AI] Starting AI simulation');
        this._active = true;
        this._moveCount = 0;
        this._recentMoves = [];
        this._lastMoveTime = performance.now();
    }

    stopAISimulation() {
        console.log('[AI] Stopping AI simulation');
        this._active = false;
    }

    setAISpeed(delayMs) {
        this._moveDelay = delayMs;
        console.log(`[AI] Move delay set to ${delayMs}ms`);
    }

    // === AI Logic ===

    /**
     * Get all valid moves from current state
     * Same logic as VolitionHeadlessSimulationSystem but uses same services
     */
    _getValidMoves() {
        const moves = [];
        const handCards = this.call.getHandCards();
        const numColumns = this.call.getFieldColumns();

        // 1. Hand to Kingdom moves (highest priority)
        for (const cardEid of handCards) {
            if (this.call.canPlayToKingdom(cardEid)) {
                const card = this.game.getComponent(cardEid, 'card');
                const loc = this.game.getComponent(cardEid, 'cardLocation');
                moves.push({
                    type: 'kingdom',
                    cardEid,
                    source: 'hand',
                    originalIndex: loc.index,
                    rank: card.rank,
                    suit: card.suit
                });
            }
        }

        // 2. Field to Kingdom moves (bottom cards only)
        for (let col = 0; col < numColumns; col++) {
            const bottomCard = this.call.getBottomCard(col);
            if (bottomCard && this.call.canPlayToKingdom(bottomCard)) {
                const card = this.game.getComponent(bottomCard, 'card');
                moves.push({
                    type: 'kingdom',
                    cardEid: bottomCard,
                    source: 'field',
                    sourceColumn: col,
                    rank: card.rank,
                    suit: card.suit
                });
            }
        }

        // 3. Hand to Field moves
        for (const cardEid of handCards) {
            const card = this.game.getComponent(cardEid, 'card');
            const loc = this.game.getComponent(cardEid, 'cardLocation');
            for (let col = 0; col < numColumns; col++) {
                if (this.call.canPlayToField(cardEid, col)) {
                    moves.push({
                        type: 'field',
                        cardEid,
                        targetColumn: col,
                        source: 'hand',
                        originalIndex: loc.index,
                        rank: card.rank,
                        suit: card.suit
                    });
                }
            }
        }

        // 4. Field to Field moves (valid sequences)
        for (let sourceCol = 0; sourceCol < numColumns; sourceCol++) {
            const columnCards = this.call.getColumnCards(sourceCol);
            for (const cardEid of columnCards) {
                if (this.call.isValidSequence(cardEid)) {
                    const card = this.game.getComponent(cardEid, 'card');
                    for (let targetCol = 0; targetCol < numColumns; targetCol++) {
                        if (targetCol !== sourceCol && this.call.canPlayToField(cardEid, targetCol)) {
                            moves.push({
                                type: 'move',
                                cardEid,
                                sourceColumn: sourceCol,
                                targetColumn: targetCol,
                                rank: card.rank,
                                suit: card.suit
                            });
                        }
                    }
                }
            }
        }

        return moves;
    }

    /**
     * Score a move for AI decision making
     * Higher score = better move
     */
    _scoreMove(move) {
        let score = 0;

        // Kingdom moves are always best
        if (move.type === 'kingdom') {
            score = 10000 + move.rank; // Prefer lower ranks first (Aces!)
            if (move.source === 'field') {
                score += 500; // Bonus for freeing field cards
            }
            return score;
        }

        // Avoid repeating recent moves (cycle prevention)
        if (this._isRecentMove(move)) {
            return -10000;
        }

        // Field-to-field moves
        if (move.type === 'move') {
            const sourceCards = this.call.getColumnCards(move.sourceColumn);
            const targetCards = this.call.getColumnCards(move.targetColumn);
            const cardIndex = sourceCards.indexOf(move.cardEid);

            // Check if this move exposes a useful card
            let exposesUsefulCard = false;
            if (cardIndex > 0) {
                const exposedCard = sourceCards[cardIndex - 1];
                const exposedCardData = this.game.getComponent(exposedCard, 'card');
                const kingdomRank = this.call.getTopKingdomRank(exposedCardData.suit);
                if (exposedCardData.rank === kingdomRank + 1) {
                    exposesUsefulCard = true;
                }
            }

            // Moving to empty column
            if (targetCards.length === 0) {
                // Lone card to empty column = pointless (just shuffling between columns)
                if (sourceCards.length === 1) {
                    return -10000;
                }
                // Moving stack to empty column - only Kings should do this
                if (exposesUsefulCard) {
                    score = 5000; // Good - exposes kingdom-playable card
                } else if (move.rank === 13 && cardIndex > 0) {
                    score = 1500; // King claims empty column and exposes cards
                } else {
                    // Non-kings should NOT use empty columns (prefer drawing)
                    return -6000;
                }
            } else {
                // Building sequences on existing stacks - this is always good!
                // Consolidating cards frees up columns and builds longer sequences
                score = 3000;

                // Bonus for consolidating lone cards (frees up a column!)
                if (sourceCards.length === 1) {
                    score += 2000; // Freeing up a column is valuable
                }

                // Bonus for longer target stack (building longer sequences)
                score += targetCards.length * 50;

                // Big bonus if this exposes cards we can play to kingdom
                if (exposesUsefulCard) {
                    score += 5000;
                }
            }
            return score;
        }

        // Hand to Field moves
        if (move.type === 'field') {
            const targetCards = this.call.getColumnCards(move.targetColumn);

            if (targetCards.length === 0) {
                // Empty column - only Kings should go here from hand
                if (move.rank === 13) {
                    score = 800; // Kings claim empty columns well
                } else {
                    // Non-kings should NOT use empty columns (last resort only)
                    return -6000;
                }
            } else {
                // Building on existing stacks - preferred for non-kings
                score = 500;

                // Prefer playing high cards (they're harder to place later)
                score += move.rank * 20;

                // Prefer longer target stacks
                score += targetCards.length * 30;
            }
            return score;
        }

        return score;
    }

    _isRecentMove(move) {
        for (const recent of this._recentMoves) {
            if (move.type === 'move' && recent.type === 'move') {
                // Check if this reverses a recent move
                if (move.sourceColumn === recent.targetColumn &&
                    move.targetColumn === recent.sourceColumn &&
                    move.cardEid === recent.cardEid) {
                    return true;
                }
            }
        }
        return false;
    }

    _recordMove(move) {
        this._recentMoves.push(move);
        // Keep only last 10 moves
        if (this._recentMoves.length > 10) {
            this._recentMoves.shift();
        }
    }

    /**
     * Execute a move using the same interface as InputSystem
     */
    _executeMove(move) {
        this._moveCount++;
        this._recordMove(move);

        if (this._isHeadless && this._moveCount <= 30) {
            const handBefore = this.call.getHandCards().length;
            const deckBefore = this.call.getDeckCount();
            const kingdomBefore = this.call.getTotalKingdomCards();
            console.log(`[AI DEBUG ${this._moveCount}] ${move.type} ${this._cardName(move)} | hand=${handBefore} deck=${deckBefore} kingdom=${kingdomBefore}`);
        }

        if (move.type === 'kingdom') {
            // Play to kingdom - same as InputSystem.onDoubleClick
            const success = this.call.playToKingdom(move.cardEid);
            if (success && move.source === 'hand') {
                // Flow after hand play - same as InputSystem
                this.call.flowAfterHandPlay?.(move.cardEid, 'kingdom', move.originalIndex);
            }
            if (!this._isHeadless) console.log(`[AI] Move ${this._moveCount}: Play ${this._cardName(move)} to kingdom`);
            return success;
        }

        if (move.type === 'field') {
            // Play from hand to field - same as InputSystem.endDrag
            const success = this.call.playToField(move.cardEid, move.targetColumn);
            if (success) {
                // Flow after hand play
                this.call.flowAfterHandPlay?.(move.cardEid, 'field', move.originalIndex);
            }
            if (!this._isHeadless) console.log(`[AI] Move ${this._moveCount}: Play ${this._cardName(move)} to column ${move.targetColumn}`);
            return success;
        }

        if (move.type === 'move') {
            // Field to field - same as InputSystem.endDrag for field sources
            const success = this.call.moveFieldToField(move.cardEid, move.targetColumn);
            if (!this._isHeadless) console.log(`[AI] Move ${this._moveCount}: Move ${this._cardName(move)} from column ${move.sourceColumn} to ${move.targetColumn}`);
            return success;
        }

        return false;
    }

    _cardName(move) {
        const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const suits = ['♥', '♦', '♣', '♠'];
        return `${ranks[move.rank]}${suits[move.suit]}`;
    }

    /**
     * Check if any card is still animating (moving to target position)
     */
    _isAnyCardAnimating() {
        const entities = this.game.getEntitiesWith('card', 'cardVisual', 'cardLocation');
        for (const eid of entities) {
            const visual = this.game.getComponent(eid, 'cardVisual');
            const loc = this.game.getComponent(eid, 'cardLocation');
            // Skip cards in deck (location 0)
            if (loc.location !== 0 && visual.animating === 1) {
                return true;
            }
        }
        return false;
    }

    /**
     * Main AI decision loop - called each frame
     */
    update() {
        if (!this._active) return;
        if (this.call.isGameOver?.()) {
            this._active = false;
            if (!this._isHeadless) {
                console.log('[AI] Game won!');
                this.call.showWinScreen?.();
            }
            return;
        }

        // In headless or instant mode, skip animation checks
        if (!this._isHeadless && !this._isInstant) {
            // Wait for CardFlowSystem animations to complete
            if (this.call.isFlowAnimating?.()) return;

            // Wait for all card movement animations to complete
            if (this._isAnyCardAnimating()) return;

            // Wait for move delay
            const now = performance.now();
            if (now - this._lastMoveTime < this._moveDelay) return;
            this._lastMoveTime = now;
        } else if (this._isInstant) {
            // In instant mode, still use a small delay to prevent UI freeze
            const now = performance.now();
            if (now - this._lastMoveTime < this._moveDelay) return;
            this._lastMoveTime = now;
        }

        // Get all valid moves
        const moves = this._getValidMoves();

        if (moves.length > 0) {
            // Score and sort moves
            moves.forEach(m => m.score = this._scoreMove(m));
            moves.sort((a, b) => b.score - a.score);

            // Execute best move
            const bestMove = moves[0];
            if (bestMove.score > -5000) {
                this._executeMove(bestMove);
                return;
            }
        }

        // No good moves - try to draw/discard
        // Can flow if: deck has cards OR hand has cards (to discard to field)
        const handLen = this.call.getHandCards().length;
        if (this.call.getDeckCount() > 0 || handLen > 0) {
            this._moveCount++;
            if (this._isHeadless && this._moveCount <= 30) {
                console.log(`[AI DEBUG ${this._moveCount}] DRAW | hand=${handLen} deck=${this.call.getDeckCount()} kingdom=${this.call.getTotalKingdomCards()}`);
            }
            if (!this._isHeadless) console.log(`[AI] Move ${this._moveCount}: Draw card`);
            this.call.flowCard();
        } else {
            // Stuck - no cards anywhere to draw
            if (this._isHeadless) {
                console.log(`[AI DEBUG] STUCK! hand=${handLen} deck=${this.call.getDeckCount()} kingdom=${this.call.getTotalKingdomCards()}`);
            }
            if (!this._isHeadless) console.log('[AI] No valid moves available - game lost!');
            this._active = false;
            // Show loss screen (visual mode only)
            if (!this._isHeadless) {
                this.call.showLossScreen?.();
            }
        }
    }

    /**
     * Get the current move count (for headless results)
     */
    getMoveCount() {
        return this._moveCount;
    }

    /**
     * Check if AI is currently active
     */
    isActive() {
        return this._active;
    }
}
