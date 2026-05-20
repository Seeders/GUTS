/**
 * ThreatSystem - Handles card resolution and turn-end threat damage
 * Core gameplay logic for the Abandoned survival game
 */
class ThreatSystem extends GUTS.BaseSystem {
    static services = ['resolveDrawnCard', 'processTurnEnd', 'calculateThreatDamage', 'hasPendingChoice', 'completeHeartChoice'];
    static serviceDependencies = [
        'addToThreatLine', 'addToRefuge', 'resolveThreat',
        'getActiveThreats', 'getThreatCount', 'incrementThreatTurns',
        'takeDamage', 'healDamage', 'isRefugeFull',
        'playDamage', 'playHeal'
    ];

    constructor(game) {
        super(game);
        this.threatTriggerCount = 3; // How many threats trigger damage
        this.pendingHeartChoice = null; // For heart resolution UI
    }

    init() {
        const config = this.game.gameInstance?.getConfig() || {};
        this.threatTriggerCount = config.threatTriggerCount || 3;
    }

    /**
     * Resolve a drawn card based on its suit
     * Called when a card is drawn from the night deck
     * @param {number} cardEid - Entity ID of the drawn card
     * @returns {Object} - Resolution result { action: string, requiresChoice: boolean }
     */
    resolveDrawnCard(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');

        // First add to threat line (all cards go there initially)
        this.call.addToThreatLine(cardEid);

        switch (card.suit) {
            case 0: // Hearts - Vitality
                // Player can choose: heal immediately OR store in refuge
                // For now, we'll give the player the choice via UI
                return this.resolveHeart(cardEid);

            case 1: // Diamonds - Supplies
                // Add to refuge as playable supply
                return this.resolveDiamond(cardEid);

            case 2: // Clubs - Actions
                // Add to refuge as playable action
                return this.resolveClub(cardEid);

            case 3: // Spades - Threats
                // STAYS in threat line until dealt with
                return this.resolveSpade(cardEid);

            default:
                return { action: 'unknown', requiresChoice: false };
        }
    }

    /**
     * Resolve a Heart card (Vitality)
     * Player chooses: heal immediately OR store in refuge
     */
    resolveHeart(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');

        // If refuge is full, automatically heal
        if (this.call.isRefugeFull()) {
            // Move from threat line to discard, heal
            this.call.resolveThreat(cardEid, 3); // 3 = discard
            this.call.healDamage(card.rank);
            this.call.playHeal?.();

            this.game.triggerEvent('onHeartResolved', {
                cardEid,
                rank: card.rank,
                action: 'heal',
                healed: card.rank
            });

            return { action: 'heal', requiresChoice: false, healed: card.rank };
        }

        // Otherwise, give player choice
        this.pendingHeartChoice = cardEid;

        this.game.triggerEvent('onHeartDrawn', {
            cardEid,
            rank: card.rank,
            requiresChoice: true
        });

        return { action: 'pending', requiresChoice: true, cardEid };
    }

    /**
     * Complete heart resolution based on player choice
     * @param {string} choice - 'heal' or 'store'
     */
    completeHeartChoice(choice) {
        if (!this.pendingHeartChoice) return;

        const cardEid = this.pendingHeartChoice;
        const card = this.game.getComponent(cardEid, 'card');
        this.pendingHeartChoice = null;

        if (choice === 'heal') {
            // Move from threat line to discard, heal
            this.call.resolveThreat(cardEid, 3); // 3 = discard
            this.call.healDamage(card.rank);
            this.call.playHeal?.();

            this.game.triggerEvent('onHeartResolved', {
                cardEid,
                rank: card.rank,
                action: 'heal',
                healed: card.rank
            });
        } else {
            // Move to refuge
            this.call.resolveThreat(cardEid, 2); // 2 = refuge
            this.call.addToRefuge(cardEid);

            this.game.triggerEvent('onHeartResolved', {
                cardEid,
                rank: card.rank,
                action: 'store'
            });
        }
    }

    /**
     * Resolve a Diamond card (Supplies)
     * Goes to refuge for later use
     */
    resolveDiamond(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');

        if (this.call.isRefugeFull()) {
            // If refuge is full, discard the diamond
            this.call.resolveThreat(cardEid, 3); // 3 = discard

            this.game.triggerEvent('onDiamondResolved', {
                cardEid,
                rank: card.rank,
                action: 'discard',
                reason: 'refuge_full'
            });

            return { action: 'discard', requiresChoice: false };
        }

        // Move to refuge
        this.call.resolveThreat(cardEid, 2); // 2 = refuge
        this.call.addToRefuge(cardEid);

        this.game.triggerEvent('onDiamondResolved', {
            cardEid,
            rank: card.rank,
            action: 'store'
        });

        return { action: 'store', requiresChoice: false };
    }

    /**
     * Resolve a Club card (Actions)
     * Goes to refuge for later use
     */
    resolveClub(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');

        if (this.call.isRefugeFull()) {
            // If refuge is full, discard the club
            this.call.resolveThreat(cardEid, 3); // 3 = discard

            this.game.triggerEvent('onClubResolved', {
                cardEid,
                rank: card.rank,
                action: 'discard',
                reason: 'refuge_full'
            });

            return { action: 'discard', requiresChoice: false };
        }

        // Move to refuge
        this.call.resolveThreat(cardEid, 2); // 2 = refuge
        this.call.addToRefuge(cardEid);

        this.game.triggerEvent('onClubResolved', {
            cardEid,
            rank: card.rank,
            action: 'store'
        });

        return { action: 'store', requiresChoice: false };
    }

    /**
     * Resolve a Spade card (Threat)
     * STAYS in threat line until dealt with
     */
    resolveSpade(cardEid) {
        const card = this.game.getComponent(cardEid, 'card');

        // Card already added to threat line with threat component
        // Just trigger event
        this.game.triggerEvent('onThreatAppeared', {
            cardEid,
            rank: card.rank,
            threatCount: this.call.getThreatCount()
        });

        return { action: 'threat', requiresChoice: false };
    }

    /**
     * Calculate damage from active threats
     * @returns {number} - Damage to deal (lowest threat rank if 3+ threats, else 0)
     */
    calculateThreatDamage() {
        const threats = this.call.getActiveThreats();

        if (threats.length < this.threatTriggerCount) {
            return 0;
        }

        // Get lowest rank among active threats
        let lowestRank = Infinity;
        for (const eid of threats) {
            const card = this.game.getComponent(eid, 'card');
            if (card.rank < lowestRank) {
                lowestRank = card.rank;
            }
        }

        return lowestRank;
    }

    /**
     * Process turn end - deal damage if 3+ threats, increment threat turns
     * @returns {Object} - { damaged: boolean, amount: number, died: boolean }
     */
    processTurnEnd() {
        const threatCount = this.call.getThreatCount();
        const damage = this.calculateThreatDamage();

        let died = false;

        if (damage > 0) {
            died = this.call.takeDamage(damage);
            this.call.playDamage?.();

            this.game.triggerEvent('onTurnEndDamage', {
                threatCount,
                damage,
                died
            });
        }

        // Increment turns active for all threats
        this.call.incrementThreatTurns();

        return { damaged: damage > 0, amount: damage, died };
    }

    /**
     * Check if player needs to make a heart choice
     */
    hasPendingChoice() {
        return this.pendingHeartChoice !== null;
    }

    /**
     * Get pending heart choice card
     */
    getPendingHeartChoice() {
        return this.pendingHeartChoice;
    }
}
