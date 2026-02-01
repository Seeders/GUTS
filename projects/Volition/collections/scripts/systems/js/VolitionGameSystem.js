/**
 * VolitionGameSystem - Main game orchestration system
 * Handles game state, settings, UI, win/loss detection
 */
class VolitionGameSystem extends GUTS.BaseSystem {
    static services = ['checkMove', 'showWinScreen', 'showLossScreen', 'getSettings', 'dealNextCard'];
    static serviceDependencies = [
        'getDeckCount', 'getHandCards', 'getFieldColumns', 'getColumnCards',
        'canPlayToKingdom', 'canPlayToField', 'isValidSequence', 'getCardsBelow',
        'getTotalKingdomCards', 'flowCard', 'getCardElement', 'isTutorialActive',
        'isAwaitingColumnSelection', 'cancelColumnSelection',
        'playVictory', 'playCardShuffle', 'playCardPlace',
        // Music services
        'toggleMusic', 'isMusicEnabled', 'getMusicVolume', 'setMusicVolume',
        // SFX services
        'getSfxVolume', 'setSfxVolume',
        // AI services
        'startAISimulation', 'stopAISimulation', 'setAISpeed', 'isActive'
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
            fieldColumns: 6
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

        // Check if AI mode was requested
        this.checkAIMode();
    }

    checkAIMode() {
        try {
            const aiMode = localStorage.getItem('volitionAIMode');
            if (aiMode === 'true') {
                // Clear the flag
                localStorage.removeItem('volitionAIMode');
                // Update button to show AI is active
                const aiPlayBtn = document.getElementById('aiPlayBtn');
                if (aiPlayBtn) {
                    aiPlayBtn.querySelector('.label').textContent = 'AI On';
                    aiPlayBtn.classList.add('active');
                }
                // Start AI after a delay for cards to be dealt
                setTimeout(() => {
                    console.log('[Game] Starting AI simulation');
                    this.call.startAISimulation?.();
                }, 2000);
            }
        } catch (e) {
            console.warn('Failed to check AI mode:', e);
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
                // Warn if game is in progress (not game over)
                if (!this.gameOver) {
                    if (!confirm('Starting the tutorial will end your current game. Continue?')) {
                        return;
                    }
                }
                this.game.sceneManager?.switchScene('tutorial');
            });
        }

        // AI Play button - restart with AI playing
        const aiPlayBtn = document.getElementById('aiPlayBtn');
        if (aiPlayBtn) {
            aiPlayBtn.addEventListener('click', () => this.startAIPlay());
        }
    }

    startAIPlay() {
        // Store that we want AI mode, then restart
        try {
            localStorage.setItem('volitionAIMode', 'true');
        } catch (e) {
            console.warn('Failed to save AI mode:', e);
        }
        this.restartGame();
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
        const fieldColumnsSlider = document.getElementById('fieldColumnsSlider');
        const fieldColumnsValue = document.getElementById('fieldColumnsValue');

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

        if (fieldColumnsSlider) {
            fieldColumnsSlider.value = this.settings.fieldColumns;
            fieldColumnsValue.textContent = this.settings.fieldColumns;
            fieldColumnsSlider.addEventListener('input', () => {
                fieldColumnsValue.textContent = fieldColumnsSlider.value;
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

        // Set up music volume slider
        const musicVolumeSlider = document.getElementById('musicVolumeSlider');
        const musicVolumeValue = document.getElementById('musicVolumeValue');
        if (musicVolumeSlider && musicVolumeValue) {
            // Set initial value from saved preference
            const currentMusicVolume = this.call.getMusicVolume?.() ?? 0.4;
            musicVolumeSlider.value = Math.round(currentMusicVolume * 100);
            musicVolumeValue.textContent = `${musicVolumeSlider.value}%`;

            musicVolumeSlider.addEventListener('input', () => {
                const volume = parseInt(musicVolumeSlider.value) / 100;
                musicVolumeValue.textContent = `${musicVolumeSlider.value}%`;
                this.call.setMusicVolume?.(volume);
            });
        }

        // Set up SFX volume slider
        const sfxVolumeSlider = document.getElementById('sfxVolumeSlider');
        const sfxVolumeValue = document.getElementById('sfxVolumeValue');
        if (sfxVolumeSlider && sfxVolumeValue) {
            // Set initial value from saved preference
            const currentSfxVolume = this.call.getSfxVolume?.() ?? 0.5;
            sfxVolumeSlider.value = Math.round(currentSfxVolume * 100);
            sfxVolumeValue.textContent = `${sfxVolumeSlider.value}%`;

            // Debounce timer for test sound
            let sfxTestTimer = null;

            sfxVolumeSlider.addEventListener('input', () => {
                const volume = parseInt(sfxVolumeSlider.value) / 100;
                sfxVolumeValue.textContent = `${sfxVolumeSlider.value}%`;
                this.call.setSfxVolume?.(volume);

                // Play a test sound (debounced) so user can hear the volume
                clearTimeout(sfxTestTimer);
                sfxTestTimer = setTimeout(() => {
                    this.call.playCardPlace?.();
                }, 150);
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
                const newColumns = parseInt(fieldColumnsSlider.value);
                const columnsChanged = newColumns !== this.settings.fieldColumns;

                if (columnsChanged) {
                    // Column count changed - warn user before restarting
                    if (confirm('Changing the column count will restart your current game. Continue?')) {
                        this.saveSettings({
                            cardSpeed: selectedSpeed,
                            fieldColumns: newColumns
                        });
                        this.restartGame();
                    }
                } else {
                    // Only card speed or audio settings changed - no restart needed
                    this.saveSettings({
                        cardSpeed: selectedSpeed,
                        fieldColumns: newColumns
                    });
                    settingsModal?.classList.add('hidden');
                }
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

        // Prioritize moves: kingdom plays first, then useful field moves
        // Filter out circular moves (moves that only lead back to original position)

        // 1. Kingdom plays from hand - always good
        const kingdomFromHand = validMoves.filter(m => m.type === 'hand-kingdom');
        if (kingdomFromHand.length > 0) {
            return kingdomFromHand[0];
        }

        // 2. Kingdom plays from field - always good
        const kingdomFromField = validMoves.filter(m => m.type === 'field-kingdom');
        if (kingdomFromField.length > 0) {
            return kingdomFromField[0];
        }

        // 3. Hand to field plays
        const handToField = validMoves.filter(m => m.type === 'hand-field');
        if (handToField.length > 0) {
            return handToField[0];
        }

        // 4. Field-to-field moves - check if they're useful
        const fieldMoves = validMoves.filter(m => m.type === 'field-field');

        for (const move of fieldMoves) {
            // Check if this is a useful move (exposed card can be played somewhere)
            if (move.exposedCard) {
                const isUseful = this.isExposedCardUseful(move.exposedCard, move.sourceCol, move.targetCol);
                if (isUseful) {
                    return move;
                }
            }
        }

        // 5. If only circular/useless moves remain, check if we're truly stuck
        // If there's only one field move and it would just oscillate, it's not useful
        if (fieldMoves.length === 1) {
            const move = fieldMoves[0];
            if (this.isCircularMove(move)) {
                // This is a dead-end - the only move leads back to where we started
                return null;
            }
        }

        // Return the first field move even if not ideal (player might see something we don't)
        if (fieldMoves.length > 0) {
            const move = fieldMoves[0];
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
        const numCols = this.call.getFieldColumns();

        // Check hand cards for kingdom plays
        for (const cardEid of handCards) {
            if (this.call.canPlayToKingdom(cardEid)) {
                moves.push({
                    type: 'hand-kingdom',
                    cardEid,
                    message: `${this.getCardName(cardEid)} can go to kingdom`
                });
            }
        }

        // Check hand cards for field plays
        for (const cardEid of handCards) {
            for (let col = 0; col < numCols; col++) {
                if (this.call.canPlayToField(cardEid, col)) {
                    moves.push({
                        type: 'hand-field',
                        cardEid,
                        targetCol: col,
                        message: `${this.getCardName(cardEid)} can play to column ${col + 1}`
                    });
                }
            }
        }

        // Check field cards for kingdom plays (bottom cards only)
        for (let col = 0; col < numCols; col++) {
            const colCards = this.call.getColumnCards(col);
            for (const cardEid of colCards) {
                if (this.call.canPlayToKingdom(cardEid)) {
                    const cardsBelow = this.call.getCardsBelow(cardEid);
                    if (cardsBelow.length === 1) {
                        moves.push({
                            type: 'field-kingdom',
                            cardEid,
                            sourceCol: col,
                            message: `${this.getCardName(cardEid)} can go to kingdom`
                        });
                    }
                }
            }
        }

        // Check field cards for field-to-field moves
        for (let col = 0; col < numCols; col++) {
            const colCards = this.call.getColumnCards(col);
            for (const cardEid of colCards) {
                const loc = this.game.getComponent(cardEid, 'cardLocation');

                // Skip if this is the top card of the column (index 0)
                if (loc.index === 0) continue;

                if (this.call.isValidSequence(cardEid)) {
                    for (let targetCol = 0; targetCol < numCols; targetCol++) {
                        if (targetCol !== col && this.call.canPlayToField(cardEid, targetCol)) {
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
                                type: 'field-field',
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
        const numCols = this.call.getFieldColumns();

        // Can it go to kingdom?
        if (this.call.canPlayToKingdom(exposedCardEid)) {
            return true;
        }

        // Can it play to any OTHER column (not source, not target)?
        for (let col = 0; col < numCols; col++) {
            if (col !== sourceCol && col !== targetCol) {
                if (this.call.canPlayToField(exposedCardEid, col)) {
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
        if (move.type !== 'field-field') return false;

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

            const numCols = this.call.getFieldColumns();
            let exposedHasOtherOptions = false;

            // Can exposed go to kingdom?
            if (this.call.canPlayToKingdom(exposedCard)) {
                exposedHasOtherOptions = true;
            }

            // Can exposed play to any other column?
            for (let col = 0; col < numCols; col++) {
                if (col !== sourceCol && col !== targetCol) {
                    if (this.call.canPlayToField(exposedCard, col)) {
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
            const count = this.call.getTotalKingdomCards();
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
