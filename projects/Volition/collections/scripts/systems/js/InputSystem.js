/**
 * InputSystem - Game-specific input handling for Volition
 * Manages complex card dragging with stack support for field cards
 * Disables global CardDragSystem and handles all input locally
 */
class InputSystem extends GUTS.BaseSystem {
    static services = ['selectCard', 'deselectCard'];
    static serviceDependencies = [
        'setDraggableFilter',
        'canPlayToKingdom', 'playToKingdom',
        'canPlayToField', 'playToField',
        'getHandCards', 'getFieldColumns', 'getColumnCards', 'getBottomCard',
        'isValidSequence', 'getCardsBelow', 'moveFieldToField',
        'flowCard', 'flowAfterHandPlay', 'isFlowAnimating', 'updateHandLayout',
        'getKingdomPosition', 'getFieldPosition', 'getCardWidth', 'getCardHeight', 'getStackOffset',
        'isAwaitingColumnSelection', 'isAutoWinning',
        'playCardPickup', 'playCardPlace', 'playCardInvalid'
    ];

    constructor(game) {
        super(game);
        this.selectedCard = null;
        this.draggedCards = [];
        this.dragStartPositions = [];
        this.sourceLocation = null;
        this.sourceColumn = -1;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.lastTapTime = 0;
        this.lastTapX = 0;
        this.lastTapY = 0;
        this.doubleTapThreshold = 300;
        this.doubleTapDistance = 30;
        this.dropPreview = null;
        this.lastTouchTime = 0;
        this.boundHandlers = null;
    }

    getCardDimensions() {
        return {
            width: this.call.getCardWidth?.() || 70,
            height: this.call.getCardHeight?.() || 98
        };
    }

    init() {
    }

    onSceneLoad() {
        // Disable global CardDragSystem - Volition handles its own complex drag logic
        this.call.setDraggableFilter?.(() => false);
        this.setupEventListeners();
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

    onSceneUnload() {
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

    getCardAtPosition(x, y) {
        const allCards = [];

        const handCards = this.call.getHandCards?.() || [];
        for (const eid of handCards) {
            allCards.push({ eid, source: 'hand', column: -1 });
        }

        const numCols = this.call.getFieldColumns?.() || 0;
        for (let col = 0; col < numCols; col++) {
            const colCards = this.call.getColumnCards?.(col) || [];
            for (const eid of colCards) {
                allCards.push({ eid, source: 'field', column: col });
            }
        }

        allCards.sort((a, b) => {
            const va = this.game.getComponent(a.eid, 'cardVisual');
            const vb = this.game.getComponent(b.eid, 'cardVisual');
            return (vb?.zIndex || 0) - (va?.zIndex || 0);
        });

        const dims = this.getCardDimensions();
        for (const cardInfo of allCards) {
            const visual = this.game.getComponent(cardInfo.eid, 'cardVisual');
            if (!visual) continue;
            if (x >= visual.x && x <= visual.x + dims.width &&
                y >= visual.y && y <= visual.y + dims.height) {
                return cardInfo;
            }
        }
        return null;
    }

    getDropTarget(x, y) {
        const dims = this.getCardDimensions();
        const stackOffset = this.call.getStackOffset?.() || 20;

        for (let suit = 0; suit < 4; suit++) {
            const pos = this.call.getKingdomPosition?.(suit);
            if (pos && x >= pos.x && x <= pos.x + dims.width &&
                y >= pos.y && y <= pos.y + dims.height) {
                return { type: 'kingdom', suit: suit };
            }
        }

        const numCols = this.call.getFieldColumns?.() || 0;
        for (let col = 0; col < numCols; col++) {
            const pos = this.call.getFieldPosition?.(col);
            if (!pos) continue;
            const colCards = this.call.getColumnCards?.(col) || [];
            const colHeight = dims.height + colCards.length * stackOffset;

            if (x >= pos.x && x <= pos.x + dims.width &&
                y >= pos.y && y <= pos.y + colHeight) {
                return { type: 'field', column: col };
            }
        }

        return null;
    }

    onMouseDown(e) {
        if (this.game.gameInstance?.state?.gameOver) return;
        if (this.call.isAutoWinning?.()) return;
        if (Date.now() - this.lastTouchTime < 500) return;
        if (this.call.isFlowAnimating?.()) return;
        if (this.call.isAwaitingColumnSelection?.()) return;

        const cardInfo = this.getCardAtPosition(e.clientX, e.clientY);
        if (cardInfo) {
            this.startDrag(cardInfo, e.clientX, e.clientY);
        }
    }

    onMouseMove(e) {
        if (Date.now() - this.lastTouchTime < 500) return;
        if (this.isDragging && this.selectedCard) {
            this.updateDrag(e.clientX, e.clientY);
        }
    }

    onMouseUp(e) {
        if (Date.now() - this.lastTouchTime < 500) return;
        if (this.isDragging && this.selectedCard) {
            this.endDrag(e.clientX, e.clientY);
        }
    }

    onTouchStart(e) {
        if (this.game.gameInstance?.state?.gameOver) return;
        if (this.call.isAutoWinning?.()) return;
        if (this.call.isFlowAnimating?.()) return;

        this.lastTouchTime = Date.now();
        const touch = e.touches[0];
        const now = Date.now();
        const x = touch.clientX;
        const y = touch.clientY;

        const timeDiff = now - this.lastTapTime;
        const distX = Math.abs(x - this.lastTapX);
        const distY = Math.abs(y - this.lastTapY);

        if (timeDiff < this.doubleTapThreshold &&
            distX < this.doubleTapDistance &&
            distY < this.doubleTapDistance) {
            e.preventDefault();
            this.lastTapTime = 0;
            this.handleDoubleTap(x, y);
            return;
        }

        this.touchStartX = x;
        this.touchStartY = y;
        this.touchStartTime = now;

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
        this.lastTouchTime = Date.now();
        const touch = e.changedTouches[0];
        const x = touch.clientX;
        const y = touch.clientY;

        const movedX = Math.abs(x - (this.touchStartX || 0));
        const movedY = Math.abs(y - (this.touchStartY || 0));
        const wasTap = movedX < this.doubleTapDistance && movedY < this.doubleTapDistance;

        if (wasTap) {
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
        if (this.call.isAutoWinning?.()) return;
        if (this.call.isFlowAnimating?.()) return;
        if (this.call.isAwaitingColumnSelection?.()) return;

        this.handleAutoPlay(e.clientX, e.clientY);
    }

    handleDoubleTap(x, y) {
        if (this.game.gameInstance?.state?.gameOver) return;
        if (this.call.isAutoWinning?.()) return;
        if (this.call.isFlowAnimating?.()) return;
        if (this.call.isAwaitingColumnSelection?.()) return;

        if (this.isDragging && this.selectedCard) {
            this.draggedCards.forEach(cardEid => {
                const d = this.game.getComponent(cardEid, 'draggable');
                if (d) d.isDragging = 0;
            });
            this.selectedCard = null;
            this.draggedCards = [];
            this.dragStartPositions = [];
            this.isDragging = false;
        }

        this.handleAutoPlay(x, y);
    }

    handleAutoPlay(x, y) {
        const cardInfo = this.getCardAtPosition(x, y);
        if (!cardInfo) return;

        const wasFromHand = cardInfo.source === 'hand';
        const cardEid = cardInfo.eid;

        let originalIndex = 0;
        if (wasFromHand) {
            const loc = this.game.getComponent(cardEid, 'cardLocation');
            if (loc) originalIndex = loc.index;
        }

        if (this.call.canPlayToKingdom?.(cardEid)) {
            if (!wasFromHand) {
                const bottomCard = this.call.getBottomCard?.(cardInfo.column);
                if (bottomCard !== cardEid) return;
            }
            if (wasFromHand) this.call.playCardPickup?.();
            this.call.playToKingdom?.(cardEid);
            if (wasFromHand) this.call.flowAfterHandPlay?.(cardEid, 'kingdom', originalIndex);
            return;
        }

        if (wasFromHand) {
            const numCols = this.call.getFieldColumns?.() || 0;
            for (let col = 0; col < numCols; col++) {
                if (this.call.canPlayToField?.(cardEid, col)) {
                    this.call.playCardPickup?.();
                    this.call.playToField?.(cardEid, col);
                    this.call.flowAfterHandPlay?.(cardEid, 'field', originalIndex);
                    return;
                }
            }
        }
    }

    startDrag(cardInfo, x, y) {
        const { eid, source, column } = cardInfo;

        this.clearDropHighlights();
        this.selectedCard = eid;
        this.sourceLocation = source;
        this.sourceColumn = column;
        this.isDragging = true;
        this.draggedCards = [];
        this.dragStartPositions = [];

        const visual = this.game.getComponent(eid, 'cardVisual');
        const draggable = this.game.getComponent(eid, 'draggable');
        if (!visual || !draggable) {
            this.isDragging = false;
            this.selectedCard = null;
            return;
        }

        this.dragStartX = visual.x;
        this.dragStartY = visual.y;
        draggable.offsetX = x - visual.x;
        draggable.offsetY = y - visual.y;

        if (source === 'hand') {
            this.draggedCards = [eid];
            this.dragStartPositions = [{ x: visual.x, y: visual.y, zIndex: visual.zIndex }];
            draggable.isDragging = 1;
            visual.zIndex = 1000;
            this.call.playCardPickup?.();
        } else if (source === 'field') {
            if (this.call.isValidSequence?.(eid)) {
                const cardsBelow = this.call.getCardsBelow?.(eid) || [eid];
                this.draggedCards = cardsBelow;

                cardsBelow.forEach((cardEid, idx) => {
                    const v = this.game.getComponent(cardEid, 'cardVisual');
                    const d = this.game.getComponent(cardEid, 'draggable');
                    if (v && d) {
                        this.dragStartPositions.push({ x: v.x, y: v.y, zIndex: v.zIndex });
                        d.isDragging = 1;
                        v.zIndex = 1000 + idx;
                    }
                });
                this.call.playCardPickup?.();
            } else {
                this.isDragging = false;
                this.selectedCard = null;
            }
        }
    }

    updateDrag(x, y) {
        if (!this.selectedCard || this.draggedCards.length === 0) return;

        const draggable = this.game.getComponent(this.selectedCard, 'draggable');
        if (!draggable) return;

        const baseX = x - draggable.offsetX;
        const baseY = y - draggable.offsetY;
        const stackOffset = this.call.getStackOffset?.() || 20;

        this.draggedCards.forEach((cardEid, idx) => {
            const v = this.game.getComponent(cardEid, 'cardVisual');
            if (v) {
                v.x = baseX;
                v.y = baseY + idx * stackOffset;
            }
        });

        this.updateDropHighlights(x, y);
    }

    updateDropHighlights(x, y) {
        this.clearDropHighlights();
        if (!this.selectedCard) return;

        const target = this.getDropTarget(x, y);
        if (!target) return;

        const card = this.game.getComponent(this.selectedCard, 'card');
        const isSingleCard = this.draggedCards.length === 1;
        const dims = this.getCardDimensions();
        const stackOffset = this.call.getStackOffset?.() || 20;

        if (target.type === 'kingdom') {
            if (isSingleCard && card.suit === target.suit && this.call.canPlayToKingdom?.(this.selectedCard)) {
                const pos = this.call.getKingdomPosition?.(target.suit);
                if (pos) this.showDropPreview(pos.x, pos.y, dims.width, dims.height);
            }
        } else if (target.type === 'field') {
            if (this.sourceLocation === 'field' && this.sourceColumn === target.column) return;

            if (this.call.canPlayToField?.(this.selectedCard, target.column)) {
                const pos = this.call.getFieldPosition?.(target.column);
                const columnCards = this.call.getColumnCards?.(target.column, false) || [];
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
        if (this.dropPreview) {
            this.dropPreview.style.display = 'none';
        }
    }

    endDrag(x, y) {
        if (!this.selectedCard) return;

        this.clearDropHighlights();

        this.draggedCards.forEach(cardEid => {
            const d = this.game.getComponent(cardEid, 'draggable');
            if (d) d.isDragging = 0;
        });

        const target = this.getDropTarget(x, y);
        let played = false;
        let playedTargetType = null;

        const wasFromHand = this.sourceLocation === 'hand';
        const playedCardEid = this.selectedCard;

        let originalIndex = 0;
        if (wasFromHand) {
            const loc = this.game.getComponent(playedCardEid, 'cardLocation');
            if (loc) originalIndex = loc.index;
        }

        if (target) {
            if (target.type === 'kingdom') {
                if (this.draggedCards.length === 1) {
                    const card = this.game.getComponent(this.selectedCard, 'card');
                    if (card.suit === target.suit && this.call.canPlayToKingdom?.(this.selectedCard)) {
                        played = this.call.playToKingdom?.(this.selectedCard) || false;
                        playedTargetType = 'kingdom';
                    }
                }
            } else if (target.type === 'field') {
                if (this.sourceLocation === 'field' && this.sourceColumn === target.column) {
                    played = false;
                } else if (this.sourceLocation === 'hand') {
                    if (this.call.canPlayToField?.(this.selectedCard, target.column)) {
                        played = this.call.playToField?.(this.selectedCard, target.column) || false;
                        playedTargetType = 'field';
                    }
                } else if (this.sourceLocation === 'field') {
                    played = this.call.moveFieldToField?.(this.selectedCard, target.column) || false;
                    if (played) this.call.playCardPlace?.();
                }
            }
        }

        if (played && wasFromHand && playedTargetType) {
            this.call.flowAfterHandPlay?.(playedCardEid, playedTargetType, originalIndex);
        }

        if (!played) {
            this.draggedCards.forEach((cardEid, idx) => {
                const v = this.game.getComponent(cardEid, 'cardVisual');
                const startPos = this.dragStartPositions[idx];
                if (v && startPos) {
                    v.targetX = startPos.x;
                    v.targetY = startPos.y;
                    v.zIndex = startPos.zIndex;
                    v.animating = 1;
                }
            });

            if (this.dragStartPositions.length > 0 && this.draggedCards.length > 0) {
                const startPos = this.dragStartPositions[0];
                const visual = this.game.getComponent(this.draggedCards[0], 'cardVisual');
                if (visual && startPos) {
                    const dragDistX = Math.abs(visual.x - startPos.x);
                    const dragDistY = Math.abs(visual.y - startPos.y);
                    const wasDragged = dragDistX > this.doubleTapDistance || dragDistY > this.doubleTapDistance;

                    if (target && wasDragged) {
                        this.call.playCardInvalid?.();
                    }
                }
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
