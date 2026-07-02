/**
 * ArpgHudSystem - The ARPG in-game HUD.
 *
 * Phase A: health globe, mana globe, gold display, zone name, respawn message.
 * Later phases add: XP bar, skill bar with cooldowns, potion belt, boss bar.
 */
class ArpgHudSystem extends GUTS.BaseSystem {
    static services = [];

    static serviceDependencies = [
        'getPlayerCharacter',
        'getPlayerEntities'
    ];

    constructor(game) {
        super(game);
        this.game.arpgHudSystem = this;
        this.els = {};
    }

    init() {}

    onSceneLoad() {
        if (!this.game.state.isAdventure) return;
        this.cacheElements();
        this.updateZoneName();
    }

    cacheElements() {
        this.els = {
            healthFill: document.getElementById('arpgHealthFill'),
            healthText: document.getElementById('arpgHealthText'),
            manaFill: document.getElementById('arpgManaFill'),
            manaText: document.getElementById('arpgManaText'),
            gold: document.getElementById('arpgGold'),
            zoneName: document.getElementById('arpgZoneName'),
            deathOverlay: document.getElementById('arpgDeathOverlay'),
            levelText: document.getElementById('arpgLevel'),
            xpFill: document.getElementById('arpgXpFill')
        };
    }

    updateZoneName() {
        if (!this.els.zoneName) return;
        const levelKey = this.reverseEnums.levels?.[this.game.state.level];
        const level = this.collections.levels?.[levelKey];
        this.els.zoneName.textContent = level?.title || levelKey || '';
    }

    update() {
        if (!this.game.state.isAdventure) return;
        const entityId = this.call.getPlayerCharacter?.();
        if (entityId == null) return;

        // Health globe
        const health = this.game.getComponent(entityId, 'health');
        if (health && this.els.healthFill) {
            const pct = Math.max(0, Math.min(1, health.current / Math.max(1, health.max)));
            this.els.healthFill.style.height = `${pct * 100}%`;
            if (this.els.healthText) {
                this.els.healthText.textContent = `${Math.ceil(health.current)}/${health.max}`;
            }
        }

        // Mana globe
        const pool = this.game.getComponent(entityId, 'resourcePool');
        if (pool && this.els.manaFill) {
            const pct = Math.max(0, Math.min(1, pool.mana / Math.max(1, pool.maxMana)));
            this.els.manaFill.style.height = `${pct * 100}%`;
            if (this.els.manaText) {
                this.els.manaText.textContent = `${Math.floor(pool.mana)}/${pool.maxMana}`;
            }
        }

        // Gold from player stats
        if (this.els.gold) {
            const playerEntities = this.call.getPlayerEntities?.() || [];
            for (const pid of playerEntities) {
                const stats = this.game.getComponent(pid, 'playerStats');
                if (stats?.playerId === 0) {
                    this.els.gold.textContent = stats.gold ?? 0;
                    break;
                }
            }
        }

        // Experience / level (Phase B fills this in properly)
        const exp = this.game.getComponent(entityId, 'experience');
        if (exp) {
            if (this.els.levelText) this.els.levelText.textContent = exp.level ?? 1;
            if (this.els.xpFill && exp.experienceToNextLevel > 0) {
                const pct = Math.max(0, Math.min(1, (exp.experience || 0) / exp.experienceToNextLevel));
                this.els.xpFill.style.width = `${pct * 100}%`;
            }
        }

        // Death overlay
        if (this.els.deathOverlay) {
            const deathState = this.game.getComponent(entityId, 'deathState');
            const dead = deathState && deathState.state !== this.enums.deathState.alive;
            this.els.deathOverlay.classList.toggle('hidden', !dead);
        }
    }

    onPlayerCharacterSpawned() {
        // Re-resolve elements in case the interface re-rendered
        this.cacheElements();
    }

    onSceneUnload() {
        this.els = {};
    }
}
