/**
 * TutorialSystem - Interactive walkthrough tutorial with fixed scenario
 * Guides the player through actual gameplay moves
 */
class TutorialSystem extends GUTS.BaseSystem {
    static services = ['startTutorial', 'endTutorial', 'isTutorialActive', 'onCardPlayed'];
    static serviceDependencies = ['getHandCards', 'getColumnCards', 'getKingdomCards', 'getDeckCount', 'flowCard', 'startAISimulation', 'stopAISimulation', 'setAISpeed', 'shuffleDeck', 'dealInitialHand'];

    constructor(game) {
        super(game);
        this.active = false;
        this.currentStep = 0;
        this.overlay = null;
        this.waitingForAction = null;
        this.drawCount = 0; // Track draws for the discard demonstration
        this.cardsDealt = false; // Track if initial hand has been dealt

        // Tutorial steps - each step explains something and optionally waits for an action
        this.steps = [
            {
                title: "Welcome to Volition!",
                text: "Let's learn how to play. Your goal is to move all 52 cards to the kingdoms sorted by suit from Ace to King.",
                highlight: null,
                waitFor: null, // No action required, just click Next
                position: "center"
            },
            {
                title: "Your Hand",
                text: "These are your cards. You can drag any card from your hand to play it.",
                highlight: "#handArea",
                waitFor: null,
                position: "above"
            },
            {
                title: "The Kingdoms",
                text: "Each suit has its own kingdom. Start with Aces, then build up to Kings. The kingdoms are Hearts, Diamonds, Clubs, and Spades.",
                highlight: "#kingdomArea",
                waitFor: null,
                position: "below"
            },
            {
                title: "Discard Preview",
                text: "The red outline on the field shows where your oldest card will go when it's pushed out of your hand.",
                highlight: "#fieldArea",
                waitFor: null,
                position: "below"
            },
            {
                title: "Discard Order",
                text: "Cards are discarded to empty columns first (left to right). If all columns have cards, it cycles through them in order.",
                highlight: "#fieldArea",
                waitFor: null,
                position: "below"
            },
            {
                title: "Play an Ace!",
                text: "Look for an Ace in your hand. Drag it to its matching kingdom, or double-tap it to auto-play.",
                highlight: "#handArea",
                waitFor: { type: 'kingdom', description: 'Play any Ace to the kingdom' },
                position: "above",
                isActionStep: true
            },
            {
                title: "Great!",
                text: "Nice work! You just played a card to the kingdom. Keep building each suit up to King to win.",
                highlight: "#kingdomArea",
                waitFor: null,
                position: "below"
            },
            {
                title: "The Field",
                text: "These columns are the main play area.  Stack cards in descending order with alternating colors (red on black, black on red).",
                highlight: "#fieldArea",
                waitFor: null,
                position: "below"
            },
            {
                title: "Play to the Field",
                text: "Try placing a card on the field. Remember: descending order, alternating colors. Only Kings can start an empty column.  These rules do NOT apply to discards!  Watch out!",
                highlight: "#fieldArea",
                waitFor: { type: 'field', description: 'Play a card to the field' },
                position: "below",
                isActionStep: true
            },
            {
                title: "Card Flow",
                text: "Your hand always holds 5 cards. When you draw from the deck, the oldest card (leftmost) is pushed out to the next field column regardless of what is there. Try to play cards before they get pushed out!",
                highlight: "#handArea",
                waitFor: null,
                position: "above"
            },
            {
                title: "Try Drawing a Card",
                text: "Click the deck to draw a card. Watch where your oldest card goes!",
                highlight: "#deckArea",
                waitFor: { type: 'draw', description: 'Draw a card from the deck' },
                position: "above",
                isActionStep: true
            },
            {
                title: "Keep Drawing",
                text: "Keep clicking the deck. Watch each column fill up one by one.",
                highlight: "#deckArea",
                waitFor: { type: 'draw', description: 'Draw another card' },
                position: "above",
                isActionStep: true
            },
            {
                title: "Columns Filling",
                text: "Draw again! You won't always have a lot of moves at the start of the game.  That's ok!",
                highlight: "#deckArea",
                waitFor: { type: 'draw', description: 'Draw another card' },
                position: "above",
                isActionStep: true
            },
            {
                title: "Keep Going",
                text: "There are still no moves!  Nobody chooses where they begin in life.  But there is still hope!",
                highlight: "#deckArea",
                waitFor: { type: 'draw', description: 'Draw another card' },
                position: "above",
                isActionStep: true
            },
            {
                title: "Almost Full",
                text: "Draw again.  Soon all of the columns will be full, and discards will loop to the start again.",
                highlight: "#deckArea",
                waitFor: { type: 'draw', description: 'Draw another card' },
                position: "above",
                isActionStep: true
            },
            {
                title: "All Columns Full",
                text: "Last draw for the tutorial.  Stick with me, there is a point to this!",
                highlight: "#deckArea",
                waitFor: { type: 'draw', description: 'Draw one more card' },
                position: "above",
                isActionStep: true
            },
            {
                title: "Important: Discard Rules!",
                text: "Notice the discard ignored placement rules! Unlike when YOU play cards, discards ignore constraints. They don't need alternating colors or descending order. This is why you should play cards before they get pushed out!",
                highlight: "#fieldArea",
                waitFor: null,
                position: "below"
            },
            {
                title: "You're Ready!",
                text: "Build all four kingdoms from Ace to King to win. Play cards wisely and manage your hand. Good luck!",
                highlight: null,
                waitFor: null,
                position: "center",
                isFinalStep: true
            }
        ];
    }

    init() {
        console.log('TutorialSystem initializing...');
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
                if (this.active && this.waitingForAction?.type === 'draw') {
                    setTimeout(() => this.completeAction('draw'), 100);
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
    }

    completeAction(actionType) {
        if (!this.active || !this.waitingForAction) return;
        if (this.waitingForAction.type !== actionType) return;

        // Action completed, advance to next step
        this.waitingForAction = null;
        setTimeout(() => this.nextStep(), 300);
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
        this.drawCount = 0;

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
            console.warn('Failed to save tutorial state:', e);
        }

        this.game.sceneManager?.switchScene('game');
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
            console.warn('Failed to save tutorial state:', e);
        }

        // Stay in current scene - cards are already dealt, let them play
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

        // Update content
        this.titleEl.textContent = step.title;
        this.textEl.textContent = step.text;
        this.progressEl.textContent = `${stepIndex + 1} / ${this.steps.length}`;

        // Update button based on step type
        if (step.isActionStep) {
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
