/**
 * HeadlessLayoutSystem - Provides mock layout positions for headless mode
 * Replaces the DOM-dependent LayoutSystem with fixed positions
 */
class HeadlessLayoutSystem extends GUTS.BaseSystem {
    static services = [
        'getKingdomPosition', 'getFieldPosition', 'getHandPosition', 'getDeckPosition',
        'getCardWidth', 'getCardHeight', 'getStackOffset',
        'refreshLayout', 'updateHandLayout', 'refreshFieldPositions', 'refreshKingdomPositions'
    ];

    constructor(game) {
        super(game);

        // Fixed card dimensions (matching CSS defaults)
        this.cardWidth = 48;
        this.cardHeight = 67;
        this.stackOffset = 16;

        // Pre-computed positions (not used visually, just for data consistency)
        this.kingdomPositions = [];
        this.fieldPositions = [];
        this.handPositions = [];
        this.deckPosition = { x: 0, y: 400 };
    }

    init() {
        // Read config for field columns
        const config = this.game.gameInstance?.getConfig() || {};
        const numColumns = config.fieldColumns || 6;
        const handCapacity = config.handCapacity || 5;

        // Generate mock positions
        for (let i = 0; i < 4; i++) {
            this.kingdomPositions[i] = { x: i * 60, y: 0 };
        }

        for (let i = 0; i < numColumns; i++) {
            this.fieldPositions[i] = { x: i * 60, y: 100 };
        }

        for (let i = 0; i < handCapacity; i++) {
            this.handPositions[i] = { x: i * 60, y: 300 };
        }
    }

    postAllInit() {
        // No DOM to refresh
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

    // No-op methods - no DOM to update in headless mode
    refreshLayout() {}
    updateHandLayout() {}
    refreshFieldPositions() {}
    refreshKingdomPositions() {}

    update() {
        // No per-frame updates needed in headless mode
    }
}
