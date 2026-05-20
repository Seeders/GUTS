/**
 * WarRenderSystem - Handles War-specific card rendering and UI
 * Uses CardRenderSystem for card elements, adds pile/table layout
 * Handles button clicks and game event UI updates
 */
class WarRenderSystem extends GUTS.BaseSystem {
    static services = ['updateDisplay', 'showMessage', 'animateFlip'];
    static serviceDependencies = [
        'getPlayerPile', 'getTableCards', 'getGameState',
        'createCardElement', 'getCardElement', 'flipCard',
        'getCardWidth', 'getCardHeight',
        'sendReady', 'startGame', 'resolveCurrentRound', 'flipWarCards', 'collectCards'
    ];

    constructor(game) {
        super(game);
        this.containerWidth = 400;
        this.containerHeight = 600;
    }

    init() {
        const config = this.game.getConfig?.() || {};
        this._isHeadless = config.isHeadless || false;
    }

    postAllInit() {
        if (this._isHeadless) return;

        const container = document.getElementById('cardContainer');
        if (container) {
            this.containerWidth = container.offsetWidth || 400;
            this.containerHeight = container.offsetHeight || 600;
        }

        // Set up button listeners
        const flipBtn = document.getElementById('flipButton');
        if (flipBtn) {
            flipBtn.addEventListener('click', () => this.onFlipClick());
        }

        const playAgainBtn = document.getElementById('playAgainBtn');
        if (playAgainBtn) {
            playAgainBtn.addEventListener('click', () => this.onPlayAgainClick());
        }

        // Auto-start game
        setTimeout(() => {
            this.call.startGame?.();
        }, 500);
    }

    /**
     * Handle flip button click
     */
    onFlipClick() {
        const flipBtn = document.getElementById('flipButton');
        if (flipBtn) flipBtn.disabled = true;

        this.call.sendReady?.();
    }

    /**
     * Handle play again click
     */
    onPlayAgainClick() {
        this.hideOverlay('gameOverOverlay');
        this.hideOverlay('warOverlay');
        this.hideMessage();
        this.call.startGame?.();
    }

    // ========== EVENT HANDLERS ==========

    /**
     * Game started - enable flip button, update counts
     */
    onGameStart(data) {
        if (this._isHeadless) return;

        const flipBtn = document.getElementById('flipButton');
        if (flipBtn) flipBtn.disabled = false;

        this.updateCounts(data.player1Count, data.player2Count);
    }

    /**
     * Cards flipped - show them on the table, then resolve after a delay
     */
    onCardsFlipped(data) {
        if (this._isHeadless) return;

        // After a delay, resolve the round so cards are visible on table first
        setTimeout(() => {
            this.call.resolveCurrentRound?.();
        }, 1500);
    }

    /**
     * Round won - show result with cards still on table, then collect after delay
     */
    onRoundWon(data) {
        if (this._isHeadless) return;

        const winnerLabel = data.winner === 1 ? 'You' : 'Opponent';
        const warText = data.warDepth > 0 ? ` (War x${data.warDepth})` : '';
        this.showMessage(`${winnerLabel} won ${data.cardsWon} cards!${warText}`);

        // After showing the spoils, collect cards and re-enable
        setTimeout(() => {
            this.hideMessage();
            this.call.collectCards?.();

            const state = this.call.getGameState?.();
            if (state && !state.gameOver) {
                const flipBtn = document.getElementById('flipButton');
                if (flipBtn) flipBtn.disabled = false;
            }
        }, 2000);
    }

    /**
     * War triggered - show WAR overlay, then flip war cards after delay
     */
    onWarTriggered(data) {
        if (this._isHeadless) return;

        // Show WAR! overlay
        this.showOverlay('warOverlay');

        // Hide overlay after 1s
        setTimeout(() => this.hideOverlay('warOverlay'), 1000);

        // After showing face-down cards, flip the deciding war cards
        setTimeout(() => {
            this.call.flipWarCards?.();
        }, 1500);
    }

    /**
     * Game ended - show game over overlay
     */
    onGameEnd(data) {
        if (this._isHeadless) return;

        const winnerLabel = data.winner === 1 ? 'You Win!' : 'Opponent Wins!';

        const winnerMsg = document.getElementById('winnerMessage');
        const reasonEl = document.getElementById('endReason');
        if (winnerMsg) winnerMsg.textContent = winnerLabel;
        if (reasonEl) reasonEl.textContent = data.reason || 'Collected all cards';

        const flipBtn = document.getElementById('flipButton');
        if (flipBtn) flipBtn.disabled = true;

        setTimeout(() => this.showOverlay('gameOverOverlay'), 1000);
    }

    // ========== DISPLAY METHODS ==========

    /**
     * Update the display - position all cards appropriately
     */
    updateDisplay() {
        if (this._isHeadless) return;

        const state = this.call.getGameState?.();
        if (!state) return;

        const cardWidth = this.call.getCardWidth?.() || 70;
        const cardHeight = this.call.getCardHeight?.() || 98;

        const centerX = (this.containerWidth - cardWidth) / 2;

        // Position player 2's pile (top)
        const p2Pile = this.call.getPlayerPile?.(2) || [];
        this.positionPile(p2Pile, centerX, 50);

        // Position player 1's pile (bottom)
        const p1Pile = this.call.getPlayerPile?.(1) || [];
        this.positionPile(p1Pile, centerX, this.containerHeight - cardHeight - 120);

        // Position table cards (center)
        const tableCards = this.call.getTableCards?.() || [];
        this.positionTableCards(tableCards, centerX, cardWidth, cardHeight);

        // Update counts
        this.updateCounts(state.player1Count, state.player2Count);
    }

    /**
     * Position a player's pile
     */
    positionPile(pile, x, y) {
        const maxVisible = 5;
        const offset = 2;

        for (let i = 0; i < pile.length; i++) {
            const cardEid = pile[i];
            const visual = this.game.getComponent(cardEid, 'cardVisual');

            if (visual) {
                const fromTop = pile.length - 1 - i;
                if (fromTop < maxVisible) {
                    visual.targetX = x + fromTop * offset;
                    visual.targetY = y + fromTop * offset;
                    visual.zIndex = i;
                } else {
                    // Deep cards snap to pile position instantly
                    visual.targetX = x;
                    visual.targetY = y;
                    visual.x = x;
                    visual.y = y;
                    visual.zIndex = 0;
                }
                visual.animating = 1;
            }

            // Ensure pile cards are face down
            const card = this.game.getComponent(cardEid, 'card');
            if (card) card.faceUp = 0;

            const warCard = this.game.getComponent(cardEid, 'warCard');
            if (warCard) {
                warCard.inPile = 1;
                warCard.onTable = 0;
            }
        }
    }

    /**
     * Position cards on the table (flipped cards)
     */
    positionTableCards(tableCards, centerX, cardWidth, cardHeight) {
        const centerY = this.containerHeight / 2 - cardHeight / 2;

        const p1Cards = [];
        const p2Cards = [];

        for (const eid of tableCards) {
            const warCard = this.game.getComponent(eid, 'warCard');
            if (warCard) {
                if (warCard.owner === 1) {
                    p1Cards.push(eid);
                } else {
                    p2Cards.push(eid);
                }
            }
        }

        // Player 1's table cards (below center)
        const p1Y = centerY + cardHeight / 2 + 10;
        this.positionCardRow(p1Cards, centerX, p1Y, 500);

        // Player 2's table cards (above center)
        const p2Y = centerY - cardHeight / 2 - 10;
        this.positionCardRow(p2Cards, centerX, p2Y, 500);
    }

    /**
     * Position a row of cards with overlap for war scenarios
     */
    positionCardRow(cards, centerX, y, baseZ) {
        const cardWidth = this.call.getCardWidth?.() || 70;
        const overlap = 30;

        const totalWidth = cards.length > 0 ? cardWidth + (cards.length - 1) * overlap : 0;
        const startX = centerX - totalWidth / 2 + cardWidth / 2;

        for (let i = 0; i < cards.length; i++) {
            const cardEid = cards[i];
            const visual = this.game.getComponent(cardEid, 'cardVisual');

            if (visual) {
                visual.targetX = startX + i * overlap;
                visual.targetY = y;
                visual.zIndex = baseZ + i;
                visual.animating = 1;
            }
        }
    }

    /**
     * Animate a card flip
     */
    animateFlip(cardEid) {
        this.call.flipCard?.(cardEid);
    }

    /**
     * Update card counts display
     */
    updateCounts(p1Count, p2Count) {
        const p1El = document.getElementById('player1Count');
        const p2El = document.getElementById('player2Count');
        if (p1El) p1El.textContent = p1Count;
        if (p2El) p2El.textContent = p2Count;
    }

    /**
     * Show a message
     */
    showMessage(text) {
        const msgEl = document.getElementById('message');
        if (msgEl) {
            msgEl.textContent = text;
            msgEl.style.display = 'block';
        }
    }

    /**
     * Hide message
     */
    hideMessage() {
        const msgEl = document.getElementById('message');
        if (msgEl) msgEl.style.display = 'none';
    }

    /**
     * Show overlay by ID
     */
    showOverlay(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('hidden');
    }

    /**
     * Hide overlay by ID
     */
    hideOverlay(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    }

    update() {
        // Rendering handled by CardRenderSystem
        // This system manages War-specific layout
    }
}
