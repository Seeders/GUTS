/**
 * LayoutSystem - Single source of truth for all UI element positions
 * Reads positions from DOM and provides them to other systems
 */
class LayoutSystem extends GUTS.BaseSystem {
    static services = [
        'getKingdomPosition', 'getFieldPosition', 'getHandPosition', 'getDeckPosition',
        'getCardWidth', 'getCardHeight', 'getStackOffset',
        'refreshLayout'
    ];
    static serviceDependencies = ['updateHandLayout', 'refreshFieldPositions', 'refreshKingdomPositions'];

    constructor(game) {
        super(game);

        // Positions
        this.kingdomPositions = [];
        this.fieldPositions = [];
        this.handPositions = [];
        this.deckPosition = { x: 0, y: 0 };

        // Card dimensions
        this.cardWidth = 48;
        this.cardHeight = 67;
        this.stackOffset = 16;
    }

    init() {
        console.log('LayoutSystem initializing...');
    }

    postAllInit() {
        // Initial layout calculation
        this.refreshLayout();

        // Update on resize
        window.addEventListener('resize', () => {
            this.refreshLayout();
            this.notifyLayoutChange();
        });
    }

    refreshLayout() {
        // Read card dimensions from CSS
        const style = getComputedStyle(document.documentElement);
        this.cardWidth = parseInt(style.getPropertyValue('--card-width')) || 48;
        this.cardHeight = parseInt(style.getPropertyValue('--card-height')) || 67;
        this.stackOffset = parseInt(style.getPropertyValue('--stack-offset')) || 16;

        // Read kingdom positions
        this.kingdomPositions = [];
        for (let i = 0; i < 4; i++) {
            const el = document.getElementById(`kingdom-${i}`);
            if (el) {
                const rect = el.getBoundingClientRect();
                this.kingdomPositions[i] = { x: rect.left, y: rect.top };
            }
        }

        // Read field positions
        this.fieldPositions = [];
        let i = 0;
        while (true) {
            const el = document.getElementById(`field-${i}`);
            if (!el) break;
            const rect = el.getBoundingClientRect();
            this.fieldPositions[i] = { x: rect.left, y: rect.top };
            i++;
        }

        // Read hand positions
        this.handPositions = [];
        for (let i = 0; i < 5; i++) {
            const el = document.getElementById(`hand-slot-${i}`);
            if (el) {
                const rect = el.getBoundingClientRect();
                this.handPositions[i] = { x: rect.left, y: rect.top };
            }
        }

        // Read deck position
        const deckEl = document.getElementById('deckVisual');
        if (deckEl) {
            const rect = deckEl.getBoundingClientRect();
            this.deckPosition = { x: rect.left, y: rect.top };
        }
    }

    notifyLayoutChange() {
        // Notify other systems to update card positions via services
        this.call.updateHandLayout();
        this.call.refreshFieldPositions();
        this.call.refreshKingdomPositions();
    }

    getKingdomPosition(suit) {
        return this.kingdomPositions[suit] || { x: 0, y: 0 };
    }

    getFieldPosition(column) {
        return this.fieldPositions[column] || { x: 0, y: 0 };
    }

    getHandPosition(slot) {
        return this.handPositions[slot] || { x: 0, y: 0 };
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
        return this.stackOffset;
    }

    update() {
        // Layout is event-driven, no per-frame updates needed
    }
}
