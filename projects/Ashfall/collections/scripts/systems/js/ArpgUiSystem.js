/**
 * ArpgUiSystem - Toggleable ARPG panels: character sheet (C), inventory (I),
 * skill tree (T), quest log (J). Phase B implements the character sheet;
 * later phases fill in the others.
 */
class ArpgUiSystem extends GUTS.BaseSystem {
    static services = [];

    static serviceDependencies = [
        'getPlayerCharacter',
        'allocateAttribute'
    ];

    constructor(game) {
        super(game);
        this.game.arpgUiSystem = this;
        this.openPanel = null;
        this._boundKeyDown = null;
        this._dirty = true;
    }

    init() {}

    onSceneLoad() {
        if (!this.game.state.isAdventure) return;

        this._boundKeyDown = (e) => {
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            if (e.code === 'KeyC') this.togglePanel('character');
            else if (e.code === 'KeyI') this.togglePanel('inventory');
            else if (e.code === 'KeyT') this.togglePanel('skilltree');
            else if (e.code === 'KeyJ') this.togglePanel('quests');
            else if (e.code === 'Escape' && this.openPanel) this.closePanel();
        };
        document.addEventListener('keydown', this._boundKeyDown);

        // Delegated click handling survives innerHTML refreshes
        const charPanel = document.getElementById('arpgPanel_character');
        if (charPanel && !charPanel._delegated) {
            charPanel._delegated = true;
            charPanel.addEventListener('click', (e) => {
                const plus = e.target.closest?.('.arpg-attr-plus');
                if (plus?.dataset?.attr) {
                    this.call.allocateAttribute(plus.dataset.attr, 1);
                    this._lastRenderAt = 0; // force refresh
                }
                if (e.target.closest?.('.arpg-panel-close')) this.closePanel();
            });
        }
    }

    togglePanel(name) {
        if (this.openPanel === name) {
            this.closePanel();
        } else {
            this.openPanelByName(name);
        }
    }

    openPanelByName(name) {
        this.closePanel();
        const el = document.getElementById(`arpgPanel_${name}`);
        if (!el) return;
        el.classList.remove('hidden');
        this.openPanel = name;
        this._dirty = true;
        this.game.triggerEvent('onArpgPanelOpened', { panel: name });
    }

    closePanel() {
        if (!this.openPanel) return;
        const el = document.getElementById(`arpgPanel_${this.openPanel}`);
        if (el) el.classList.add('hidden');
        const prev = this.openPanel;
        this.openPanel = null;
        this.game.triggerEvent('onArpgPanelClosed', { panel: prev });
    }

    // Refresh visible panel content at ~4Hz (delegated listeners survive rebuilds)
    update() {
        if (!this.game.state.isAdventure || !this.openPanel) return;
        const now = this.game.state.now || 0;
        if (this._lastRenderAt && now - this._lastRenderAt < 0.25) return;
        this._lastRenderAt = now;
        if (this.openPanel === 'character') this.renderCharacterPanel();
    }

    onDerivedStatsChanged() { this._dirty = true; }
    onPlayerLevelUp() { this._dirty = true; }

    // ─── Character sheet panel ────────────────────────────────────────────────

    renderCharacterPanel() {
        const body = document.getElementById('arpgCharacterBody');
        if (!body) return;

        const entityId = this.call.getPlayerCharacter?.();
        if (entityId == null) return;
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        const combat = this.game.getComponent(entityId, 'combat');
        const health = this.game.getComponent(entityId, 'health');
        const pool = this.game.getComponent(entityId, 'resourcePool');
        if (!sheet) return;

        const classDef = this.collections.classes?.[sheet.classId];

        const attrRow = (label, key) => {
            const canSpend = sheet.unspentAttributePoints > 0;
            return `
                <div class="arpg-attr-row">
                    <span class="arpg-attr-label">${label}</span>
                    <span class="arpg-attr-value">${sheet.attributes[key]}</span>
                    <button class="arpg-attr-plus ${canSpend ? '' : 'hidden'}" data-attr="${key}">+</button>
                </div>`;
        };

        const statRow = (label, value) => `
            <div class="arpg-stat-row"><span>${label}</span><span>${value}</span></div>`;

        body.innerHTML = `
            <div class="arpg-char-header">
                <div class="arpg-char-name">${classDef?.icon || ''} ${classDef?.title || sheet.classId}</div>
                <div class="arpg-char-level">Level ${sheet.level}</div>
                <div class="arpg-char-xp">XP ${sheet.experience} / ${sheet.experienceToNext}</div>
            </div>
            <div class="arpg-char-columns">
                <div class="arpg-char-col">
                    <div class="arpg-section-title">Attributes
                        ${sheet.unspentAttributePoints > 0
                            ? `<span class="arpg-points-badge">${sheet.unspentAttributePoints} points</span>` : ''}
                    </div>
                    ${attrRow('Strength', 'strength')}
                    ${attrRow('Dexterity', 'dexterity')}
                    ${attrRow('Intelligence', 'intelligence')}
                    ${attrRow('Vitality', 'vitality')}
                    <div class="arpg-section-title" style="margin-top:10px;">Resources</div>
                    ${statRow('Life', `${Math.ceil(health?.current ?? 0)} / ${health?.max ?? 0}`)}
                    ${statRow('Mana', `${Math.floor(pool?.mana ?? 0)} / ${pool?.maxMana ?? 0}`)}
                </div>
                <div class="arpg-char-col">
                    <div class="arpg-section-title">Combat</div>
                    ${statRow('Damage', combat?.damage ?? 0)}
                    ${statRow('Attack Speed', (combat?.attackSpeed ?? 1).toFixed(2))}
                    ${statRow('Accuracy', combat?.accuracy ?? 0)}
                    ${statRow('Evasion', combat?.evasion ?? 0)}
                    ${statRow('Crit Chance', `${((combat?.criticalChance ?? 0) * 100).toFixed(1)}%`)}
                    ${statRow('Crit Multiplier', `${((combat?.criticalMultiplier ?? 1.5) * 100).toFixed(0)}%`)}
                    <div class="arpg-section-title" style="margin-top:10px;">Defenses</div>
                    ${statRow('Armor', combat?.armor ?? 0)}
                    ${statRow('Fire Res', `${combat?.fireResistance ?? 0}%`)}
                    ${statRow('Cold Res', `${combat?.coldResistance ?? 0}%`)}
                    ${statRow('Lightning Res', `${combat?.lightningResistance ?? 0}%`)}
                    ${statRow('Poison Res', `${combat?.poisonResistance ?? 0}%`)}
                </div>
            </div>`;

    }

    onSceneUnload() {
        if (this._boundKeyDown) {
            document.removeEventListener('keydown', this._boundKeyDown);
            this._boundKeyDown = null;
        }
        this.openPanel = null;
    }
}
