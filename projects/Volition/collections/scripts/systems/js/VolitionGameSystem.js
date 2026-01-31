/**
 * VolitionGameSystem - Main game orchestration system
 * Handles game state, settings, UI, win/loss detection
 */
class VolitionGameSystem extends GUTS.BaseSystem {
    static services = ['checkMove', 'showWinScreen', 'showLossScreen', 'getSettings', 'dealNextCard'];
    static serviceDependencies = [
        'getDeckCount', 'getHandCards', 'getTableauColumns', 'getColumnCards',
        'canPlayToFoundation', 'canPlayToTableau', 'isValidSequence', 'getCardsBelow',
        'getTotalFoundationCards', 'flowCard'
    ];

    constructor(game) {
        super(game);
        this.game.volitionGameSystem = this;

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

        const nextCardBtn = document.getElementById('nextCardBtn');
        if (nextCardBtn) {
            nextCardBtn.addEventListener('click', () => this.dealNextCard());
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

        const hasValidMove = this.hasAnyValidMove();
        const deckEmpty = this.call.getDeckCount() <= 0;

        if (!hasValidMove && deckEmpty) {
            // No moves and deck is empty - game over
            this.showLossScreen();
        } else if (hasValidMove) {
            this.showMessage('Valid moves available!');
        } else {
            // No moves but deck has cards
            this.showMessage('No moves - draw more cards!');
        }
    }

    hasAnyValidMove() {
        // Check hand cards
        const handCards = this.call.getHandCards();
        for (const cardEid of handCards) {
            if (this.call.canPlayToFoundation(cardEid)) {
                return true;
            }

            const numCols = this.call.getTableauColumns();
            for (let col = 0; col < numCols; col++) {
                if (this.call.canPlayToTableau(cardEid, col)) {
                    return true;
                }
            }
        }

        // Check tableau cards
        const numCols = this.call.getTableauColumns();
        for (let col = 0; col < numCols; col++) {
            const colCards = this.call.getColumnCards(col);
            for (const cardEid of colCards) {
                if (this.call.canPlayToFoundation(cardEid)) {
                    const cardsBelow = this.call.getCardsBelow(cardEid);
                    if (cardsBelow.length === 1) {
                        return true;
                    }
                }

                if (this.call.isValidSequence(cardEid)) {
                    for (let targetCol = 0; targetCol < numCols; targetCol++) {
                        if (targetCol !== col && this.call.canPlayToTableau(cardEid, targetCol)) {
                            return true;
                        }
                    }
                }
            }
        }

        return false;
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
