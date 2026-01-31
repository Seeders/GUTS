/**
 * InputSystem - Handles mouse/touch input for card dragging and playing
 */
class InputSystem extends GUTS.BaseSystem {
    static services = ['selectCard', 'deselectCard'];
    static serviceDependencies = [
        'canPlayToFoundation', 'playToFoundation',
        'canPlayToTableau', 'playToTableau',
        'getHandCards', 'getTableauColumns', 'getColumnCards',
        'isValidSequence', 'getCardsBelow', 'moveTableauToTableau',
        'flowCard',
        'getFoundationPosition', 'getTableauPosition', 'getCardWidth', 'getCardHeight', 'getStackOffset'
    ];

    constructor(game) {
        super(game);
        this.game.inputSystem = this;
        this.selectedCard = null;
        this.draggedCards = []; // Array of cards being dragged (for stack moves)
        this.dragStartPositions = []; // Original positions for each dragged card
        this.sourceLocation = null; // 'hand' or 'tableau'
        this.sourceColumn = -1; // Column index if from tableau
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
    }

    getCardDimensions() {
        return {
            width: this.call.getCardWidth(),
            height: this.call.getCardHeight()
        };
    }

    init() {
        console.log('InputSystem initializing...');
    }

    postAllInit() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        const container = document.getElementById('cardContainer');
        if (!container) {
            setTimeout(() => this.setupEventListeners(), 100);
            return;
        }

        // Mouse events
        document.addEventListener('mousedown', this.onMouseDown.bind(this));
        document.addEventListener('mousemove', this.onMouseMove.bind(this));
        document.addEventListener('mouseup', this.onMouseUp.bind(this));

        // Touch events
        document.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        document.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        document.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });

        // Double-click for auto-play
        document.addEventListener('dblclick', this.onDoubleClick.bind(this));
    }

    getCardAtPosition(x, y) {
        // Collect all playable cards (hand + tableau)
        const allCards = [];

        // Get hand cards
        const handCards = this.call.getHandCards();
        for (const eid of handCards) {
            allCards.push({ eid, source: 'hand', column: -1 });
        }

        // Get tableau cards
        const numCols = this.call.getTableauColumns();
        for (let col = 0; col < numCols; col++) {
            const colCards = this.call.getColumnCards(col);
            for (const eid of colCards) {
                allCards.push({ eid, source: 'tableau', column: col });
            }
        }

        // Sort by z-index (highest first)
        allCards.sort((a, b) => {
            const va = this.game.getComponent(a.eid, 'cardVisual');
            const vb = this.game.getComponent(b.eid, 'cardVisual');
            return vb.zIndex - va.zIndex;
        });

        // Find the card at position
        const dims = this.getCardDimensions();
        for (const cardInfo of allCards) {
            const visual = this.game.getComponent(cardInfo.eid, 'cardVisual');
            if (x >= visual.x && x <= visual.x + dims.width &&
                y >= visual.y && y <= visual.y + dims.height) {
                return cardInfo;
            }
        }
        return null;
    }

    getDropTarget(x, y) {
        const dims = this.getCardDimensions();
        const stackOffset = this.call.getStackOffset();

        // Check foundation piles
        for (let suit = 0; suit < 4; suit++) {
            const pos = this.call.getFoundationPosition(suit);
            if (x >= pos.x && x <= pos.x + dims.width &&
                y >= pos.y && y <= pos.y + dims.height) {
                return { type: 'foundation', suit: suit };
            }
        }

        // Check tableau columns
        const numCols = this.call.getTableauColumns();
        for (let col = 0; col < numCols; col++) {
            const pos = this.call.getTableauPosition(col);
            const colCards = this.call.getColumnCards(col);
            const colHeight = dims.height + colCards.length * stackOffset;

            if (x >= pos.x && x <= pos.x + dims.width &&
                y >= pos.y && y <= pos.y + colHeight) {
                return { type: 'tableau', column: col };
            }
        }

        return null;
    }

    onMouseDown(e) {
        if (this.game.gameInstance?.state?.gameOver) return;

        const cardInfo = this.getCardAtPosition(e.clientX, e.clientY);
        if (cardInfo) {
            this.startDrag(cardInfo, e.clientX, e.clientY);
        }
    }

    onMouseMove(e) {
        if (this.isDragging && this.selectedCard) {
            this.updateDrag(e.clientX, e.clientY);
        }
    }

    onMouseUp(e) {
        if (this.isDragging && this.selectedCard) {
            this.endDrag(e.clientX, e.clientY);
        }
    }

    onTouchStart(e) {
        if (this.game.gameInstance?.state?.gameOver) return;

        const touch = e.touches[0];
        const cardInfo = this.getCardAtPosition(touch.clientX, touch.clientY);
        if (cardInfo) {
            e.preventDefault();
            this.startDrag(cardInfo, touch.clientX, touch.clientY);
        }
    }

    onTouchMove(e) {
        if (this.isDragging && this.selectedCard) {
            e.preventDefault();
            const touch = e.touches[0];
            this.updateDrag(touch.clientX, touch.clientY);
        }
    }

    onTouchEnd(e) {
        if (this.isDragging && this.selectedCard) {
            e.preventDefault();
            const touch = e.changedTouches[0];
            this.endDrag(touch.clientX, touch.clientY);
        }
    }

    onDoubleClick(e) {
        if (this.game.gameInstance?.state?.gameOver) return;

        const cardInfo = this.getCardAtPosition(e.clientX, e.clientY);
        if (cardInfo) {
            // Try to auto-play to foundation (only single cards)
            if (this.call.canPlayToFoundation(cardInfo.eid)) {
                const wasFromHand = cardInfo.source === 'hand';
                this.call.playToFoundation(cardInfo.eid);
                // Auto-refill hand in manual mode
                if (wasFromHand) {
                    this.tryAutoRefill();
                }
            }
        }
    }

    tryAutoRefill() {
        // Automatically draw next card when playing from hand
        this.call.flowCard();
    }

    startDrag(cardInfo, x, y) {
        const { eid, source, column } = cardInfo;

        this.selectedCard = eid;
        this.sourceLocation = source;
        this.sourceColumn = column;
        this.isDragging = true;
        this.draggedCards = [];
        this.dragStartPositions = [];

        const visual = this.game.getComponent(eid, 'cardVisual');
        const draggable = this.game.getComponent(eid, 'draggable');

        this.dragStartX = visual.x;
        this.dragStartY = visual.y;

        draggable.offsetX = x - visual.x;
        draggable.offsetY = y - visual.y;

        if (source === 'hand') {
            // Single card drag from hand
            this.draggedCards = [eid];
            this.dragStartPositions = [{ x: visual.x, y: visual.y, zIndex: visual.zIndex }];
            draggable.isDragging = 1;
            visual.zIndex = 1000;
        } else if (source === 'tableau') {
            // Check if we can drag this card (must be valid sequence)
            if (this.call.isValidSequence(eid)) {
                // Get all cards below this one
                const cardsBelow = this.call.getCardsBelow(eid);
                this.draggedCards = cardsBelow;

                // Store start positions and set dragging state
                cardsBelow.forEach((cardEid, idx) => {
                    const v = this.game.getComponent(cardEid, 'cardVisual');
                    const d = this.game.getComponent(cardEid, 'draggable');
                    this.dragStartPositions.push({ x: v.x, y: v.y, zIndex: v.zIndex });
                    d.isDragging = 1;
                    v.zIndex = 1000 + idx;
                });
            } else {
                // Can't drag chaotic stack
                this.isDragging = false;
                this.selectedCard = null;
                return;
            }
        }
    }

    updateDrag(x, y) {
        if (!this.selectedCard || this.draggedCards.length === 0) return;

        const draggable = this.game.getComponent(this.selectedCard, 'draggable');
        const baseX = x - draggable.offsetX;
        const baseY = y - draggable.offsetY;

        // Move all dragged cards, maintaining their relative positions
        const stackOffset = this.call.getStackOffset();

        this.draggedCards.forEach((cardEid, idx) => {
            const v = this.game.getComponent(cardEid, 'cardVisual');
            v.x = baseX;
            v.y = baseY + idx * stackOffset;
        });
    }

    endDrag(x, y) {
        if (!this.selectedCard) return;

        // Reset dragging state on all dragged cards
        this.draggedCards.forEach(cardEid => {
            const d = this.game.getComponent(cardEid, 'draggable');
            d.isDragging = 0;
        });

        // Check drop target
        const target = this.getDropTarget(x, y);
        let played = false;

        const wasFromHand = this.sourceLocation === 'hand';

        if (target) {
            if (target.type === 'foundation') {
                // Foundation only accepts single cards
                if (this.draggedCards.length === 1) {
                    const card = this.game.getComponent(this.selectedCard, 'card');
                    if (card.suit === target.suit && this.call.canPlayToFoundation(this.selectedCard)) {
                        played = this.call.playToFoundation(this.selectedCard);
                    }
                }
            } else if (target.type === 'tableau') {
                // Don't allow dropping on the same column
                if (this.sourceLocation === 'tableau' && this.sourceColumn === target.column) {
                    played = false;
                } else if (this.sourceLocation === 'hand') {
                    // Hand to tableau - single card
                    if (this.call.canPlayToTableau(this.selectedCard, target.column)) {
                        played = this.call.playToTableau(this.selectedCard, target.column);
                    }
                } else if (this.sourceLocation === 'tableau') {
                    // Tableau to tableau - use moveTableauToTableau for stacks
                    played = this.call.moveTableauToTableau(this.selectedCard, target.column);
                }
            }
        }

        // Auto-refill hand in manual mode after playing from hand
        if (played && wasFromHand) {
            this.tryAutoRefill();
        }

        // If not played, return all cards to original positions
        if (!played) {
            this.draggedCards.forEach((cardEid, idx) => {
                const v = this.game.getComponent(cardEid, 'cardVisual');
                const startPos = this.dragStartPositions[idx];
                v.targetX = startPos.x;
                v.targetY = startPos.y;
                v.zIndex = startPos.zIndex;
                v.animating = 1;
            });

            // Restore z-index via hand layout update if from hand
            if (this.sourceLocation === 'hand' && this.game.handSystem) {
                this.game.handSystem.updateHandLayout();
            }
        }

        this.selectedCard = null;
        this.draggedCards = [];
        this.dragStartPositions = [];
        this.sourceLocation = null;
        this.sourceColumn = -1;
        this.isDragging = false;
    }

    selectCard(cardEid) {
        this.selectedCard = cardEid;
    }

    deselectCard() {
        this.selectedCard = null;
    }

    update() {
        // Input handled via events
    }
}
