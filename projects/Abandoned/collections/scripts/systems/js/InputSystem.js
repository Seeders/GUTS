/**
 * InputSystem - Game-specific input handling for Abandoned
 * Listens to CardDragSystem events for drag handling
 * Implements game-specific drop logic (cards on threats)
 */
class InputSystem extends GUTS.BaseSystem {
    static services = ['selectCard', 'deselectCard'];
    static serviceDependencies = [
        'setDraggableFilter', 'getCardAtPosition', 'isDragging', 'getDraggedCard',
        'getRefugeCards', 'getActiveThreats', 'getThreatLineCards',
        'useActionCard', 'useSupplyCards', 'useHealCard',
        'getRefugePosition', 'getThreatLinePosition', 'getCardWidth', 'getCardHeight',
        'playCardPickup', 'playCardPlace', 'playCardInvalid'
    ];

    constructor(game) {
        super(game);
        this.selectedCard = null;
        this.selectedDiamonds = new Set(); // Track selected diamonds for combining
        this.dropPreview = null;
        this.doubleTapDistance = 30;
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
        // Set up draggable filter - only refuge cards can be dragged
        this.call.setDraggableFilter?.((cardEid) => {
            const refugeCards = this.call.getRefugeCards?.() || [];
            return refugeCards.includes(cardEid);
        });
    }

    onSceneUnload() {
        if (this.dropPreview && this.dropPreview.parentNode) {
            this.dropPreview.parentNode.removeChild(this.dropPreview);
            this.dropPreview = null;
        }
    }

    /**
     * Find a threat card at the given screen position (drop target)
     */
    getThreatAtPosition(x, y) {
        const threats = this.call.getActiveThreats?.() || [];
        const dims = this.getCardDimensions();

        for (const eid of threats) {
            const visual = this.game.getComponent(eid, 'cardVisual');
            if (!visual) continue;
            if (x >= visual.x && x <= visual.x + dims.width &&
                y >= visual.y && y <= visual.y + dims.height) {
                return eid;
            }
        }
        return null;
    }

    /**
     * Get drop target info at position
     */
    getDropTarget(x, y) {
        const threatEid = this.getThreatAtPosition(x, y);
        if (threatEid) {
            return { type: 'threat', eid: threatEid };
        }
        return null;
    }

    /**
     * Handle card drag start event from CardDragSystem
     */
    onCardDragStart(data) {
        this.selectedCard = data.cardEid;
        this.call.playCardPickup?.();
    }

    /**
     * Handle card drag move event from CardDragSystem
     */
    onCardDragMove(data) {
        this.updateDropHighlights(data.x, data.y);
    }

    /**
     * Handle card drop event from CardDragSystem
     */
    onCardDrop(data) {
        this.clearDropHighlights();

        const playedCardEid = data.cardEid;
        const card = this.game.getComponent(playedCardEid, 'card');
        if (!card) return;

        // Check if this was a short drag (click/tap) for diamond selection
        const startPositions = data.startPositions || [];
        if (startPositions.length > 0) {
            const startPos = startPositions[0];
            const visual = this.game.getComponent(playedCardEid, 'cardVisual');
            if (visual && startPos) {
                const dragDistX = Math.abs(data.x - (startPos.x + (this.getCardDimensions().width / 2)));
                const dragDistY = Math.abs(data.y - (startPos.y + (this.getCardDimensions().height / 2)));
                const wasClick = dragDistX < this.doubleTapDistance && dragDistY < this.doubleTapDistance;

                // If it was a click on a diamond, toggle selection
                if (wasClick && card.suit === 1) {
                    if (this.selectedDiamonds.has(playedCardEid)) {
                        this.selectedDiamonds.delete(playedCardEid);
                    } else {
                        this.selectedDiamonds.add(playedCardEid);
                    }
                    this.updateDiamondSelectionVisuals();

                    // Return card to original position
                    visual.targetX = startPos.x;
                    visual.targetY = startPos.y;
                    visual.zIndex = startPos.zIndex;
                    visual.animating = 1;
                    this.selectedCard = null;
                    return;
                }
            }
        }

        const target = this.getDropTarget(data.x, data.y);
        let played = false;

        if (target && target.type === 'threat') {
            const threatEid = target.eid;
            const threatCard = this.game.getComponent(threatEid, 'card');

            if (card.suit === 2) { // Clubs - action card
                if (card.rank >= threatCard.rank) {
                    played = this.call.useActionCard?.(playedCardEid, threatEid) || false;
                }
            } else if (card.suit === 1) { // Diamonds - supply card
                // Get current refuge cards for validation
                const refugeCards = this.call.getRefugeCards?.() || [];

                // Collect the dragged diamond + any selected diamonds that are still in refuge
                const diamondsToUse = new Set([playedCardEid]);
                for (const eid of this.selectedDiamonds) {
                    if (refugeCards.includes(eid)) {
                        diamondsToUse.add(eid);
                    }
                }

                // Calculate total rank
                let totalRank = 0;
                for (const eid of diamondsToUse) {
                    const diamondCard = this.game.getComponent(eid, 'card');
                    if (diamondCard && diamondCard.suit === 1) {
                        totalRank += diamondCard.rank;
                    }
                }

                // Can defeat if total >= threat rank
                if (totalRank >= threatCard.rank) {
                    played = this.call.useSupplyCards?.([...diamondsToUse], threatEid) || false;
                    if (played) {
                        this.clearDiamondSelection();
                    }
                }
            }

            if (played) {
                this.call.playCardPlace?.();
            }
        }

        // If not played, return cards to original positions
        if (!played) {
            const startPositions = data.startPositions || [];
            data.cards.forEach((cardEid, idx) => {
                const v = this.game.getComponent(cardEid, 'cardVisual');
                const startPos = startPositions[idx];
                if (v && startPos) {
                    v.targetX = startPos.x;
                    v.targetY = startPos.y;
                    v.zIndex = startPos.zIndex;
                    v.animating = 1;
                }
            });

            // Play invalid sound if we dragged to a target
            if (target && startPositions.length > 0) {
                const startPos = startPositions[0];
                const visual = this.game.getComponent(data.cards[0], 'cardVisual');
                if (visual && startPos) {
                    const dragDistX = Math.abs(visual.x - startPos.x);
                    const dragDistY = Math.abs(visual.y - startPos.y);
                    const wasDragged = dragDistX > this.doubleTapDistance || dragDistY > this.doubleTapDistance;

                    if (wasDragged) {
                        this.call.playCardInvalid?.();
                    }
                }
            }
        }

        this.selectedCard = null;
    }

    /**
     * Handle click event from CardDragSystem - used for diamond selection
     */
    onCardClick(data) {
        if (this.game.gameInstance?.state?.gameOver) return;

        const card = this.game.getComponent(data.cardEid, 'card');
        if (!card) return;

        // Only allow click selection on refuge cards
        const refugeCards = this.call.getRefugeCards?.() || [];
        if (!refugeCards.includes(data.cardEid)) return;

        // Toggle diamond selection for combining
        if (card.suit === 1) { // Diamond
            if (this.selectedDiamonds.has(data.cardEid)) {
                this.selectedDiamonds.delete(data.cardEid);
            } else {
                this.selectedDiamonds.add(data.cardEid);
            }
            this.updateDiamondSelectionVisuals();
        }
    }

    /**
     * Handle double-click event from CardDragSystem
     */
    onCardDoubleClick(data) {
        if (this.game.gameInstance?.state?.gameOver) return;

        const card = this.game.getComponent(data.cardEid, 'card');
        if (!card) return;

        // Only allow double-click on refuge cards
        const refugeCards = this.call.getRefugeCards?.() || [];
        if (!refugeCards.includes(data.cardEid)) return;

        // Auto-heal with heart cards
        if (card.suit === 0) {
            if (this.call.useHealCard?.(data.cardEid)) {
                this.call.playCardPlace?.();
            }
        }
    }

    /**
     * Update visual highlighting for selected diamonds
     */
    updateDiamondSelectionVisuals() {
        // Remove all diamond-selected classes first
        document.querySelectorAll('.card.diamond-selected').forEach(el => {
            el.classList.remove('diamond-selected');
        });

        // Add class to selected diamonds
        for (const eid of this.selectedDiamonds) {
            const el = document.querySelector(`[data-eid="${eid}"]`);
            if (el) {
                el.classList.add('diamond-selected');
            }
        }
    }

    /**
     * Clear diamond selection
     */
    clearDiamondSelection() {
        this.selectedDiamonds.clear();
        this.updateDiamondSelectionVisuals();
    }

    /**
     * Get total rank of selected diamonds
     */
    getSelectedDiamondTotal() {
        let total = 0;
        for (const eid of this.selectedDiamonds) {
            const card = this.game.getComponent(eid, 'card');
            if (card && card.suit === 1) {
                total += card.rank;
            }
        }
        return total;
    }

    updateDropHighlights(x, y) {
        this.clearDropHighlights();

        if (!this.selectedCard) return;

        const target = this.getDropTarget(x, y);
        if (!target) return;

        const card = this.game.getComponent(this.selectedCard, 'card');
        const dims = this.getCardDimensions();

        if (target.type === 'threat') {
            const threatCard = this.game.getComponent(target.eid, 'card');
            const threatVisual = this.game.getComponent(target.eid, 'cardVisual');

            let canDefeat = false;
            if (card.suit === 2) { // Clubs
                canDefeat = card.rank >= threatCard.rank;
            } else if (card.suit === 1) { // Diamonds
                // Calculate total with dragged diamond + selected diamonds (validated)
                const refugeCards = this.call.getRefugeCards?.() || [];
                let totalRank = card.rank;
                for (const eid of this.selectedDiamonds) {
                    if (eid !== this.selectedCard && refugeCards.includes(eid)) {
                        const diamondCard = this.game.getComponent(eid, 'card');
                        if (diamondCard && diamondCard.suit === 1) {
                            totalRank += diamondCard.rank;
                        }
                    }
                }
                canDefeat = totalRank >= threatCard.rank;
            }

            if (canDefeat && threatVisual) {
                this.showDropPreview(threatVisual.x, threatVisual.y, dims.width, dims.height);
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

    selectCard(cardEid) {
        this.selectedCard = cardEid;
    }

    deselectCard() {
        this.selectedCard = null;
    }

    update() {
        // Input handled via CardDragSystem events
    }
}
