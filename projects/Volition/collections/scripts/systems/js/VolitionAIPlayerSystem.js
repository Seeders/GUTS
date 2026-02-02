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
    static services = ['startAISimulation', 'stopAISimulation', 'setAISpeed', 'getMoveCount', 'isActive', 'setAIDebug'];
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
        this._debug = false; // Set to true to log AI decisions
    }

    init() {
        // Detect headless mode and scale move delay based on animation speed
        const config = this.game.getConfig?.() || {};
        this._isHeadless = config.isHeadless || false;

        // Scale AI move delay based on animation speed
        // Default speed is 4000, scale delay inversely (faster animations = shorter delay)
        const animSpeed = config.animationSpeed !== undefined ? config.animationSpeed : 4000;
        const speedMultiplier = 4000 / Math.max(animSpeed, 1);
        this._moveDelay = Math.max(1000 * speedMultiplier, 100); // Min 100ms delay
        this._isInstant = animSpeed >= 10000; // Consider "instant" if speed >= 10000
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
        }

        // Enable debug mode via URL param: ?aidebug=true
        if (urlParams.get('aidebug') === 'true') {
            this._debug = true;
            console.log('AI debug logging enabled via URL');
        }

        if (isSimulation) {
            // Delay start to let cards be dealt and animations settle
            setTimeout(() => {
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
                this.startAISimulation();
            }, 2000);
        }
    }

    // === Public Services ===

    startAISimulation() {
        this._active = true;
        this._moveCount = 0;
        this._recentMoves = [];
        this._lastMoveTime = performance.now();
    }

    stopAISimulation() {
        this._active = false;
    }

    setAISpeed(delayMs) {
        this._moveDelay = delayMs;
    }

    setAIDebug(enabled) {
        this._debug = enabled;
        if (enabled) {
            console.log('AI debug logging enabled');
        }
    }

    onAnimationSpeedChanged(data) {
        // Scale AI move delay based on animation speed
        const speedMultiplier = 4000 / Math.max(data.speed, 1);
        this._moveDelay = Math.max(1000 * speedMultiplier, 100);
        this._isInstant = data.speed >= 10000;
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
                const canPlay = this.call.canPlayToField(cardEid, col);

                // Debug: Log Queen moves specifically
                if (this._debug && card.rank === 12) {
                    const colCards = this.call.getColumnCards(col);
                    if (colCards.length > 0) {
                        const bottomCard = this.game.getComponent(colCards[colCards.length - 1], 'card');
                        if (bottomCard.rank === 13) {
                            // Queen trying to play on King - log why it might fail
                            const queenRed = card.suit === 0 || card.suit === 1;
                            const kingRed = bottomCard.suit === 0 || bottomCard.suit === 1;
                            console.log(`Q${this._cardName({rank:12, suit:card.suit})} -> K${this._cardName({rank:13, suit:bottomCard.suit})} col ${col}: canPlay=${canPlay}, sameColor=${queenRed === kingRed}`);
                        }
                    }
                }

                if (canPlay) {
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
                const card = this.game.getComponent(cardEid, 'card');
                const isValid = this.call.isValidSequence(cardEid);

                if (this._debug && card.rank === 13) {
                    // Log King moves specifically since user reported issues with these
                    const loc = this.game.getComponent(cardEid, 'cardLocation');
                    console.log(`${this._cardName({rank:13, suit:card.suit})} at col ${sourceCol} idx ${loc.index}: isValidSequence=${isValid}`);
                }

                if (isValid) {
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

            // Debug: cardIndex should never be -1 if the move was generated correctly
            if (this._debug && cardIndex === -1) {
                console.warn(`BUG: Card ${move.cardEid} not found in source column ${move.sourceColumn}`);
            }

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
                    // Non-kings to empty, or King at top (no cards to expose) = pointless
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

        if (move.type === 'kingdom') {
            // Play to kingdom - same as InputSystem.onDoubleClick
            const success = this.call.playToKingdom(move.cardEid);
            if (success && move.source === 'hand') {
                // Flow after hand play - same as InputSystem
                this.call.flowAfterHandPlay?.(move.cardEid, 'kingdom', move.originalIndex);
            }
            return success;
        }

        if (move.type === 'field') {
            // Play from hand to field - same as InputSystem.endDrag
            const success = this.call.playToField(move.cardEid, move.targetColumn);
            if (success) {
                // Flow after hand play
                this.call.flowAfterHandPlay?.(move.cardEid, 'field', move.originalIndex);
            }
            return success;
        }

        if (move.type === 'move') {
            // Field to field - same as InputSystem.endDrag for field sources
            const success = this.call.moveFieldToField(move.cardEid, move.targetColumn);
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

            if (this._debug) {
                console.log('=== AI Move Analysis ===');
                console.log('Hand cards:', this.call.getHandCards().map(eid => {
                    const c = this.game.getComponent(eid, 'card');
                    return this._cardName({ rank: c.rank, suit: c.suit });
                }));
                console.log('Top 5 moves:');
                moves.slice(0, 5).forEach((m, i) => {
                    const moveDesc = m.type === 'kingdom' ? `${this._cardName(m)} -> Kingdom`
                        : m.type === 'field' ? `${this._cardName(m)} -> Col ${m.targetColumn}`
                        : `${this._cardName(m)} Col ${m.sourceColumn} -> Col ${m.targetColumn}`;
                    console.log(`  ${i + 1}. ${moveDesc} (score: ${m.score})`);
                });
            }

            // Execute best move
            const bestMove = moves[0];
            if (bestMove.score > -5000) {
                if (this._debug) {
                    console.log(`Executing: ${this._cardName(bestMove)} (${bestMove.type}, score ${bestMove.score})`);
                }
                this._executeMove(bestMove);
                return;
            } else if (this._debug) {
                console.log(`Best move score ${bestMove.score} <= -5000, will draw instead`);
            }
        } else if (this._debug) {
            console.log('No valid moves found');
        }

        // Debug: Show field state when drawing
        if (this._debug) {
            console.log('Drawing card. Field state:');
            const numCols = this.call.getFieldColumns();
            for (let col = 0; col < numCols; col++) {
                const cards = this.call.getColumnCards(col);
                if (cards.length === 0) {
                    console.log(`  Col ${col}: EMPTY`);
                } else {
                    const cardNames = cards.map(eid => {
                        const c = this.game.getComponent(eid, 'card');
                        return this._cardName({ rank: c.rank, suit: c.suit });
                    });
                    console.log(`  Col ${col}: ${cardNames.join(' -> ')}`);
                }
            }
        }

        // No good moves - try to draw/discard
        // Can flow if: deck has cards OR hand has cards (to discard to field)
        const handLen = this.call.getHandCards().length;
        if (this.call.getDeckCount() > 0 || handLen > 0) {
            this._moveCount++;
            this.call.flowCard();
        } else {
            // Stuck - no cards anywhere to draw
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
