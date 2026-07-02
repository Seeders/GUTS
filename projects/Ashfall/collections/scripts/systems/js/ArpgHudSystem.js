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
            beltLife: document.getElementById('arpgBeltLife'),
            beltMana: document.getElementById('arpgBeltMana'),
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

        // Potion belt counters
        const inv = this.game.getComponent(entityId, 'inventory');
        if (inv) {
            if (this.els.beltLife) this.els.beltLife.textContent = `❤️ ${inv.beltLife || 0}`;
            if (this.els.beltMana) this.els.beltMana.textContent = `💙 ${inv.beltMana || 0}`;
        }

        this.updateSkillBar(entityId);
    }

    // ─── Skill bar (icons + cooldown sweep) ──────────────────────────────────

    updateSkillBar(entityId) {
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        const bar = sheet?.skillBar;
        const sts = this.game.skillTreeSystem;
        const abilitySystem = this.game.abilitySystem;
        if (!sheet || !sts) return;

        const slotToDom = { rmb: 'rmb', s1: '1', s2: '2', s3: '3', s4: '4' };
        for (const [slot, domSlot] of Object.entries(slotToDom)) {
            const el = document.querySelector(`.arpg-skill-slot[data-slot="${domSlot}"]`);
            if (!el) continue;
            const iconEl = el.querySelector('.arpg-skill-icon');
            const skillId = bar?.[slot];

            if (!skillId) {
                if (iconEl) iconEl.textContent = '';
                el.title = '';
                this.setCooldownOverlay(el, 0);
                continue;
            }

            const found = sts.getSkillDef(sheet.classId, skillId);
            const skill = found?.skill;
            if (iconEl) iconEl.textContent = skill?.icon || '❖';
            el.title = skill ? `${skill.title} — ${skill.description || ''}` : '';

            // Cooldown sweep
            let pct = 0;
            if (skill?.ability && abilitySystem) {
                const remaining = abilitySystem.getRemainingCooldown(entityId, skill.ability);
                const abilityData = this.collections.abilities?.[skill.ability];
                const total = (abilityData?.cooldown || 0) + (abilityData?.castTime || 0);
                if (total > 0 && remaining > 0) pct = Math.min(1, remaining / total);
            }
            this.setCooldownOverlay(el, pct);
        }
    }

    setCooldownOverlay(slotEl, pct) {
        let overlay = slotEl.querySelector('.arpg-skill-cooldown');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'arpg-skill-cooldown';
            slotEl.appendChild(overlay);
        }
        overlay.style.height = `${Math.round(pct * 100)}%`;
    }

    onPlayerCharacterSpawned() {
        // Re-resolve elements in case the interface re-rendered
        this.cacheElements();
    }

    onSceneUnload() {
        this.els = {};
    }
}
