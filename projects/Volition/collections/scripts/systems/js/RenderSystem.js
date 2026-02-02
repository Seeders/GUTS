/**
 * RenderSystem - Renders cards to the DOM and handles animations
 */
class RenderSystem extends GUTS.BaseSystem {
    static services = ['createCardElement', 'updateCardPosition', 'getCardElement', 'flipCard'];
    static serviceDependencies = ['isValidSequence', 'canPlayToKingdom', 'getTotalKingdomCards'];

    constructor(game) {
        super(game);
        this.cardElements = new Map();
        this.suitSymbols = ['\u2665', '\u2662', '\u2667', '\u2660']; // hearts, diamonds (outline), clubs (outline), spades
        this.rankNames = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        this.cardContainer = null;
        this.animationSpeed = 2000; // pixels per second
    }

    init() {
        const config = this.game.gameInstance?.getConfig() || {};
        this.animationSpeed = config.animationSpeed !== undefined ? config.animationSpeed : 2000;
    }

    postAllInit() {
        this.cardContainer = document.getElementById('cardContainer');
    }

    createCardElement(cardEid) {
        if (this.cardElements.has(cardEid)) {
            return this.cardElements.get(cardEid);
        }

        const card = this.game.getComponent(cardEid, 'card');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        const el = document.createElement('div');
        el.className = 'card';
        el.dataset.entityId = cardEid;

        // Set color class (red for hearts/diamonds, black for clubs/spades)
        const isRed = card.suit === 0 || card.suit === 1;
        el.classList.add(isRed ? 'red' : 'black');

        const suitSymbol = this.suitSymbols[card.suit];
        const rankName = this.rankNames[card.rank];
        const centerContent = this.getPipPattern(card.rank, suitSymbol);

        // Card has both front and back faces for flip animation
        el.innerHTML = `
            <div class="card-flipper">
                <div class="card-front">
                    <div class="card-corner top-left">
                        <span class="card-rank">${rankName}</span>
                    </div>
                    <div class="card-corner top-right">
                        <span class="card-suit-large">${suitSymbol}</span>
                    </div>
                    <div class="card-pips">${centerContent}</div>
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

        // Set initial face state
        if (card.faceUp === 0) {
            el.classList.add('face-down');
        }

        this.cardContainer.appendChild(el);
        this.cardElements.set(cardEid, el);

        return el;
    }

    getPipPattern(rank, suit) {
        // Face cards
        if (rank >= 11) {
            const faces = { 11: 'J', 12: 'Q', 13: 'K' };
            return `<span class="face-letter">${faces[rank]}</span>`;
        }

        // Ace - large center
        if (rank === 1) {
            return `<span class="pip ace">${suit}</span>`;
        }

        // Pip positions for 2-10
        // Positions: t=top, m=middle, b=bottom, l=left, c=center, r=right
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

    getCardElement(cardEid) {
        return this.cardElements.get(cardEid);
    }

    updateCardPosition(cardEid) {
        const el = this.cardElements.get(cardEid);
        if (!el) return;

        const visual = this.game.getComponent(cardEid, 'cardVisual');
        el.style.left = visual.x + 'px';
        el.style.top = visual.y + 'px';
        el.style.zIndex = visual.zIndex;
    }

    flipCard(cardEid) {
        const el = this.cardElements.get(cardEid);
        if (!el) return;

        // Add flipping animation class
        el.classList.add('flipping');
        el.classList.remove('face-down');

        // Remove animation class after it completes
        setTimeout(() => {
            el.classList.remove('flipping');
        }, 400);
    }

    onAnimationSpeedChanged(data) {
        this.animationSpeed = data.speed;
    }

    update() {
        const dt = 0.016; // ~60fps
        const entities = this.game.getEntitiesWith('card', 'cardVisual', 'cardLocation');

        for (const eid of entities) {
            const loc = this.game.getComponent(eid, 'cardLocation');
            const card = this.game.getComponent(eid, 'card');
            const visual = this.game.getComponent(eid, 'cardVisual');
            const draggable = this.game.getComponent(eid, 'draggable');

            // Skip cards in deck (not visible)
            if (loc.location === 0) {
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
            el.style.display = '';

            // Animate position if not dragging
            if (!draggable.isDragging && visual.animating) {
                const dx = visual.targetX - visual.x;
                const dy = visual.targetY - visual.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Close enough - snap to target
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

            // Update DOM element position
            el.style.left = visual.x + 'px';
            el.style.top = visual.y + 'px';
            el.style.zIndex = visual.zIndex;

            // Update classes
            el.classList.toggle('dragging', draggable.isDragging === 1);

            // Update face-down state (unless actively flipping)
            if (!el.classList.contains('flipping')) {
                el.classList.toggle('face-down', card.faceUp === 0);
            }

            // Highlight oldest card in hand
            if (loc.location === 1 && loc.index === 0) {
                el.classList.add('oldest-in-hand');
            } else {
                el.classList.remove('oldest-in-hand');
            }

            // Check if playable (can go to kingdom)
            if (loc.location === 1) {
                const canPlay = this.call.canPlayToKingdom(eid);
                el.classList.toggle('playable', canPlay);
            }

            // Mark chaotic cards in field (not part of valid alternating sequence)
            if (loc.location === 3) {
                const isValid = this.call.isValidSequence(eid);
                el.classList.toggle('chaotic', !isValid);
            } else {
                el.classList.remove('chaotic');
            }
        }

        // Update kingdom progress
        this.updateProgress();
    }

    updateProgress() {
        const progressEl = document.getElementById('kingdomProgress');
        if (progressEl) {
            const count = this.call.getTotalKingdomCards();
            progressEl.textContent = `${count}/52`;
        }
    }
}
