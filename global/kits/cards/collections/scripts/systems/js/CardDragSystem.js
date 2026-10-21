/**
 * CardDragSystem - Global system for card drag and drop interactions
 *
 * Provides basic card dragging functionality:
 * - Mouse and touch support
 * - Double-tap/double-click detection
 * - Drag start/move/end events
 * - Drop target detection (games implement their own drop logic)
 *
 * Games should:
 * - Override getDropTarget() for game-specific drop zones
 * - Listen to card drag events to implement game rules
 * - Call canDragCard() to control which cards are draggable
 */
class CardDragSystem extends GUTS.BaseSystem {
    static services = [
        'startDrag', 'endDrag', 'cancelDrag',
        'isDragging', 'getDraggedCard', 'getDraggedCards',
        'setDraggableFilter', 'getCardAtPosition'
    ];
    static serviceDependencies = [
        'getCardWidth', 'getCardHeight', 'getCardElement',
        'isGameOver'
    ];

    constructor(game) {
        super(game);

        this.selectedCard = null;
        this.draggedCards = [];
        this.dragStartPositions = [];
        this.isDraggingState = false;

        // Touch/click detection
        this.lastTapTime = 0;
        this.lastTapX = 0;
        this.lastTapY = 0;
        this.doubleTapThreshold = 300;
        this.doubleTapDistance = 30;
        this.lastTouchTime = 0;
        this.touchStartX = 0;
        this.touchStartY = 0;

        // Drop preview
        this.dropPreview = null;

        // Bound handlers for cleanup
        this.boundHandlers = null;

        // Filter function for draggable cards (games can override)
        this.draggableFilter = null;
    }

    init() {
        const config = this.game.getConfig?.() || {};
        this._isHeadless = config.isHeadless || false;
    }

    onSceneLoad() {
        if (this._isHeadless) return;
        this.setupEventListeners();
    }

    onSceneUnload() {
        this.removeEventListeners();
    }

    setupEventListeners() {
        const container = document.getElementById('cardContainer');
        if (!container) {
            setTimeout(() => this.setupEventListeners(), 100);
            return;
        }

        this.boundHandlers = {
            mousedown: this.onMouseDown.bind(this),
            mousemove: this.onMouseMove.bind(this),
            mouseup: this.onMouseUp.bind(this),
            touchstart: this.onTouchStart.bind(this),
            touchmove: this.onTouchMove.bind(this),
            touchend: this.onTouchEnd.bind(this),
            dblclick: this.onDoubleClick.bind(this)
        };

        document.addEventListener('mousedown', this.boundHandlers.mousedown);
        document.addEventListener('mousemove', this.boundHandlers.mousemove);
        document.addEventListener('mouseup', this.boundHandlers.mouseup);
        document.addEventListener('touchstart', this.boundHandlers.touchstart, { passive: false });
        document.addEventListener('touchmove', this.boundHandlers.touchmove, { passive: false });
        document.addEventListener('touchend', this.boundHandlers.touchend, { passive: false });
        document.addEventListener('dblclick', this.boundHandlers.dblclick);
    }

    removeEventListeners() {
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

        if (this.dropPreview && this.dropPreview.parentNode) {
            this.dropPreview.parentNode.removeChild(this.dropPreview);
            this.dropPreview = null;
        }
    }

    /**
     * Set filter function to determine which cards are draggable
     * @param {Function} filterFn - Function(cardEid) => boolean
     */
    setDraggableFilter(filterFn) {
        this.draggableFilter = filterFn;
    }

    /**
     * Check if a card can be dragged
     * @param {number} cardEid - Entity ID
     * @returns {boolean}
     */
    canDragCard(cardEid) {
        if (this.draggableFilter) {
            return this.draggableFilter(cardEid);
        }
        // Default: any card with draggable component
        return this.game.getComponent(cardEid, 'draggable') !== null;
    }

    /**
     * Find card entity at screen position
     * @param {number} x - Screen X
     * @param {number} y - Screen Y
     * @returns {{eid: number}|null}
     */
    getCardAtPosition(x, y) {
        const allCards = [];
        const entities = this.game.getEntitiesWith('card', 'cardVisual', 'draggable');

        for (const eid of entities) {
            const loc = this.game.getComponent(eid, 'cardLocation');
            // Skip cards in deck
            if (loc && loc.location === 0) continue;

            // Skip non-draggable cards
            if (!this.canDragCard(eid)) continue;

            allCards.push(eid);
        }

        // Sort by z-index (highest first)
        allCards.sort((a, b) => {
            const va = this.game.getComponent(a, 'cardVisual');
            const vb = this.game.getComponent(b, 'cardVisual');
            return (vb?.zIndex || 0) - (va?.zIndex || 0);
        });

        const width = this.call.getCardWidth?.() || 70;
        const height = this.call.getCardHeight?.() || 98;

        for (const eid of allCards) {
            const visual = this.game.getComponent(eid, 'cardVisual');
            if (!visual) continue;

            if (x >= visual.x && x <= visual.x + width &&
                y >= visual.y && y <= visual.y + height) {
                return { eid };
            }
        }

        return null;
    }

    /**
     * Check if currently dragging
     * @returns {boolean}
     */
    isDragging() {
        return this.isDraggingState;
    }

    /**
     * Get the primary dragged card
     * @returns {number|null}
     */
    getDraggedCard() {
        return this.selectedCard;
    }

    /**
     * Get all dragged cards (for stack dragging)
     * @returns {number[]}
     */
    getDraggedCards() {
        return this.draggedCards;
    }

    // Mouse handlers
    onMouseDown(e) {
        if (this.call.isGameOver?.()) return;
        if (Date.now() - this.lastTouchTime < 500) return; // Ignore synthesized events

        const cardInfo = this.getCardAtPosition(e.clientX, e.clientY);
        if (cardInfo) {
            this.startDrag(cardInfo.eid, e.clientX, e.clientY);
        }
    }

    onMouseMove(e) {
        if (Date.now() - this.lastTouchTime < 500) return;
        if (this.isDraggingState && this.selectedCard) {
            this.updateDrag(e.clientX, e.clientY);
        }
    }

    onMouseUp(e) {
        if (Date.now() - this.lastTouchTime < 500) return;
        if (this.isDraggingState && this.selectedCard) {
            this.endDrag(e.clientX, e.clientY);
        }
    }

    // Touch handlers
    onTouchStart(e) {
        if (this.call.isGameOver?.()) return;
        this.lastTouchTime = Date.now();

        const touch = e.touches[0];
        const x = touch.clientX;
        const y = touch.clientY;

        // Double-tap detection
        const timeDiff = Date.now() - this.lastTapTime;
        const distX = Math.abs(x - this.lastTapX);
        const distY = Math.abs(y - this.lastTapY);

        if (timeDiff < this.doubleTapThreshold &&
            distX < this.doubleTapDistance &&
            distY < this.doubleTapDistance) {
            e.preventDefault();
            this.lastTapTime = 0;
            this.onDoubleTap(x, y);
            return;
        }

        this.touchStartX = x;
        this.touchStartY = y;

        const cardInfo = this.getCardAtPosition(x, y);
        if (cardInfo) {
            e.preventDefault();
            this.startDrag(cardInfo.eid, x, y);
        }
    }

    onTouchMove(e) {
        if (this.isDraggingState && this.selectedCard) {
            e.preventDefault();
            const touch = e.touches[0];
            this.updateDrag(touch.clientX, touch.clientY);
        }
    }

    onTouchEnd(e) {
        this.lastTouchTime = Date.now();

        const touch = e.changedTouches[0];
        const x = touch.clientX;
        const y = touch.clientY;

        const movedX = Math.abs(x - this.touchStartX);
        const movedY = Math.abs(y - this.touchStartY);
        const wasTap = movedX < this.doubleTapDistance && movedY < this.doubleTapDistance;

        if (wasTap) {
            this.lastTapTime = Date.now();
            this.lastTapX = x;
            this.lastTapY = y;
        }

        if (this.isDraggingState && this.selectedCard) {
            e.preventDefault();
            this.endDrag(x, y);
        }
    }

    onDoubleClick(e) {
        if (this.call.isGameOver?.()) return;

        const cardInfo = this.getCardAtPosition(e.clientX, e.clientY);
        if (cardInfo) {
            this.game.triggerEvent('onCardDoubleClick', {
                cardEid: cardInfo.eid,
                x: e.clientX,
                y: e.clientY
            });
        }
    }

    onDoubleTap(x, y) {
        if (this.call.isGameOver?.()) return;

        // Cancel any ongoing drag
        if (this.isDraggingState) {
            this.cancelDrag();
        }

        const cardInfo = this.getCardAtPosition(x, y);
        if (cardInfo) {
            this.game.triggerEvent('onCardDoubleClick', {
                cardEid: cardInfo.eid,
                x, y
            });
        }
    }

    /**
     * Start dragging a card
     * @param {number} cardEid - Entity ID
     * @param {number} x - Screen X
     * @param {number} y - Screen Y
     */
    startDrag(cardEid, x, y) {
        if (!this.canDragCard(cardEid)) return;

        this.selectedCard = cardEid;
        this.isDraggingState = true;
        this.draggedCards = [cardEid];
        this.dragStartPositions = [];

        const visual = this.game.getComponent(cardEid, 'cardVisual');
        const draggable = this.game.getComponent(cardEid, 'draggable');

        if (!visual || !draggable) {
            this.cancelDrag();
            return;
        }

        draggable.offsetX = x - visual.x;
        draggable.offsetY = y - visual.y;
        draggable.isDragging = 1;

        this.dragStartPositions = [{
            x: visual.x,
            y: visual.y,
            zIndex: visual.zIndex
        }];

        visual.zIndex = 1000;

        this.game.triggerEvent('onCardDragStart', {
            cardEid,
            x, y,
            startX: visual.x,
            startY: visual.y
        });
    }

    /**
     * Update drag position
     * @param {number} x - Screen X
     * @param {number} y - Screen Y
     */
    updateDrag(x, y) {
        if (!this.selectedCard) return;

        const draggable = this.game.getComponent(this.selectedCard, 'draggable');
        if (!draggable) return;

        const baseX = x - draggable.offsetX;
        const baseY = y - draggable.offsetY;

        this.draggedCards.forEach((cardEid, idx) => {
            const visual = this.game.getComponent(cardEid, 'cardVisual');
            if (visual) {
                visual.x = baseX;
                visual.y = baseY;
            }
        });

        this.game.triggerEvent('onCardDragMove', {
            cardEid: this.selectedCard,
            x, y,
            cardX: baseX,
            cardY: baseY
        });
    }

    /**
     * End drag and check for drop
     * @param {number} x - Screen X
     * @param {number} y - Screen Y
     */
    endDrag(x, y) {
        if (!this.selectedCard) return;

        // Reset dragging state
        this.draggedCards.forEach(cardEid => {
            const d = this.game.getComponent(cardEid, 'draggable');
            if (d) d.isDragging = 0;
        });

        // Trigger drop event - games handle the actual drop logic
        this.game.triggerEvent('onCardDrop', {
            cardEid: this.selectedCard,
            cards: [...this.draggedCards],
            x, y,
            startPositions: [...this.dragStartPositions]
        });

        this.selectedCard = null;
        this.draggedCards = [];
        this.dragStartPositions = [];
        this.isDraggingState = false;
    }

    /**
     * Cancel current drag and return cards to original positions
     */
    cancelDrag() {
        if (!this.selectedCard) return;

        this.draggedCards.forEach((cardEid, idx) => {
            const visual = this.game.getComponent(cardEid, 'cardVisual');
            const draggable = this.game.getComponent(cardEid, 'draggable');
            const startPos = this.dragStartPositions[idx];

            if (draggable) {
                draggable.isDragging = 0;
            }

            if (visual && startPos) {
                visual.targetX = startPos.x;
                visual.targetY = startPos.y;
                visual.zIndex = startPos.zIndex;
                visual.animating = 1;
            }
        });

        this.game.triggerEvent('onCardDragCancel', {
            cardEid: this.selectedCard,
            cards: [...this.draggedCards]
        });

        this.selectedCard = null;
        this.draggedCards = [];
        this.dragStartPositions = [];
        this.isDraggingState = false;
    }

    update() {
        // Drag state is maintained by event handlers
    }
}
