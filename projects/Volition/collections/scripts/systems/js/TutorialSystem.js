/**
 * TutorialSystem - Interactive walkthrough tutorial with fixed scenario
 * Guides the player through actual gameplay moves
 */
class TutorialSystem extends GUTS.BaseSystem {
    static services = ['startTutorial', 'endTutorial', 'isTutorialActive', 'onCardPlayed'];
    static serviceDependencies = ['getHandCards', 'getColumnCards', 'getKingdomCards', 'getDeckCount', 'flowCard', 'startAISimulation', 'stopAISimulation', 'setAISpeed', 'shuffleDeck', 'dealInitialHand', 'resetDeck', 'getFieldColumns', 'pushToHand', 'dealCard', 'getHandCapacity'];

    constructor(game) {
        super(game);
        this.active = false;
        this.currentStep = 0;
        this.overlay = null;
        this.waitingForAction = null;
        this.cardsDealt = false; // Track if initial hand has been dealt

        // Tutorial steps - each step explains something and optionally waits for an action
        this.steps = [
            {
                title: "Welcome to Volition!",
                text: "Let's learn how to play. Your goal is to move all 52 cards to the kingdoms sorted by suit from Ace to King.",
                highlight: null,
                waitFor: null,
                position: "center"
            },
            {
                title: "The Kingdoms",
                text: "Each suit has its own kingdom. Start with Aces, then build up to Kings.",
                highlight: "#kingdomArea",
                waitFor: null,
                position: "below"
            },
            {
                title: "The Field",
                text: "The field has 6 columns that hold cards still in play.",
                highlight: "#fieldArea",
                waitFor: null,
                position: "below"
            },
            {
                title: "Play the Ace!",
                text: "Drag the Ace from the field to its matching kingdom, or double-tap it to auto-play.",
                highlight: "#fieldArea",
                waitFor: { type: 'kingdom', description: 'Play the Ace to the kingdom' },
                position: "below",
                isActionStep: true
            },
            {
                title: "Great!",
                text: "Nice work! Cards can be played to kingdoms from your hand or the field.",
                highlight: "#kingdomArea",
                waitFor: null,
                position: "below"
            },
            {
                title: "Your Hand",
                text: "This is your hand. You can play cards to empty columns, or stack them in descending order with alternating colors.",
                highlight: "#handArea",
                waitFor: null,
                position: "above"
            },
            {
                title: "Fill the Empty Column!",
                text: "The Ace left an empty column. Drag any card from your hand to fill it!",
                highlight: "#fieldArea",
                waitFor: { type: 'field', description: 'Play a card to the field' },
                position: "below",
                isActionStep: true
            },
            {
                title: "Card Flow",
                text: "When you draw from the deck, your oldest card (leftmost) gets pushed out to the field as a discard.",
                highlight: "#deckArea",
                waitFor: null,
                position: "above"
            },
            {
                title: "Watch What Happens",
                text: "Draw a card and watch where the discard goes. It will ignore placement rules!",
                highlight: "#deckArea",
                waitFor: { type: 'draw', description: 'Draw a card' },
                position: "above",
                isActionStep: true
            },
            {
                title: "Discards Ignore Rules!",
                text: "See how that red card stacked on another red card? Discards can block important cards, so play wisely!",
                highlight: "#fieldArea",
                waitFor: null,
                position: "below"
            },
            {
                title: "You're Ready!",
                text: "Build all four kingdoms from Ace to King to win. Good luck!",
                highlight: null,
                waitFor: null,
                position: "center",
                isFinalStep: true
            }
        ];
    }

    init() {
    }

    postAllInit() {
        this.createOverlay();
        this.hookCardActions();

        // Auto-start tutorial (this system is only loaded in tutorial scene)
        setTimeout(() => this.startTutorial(), 500);
    }

    hookCardActions() {
        // Hook the deck button to detect card draws
        const deckArea = document.getElementById('deckArea');
        if (deckArea) {
            deckArea.addEventListener('click', () => {
                if (this.active && this.waitingForAction) {
                    // Handle draw action immediately
                    if (this.waitingForAction?.type === 'draw') {
                        setTimeout(() => this.completeAction('draw'), 200);
                    }
                    // Start polling for fill_columns completion
                    this.startFillColumnsPolling();
                }
            });
        }
    }

    // Called by KingdomSystem and FieldSystem when a card is played
    onCardPlayed(location, cardEid) {
        if (!this.active || !this.waitingForAction) return;

        if (this.waitingForAction.type === 'kingdom' && location === 'kingdom') {
            this.completeAction('kingdom');
        } else if (this.waitingForAction.type === 'field' && location === 'field') {
            this.completeAction('field');
        }

        // Start polling for fill_columns completion after field plays
        if (location === 'field') {
            this.startFillColumnsPolling();
        }
    }

    /**
     * Start polling to check if fill_columns is complete
     * Polls every 300ms until all columns have landed cards
     */
    startFillColumnsPolling() {
        if (this._fillColumnsInterval) return; // Already polling
        if (!this.active || !this.waitingForAction) return;
        if (this.waitingForAction.type !== 'fill_columns') return;

        this._fillColumnsInterval = setInterval(() => {
            if (!this.active || !this.waitingForAction || this.waitingForAction.type !== 'fill_columns') {
                clearInterval(this._fillColumnsInterval);
                this._fillColumnsInterval = null;
                return;
            }

            if (this.areAllColumnsFilled()) {
                clearInterval(this._fillColumnsInterval);
                this._fillColumnsInterval = null;
                this.waitingForAction = null;
                setTimeout(() => this.nextStep(), 300);
            }
        }, 300);
    }

    completeAction(actionType) {
        if (!this.active || !this.waitingForAction) return;
        if (this.waitingForAction.type !== actionType) return;

        // Action completed, advance to next step
        this.waitingForAction = null;
        setTimeout(() => this.nextStep(), 300);
    }

    /**
     * Check if all field columns have at least one card
     */
    areAllColumnsFilled() {
        const numColumns = this.call.getFieldColumns?.() || 6;
        let filledCount = 0;
        for (let col = 0; col < numColumns; col++) {
            const colCards = this.call.getColumnCards?.(col) || [];
            if (colCards.length > 0) {
                filledCount++;
            }
        }
        return filledCount === numColumns;
    }

    /**
     * Fill hand to capacity before the draw demonstration
     * This ensures a discard happens when the user draws
     */
    fillHandForDemo() {
        const capacity = this.call.getHandCapacity?.() || 5;
        const handCards = this.call.getHandCards?.() || [];
        const cardsNeeded = capacity - handCards.length;

        for (let i = 0; i < cardsNeeded; i++) {
            const cardEid = this.call.dealCard?.();
            if (!cardEid) break;
            this.call.pushToHand?.(cardEid);
        }
    }

    /**
     * Check if an action was already completed before we reached this step
     * This handles cases where user performs actions out of order
     */
    isActionAlreadyCompleted(waitFor) {
        if (!waitFor) return false;

        if (waitFor.type === 'kingdom') {
            // Check if any cards are in the kingdom (tutorial starts with empty kingdoms)
            for (let suit = 0; suit < 4; suit++) {
                const cards = this.call.getKingdomCards?.(suit) || [];
                if (cards.length > 0) {
                    return true; // At least one card played to kingdom
                }
            }
            return false;
        }

        if (waitFor.type === 'field') {
            // Check if any field column has MORE than 1 card (indicating stacking)
            // Columns are pre-filled with 1 card each during initial deal
            const numColumns = this.call.getFieldColumns?.() || 6;
            for (let col = 0; col < numColumns; col++) {
                const colCards = this.call.getColumnCards?.(col) || [];
                if (colCards.length > 1) {
                    return true; // Stacking has occurred
                }
            }
            return false;
        }

        if (waitFor.type === 'fill_columns') {
            return this.areAllColumnsFilled();
        }

        return false;
    }

    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'tutorialOverlay';
        this.overlay.className = 'tutorial-overlay hidden';
        this.overlay.innerHTML = `
            <div class="tutorial-backdrop"></div>
            <div class="tutorial-highlight"></div>
            <div class="tutorial-choice" style="display: none;">
                <h2 class="choice-title">Welcome to Volition!</h2>
                <p class="choice-text">How would you like to learn?</p>
                <div class="choice-buttons">
                    <button class="choice-btn choice-tutorial">
                        <span class="choice-icon">📖</span>
                        <span class="choice-label">Interactive Tutorial</span>
                        <span class="choice-desc">Step-by-step guidance</span>
                    </button>
                    <button class="choice-btn choice-watch">
                        <span class="choice-icon">🤖</span>
                        <span class="choice-label">Watch AI Play</span>
                        <span class="choice-desc">Learn by observation</span>
                    </button>
                </div>
                <button class="choice-skip">Skip - I know how to play</button>
            </div>
            <div class="tutorial-box">
                <h3 class="tutorial-title"></h3>
                <p class="tutorial-text"></p>
                <div class="tutorial-nav">
                    <span class="tutorial-progress"></span>
                    <div class="tutorial-buttons">
                        <button class="tutorial-skip">Skip Tutorial</button>
                        <button class="tutorial-next">Next</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);

        this.choiceEl = this.overlay.querySelector('.tutorial-choice');
        this.highlightEl = this.overlay.querySelector('.tutorial-highlight');
        this.boxEl = this.overlay.querySelector('.tutorial-box');
        this.titleEl = this.overlay.querySelector('.tutorial-title');
        this.textEl = this.overlay.querySelector('.tutorial-text');
        this.progressEl = this.overlay.querySelector('.tutorial-progress');
        this.nextBtn = this.overlay.querySelector('.tutorial-next');
        this.skipBtn = this.overlay.querySelector('.tutorial-skip');

        // Choice screen buttons
        const tutorialBtn = this.overlay.querySelector('.choice-tutorial');
        const watchBtn = this.overlay.querySelector('.choice-watch');
        const choiceSkipBtn = this.overlay.querySelector('.choice-skip');

        tutorialBtn.addEventListener('click', () => this.startInteractiveTutorial());
        watchBtn.addEventListener('click', () => this.startWatchAI());
        choiceSkipBtn.addEventListener('click', () => this.skipToGame());

        this.nextBtn.addEventListener('click', () => {
            if (!this.waitingForAction) {
                this.nextStep();
            }
        });
        this.skipBtn.addEventListener('click', () => this.endTutorial());
    }

    isTutorialActive() {
        // Service only exists in tutorial scene
        return true;
    }

    startTutorial() {
        // Show the choice screen first
        this.overlay.classList.remove('hidden');
        this.choiceEl.style.display = 'flex';
        this.boxEl.style.display = 'none';
        this.highlightEl.style.display = 'none';
    }

    startInteractiveTutorial() {
        // User chose the interactive tutorial
        this.choiceEl.style.display = 'none';
        this.boxEl.style.display = 'block';
        this.active = true;
        this.currentStep = 0;
        this.waitingForAction = null;

        // Deal the initial hand (uses fixed tutorial deck already set up by DeckSystem)
        this.call.dealInitialHand();
        this.cardsDealt = true;

        this.showStep(this.currentStep);
    }

    startWatchAI() {
        // User chose to watch the AI play
        this.choiceEl.style.display = 'none';
        this.boxEl.style.display = 'none';
        this.overlay.classList.add('hidden');
        this.active = false;

        // Mark tutorial as seen (watching AI counts as learning)
        try {
            localStorage.setItem('volitionTutorialSeen', 'true');
        } catch (e) {
            // Ignore localStorage errors
        }

        // Shuffle deck randomly (overrides the fixed tutorial deck)
        this.call.shuffleDeck();

        // Deal the initial hand
        this.call.dealInitialHand();
        this.cardsDealt = true;

        // Start the AI at a comfortable watching speed
        this.call.setAISpeed(800);
        this.call.startAISimulation();
    }

    skipToGame() {
        // User clicked "Skip - I know how to play" from choice screen
        // Just go to the game scene
        try {
            localStorage.setItem('volitionTutorialSeen', 'true');
        } catch (e) {
            // Ignore localStorage errors
        }

        // Hide the overlay before switching
        this.overlay.classList.add('hidden');

        if (this.game.sceneManager) {
            this.game.sceneManager.switchScene('game');
        } else {
            console.error('SceneManager not found on game object');
        }
    }

    endTutorial() {
        // Called when user finishes tutorial or clicks "Skip Tutorial" during tutorial
        this.active = false;
        this.waitingForAction = null;
        this.overlay.classList.add('hidden');
        this.clearHighlight();

        // Mark tutorial as seen
        try {
            localStorage.setItem('volitionTutorialSeen', 'true');
        } catch (e) {
            // Ignore localStorage errors
        }

        // Go to game scene
        if (this.game.sceneManager) {
            this.game.sceneManager.switchScene('game');
        } else {
            console.error('SceneManager not found on game object');
        }
    }

    nextStep() {
        this.currentStep++;
        if (this.currentStep >= this.steps.length) {
            this.endTutorial();
        } else {
            this.showStep(this.currentStep);
        }
    }

    showStep(stepIndex) {
        const step = this.steps[stepIndex];

        // Before draw demonstration, fill hand so discard happens
        if (step.waitFor?.type === 'draw') {
            this.fillHandForDemo();
        }

        // Update content
        this.titleEl.textContent = step.title;
        this.textEl.textContent = step.text;
        this.progressEl.textContent = `${stepIndex + 1} / ${this.steps.length}`;

        // Update button based on step type
        if (step.isActionStep) {
            // Check if action was already completed before we got to this step
            if (this.isActionAlreadyCompleted(step.waitFor)) {
                // Auto-advance since the action was already done
                setTimeout(() => this.nextStep(), 300);
                return;
            }

            this.nextBtn.textContent = "Waiting...";
            this.nextBtn.disabled = true;
            this.nextBtn.classList.add('waiting');
            this.overlay.classList.add('action-step');
            this.waitingForAction = step.waitFor;
        } else if (step.isFinalStep) {
            this.nextBtn.textContent = "Start Playing";
            this.nextBtn.disabled = false;
            this.nextBtn.classList.remove('waiting');
            this.overlay.classList.remove('action-step');
            this.waitingForAction = null;
        } else {
            this.nextBtn.textContent = "Next";
            this.nextBtn.disabled = false;
            this.nextBtn.classList.remove('waiting');
            this.overlay.classList.remove('action-step');
            this.waitingForAction = null;
        }

        // Handle highlight
        this.clearHighlight();
        if (step.highlight) {
            this.highlightElement(step.highlight, step.position);
        } else {
            this.centerBox();
        }
    }

    highlightElement(selector, position) {
        const target = document.querySelector(selector);
        if (!target) {
            this.centerBox();
            return;
        }

        const rect = target.getBoundingClientRect();
        const padding = 8;

        // Hide backdrop when showing highlight (highlight's box-shadow creates the overlay with a hole)
        this.overlay.querySelector('.tutorial-backdrop').style.display = 'none';

        // Position highlight
        this.highlightEl.style.display = 'block';
        this.highlightEl.style.left = (rect.left - padding) + 'px';
        this.highlightEl.style.top = (rect.top - padding) + 'px';
        this.highlightEl.style.width = (rect.width + padding * 2) + 'px';
        this.highlightEl.style.height = (rect.height + padding * 2) + 'px';

        // Position box relative to highlight
        const boxWidth = 320;
        const boxHeight = this.boxEl.offsetHeight || 180;
        let boxX, boxY;

        if (position === 'above') {
            boxX = rect.left + rect.width / 2 - boxWidth / 2;
            boxY = rect.top - boxHeight - 20;
        } else if (position === 'below') {
            boxX = rect.left + rect.width / 2 - boxWidth / 2;
            boxY = rect.bottom + 20;
        } else {
            boxX = window.innerWidth / 2 - boxWidth / 2;
            boxY = window.innerHeight / 2 - boxHeight / 2;
        }

        // Keep within viewport
        boxX = Math.max(10, Math.min(window.innerWidth - boxWidth - 10, boxX));
        boxY = Math.max(10, Math.min(window.innerHeight - boxHeight - 10, boxY));

        this.boxEl.style.left = boxX + 'px';
        this.boxEl.style.top = boxY + 'px';
        this.boxEl.style.transform = 'none';
    }

    centerBox() {
        // Show backdrop when no highlight (centered messages need full overlay)
        this.overlay.querySelector('.tutorial-backdrop').style.display = 'block';
        this.highlightEl.style.display = 'none';
        this.boxEl.style.left = '50%';
        this.boxEl.style.top = '50%';
        this.boxEl.style.transform = 'translate(-50%, -50%)';
    }

    clearHighlight() {
        this.highlightEl.style.display = 'none';
    }

    update() {
        // Tutorial is event-driven, but we can update highlight positions if window resizes
        if (this.active && this.steps[this.currentStep]?.highlight) {
            const step = this.steps[this.currentStep];
            const target = document.querySelector(step.highlight);
            if (target) {
                const rect = target.getBoundingClientRect();
                const padding = 8;
                this.highlightEl.style.left = (rect.left - padding) + 'px';
                this.highlightEl.style.top = (rect.top - padding) + 'px';
            }
        }
    }
}
