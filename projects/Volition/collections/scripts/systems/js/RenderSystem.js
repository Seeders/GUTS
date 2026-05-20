import CardRenderSystem from '../../../../../../global/collections/scripts/systems/js/CardRenderSystem.js';

/**
 * RenderSystem - Game-specific rendering for Volition
 * Extends CardRenderSystem to add game-specific rendering:
 * playable cards highlighting, chaotic markers, kingdom progress
 */
class RenderSystem extends CardRenderSystem {
    static services = [
        // Inherit all parent services
        ...CardRenderSystem.services
    ];
    static serviceDependencies = [
        'isValidSequence', 'canPlayToKingdom', 'getTotalKingdomCards'
    ];

    constructor(game) {
        super(game);
    }

    onAnimationSpeedChanged(data) {
        this.animationSpeed = data.speed;
    }

    update() {
        // Call parent update for base card rendering
        super.update();

        const config = this.game.getConfig?.() || {};
        if (config.isHeadless) return;

        const entities = this.game.getEntitiesWith('card', 'cardVisual', 'cardLocation');

        for (const eid of entities) {
            const loc = this.game.getComponent(eid, 'cardLocation');
            if (!loc || loc.location === 0) continue;

            const el = this.getCardElement(eid);
            if (!el) continue;

            // Highlight oldest card in hand (location 1)
            if (loc.location === 1 && loc.index === 0) {
                el.classList.add('oldest-in-hand');
            } else {
                el.classList.remove('oldest-in-hand');
            }

            // Check if playable (can go to kingdom) - for hand cards
            if (loc.location === 1) {
                const canPlay = this.call.canPlayToKingdom?.(eid) || false;
                el.classList.toggle('playable', canPlay);
            }

            // Mark chaotic cards in field (location 3) - not part of valid sequence
            if (loc.location === 3) {
                const isValid = this.call.isValidSequence?.(eid) || false;
                el.classList.toggle('chaotic', !isValid);
            } else {
                el.classList.remove('chaotic');
            }
        }

        // Update kingdom progress
        this.updateProgress();
    }

    updateProgress() {
        const progressEl = document.getElementById('kingdomProgress');
        if (progressEl) {
            const count = this.call.getTotalKingdomCards?.() || 0;
            progressEl.textContent = `${count}/52`;
        }
    }
}

export default RenderSystem;
