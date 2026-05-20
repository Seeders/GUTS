/**
 * CardRenderSystem - Global system for rendering playing cards to the DOM
 *
 * Handles:
 * - Creating card DOM elements with proper suit/rank display
 * - Pip patterns for number cards (2-10)
 * - Face card letters (J, Q, K)
 * - Card flip animations
 * - Position animations
 * - Card back design
 *
 * Games can customize card appearance via CSS or by extending this system.
 */
class CardRenderSystem extends GUTS.BaseSystem {
    static services = [
        'createCardElement', 'removeCardElement', 'getCardElement',
        'updateCardPosition', 'flipCard', 'setCardFaceUp',
        'getCardWidth', 'getCardHeight',
        'getSuitSymbol', 'getSuitName', 'getRankName', 'isRedSuit'
    ];

    constructor(game) {
        super(game);
        this.cardElements = new Map(); // entityId -> DOM element
        this.cardContainer = null;

        // Card dimensions (can be overridden by CSS variables)
        this.cardWidth = 70;
        this.cardHeight = 98;

        // Animation settings
        this.animationSpeed = 2000; // pixels per second
        this.flipDuration = 400; // ms

        // Suit symbols (index = suit value)
        this.suitSymbols = ['♥', '♦', '♣', '♠', '★']; // hearts, diamonds, clubs, spades, joker
        this.suitNames = ['hearts', 'diamonds', 'clubs', 'spades', 'joker'];

        // Rank display names (index = rank value)
        this.rankNames = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    }

    init() {
        console.log('[CardRenderSystem] init()');
        const config = this.game.getConfig?.() || {};
        console.log('[CardRenderSystem] config:', config);
        this.animationSpeed = config.animationSpeed ?? 2000;
        this._isHeadless = config.isHeadless || false;
        console.log('[CardRenderSystem] isHeadless:', this._isHeadless);
    }

    postAllInit() {
        console.log('[CardRenderSystem] postAllInit()');
        if (this._isHeadless) {
            console.log('[CardRenderSystem] Skipping - headless mode');
            return;
        }

        this.cardContainer = document.getElementById('cardContainer');
        console.log('[CardRenderSystem] cardContainer:', this.cardContainer);

        // Read dimensions from CSS if available
        const style = getComputedStyle(document.documentElement);
        this.cardWidth = parseInt(style.getPropertyValue('--card-width')) || this.cardWidth;
        this.cardHeight = parseInt(style.getPropertyValue('--card-height')) || this.cardHeight;
        console.log('[CardRenderSystem] cardWidth:', this.cardWidth, 'cardHeight:', this.cardHeight);
    }

    onAnimationSpeedChanged(data) {
        this.animationSpeed = data.speed;
    }

    /**
     * Get suit symbol for display
     * @param {number} suit - Suit value
     * @returns {string}
     */
    getSuitSymbol(suit) {
        return this.suitSymbols[suit] || '?';
    }

    /**
     * Get suit name for CSS classes
     * @param {number} suit - Suit value
     * @returns {string}
     */
    getSuitName(suit) {
        return this.suitNames[suit] || 'unknown';
    }

    /**
     * Get rank display name
     * @param {number} rank - Rank value
     * @returns {string}
     */
    getRankName(rank) {
        return this.rankNames[rank] || '';
    }

    /**
     * Check if suit is red (hearts or diamonds)
     * @param {number} suit - Suit value
     * @returns {boolean}
     */
    isRedSuit(suit) {
        return suit === 0 || suit === 1;
    }

    /**
     * Get card width
     * @returns {number}
     */
    getCardWidth() {
        return this.cardWidth;
    }

    /**
     * Get card height
     * @returns {number}
     */
    getCardHeight() {
        return this.cardHeight;
    }

    /**
     * Create a DOM element for a card
     * @param {number} cardEid - Entity ID of the card
     * @returns {HTMLElement|null}
     */
    createCardElement(cardEid) {
        if (this._isHeadless) return null;
        if (this.cardElements.has(cardEid)) {
            return this.cardElements.get(cardEid);
        }

        const card = this.game.getComponent(cardEid, 'card');
        const visual = this.game.getComponent(cardEid, 'cardVisual');
        if (!card || !visual) {
            console.warn('[CardRenderSystem] createCardElement failed - missing component', cardEid, 'card:', !!card, 'visual:', !!visual);
            return null;
        }
        console.log('[CardRenderSystem] createCardElement', cardEid, 'suit:', card.suit, 'rank:', card.rank);

        const el = document.createElement('div');
        el.className = 'card';
        el.dataset.entityId = cardEid;

        // Color class
        const isRed = this.isRedSuit(card.suit);
        el.classList.add(isRed ? 'red' : 'black');

        // Suit class
        el.classList.add(`suit-${this.getSuitName(card.suit)}`);

        const suitSymbol = this.getSuitSymbol(card.suit);
        const rankName = this.getRankName(card.rank);
        const pipsContent = this.createPipPattern(card.rank, suitSymbol);

        el.innerHTML = `
            <div class="card-flipper">
                <div class="card-front">
                    <div class="card-corner top-left">
                        <span class="card-rank">${rankName}</span>
                    </div>
                    <div class="card-corner top-right">
                        <span class="card-suit-large">${suitSymbol}</span>
                    </div>
                    <div class="card-pips">${pipsContent}</div>
                    <div class="card-corner bottom-left">
                        <span class="card-suit-large">${suitSymbol}</span>
                    </div>
                    <div class="card-corner bottom-right">
                        <span class="card-rank">${rankName}</span>
                    </div>
                </div>
                <div class="card-back">
                    <div class="card-back-pattern"></div>
                </div>
            </div>
        `;

        el.style.left = visual.x + 'px';
        el.style.top = visual.y + 'px';
        el.style.zIndex = visual.zIndex;

        if (card.faceUp === 0) {
            el.classList.add('face-down');
        }

        if (this.cardContainer) {
            this.cardContainer.appendChild(el);
        }
        this.cardElements.set(cardEid, el);

        return el;
    }

    /**
     * Create pip pattern HTML for card center
     * @param {number} rank - Card rank
     * @param {string} suit - Suit symbol
     * @returns {string} HTML string
     */
    createPipPattern(rank, suit) {
        // Face cards
        if (rank >= 11) {
            const faces = { 11: 'J', 12: 'Q', 13: 'K' };
            return `<span class="face-letter">${faces[rank]}</span>`;
        }

        // Ace - large center suit
        if (rank === 1) {
            return `<span class="pip ace">${suit}</span>`;
        }

        // Joker
        if (rank === 0) {
            return `<span class="face-letter">★</span>`;
        }

        // Number cards (2-10) pip positions
        const patterns = {
            2: ['tc', 'bc-flip'],
            3: ['tc', 'mc', 'bc-flip'],
            4: ['tl', 'tr', 'bl-flip', 'br-flip'],
            5: ['tl', 'tr', 'mc', 'bl-flip', 'br-flip'],
            6: ['tl', 'tr', 'ml', 'mr', 'bl-flip', 'br-flip'],
            7: ['tl', 'tr', 'ml', 'mr', 'bl-flip', 'br-flip', 'tc2'],
            8: ['tl', 'tr', 'ml', 'mr', 'bl-flip', 'br-flip', 'tc2', 'bc2-flip'],
            9: ['tl', 'tr', 'tl2', 'tr2', 'mc', 'bl2-flip', 'br2-flip', 'bl-flip', 'br-flip'],
            10: ['tl', 'tr', 'tc2', 'tl2', 'tr2', 'bl2-flip', 'br2-flip', 'bc2-flip', 'bl-flip', 'br-flip']
        };

        const positions = patterns[rank] || [];
        return positions.map(pos => {
            const isFlipped = pos.includes('-flip');
            const posClass = pos.replace('-flip', '');
            return `<span class="pip ${posClass}${isFlipped ? ' flip' : ''}">${suit}</span>`;
        }).join('');
    }

    /**
     * Remove card element from DOM
     * @param {number} cardEid - Entity ID
     */
    removeCardElement(cardEid) {
        const el = this.cardElements.get(cardEid);
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
        this.cardElements.delete(cardEid);
    }

    /**
     * Get existing card element
     * @param {number} cardEid - Entity ID
     * @returns {HTMLElement|null}
     */
    getCardElement(cardEid) {
        return this.cardElements.get(cardEid) || null;
    }

    /**
     * Update card DOM position from component
     * @param {number} cardEid - Entity ID
     */
    updateCardPosition(cardEid) {
        const el = this.cardElements.get(cardEid);
        if (!el) return;

        const visual = this.game.getComponent(cardEid, 'cardVisual');
        if (!visual) return;

        el.style.left = visual.x + 'px';
        el.style.top = visual.y + 'px';
        el.style.zIndex = visual.zIndex;
    }

    /**
     * Trigger flip animation for a card
     * @param {number} cardEid - Entity ID
     */
    flipCard(cardEid) {
        if (this._isHeadless) return;

        const el = this.cardElements.get(cardEid);
        if (!el) return;

        el.classList.add('flipping');
        el.classList.remove('face-down');

        setTimeout(() => {
            el.classList.remove('flipping');
        }, this.flipDuration);
    }

    /**
     * Set card face up/down state without animation
     * @param {number} cardEid - Entity ID
     * @param {boolean} faceUp - Whether card should be face up
     */
    setCardFaceUp(cardEid, faceUp) {
        const el = this.cardElements.get(cardEid);
        if (!el) return;

        const card = this.game.getComponent(cardEid, 'card');
        if (card) {
            card.faceUp = faceUp ? 1 : 0;
        }

        el.classList.toggle('face-down', !faceUp);
    }

    update() {
        if (this._isHeadless) return;

        const dt = 0.016; // ~60fps
        const entities = this.game.getEntitiesWith('card', 'cardVisual');

        // Debug logging (only once)
        if (!this._debugLogged && entities.length > 0) {
            console.log('[CardRenderSystem] update() - found', entities.length, 'card entities');
            const first = entities[0];
            const loc = this.game.getComponent(first, 'cardLocation');
            const visual = this.game.getComponent(first, 'cardVisual');
            console.log('[CardRenderSystem] First card location:', loc);
            console.log('[CardRenderSystem] First card visual:', visual);
            this._debugLogged = true;
        }

        for (const eid of entities) {
            const card = this.game.getComponent(eid, 'card');
            const visual = this.game.getComponent(eid, 'cardVisual');
            const draggable = this.game.getComponent(eid, 'draggable');
            const loc = this.game.getComponent(eid, 'cardLocation');

            // Skip cards in deck (location 0) - they're not visible
            if (loc && loc.location === 0) {
                const el = this.cardElements.get(eid);
                if (el) {
                    el.style.display = 'none';
                }
                continue;
            }

            // Create element if needed
            let el = this.cardElements.get(eid);
            if (!el) {
                el = this.createCardElement(eid);
            }
            if (!el) continue;

            el.style.display = '';

            // Animate position if not dragging
            if (draggable && !draggable.isDragging && visual.animating) {
                const dx = visual.targetX - visual.x;
                const dy = visual.targetY - visual.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 2) {
                    visual.x = visual.targetX;
                    visual.y = visual.targetY;
                    visual.animating = 0;
                } else {
                    const speed = this.animationSpeed * dt;
                    const ratio = Math.min(speed / dist, 1);
                    visual.x += dx * ratio;
                    visual.y += dy * ratio;
                }
            }

            // Update DOM
            el.style.left = visual.x + 'px';
            el.style.top = visual.y + 'px';
            el.style.zIndex = visual.zIndex;

            if (draggable) {
                el.classList.toggle('dragging', draggable.isDragging === 1);
            }

            // Update face state (unless flipping)
            if (!el.classList.contains('flipping')) {
                el.classList.toggle('face-down', card.faceUp === 0);
            }
        }
    }
}
