/**
 * ThreatLineSystem - Manages the visible threat line where drawn cards appear
 * Tracks active threats and handles threat removal
 */
class ThreatLineSystem extends GUTS.BaseSystem {
    static services = [
        'getThreatLineCards', 'getActiveThreats', 'getThreatCount',
        'addToThreatLine', 'removeThreat', 'resolveThreat', 'getThreatLinePosition'
    ];
    static serviceDependencies = ['getLayoutDimensions'];

    constructor(game) {
        super(game);
        this.threatLineCards = []; // Array of entity IDs in threat line
    }

    init() {
        this.threatLineCards = [];
    }

    /**
     * Get all cards currently in the threat line
     */
    getThreatLineCards() {
        return this.threatLineCards.filter(eid => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            return loc && loc.location === 1; // threatLine
        });
    }

    /**
     * Get only active (unresolved) threat cards (spades)
     */
    getActiveThreats() {
        return this.getThreatLineCards().filter(eid => {
            const card = this.game.getComponent(eid, 'card');
            const threat = this.game.getComponent(eid, 'threat');
            // Spades (suit 3) that are not resolved
            return card.suit === 3 && threat && !threat.resolved;
        });
    }

    /**
     * Get count of active threats
     */
    getThreatCount() {
        return this.getActiveThreats().length;
    }

    /**
     * Add a card to the threat line
     * @param {number} cardEid - Entity ID of the card
     */
    addToThreatLine(cardEid) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const card = this.game.getComponent(cardEid, 'card');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        // Set location to threat line
        loc.location = 1; // threatLine
        loc.index = this.threatLineCards.length;
        loc.columnIndex = -1;

        // If it's a spade, add threat component
        if (card.suit === 3) {
            // Check if threat component already exists
            let threat = this.game.getComponent(cardEid, 'threat');
            if (!threat) {
                this.game.addComponent(cardEid, 'threat', {
                    isThreat: 1,
                    turnsActive: 0,
                    resolved: 0
                });
            } else {
                threat.isThreat = 1;
                threat.turnsActive = 0;
                threat.resolved = 0;
            }
        }

        this.threatLineCards.push(cardEid);

        // Set visual position
        const pos = this.getThreatLinePosition(loc.index);
        visual.targetX = pos.x;
        visual.targetY = pos.y;
        visual.zIndex = 100 + loc.index;
        visual.animating = 1;

        this.game.triggerEvent('onCardAddedToThreatLine', { cardEid, suit: card.suit, rank: card.rank });
    }

    /**
     * Remove a threat from the threat line (when defeated by player action)
     * @param {number} cardEid - Entity ID of the threat card
     */
    removeThreat(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');
        const threat = this.game.getComponent(cardEid, 'threat');
        const loc = this.game.getComponent(cardEid, 'cardLocation');
        const visual = this.game.getComponent(cardEid, 'cardVisual');

        if (threat) {
            threat.resolved = 1;
        }

        // Move to discard
        loc.location = 3; // discard
        loc.index = 0;

        // Move off-screen
        if (visual) {
            visual.targetX = -100;
            visual.targetY = -100;
            visual.animating = 1;
        }

        // Remove from threat line array
        const idx = this.threatLineCards.indexOf(cardEid);
        if (idx > -1) {
            this.threatLineCards.splice(idx, 1);
        }

        // Update indices of remaining cards
        this.updateThreatLineIndices();

        this.game.triggerEvent('onThreatResolved', { cardEid, rank: card.rank });
    }

    /**
     * Resolve a non-threat card (move it out of threat line)
     * Used for hearts/diamonds/clubs that are resolved immediately or moved to refuge
     * @param {number} cardEid - Entity ID of the card
     * @param {number} targetLocation - Where to move the card (2=refuge, 3=discard)
     */
    resolveThreat(cardEid, targetLocation = 3) {
        const loc = this.game.getComponent(cardEid, 'cardLocation');

        // Move to target location
        loc.location = targetLocation;
        loc.index = 0;

        // Remove from threat line array
        const idx = this.threatLineCards.indexOf(cardEid);
        if (idx > -1) {
            this.threatLineCards.splice(idx, 1);
        }

        // Update indices of remaining cards
        this.updateThreatLineIndices();
    }

    /**
     * Update indices and positions of all cards in threat line after removal
     */
    updateThreatLineIndices() {
        this.threatLineCards.forEach((eid, idx) => {
            const loc = this.game.getComponent(eid, 'cardLocation');
            const visual = this.game.getComponent(eid, 'cardVisual');
            if (loc) {
                loc.index = idx;
            }
            // Update visual positions
            if (visual) {
                const pos = this.getThreatLinePosition(idx);
                visual.targetX = pos.x;
                visual.targetY = pos.y;
                visual.zIndex = 100 + idx;
                visual.animating = 1;
            }
        });
    }

    /**
     * Get position for a card in the threat line
     * @param {number} index - Index in threat line
     * @returns {{x: number, y: number}}
     */
    getThreatLinePosition(index) {
        // Get layout dimensions from LayoutSystem
        const dims = this.call.getLayoutDimensions?.() || {
            threatLineX: 100,
            threatLineY: 80,
            cardWidth: 70,
            cardGap: 10
        };

        return {
            x: dims.threatLineX + (index * (dims.cardWidth + dims.cardGap)),
            y: dims.threatLineY
        };
    }

    /**
     * Increment turns active for all threats at turn end
     */
    incrementThreatTurns() {
        for (const eid of this.getActiveThreats()) {
            const threat = this.game.getComponent(eid, 'threat');
            if (threat) {
                threat.turnsActive++;
            }
        }
    }

    update() {
        // Skip DOM updates in headless mode
        const config = this.game.gameInstance?.getConfig() || {};
        if (config.isHeadless) return;

        // Update threat count display
        const threatCountEl = document.getElementById('threatCount');
        if (threatCountEl) {
            threatCountEl.textContent = this.getThreatCount();
        }
    }
}
