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
        'isAwaitingColumnSelection', 'cancelColumnSelection'
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
        // Check hand cards for foundation plays
        const handCards = this.call.getHandCards();
        for (const cardEid of handCards) {
            if (this.call.canPlayToFoundation(cardEid)) {
                return {
                    cardEid,
                    message: `${this.getCardName(cardEid)} can go to foundation`
                };
            }
        }

        // Check hand cards for tableau plays
        const numCols = this.call.getTableauColumns();
        for (const cardEid of handCards) {
            for (let col = 0; col < numCols; col++) {
                if (this.call.canPlayToTableau(cardEid, col)) {
                    return {
                        cardEid,
                        message: `${this.getCardName(cardEid)} can play to column ${col + 1}`
                    };
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
                        return {
                            cardEid,
                            message: `${this.getCardName(cardEid)} can go to foundation`
                        };
                    }
                }
            }
        }

        // Check tableau cards for tableau-to-tableau moves
        // Only count moves that EXPOSE a new card (i.e., there are cards above the moved stack)
        for (let col = 0; col < numCols; col++) {
            const colCards = this.call.getColumnCards(col);
            for (const cardEid of colCards) {
                const loc = this.game.getComponent(cardEid, 'cardLocation');

                // Skip if this is the top card of the column (index 0)
                // Moving it wouldn't expose anything new
                if (loc.index === 0) continue;

                if (this.call.isValidSequence(cardEid)) {
                    for (let targetCol = 0; targetCol < numCols; targetCol++) {
                        if (targetCol !== col && this.call.canPlayToTableau(cardEid, targetCol)) {
                            const cardsBelow = this.call.getCardsBelow(cardEid);
                            const stackSize = cardsBelow.length;

                            // Get the card that would be exposed
                            const exposedCard = colCards[loc.index - 1];
                            const exposedName = this.getCardName(exposedCard);

                            if (stackSize === 1) {
                                return {
                                    cardEid,
                                    message: `Move ${this.getCardName(cardEid)} to column ${targetCol + 1} (exposes ${exposedName})`
                                };
                            } else {
                                return {
                                    cardEid,
                                    message: `Move ${this.getCardName(cardEid)} + ${stackSize - 1} to column ${targetCol + 1} (exposes ${exposedName})`
                                };
                            }
                        }
                    }
                }
            }
        }

        return null;
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
