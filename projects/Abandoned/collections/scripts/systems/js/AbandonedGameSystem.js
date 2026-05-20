/**
 * AbandonedGameSystem - Main game orchestration system for Abandoned
 * Handles game state, turn structure, settings, and UI
 */
class AbandonedGameSystem extends GUTS.BaseSystem {
    static services = ['getSettings', 'nextTurn', 'getTurnNumber', 'isGameOver', 'getCardName', 'showHeartChoiceUI', 'hideHeartChoiceUI'];
    static serviceDependencies = [
        'getDeckCount', 'dealCard', 'dealInitialRefuge',
        'resolveDrawnCard', 'processTurnEnd', 'hasPendingChoice', 'completeHeartChoice',
        'checkGameEnd', 'isAlive', 'getCurrentDamage', 'getDamageThreshold',
        'getRefugeCards', 'getActiveThreats', 'getThreatCount',
        'playCardShuffle', 'playCardDraw',
        // Music services
        'toggleMusic', 'isMusicEnabled', 'getMusicVolume', 'setMusicVolume',
        // SFX services
        'getSfxVolume', 'setSfxVolume'
    ];

    constructor(game) {
        super(game);

        // Game state
        this.gameOver = false;
        this.won = false;
        this.turnNumber = 0;
        this.isProcessingTurn = false;

        // Settings
        this.settings = this.loadSettings();
    }

    loadSettings() {
        const defaults = {
            cardSpeed: 4000
        };
        try {
            const saved = localStorage.getItem('abandonedSettings');
            if (saved) {
                return { ...defaults, ...JSON.parse(saved) };
            }
        } catch (e) {
            // Ignore localStorage errors
        }
        return defaults;
    }

    saveSettings(settings) {
        this.settings = settings;
        try {
            localStorage.setItem('abandonedSettings', JSON.stringify(settings));
        } catch (e) {
            // Ignore localStorage errors
        }
    }

    getSettings() {
        return this.settings;
    }

    init() {
        this.turnNumber = 0;
        this.gameOver = false;
        this.won = false;

        // Apply settings to game config
        if (this.game.gameInstance) {
            this.game.gameInstance.settings = this.settings;
        }
    }

    postAllInit() {
        this.setupEventListeners();
        this.setupSettingsModal();

        // Play shuffle sound when game starts
        this.call.playCardShuffle?.();

        // Deal initial refuge cards (6 cards)
        this.call.dealInitialRefuge();

        // Update initial UI
        this.updateTurnDisplay();
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

        // Deck click to advance turn
        const deckArea = document.getElementById('deckArea');
        if (deckArea) {
            deckArea.addEventListener('click', () => this.onDeckClick());
        }

        // Heart choice buttons
        const healNowBtn = document.getElementById('healNowBtn');
        const storeHeartBtn = document.getElementById('storeHeartBtn');
        if (healNowBtn) {
            healNowBtn.addEventListener('click', () => this.onHeartChoice('heal'));
        }
        if (storeHeartBtn) {
            storeHeartBtn.addEventListener('click', () => this.onHeartChoice('store'));
        }

        // Toolbar speed toggles
        this.setupToolbarSpeed();
    }

    setupToolbarSpeed() {
        const speedToggles = document.querySelectorAll('.speed-toggle');
        speedToggles.forEach(btn => {
            const speed = parseInt(btn.dataset.speed);
            if (speed === this.settings.cardSpeed) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }

            btn.addEventListener('click', () => {
                speedToggles.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                this.saveSettings({ cardSpeed: speed });
                this.game.triggerEvent('onAnimationSpeedChanged', { speed });
            });
        });
    }

    /**
     * Handle deck click - advance to next turn
     */
    onDeckClick() {
        if (this.gameOver) return;
        if (this.isProcessingTurn) return;
        if (this.call.hasPendingChoice?.()) return; // Wait for heart choice

        this.nextTurn();
    }

    /**
     * Execute the next turn
     * Turn structure: Draw → Resolve → Process Turn End → Check Game End
     */
    nextTurn() {
        if (this.gameOver) return;
        if (this.isProcessingTurn) return;

        this.isProcessingTurn = true;
        this.turnNumber++;
        this.updateTurnDisplay();

        // Phase 1: Draw a card from night deck
        const cardEid = this.call.dealCard();

        if (!cardEid) {
            // Deck is empty - check for win
            this.isProcessingTurn = false;
            const result = this.call.checkGameEnd();
            if (result) {
                this.gameOver = true;
                this.won = result === 'won';
            }
            return;
        }

        // Play draw sound
        this.call.playCardDraw?.();

        // Phase 2: Resolve the drawn card
        const resolution = this.call.resolveDrawnCard(cardEid);

        // If heart requires choice, wait for player input
        if (resolution.requiresChoice) {
            this.showHeartChoiceUI(cardEid);
            // Turn continues after choice is made
            return;
        }

        // Continue turn processing
        this.finishTurn();
    }

    /**
     * Finish the turn after card resolution (and optional heart choice)
     */
    finishTurn() {
        // Phase 3: Process turn end (threat damage if 3+ threats)
        const turnEndResult = this.call.processTurnEnd();

        // Phase 4: Check game end conditions
        const result = this.call.checkGameEnd();
        if (result) {
            this.gameOver = true;
            this.won = result === 'won';
        }

        this.isProcessingTurn = false;

        // Emit turn complete event
        this.game.triggerEvent('onTurnComplete', {
            turnNumber: this.turnNumber,
            damage: turnEndResult.amount,
            died: turnEndResult.died
        });
    }

    /**
     * Handle heart choice from player
     */
    onHeartChoice(choice) {
        this.hideHeartChoiceUI();
        this.call.completeHeartChoice(choice);
        this.finishTurn();
    }

    /**
     * Show UI for heart card choice (heal or store)
     */
    showHeartChoiceUI(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');
        const choiceUI = document.getElementById('heartChoiceUI');
        const healAmount = document.getElementById('healAmount');

        if (choiceUI) {
            choiceUI.classList.remove('hidden');
        }
        if (healAmount) {
            healAmount.textContent = card.rank;
        }
    }

    /**
     * Hide heart choice UI
     */
    hideHeartChoiceUI() {
        const choiceUI = document.getElementById('heartChoiceUI');
        if (choiceUI) {
            choiceUI.classList.add('hidden');
        }
    }

    /**
     * Get current turn number
     */
    getTurnNumber() {
        return this.turnNumber;
    }

    /**
     * Check if game is over
     */
    isGameOver() {
        return this.gameOver;
    }

    /**
     * Get card name for display (e.g., "K♠", "7♥")
     */
    getCardName(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');
        const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const suits = ['♥', '♦', '♣', '♠'];
        return ranks[card.rank] + suits[card.suit];
    }

    /**
     * Update turn counter display
     */
    updateTurnDisplay() {
        const turnCounter = document.getElementById('turnCounter');
        if (turnCounter) {
            turnCounter.textContent = `Turn ${this.turnNumber}`;
        }
    }

    setupSettingsModal() {
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsModal = document.getElementById('settingsModal');
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');

        // Set up music toggle
        const musicToggleBtn = document.getElementById('musicToggleBtn');
        if (musicToggleBtn) {
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
            const currentSfxVolume = this.call.getSfxVolume?.() ?? 0.5;
            sfxVolumeSlider.value = Math.round(currentSfxVolume * 100);
            sfxVolumeValue.textContent = `${sfxVolumeSlider.value}%`;

            sfxVolumeSlider.addEventListener('input', () => {
                const volume = parseInt(sfxVolumeSlider.value) / 100;
                sfxVolumeValue.textContent = `${sfxVolumeSlider.value}%`;
                this.call.setSfxVolume?.(volume);
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
        // Game state is updated via events and turn processing
    }
}
