import CardRenderSystem from '../../../../../../global/collections/scripts/systems/js/CardRenderSystem.js';

/**
 * RenderSystem - Game-specific rendering for Abandoned
 * Extends CardRenderSystem to add game-specific rendering:
 * threat highlighting, refuge marking, damage display
 */
class RenderSystem extends CardRenderSystem {
    static services = [
        // Inherit all parent services
        ...CardRenderSystem.services
    ];
    static serviceDependencies = [
        'getThreatLinePosition', 'getRefugePosition',
        'getCurrentDamage', 'getDamageThreshold', 'getActiveThreats'
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

        // Get active threats for highlighting
        const activeThreats = this.call.getActiveThreats?.() || [];
        const entities = this.game.getEntitiesWith('card', 'cardVisual', 'cardLocation');

        for (const eid of entities) {
            const loc = this.game.getComponent(eid, 'cardLocation');
            if (!loc || loc.location === 0) continue;

            const el = this.getCardElement(eid);
            if (!el) continue;

            // Mark threats in threat line (location 1)
            const isThreat = loc.location === 1 && activeThreats.includes(eid);
            el.classList.toggle('threat', isThreat);

            // Mark refuge cards (location 2)
            el.classList.toggle('in-refuge', loc.location === 2);
        }

        // Update damage display
        this.updateDamageDisplay();
    }

    updateDamageDisplay() {
        const damage = this.call.getCurrentDamage?.() || 0;
        const threshold = this.call.getDamageThreshold?.() || 10;

        const damageEl = document.getElementById('damageAmount');
        const damageFillEl = document.getElementById('damageFill');

        if (damageEl) {
            damageEl.textContent = `${damage}/${threshold}`;
        }

        if (damageFillEl) {
            const percent = Math.min((damage / threshold) * 100, 100);
            damageFillEl.style.width = `${percent}%`;

            if (percent >= 70) {
                damageFillEl.classList.add('danger');
            } else {
                damageFillEl.classList.remove('danger');
            }
        }
    }
}

export default RenderSystem;
