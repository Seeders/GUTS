/**
 * LayoutSystem - Single source of truth for all UI element positions
 * Reads positions from DOM and provides them to other systems
 */
class LayoutSystem extends GUTS.BaseSystem {
    static services = [
        'getThreatLinePosition', 'getRefugePosition', 'getDeckPosition',
        'getCardWidth', 'getCardHeight', 'getStackOffset',
        'getLayoutDimensions', 'refreshLayout'
    ];
    static serviceDependencies = [];

    constructor(game) {
        super(game);

        // Positions
        this.threatLinePosition = { x: 0, y: 0 };
        this.refugePositions = [];
        this.deckPosition = { x: 0, y: 0 };

        // Card dimensions
        this.cardWidth = 48;
        this.cardHeight = 67;
        this.cardGap = 10;
    }

    init() {
    }

    postAllInit() {
        // Initial layout calculation
        this.refreshLayout();

        // Update on resize
        window.addEventListener('resize', () => {
            this.refreshLayout();
        });
    }

    refreshLayout() {
        // Read card dimensions from CSS
        const style = getComputedStyle(document.documentElement);
        this.cardWidth = parseInt(style.getPropertyValue('--card-width')) || 48;
        this.cardHeight = parseInt(style.getPropertyValue('--card-height')) || 67;
        this.cardGap = parseInt(style.getPropertyValue('--card-gap')) || 10;

        // Read threat line position
        const threatLineEl = document.getElementById('threatLine');
        if (threatLineEl) {
            const rect = threatLineEl.getBoundingClientRect();
            this.threatLinePosition = { x: rect.left + 10, y: rect.top + 10 };
        }

        // Read refuge positions
        this.refugePositions = [];
        for (let i = 0; i < 6; i++) {
            const el = document.getElementById(`refuge-${i}`);
            if (el) {
                const rect = el.getBoundingClientRect();
                this.refugePositions[i] = { x: rect.left, y: rect.top };
            }
        }

        // Read deck position
        const deckEl = document.getElementById('deckVisual');
        if (deckEl) {
            const rect = deckEl.getBoundingClientRect();
            this.deckPosition = { x: rect.left, y: rect.top };
        }
    }

    /**
     * Get position for a card in the threat line
     * @param {number} index - Index in threat line
     */
    getThreatLinePosition(index) {
        return {
            x: this.threatLinePosition.x + (index * (this.cardWidth + this.cardGap)),
            y: this.threatLinePosition.y
        };
    }

    /**
     * Get position for a card in the refuge
     * @param {number} slot - Refuge slot (0-5)
     */
    getRefugePosition(slot) {
        return this.refugePositions[slot] || { x: 0, y: 0 };
    }

    getDeckPosition() {
        return this.deckPosition;
    }

    getCardWidth() {
        return this.cardWidth;
    }

    getCardHeight() {
        return this.cardHeight;
    }

    getStackOffset() {
        return 0; // No stacking in Abandoned
    }

    /**
     * Get all layout dimensions for other systems
     */
    getLayoutDimensions() {
        return {
            threatLineX: this.threatLinePosition.x,
            threatLineY: this.threatLinePosition.y,
            cardWidth: this.cardWidth,
            cardHeight: this.cardHeight,
            cardGap: this.cardGap,
            refugeX: this.refugePositions[0]?.x || 50,
            refugeY: this.refugePositions[0]?.y || 250
        };
    }

    update() {
        // Layout is event-driven, no per-frame updates needed
    }
}
