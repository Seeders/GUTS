/**
 * VolitionGameSystem - Main game orchestration system
 * Handles game state, settings, UI, win/loss detection
 */
class VolitionGameSystem extends GUTS.BaseSystem {
    static services = ['checkMove', 'showWinScreen', 'showLossScreen', 'getSettings', 'dealNextCard'];
    static serviceDependencies = [
        'getDeckCount', 'getHandCards', 'getTableauColumns', 'getColumnCards',
        'canPlayToFoundation', 'canPlayToTableau', 'isValidSequence', 'getCardsBelow',
        'getTotalFoundationCards', 'flowCard', 'getCardElement', 'isTutorialActive',
        'isAwaitingColumnSelection', 'cancelColumnSelection',
        'playVictory', 'playCardShuffle',
        // Music services
        'toggleMusic', 'isMusicEnabled'
    ];

    constructor(game) {
        super(game);

        // Game state
        this.gameOver = false;
        this.won = false;
        this.startTime = 0;
        this.elapsedTime = 0;

        // Settings
        this.settings = this.loadSettings();
    }

    loadSettings() {
        const defaults = {
            cardSpeed: 4000,
            tableauColumns: 6
        };
        try {
            const saved = localStorage.getItem('volitionSettings');
            if (saved) {
                return { ...defaults, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
        return defaults;
    }

    saveSettings(settings) {
        this.settings = settings;
        try {
            localStorage.setItem('volitionSettings', JSON.stringify(settings));
        } catch (e) {
            console.warn('Failed to save settings:', e);
        }
    }

    getSettings() {
        return this.settings;
    }

    init() {
        console.log('VolitionGameSystem initializing...');
        this.startTime = performance.now();

        // Apply settings to game config
        if (this.game.gameInstance) {
            this.game.gameInstance.settings = this.settings;
        }
    }

    postAllInit() {
        this.setupEventListeners();
        this.setupSettingsModal();
        this.checkFirstTimeUser();

        // Play shuffle sound when game starts
        if (this.call.playCardShuffle) {
            this.call.playCardShuffle();
        }
    }

    checkFirstTimeUser() {
        // Skip if in tutorial scene (service only exists there)
        if (this.call.isTutorialActive?.()) return;

        try {
            const tutorialSeen = localStorage.getItem('volitionTutorialSeen');
            if (!tutorialSeen) {
                // First time user - show tutorial automatically
                setTimeout(() => {
                    this.game.sceneManager?.switchScene('tutorial');
                }, 100);
            }
        } catch (e) {
            console.warn('Failed to check tutorial state:', e);
        }
    }

    setupEventListeners() {
        const newGameBtn = document.getElementById('newGameBtn');
        if (newGameBtn) {
            newGameBtn.addEventListener('click', () => this.restartGame());
        }

        const playAgainBtn = document.getElementById('playAgainBtn');
        if (playAgainBtn) {
            playAgainBtn.addEventListener('click', () => this.restartGame());
        }

        const tryAgainBtn = document.getElementById('tryAgainBtn');
        if (tryAgainBtn) {
            tryAgainBtn.addEventListener('click', () => this.restartGame());
        }

        const checkMoveBtn = document.getElementById('checkMoveBtn');
        if (checkMoveBtn) {
            checkMoveBtn.addEventListener('click', () => this.checkMove());
        }

        const deckArea = document.getElementById('deckArea');
        if (deckArea) {
            deckArea.addEventListener('click', () => this.dealNextCard());
        }

        const tutorialBtn = document.getElementById('tutorialBtn');
        if (tutorialBtn) {
            tutorialBtn.addEventListener('click', () => {
                this.game.sceneManager?.switchScene('tutorial');
            });
        }
    }

    dealNextCard() {
        if (this.gameOver) return;
        this.call.flowCard();
    }

    setupSettingsModal() {
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsModal = document.getElementById('settingsModal');
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');
        const applySettingsBtn = document.getElementById('applySettingsBtn');

        const speedBtns = document.querySelectorAll('.speed-btn');
        const tableauColumnsSlider = document.getElementById('tableauColumnsSlider');
        const tableauColumnsValue = document.getElementById('tableauColumnsValue');

        // Track selected speed
        let selectedSpeed = this.settings.cardSpeed;

        // Set up speed buttons
        speedBtns.forEach(btn => {
            const speed = parseInt(btn.dataset.speed);
            if (speed === this.settings.cardSpeed) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }

            btn.addEventListener('click', () => {
                speedBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedSpeed = speed;
            });
        });

        if (tableauColumnsSlider) {
            tableauColumnsSlider.value = this.settings.tableauColumns;
            tableauColumnsValue.textContent = this.settings.tableauColumns;
            tableauColumnsSlider.addEventListener('input', () => {
                tableauColumnsValue.textContent = tableauColumnsSlider.value;
            });
        }

        // Set up music toggle
        const musicToggleBtn = document.getElementById('musicToggleBtn');
        if (musicToggleBtn) {
            // Set initial state
            const musicEnabled = this.call.isMusicEnabled?.() ?? true;
            musicToggleBtn.textContent = musicEnabled ? 'On' : 'Off';
            musicToggleBtn.classList.toggle('active', musicEnabled);

            musicToggleBtn.addEventListener('click', () => {
                const nowEnabled = this.call.toggleMusic?.();
                musicToggleBtn.textContent = nowEnabled ? 'On' : 'Off';
                musicToggleBtn.classList.toggle('active', nowEnabled);
            });
        }

        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                settingsModal?.classList.remove('hidden');
            });
        }

        if (closeSettingsBtn) {
            closeSettingsBtn.addEventListener('click', () => {
                settingsModal?.classList.add('hidden');
            });
        }

        if (applySettingsBtn) {
            applySettingsBtn.addEventListener('click', () => {
                this.saveSettings({
                    cardSpeed: selectedSpeed,
                    tableauColumns: parseInt(tableauColumnsSlider.value)
                });
                this.restartGame();
            });
        }

        if (settingsModal) {
            settingsModal.addEventListener('click', (e) => {
                if (e.target === settingsModal) {
                    settingsModal.classList.add('hidden');
                }
            });
        }
    }

    restartGame() {
        location.reload();
    }

    showWinScreen() {
        this.gameOver = true;
        this.won = true;

        if (this.game.gameInstance) {
            this.game.gameInstance.state.gameOver = true;
        }

        // Play victory sound
        if (this.call.playVictory) {
            this.call.playVictory();
        }

        const overlay = document.getElementById('winOverlay');
        const finalTime = document.getElementById('finalTime');

        if (overlay) {
            overlay.classList.remove('hidden');
        }

        if (finalTime) {
            const seconds = Math.floor(this.elapsedTime / 1000);
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            finalTime.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    }

    checkMove() {
        if (this.gameOver) return;

        const moveInfo = this.findValidMove();
        const deckEmpty = this.call.getDeckCount() <= 0;

        if (!moveInfo && deckEmpty) {
            // No moves and deck is empty - game over
            this.showLossScreen();
        } else if (moveInfo) {
            this.showMessage(moveInfo.message);
            // Highlight the card if possible
            if (moveInfo.cardEid) {
                this.highlightCard(moveInfo.cardEid);
            }
        } else {
            // No moves but deck has cards
            this.showMessage('No moves - draw more cards!');
        }
    }

    getCardName(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');
        const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const suits = ['♥', '♦', '♣', '♠'];
        return ranks[card.rank] + suits[card.suit];
    }

    isRedSuit(suit) {
        return suit === 0 || suit === 1; // hearts (0) or diamonds (1)
    }

    highlightCard(cardEid) {
        // Remove previous highlight
        document.querySelectorAll('.card.hint-highlight').forEach(el => {
            el.classList.remove('hint-highlight');
        });

        // Add highlight to the card
        const el = this.call.getCardElement(cardEid);
        if (el) {
            el.classList.add('hint-highlight');
            // Remove highlight after 3 seconds
            setTimeout(() => el.classList.remove('hint-highlight'), 3000);
        }
    }

    findValidMove() {
        const validMoves = this.findAllValidMoves();

        if (validMoves.length === 0) {
            return null;
        }

        // Prioritize moves: foundation plays first, then useful tableau moves
        // Filter out circular moves (moves that only lead back to original position)

        // 1. Foundation plays from hand - always good
        const foundationFromHand = validMoves.filter(m => m.type === 'hand-foundation');
        if (foundationFromHand.length > 0) {
            return foundationFromHand[0];
        }

        // 2. Foundation plays from tableau - always good
        const foundationFromTableau = validMoves.filter(m => m.type === 'tableau-foundation');
        if (foundationFromTableau.length > 0) {
            return foundationFromTableau[0];
        }

        // 3. Hand to tableau plays
        const handToTableau = validMoves.filter(m => m.type === 'hand-tableau');
        if (handToTableau.length > 0) {
            return handToTableau[0];
        }

        // 4. Tableau-to-tableau moves - check if they're useful
        const tableauMoves = validMoves.filter(m => m.type === 'tableau-tableau');

        for (const move of tableauMoves) {
            // Check if this is a useful move (exposed card can be played somewhere)
            if (move.exposedCard) {
                const isUseful = this.isExposedCardUseful(move.exposedCard, move.sourceCol, move.targetCol);
                if (isUseful) {
                    return move;
                }
            }
        }

        // 5. If only circular/useless moves remain, check if we're truly stuck
        // If there's only one tableau move and it would just oscillate, it's not useful
        if (tableauMoves.length === 1) {
            const move = tableauMoves[0];
            if (this.isCircularMove(move)) {
                // This is a dead-end - the only move leads back to where we started
                return null;
            }
        }

        // Return the first tableau move even if not ideal (player might see something we don't)
        if (tableauMoves.length > 0) {
            const move = tableauMoves[0];
            move.message += " (limited options)";
            return move;
        }

        return null;
    }

    /**
     * Find all valid moves without filtering
     */
    findAllValidMoves() {
        const moves = [];
        const handCards = this.call.getHandCards();
        const numCols = this.call.getTableauColumns();

        // Check hand cards for foundation plays
        for (const cardEid of handCards) {
            if (this.call.canPlayToFoundation(cardEid)) {
                moves.push({
                    type: 'hand-foundation',
                    cardEid,
                    message: `${this.getCardName(cardEid)} can go to foundation`
                });
            }
        }

        // Check hand cards for tableau plays
        for (const cardEid of handCards) {
            for (let col = 0; col < numCols; col++) {
                if (this.call.canPlayToTableau(cardEid, col)) {
                    moves.push({
                        type: 'hand-tableau',
                        cardEid,
                        targetCol: col,
                        message: `${this.getCardName(cardEid)} can play to column ${col + 1}`
                    });
                }
            }
        }

        // Check tableau cards for foundation plays (bottom cards only)
        for (let col = 0; col < numCols; col++) {
            const colCards = this.call.getColumnCards(col);
            for (const cardEid of colCards) {
                if (this.call.canPlayToFoundation(cardEid)) {
                    const cardsBelow = this.call.getCardsBelow(cardEid);
                    if (cardsBelow.length === 1) {
                        moves.push({
                            type: 'tableau-foundation',
                            cardEid,
                            sourceCol: col,
                            message: `${this.getCardName(cardEid)} can go to foundation`
                        });
                    }
                }
            }
        }

        // Check tableau cards for tableau-to-tableau moves
        for (let col = 0; col < numCols; col++) {
            const colCards = this.call.getColumnCards(col);
            for (const cardEid of colCards) {
                const loc = this.game.getComponent(cardEid, 'cardLocation');

                // Skip if this is the top card of the column (index 0)
                if (loc.index === 0) continue;

                if (this.call.isValidSequence(cardEid)) {
                    for (let targetCol = 0; targetCol < numCols; targetCol++) {
                        if (targetCol !== col && this.call.canPlayToTableau(cardEid, targetCol)) {
                            const cardsBelow = this.call.getCardsBelow(cardEid);
                            const stackSize = cardsBelow.length;
                            const exposedCard = colCards[loc.index - 1];
                            const exposedName = this.getCardName(exposedCard);

                            let message;
                            if (stackSize === 1) {
                                message = `Move ${this.getCardName(cardEid)} to column ${targetCol + 1} (exposes ${exposedName})`;
                            } else {
                                message = `Move ${this.getCardName(cardEid)} + ${stackSize - 1} to column ${targetCol + 1} (exposes ${exposedName})`;
                            }

                            moves.push({
                                type: 'tableau-tableau',
                                cardEid,
                                sourceCol: col,
                                targetCol,
                                exposedCard,
                                stackSize,
                                message
                            });
                        }
                    }
                }
            }
        }

        return moves;
    }

    /**
     * Check if an exposed card would be useful after a move
     */
    isExposedCardUseful(exposedCardEid, sourceCol, targetCol) {
        const card = this.game.getComponent(exposedCardEid, 'card');
        const numCols = this.call.getTableauColumns();

        // Can it go to foundation?
        if (this.call.canPlayToFoundation(exposedCardEid)) {
            return true;
        }

        // Can it play to any OTHER column (not source, not target)?
        for (let col = 0; col < numCols; col++) {
            if (col !== sourceCol && col !== targetCol) {
                if (this.call.canPlayToTableau(exposedCardEid, col)) {
                    return true;
                }
            }
        }

        // Check if the exposed card could receive the moved stack back
        // This would indicate a circular move situation
        // If the only option is to move back, it's not useful

        // Get target column's current bottom card (before the move)
        const targetColCards = this.call.getColumnCards(targetCol);
        if (targetColCards.length > 0) {
            const targetBottom = targetColCards[targetColCards.length - 1];
            const targetCard = this.game.getComponent(targetBottom, 'card');

            // Check if exposed card is same color as target bottom
            // If so, the exposed card can't play to the target column anyway
            const exposedIsRed = this.isRedSuit(card.suit);
            const targetIsRed = this.isRedSuit(targetCard.suit);

            if (exposedIsRed === targetIsRed) {
                // Same color - exposed card has limited options
                // But might still be useful if it can go elsewhere
                return false;
            }
        }

        return false;
    }

    /**
     * Check if a move would just lead to an oscillating/circular situation
     */
    isCircularMove(move) {
        if (move.type !== 'tableau-tableau') return false;

        const { cardEid, sourceCol, targetCol, exposedCard } = move;
        if (!exposedCard) return false;

        const card = this.game.getComponent(cardEid, 'card');
        const exposed = this.game.getComponent(exposedCard, 'card');

        // After the move, could the exposed card only play back to where we came from?
        // This happens when:
        // 1. The moved card was rank N
        // 2. The exposed card is rank N+1 and opposite color
        // 3. After moving, the only play for exposed is to receive the moved stack back

        // Check if exposed card would want to receive the moved card back
        const cardIsRed = this.isRedSuit(card.suit);
        const exposedIsRed = this.isRedSuit(exposed.suit);

        // For the exposed card to receive the moved card back:
        // - Must be opposite color (which it is, since they were stacked)
        // - Must be one rank higher
        if (cardIsRed !== exposedIsRed && exposed.rank === card.rank + 1) {
            // The exposed card could receive the moved card back
            // Check if that's the ONLY option for the exposed card

            const numCols = this.call.getTableauColumns();
            let exposedHasOtherOptions = false;

            // Can exposed go to foundation?
            if (this.call.canPlayToFoundation(exposedCard)) {
                exposedHasOtherOptions = true;
            }

            // Can exposed play to any other column?
            for (let col = 0; col < numCols; col++) {
                if (col !== sourceCol && col !== targetCol) {
                    if (this.call.canPlayToTableau(exposedCard, col)) {
                        exposedHasOtherOptions = true;
                        break;
                    }
                }
            }

            // If the exposed card has no other options, this is a circular move
            if (!exposedHasOtherOptions) {
                return true;
            }
        }

        return false;
    }

    hasAnyValidMove() {
        return this.findValidMove() !== null;
    }

    showLossScreen() {
        this.gameOver = true;
        this.won = false;

        if (this.game.gameInstance) {
            this.game.gameInstance.state.gameOver = true;
        }

        const overlay = document.getElementById('lossOverlay');
        const finalProgress = document.getElementById('finalProgress');

        if (overlay) {
            overlay.classList.remove('hidden');
        }

        if (finalProgress) {
            const count = this.call.getTotalFoundationCards();
            finalProgress.textContent = `${count}/52`;
        }
    }

    showMessage(text) {
        const existing = document.getElementById('tempMessage');
        if (existing) existing.remove();

        const msg = document.createElement('div');
        msg.id = 'tempMessage';
        msg.style.cssText = `
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            z-index: 300;
            font-size: 14px;
        `;
        msg.textContent = text;
        document.body.appendChild(msg);

        setTimeout(() => msg.remove(), 2000);
    }

    update() {
        if (this.gameOver) return;

        // Update elapsed time
        this.elapsedTime = performance.now() - this.startTime;

        // Update timer display
        const timerEl = document.getElementById('gameTimer');
        if (timerEl) {
            const seconds = Math.floor(this.elapsedTime / 1000);
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    }
}
