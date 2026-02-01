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
        'flowCard', 'flowAfterHandPlay', 'isFlowAnimating', 'updateHandLayout',
        'getFoundationPosition', 'getTableauPosition', 'getCardWidth', 'getCardHeight', 'getStackOffset',
        'isAwaitingColumnSelection',
        'playCardPickup', 'playCardPlace', 'playCardInvalid'
    ];

    constructor(game) {
        super(game);
        this.selectedCard = null;
        this.draggedCards = []; // Array of cards being dragged (for stack moves)
        this.dragStartPositions = []; // Original positions for each dragged card
        this.sourceLocation = null; // 'hand' or 'tableau'
        this.sourceColumn = -1; // Column index if from tableau
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;

        // Double-tap detection for mobile
        this.lastTapTime = 0;
        this.lastTapX = 0;
        this.lastTapY = 0;
        this.doubleTapThreshold = 300; // ms between taps
        this.doubleTapDistance = 30; // max pixels between taps

        // Drop preview element
        this.dropPreview = null;

        // Track last touch to ignore synthesized mouse events
        this.lastTouchTime = 0;

        // Store bound handlers for cleanup
        this.boundHandlers = null;
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

    onSceneLoad() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        const container = document.getElementById('cardContainer');
        if (!container) {
            setTimeout(() => this.setupEventListeners(), 100);
            return;
        }

        // Store bound handlers for cleanup
        this.boundHandlers = {
            mousedown: this.onMouseDown.bind(this),
            mousemove: this.onMouseMove.bind(this),
            mouseup: this.onMouseUp.bind(this),
            touchstart: this.onTouchStart.bind(this),
            touchmove: this.onTouchMove.bind(this),
            touchend: this.onTouchEnd.bind(this),
            dblclick: this.onDoubleClick.bind(this)
        };

        // Mouse events
        document.addEventListener('mousedown', this.boundHandlers.mousedown);
        document.addEventListener('mousemove', this.boundHandlers.mousemove);
        document.addEventListener('mouseup', this.boundHandlers.mouseup);

        // Touch events
        document.addEventListener('touchstart', this.boundHandlers.touchstart, { passive: false });
        document.addEventListener('touchmove', this.boundHandlers.touchmove, { passive: false });
        document.addEventListener('touchend', this.boundHandlers.touchend, { passive: false });

        // Double-click for auto-play
        document.addEventListener('dblclick', this.boundHandlers.dblclick);
    }

    onSceneUnload() {
        // Remove event listeners when scene is unloaded
        if (this.boundHandlers) {
            document.removeEventListener('mousedown', this.boundHandlers.mousedown);
            document.removeEventListener('mousemove', this.boundHandlers.mousemove);
            document.removeEventListener('mouseup', this.boundHandlers.mouseup);
            document.removeEventListener('touchstart', this.boundHandlers.touchstart);
            document.removeEventListener('touchmove', this.boundHandlers.touchmove);
            document.removeEventListener('touchend', this.boundHandlers.touchend);
            document.removeEventListener('dblclick', this.boundHandlers.dblclick);
            this.boundHandlers = null;
        }

        // Remove drop preview element
        if (this.dropPreview && this.dropPreview.parentNode) {
            this.dropPreview.parentNode.removeChild(this.dropPreview);
            this.dropPreview = null;
        }
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

        // Ignore synthesized mouse events after touch
        if (Date.now() - this.lastTouchTime < 500) return;

        // Block input during flow animation
        if (this.call.isFlowAnimating?.()) return;

        // Block dragging during column selection mode
        if (this.call.isAwaitingColumnSelection?.()) return;

        const cardInfo = this.getCardAtPosition(e.clientX, e.clientY);
        if (cardInfo) {
            this.startDrag(cardInfo, e.clientX, e.clientY);
        }
    }

    onMouseMove(e) {
        // Ignore synthesized mouse events after touch
        if (Date.now() - this.lastTouchTime < 500) return;

        if (this.isDragging && this.selectedCard) {
            this.updateDrag(e.clientX, e.clientY);
        }
    }

    onMouseUp(e) {
        // Ignore synthesized mouse events after touch
        if (Date.now() - this.lastTouchTime < 500) return;

        if (this.isDragging && this.selectedCard) {
            this.endDrag(e.clientX, e.clientY);
        }
    }

    onTouchStart(e) {
        if (this.game.gameInstance?.state?.gameOver) return;

        // Block input during flow animation
        if (this.call.isFlowAnimating?.()) return;

        // Track touch time to ignore synthesized mouse events
        this.lastTouchTime = Date.now();

        const touch = e.touches[0];
        const now = Date.now();
        const x = touch.clientX;
        const y = touch.clientY;

        // Check for double-tap
        const timeDiff = now - this.lastTapTime;
        const distX = Math.abs(x - this.lastTapX);
        const distY = Math.abs(y - this.lastTapY);

        if (timeDiff < this.doubleTapThreshold &&
            distX < this.doubleTapDistance &&
            distY < this.doubleTapDistance) {
            // Double-tap detected
            e.preventDefault();
            this.lastTapTime = 0; // Reset to prevent triple-tap
            this.handleDoubleTap(x, y);
            return;
        }

        // Record this touch as potential first tap
        this.touchStartX = x;
        this.touchStartY = y;
        this.touchStartTime = now;

        // Block dragging during column selection mode
        if (this.call.isAwaitingColumnSelection?.()) return;

        const cardInfo = this.getCardAtPosition(x, y);
        if (cardInfo) {
            e.preventDefault();
            this.startDrag(cardInfo, x, y);
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
        // Track touch time to ignore synthesized mouse events
        this.lastTouchTime = Date.now();

        const touch = e.changedTouches[0];
        const x = touch.clientX;
        const y = touch.clientY;

        // Check if this was a tap (minimal movement from start)
        const movedX = Math.abs(x - (this.touchStartX || 0));
        const movedY = Math.abs(y - (this.touchStartY || 0));
        const wasTap = movedX < this.doubleTapDistance && movedY < this.doubleTapDistance;

        if (wasTap) {
            // Record this as a tap for double-tap detection
            this.lastTapTime = Date.now();
            this.lastTapX = x;
            this.lastTapY = y;
        }

        if (this.isDragging && this.selectedCard) {
            e.preventDefault();
            this.endDrag(x, y);
        }
    }

    onDoubleClick(e) {
        if (this.game.gameInstance?.state?.gameOver) return;

        // Block input during flow animation
        if (this.call.isFlowAnimating?.()) return;

        // Block during column selection mode
        if (this.call.isAwaitingColumnSelection?.()) return;

        const cardInfo = this.getCardAtPosition(e.clientX, e.clientY);
        if (cardInfo) {
            // Try to auto-play to foundation (only single cards)
            if (this.call.canPlayToFoundation(cardInfo.eid)) {
                const wasFromHand = cardInfo.source === 'hand';
                const cardEid = cardInfo.eid;
                // Get original index before playing
                let originalIndex = 0;
                if (wasFromHand) {
                    const loc = this.game.getComponent(cardEid, 'cardLocation');
                    originalIndex = loc.index;
                }
                // Play pickup sound when card starts moving
                if (wasFromHand && this.call.playCardPickup) {
                    this.call.playCardPickup();
                }
                this.call.playToFoundation(cardEid);
                // Start flow sequence after playing from hand
                if (wasFromHand) {
                    this.call.flowAfterHandPlay(cardEid, 'foundation', originalIndex);
                }
            }
        }
    }

    handleDoubleTap(x, y) {
        if (this.game.gameInstance?.state?.gameOver) return;

        // Block input during flow animation
        if (this.call.isFlowAnimating?.()) return;

        // Block during column selection mode
        if (this.call.isAwaitingColumnSelection?.()) return;

        // Cancel any ongoing drag
        if (this.isDragging && this.selectedCard) {
            this.draggedCards.forEach(cardEid => {
                const d = this.game.getComponent(cardEid, 'draggable');
                d.isDragging = 0;
            });
            this.selectedCard = null;
            this.draggedCards = [];
            this.dragStartPositions = [];
            this.isDragging = false;
        }

        const cardInfo = this.getCardAtPosition(x, y);
        if (cardInfo) {
            // Try to auto-play to foundation (only single cards)
            if (this.call.canPlayToFoundation(cardInfo.eid)) {
                const wasFromHand = cardInfo.source === 'hand';
                const cardEid = cardInfo.eid;
                // Get original index before playing
                let originalIndex = 0;
                if (wasFromHand) {
                    const loc = this.game.getComponent(cardEid, 'cardLocation');
                    originalIndex = loc.index;
                }
                // Play pickup sound when card starts moving
                if (wasFromHand && this.call.playCardPickup) {
                    this.call.playCardPickup();
                }
                this.call.playToFoundation(cardEid);
                // Start flow sequence after playing from hand
                if (wasFromHand) {
                    this.call.flowAfterHandPlay(cardEid, 'foundation', originalIndex);
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

        // Clear any previous highlights
        this.clearDropHighlights();

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

            // Play pickup sound
            if (this.call.playCardPickup) {
                this.call.playCardPickup();
            }
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

                // Play pickup sound
                if (this.call.playCardPickup) {
                    this.call.playCardPickup();
                }
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

        // Update drop target highlights
        this.updateDropHighlights(x, y);
    }

    updateDropHighlights(x, y) {
        // Clear previous preview
        this.clearDropHighlights();

        if (!this.selectedCard) return;

        // Find what we're hovering over
        const target = this.getDropTarget(x, y);
        if (!target) return;

        const card = this.game.getComponent(this.selectedCard, 'card');
        const isSingleCard = this.draggedCards.length === 1;
        const dims = this.getCardDimensions();
        const stackOffset = this.call.getStackOffset();

        if (target.type === 'foundation') {
            if (isSingleCard && card.suit === target.suit && this.call.canPlayToFoundation(this.selectedCard)) {
                const pos = this.call.getFoundationPosition(target.suit);
                this.showDropPreview(pos.x, pos.y, dims.width, dims.height);
            }
        } else if (target.type === 'tableau') {
            // Skip source column for tableau cards
            if (this.sourceLocation === 'tableau' && this.sourceColumn === target.column) return;

            if (this.call.canPlayToTableau(this.selectedCard, target.column)) {
                const pos = this.call.getTableauPosition(target.column);
                const columnCards = this.call.getColumnCards(target.column, false); // landed cards only
                const dropY = pos.y + columnCards.length * stackOffset;
                this.showDropPreview(pos.x, dropY, dims.width, dims.height);
            }
        }
    }

    showDropPreview(x, y, width, height) {
        if (!this.dropPreview) {
            this.dropPreview = document.createElement('div');
            this.dropPreview.className = 'drop-preview';
            document.body.appendChild(this.dropPreview);
        }

        this.dropPreview.style.left = x + 'px';
        this.dropPreview.style.top = y + 'px';
        this.dropPreview.style.width = width + 'px';
        this.dropPreview.style.height = height + 'px';
        this.dropPreview.style.display = 'block';
    }

    clearDropHighlights() {
        document.querySelectorAll('.drop-hover').forEach(el => {
            el.classList.remove('drop-hover');
        });

        // Hide drop preview
        if (this.dropPreview) {
            this.dropPreview.style.display = 'none';
        }
    }

    endDrag(x, y) {
        if (!this.selectedCard) return;

        // Clear drop highlights
        this.clearDropHighlights();

        // Reset dragging state on all dragged cards
        this.draggedCards.forEach(cardEid => {
            const d = this.game.getComponent(cardEid, 'draggable');
            d.isDragging = 0;
        });

        // Check drop target
        const target = this.getDropTarget(x, y);
        let played = false;
        let playedTargetType = null;

        const wasFromHand = this.sourceLocation === 'hand';
        const playedCardEid = this.selectedCard;

        // Get original index before playing (needed for shift animation)
        let originalIndex = 0;
        if (wasFromHand) {
            const loc = this.game.getComponent(playedCardEid, 'cardLocation');
            originalIndex = loc.index;
        }

        if (target) {
            if (target.type === 'foundation') {
                // Foundation only accepts single cards
                if (this.draggedCards.length === 1) {
                    const card = this.game.getComponent(this.selectedCard, 'card');
                    if (card.suit === target.suit && this.call.canPlayToFoundation(this.selectedCard)) {
                        played = this.call.playToFoundation(this.selectedCard);
                        playedTargetType = 'foundation';
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
                        playedTargetType = 'tableau';
                    }
                } else if (this.sourceLocation === 'tableau') {
                    // Tableau to tableau - use moveTableauToTableau for stacks
                    played = this.call.moveTableauToTableau(this.selectedCard, target.column);
                    // Play place sound immediately for tableau-to-tableau moves
                    if (played && this.call.playCardPlace) {
                        this.call.playCardPlace();
                    }
                }
            }
        }

        // Start flow sequence after playing from hand (handles sound and shift/draw)
        if (played && wasFromHand && playedTargetType) {
            this.call.flowAfterHandPlay(playedCardEid, playedTargetType, originalIndex);
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

            // Play invalid sound only if we actually dragged (not just clicked)
            // Check if card moved significantly from start position
            const startPos = this.dragStartPositions[0];
            const visual = this.game.getComponent(this.draggedCards[0], 'cardVisual');
            const dragDistX = Math.abs(visual.x - startPos.x);
            const dragDistY = Math.abs(visual.y - startPos.y);
            const wasDragged = dragDistX > this.doubleTapDistance || dragDistY > this.doubleTapDistance;

            if (target && wasDragged && this.call.playCardInvalid) {
                this.call.playCardInvalid();
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
