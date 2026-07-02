/**
 * ArpgUiSystem - Toggleable ARPG panels: character sheet (C), inventory (I),
 * skill tree (T), quest log (J). Phase B implements the character sheet;
 * later phases fill in the others.
 */
class ArpgUiSystem extends GUTS.BaseSystem {
    static services = [];

    static serviceDependencies = [
        'getPlayerCharacter',
        'allocateAttribute',
        'learnSkill',
        'assignSkillToSlot',
        'getSkillTree',
        'chooseAscension'
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

        const treePanel = document.getElementById('arpgPanel_skilltree');
        if (treePanel && !treePanel._delegated) {
            treePanel._delegated = true;
            treePanel.addEventListener('click', (e) => {
                if (e.target.closest?.('.arpg-panel-close')) { this.closePanel(); return; }

                const bind = e.target.closest?.('.arpg-skill-bind');
                if (bind?.dataset?.skill && bind?.dataset?.slot) {
                    this.call.assignSkillToSlot(bind.dataset.skill, bind.dataset.slot);
                    this._lastRenderAt = 0;
                    return;
                }

                const asc = e.target.closest?.('.arpg-ascension-choice');
                if (asc?.dataset?.unit) {
                    if (confirm(`Ascend to ${asc.dataset.title}? This choice is permanent.`)) {
                        this.call.chooseAscension(asc.dataset.unit);
                        this._lastRenderAt = 0;
                    }
                    return;
                }

                const node = e.target.closest?.('.arpg-skill-node');
                if (node?.dataset?.skill) {
                    this.call.learnSkill(node.dataset.skill);
                    this._lastRenderAt = 0;
                }
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
        else if (this.openPanel === 'skilltree') this.renderSkillTreePanel();
    }

    // ─── Skill tree panel ─────────────────────────────────────────────────────

    renderSkillTreePanel() {
        const body = document.getElementById('arpgSkillTreeBody');
        if (!body) return;

        const entityId = this.call.getPlayerCharacter?.();
        if (entityId == null) return;
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        if (!sheet) return;

        const tree = this.call.getSkillTree(sheet.classId);
        if (!tree) {
            body.innerHTML = '<em>No skill tree found for this class.</em>';
            return;
        }

        const classDef = this.collections.classes?.[sheet.classId];
        const bar = sheet.skillBar || {};
        const slotLabels = { rmb: 'RMB', s1: '1', s2: '2', s3: '3', s4: '4' };

        // Ascension banner
        let ascensionHtml = '';
        if (sheet.ascension) {
            const ascDef = this.collections.units?.[sheet.ascension];
            ascensionHtml = `<div class="arpg-ascension-banner">Ascended: <b>${ascDef?.title || sheet.ascension}</b></div>`;
        } else if (sheet.level >= 12) {
            const choices = (classDef?.ascensions || []).map(unitId => {
                const u = this.collections.units?.[unitId];
                return `<button class="arpg-ascension-choice" data-unit="${unitId}" data-title="${u?.title || unitId}">
                    ${u?.title || unitId}</button>`;
            }).join('');
            ascensionHtml = `<div class="arpg-ascension-banner glow">⭐ Choose your Ascension: ${choices}</div>`;
        } else {
            ascensionHtml = `<div class="arpg-ascension-banner dim">Ascension unlocks at level 12</div>`;
        }

        const branchHtml = (branch) => {
            const skills = (branch.skills || []).map(skill => {
                const rank = sheet.allocatedSkills?.[skill.id] || 0;
                const locked = sheet.level < (skill.levelReq || 1);
                const maxed = rank >= (skill.maxRank || 5);
                const canLearn = !locked && !maxed && sheet.unspentSkillPoints > 0;
                const stateClass = locked ? 'locked' : (rank > 0 ? 'learned' : 'available');

                let bindHtml = '';
                if (skill.type === 'active' && rank > 0) {
                    bindHtml = '<div class="arpg-skill-binds">' +
                        Object.entries(slotLabels).map(([slot, label]) => {
                            const active = bar[slot] === skill.id ? 'bound' : '';
                            return `<span class="arpg-skill-bind ${active}" data-skill="${skill.id}" data-slot="${slot}">${label}</span>`;
                        }).join('') + '</div>';
                }

                return `
                    <div class="arpg-skill-node ${stateClass} ${canLearn ? 'can-learn' : ''}" data-skill="${skill.id}"
                         title="${skill.description || ''}${locked ? ` (requires level ${skill.levelReq})` : ''}">
                        <span class="arpg-skill-node-icon">${skill.icon || '❖'}</span>
                        <span class="arpg-skill-node-info">
                            <span class="arpg-skill-node-title">${skill.title}</span>
                            <span class="arpg-skill-node-meta">
                                ${skill.type === 'passive' ? 'Passive · ' : ''}Lv ${skill.levelReq || 1} · Rank ${rank}/${skill.maxRank || 5}
                            </span>
                        </span>
                        ${bindHtml}
                    </div>`;
            }).join('');
            return `
                <div class="arpg-skill-branch">
                    <div class="arpg-skill-branch-title">${branch.title}</div>
                    ${skills}
                </div>`;
        };

        body.innerHTML = `
            <div class="arpg-skilltree-header">
                <span>${classDef?.icon || ''} ${tree.title}</span>
                <span class="arpg-points-badge">${sheet.unspentSkillPoints} skill points</span>
            </div>
            ${ascensionHtml}
            <div class="arpg-skill-branches">
                ${(tree.branches || []).map(branchHtml).join('')}
            </div>
            <div class="arpg-skilltree-hint">Click a skill to learn it · click RMB/1–4 on a learned skill to bind it</div>`;
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
