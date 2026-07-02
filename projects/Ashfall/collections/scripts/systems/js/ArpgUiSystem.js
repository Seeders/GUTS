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
        'chooseAscension',
        'equipItem',
        'unequipItem',
        'socketGem',
        'drinkPotion',
        'getGold',
        'getQuestActionsForNpc',
        'startQuest',
        'turnInQuest',
        'getQuestState',
        'getVendorStock',
        'buyVendorItem',
        'sellItem',
        'depositToStash',
        'withdrawFromStash'
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

        const invPanel = document.getElementById('arpgPanel_inventory');
        if (invPanel && !invPanel._delegated) {
            invPanel._delegated = true;
            this.selectedGemUid = null;

            invPanel.addEventListener('click', (e) => {
                if (e.target.closest?.('.arpg-panel-close')) { this.closePanel(); return; }

                const slotEl = e.target.closest?.('.arpg-eq-slot');
                if (slotEl?.dataset?.slot && slotEl.dataset.filled === '1') {
                    this.call.unequipItem(slotEl.dataset.slot);
                    this._lastRenderAt = 0;
                    return;
                }

                const beltEl = e.target.closest?.('.arpg-belt-slot');
                if (beltEl?.dataset?.potion) {
                    this.call.drinkPotion(beltEl.dataset.potion);
                    this._lastRenderAt = 0;
                    return;
                }

                const itemEl = e.target.closest?.('.arpg-inv-item');
                if (itemEl?.dataset?.uid) {
                    const uid = parseInt(itemEl.dataset.uid, 10);
                    if (itemEl.dataset.rarity === 'gem') {
                        // Select/deselect gem for socketing
                        this.selectedGemUid = this.selectedGemUid === uid ? null : uid;
                        this._lastRenderAt = 0;
                    } else if (this.selectedGemUid != null) {
                        this.call.socketGem(this.selectedGemUid, uid);
                        this.selectedGemUid = null;
                        this._lastRenderAt = 0;
                    } else {
                        this.call.equipItem(uid);
                        this._lastRenderAt = 0;
                    }
                }
            });

            // Tooltips (delegated mouseover)
            invPanel.addEventListener('mouseover', (e) => {
                const el = e.target.closest?.('[data-tooltip-uid]');
                if (el) this.showItemTooltip(el);
            });
            invPanel.addEventListener('mouseout', (e) => {
                if (e.target.closest?.('[data-tooltip-uid]')) this.hideTooltip();
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
        else if (this.openPanel === 'inventory') this.renderInventoryPanel();
        else if (this.openPanel === 'quests') this.renderQuestsPanel();
    }

    // ─── Quest log panel ──────────────────────────────────────────────────────

    renderQuestsPanel() {
        const body = document.getElementById('arpgQuestsBody');
        if (!body) return;
        const defs = this.collections.quests || {};
        const ordered = Object.keys(defs).sort((a, b) => (defs[a].order || 0) - (defs[b].order || 0));

        const rows = ordered.map(id => {
            const def = defs[id];
            const s = this.call.getQuestState?.(id) || { state: 'notStarted', progress: 0 };
            if (s.state === 'notStarted') return '';
            const stateLabel = {
                active: `<span style="color:#f0cf70">In progress${def.count ? ` (${s.progress || 0}/${def.count})` : ''}</span>`,
                done: '<span style="color:#7fe0c3">Return to Warlord Kael</span>',
                turnedIn: '<span style="color:#6d5c3f">Completed ✔</span>'
            }[s.state] || '';
            return `
                <div class="arpg-quest-row ${s.state}">
                    <div class="arpg-quest-title">${def.title}</div>
                    <div class="arpg-quest-obj">${def.objectiveText}</div>
                    <div class="arpg-quest-state">${stateLabel}</div>
                </div>`;
        }).filter(Boolean);

        body.innerHTML = rows.length
            ? rows.join('')
            : '<em style="color:#8d7a55">No quests yet. Speak with Warlord Kael in Emberrest.</em>';
    }

    // ─── Dialogue panel ───────────────────────────────────────────────────────

    openDialoguePanel(npcId, def) {
        this.closeDialoguePanel();

        const box = document.createElement('div');
        box.id = 'arpgDialogue';
        box.innerHTML = `
            <div class="arpg-dialogue-name" style="color:${def.color || '#f0cf70'}">${def.title}</div>
            <div class="arpg-dialogue-text" id="arpgDialogueText">${def.greeting || '...'}</div>
            <div class="arpg-dialogue-actions" id="arpgDialogueActions"></div>`;
        document.getElementById('gameContainer')?.appendChild(box);

        const actions = box.querySelector('#arpgDialogueActions');
        const addBtn = (label, fn, highlight = false) => {
            const b = document.createElement('button');
            b.className = 'btn';
            b.style.cssText = `font-size:.72rem; padding:.35rem 1rem; ${highlight ? 'border-color:#f0cf70;' : ''}`;
            b.textContent = label;
            b.addEventListener('click', fn);
            actions.appendChild(b);
        };

        // Quest actions
        for (const action of this.call.getQuestActionsForNpc?.(npcId) || []) {
            if (action.kind === 'offer') {
                box.querySelector('#arpgDialogueText').textContent = action.text;
                addBtn(`Accept: ${this.collections.quests?.[action.questId]?.title}`, () => {
                    this.call.startQuest(action.questId);
                    this.closeDialoguePanel();
                }, true);
            } else if (action.kind === 'turnIn') {
                box.querySelector('#arpgDialogueText').textContent = action.text;
                addBtn(action.label, () => {
                    this.call.turnInQuest(action.questId);
                    this.closeDialoguePanel();
                }, true);
            } else if (action.kind === 'reminder') {
                box.querySelector('#arpgDialogueText').textContent = `${action.text}`;
                const hint = document.createElement('div');
                hint.style.cssText = 'color:#f0cf70; font-size:.72rem; margin-top:4px;';
                hint.textContent = `Objective: ${action.label}`;
                box.querySelector('#arpgDialogueText').appendChild(hint);
            }
        }

        // Vendor
        if (def.vendor) {
            addBtn('🪙 Trade', () => {
                this.closeDialoguePanel();
                this.openVendorPanel(npcId, def);
            }, true);
        }

        addBtn('Farewell', () => this.closeDialoguePanel());
    }

    closeDialoguePanel() {
        document.getElementById('arpgDialogue')?.remove();
    }

    // ─── Vendor panel ─────────────────────────────────────────────────────────

    openVendorPanel(npcId, def) {
        this.closePanel();
        document.getElementById('arpgVendor')?.remove();

        const panel = document.createElement('div');
        panel.id = 'arpgVendor';
        panel.className = 'arpg-panel arpg-panel-wide';
        panel.innerHTML = `
            <div class="arpg-panel-titlebar">
                <span>${def.title} — Trade</span>
                <button class="arpg-panel-close">✕</button>
            </div>
            <div class="arpg-panel-body">
                <div class="arpg-gold-line" id="arpgVendorGold"></div>
                <div class="arpg-vendor-cols">
                    <div class="arpg-vendor-col">
                        <div class="arpg-section-title">For sale</div>
                        <div id="arpgVendorStock"></div>
                    </div>
                    <div class="arpg-vendor-col">
                        <div class="arpg-section-title">Your items (click to sell)</div>
                        <div id="arpgVendorSell"></div>
                    </div>
                </div>
            </div>`;
        document.getElementById('gameContainer')?.appendChild(panel);
        panel.querySelector('.arpg-panel-close').addEventListener('click', () => panel.remove());

        const render = () => {
            const goldEl = panel.querySelector('#arpgVendorGold');
            goldEl.textContent = `💰 ${this.call.getGold?.() ?? 0} gold`;

            // Stock
            const stockEl = panel.querySelector('#arpgVendorStock');
            stockEl.innerHTML = '';
            const stock = this.call.getVendorStock(npcId) || [];
            stock.forEach((item, index) => {
                const price = item.price ?? Math.round((this.game.itemSystem?.itemValue(item) || 20) * 1.5);
                const row = document.createElement('div');
                row.className = `arpg-vendor-row rarity-${item.rarity}`;
                row.innerHTML = `<span>${item.name}</span><span class="arpg-vendor-price">${price}g</span>`;
                row.addEventListener('click', () => {
                    const res = this.call.buyVendorItem(npcId, index);
                    if (!res?.success) GUTS.NotificationSystem?.show?.(res?.reason || 'Cannot buy', 'error');
                    render();
                });
                stockEl.appendChild(row);
            });

            // Player items
            const sellEl = panel.querySelector('#arpgVendorSell');
            sellEl.innerHTML = '';
            const pid = this.call.getPlayerCharacter?.();
            const inv = pid != null ? this.game.getComponent(pid, 'inventory') : null;
            for (const entry of inv?.items || []) {
                const item = entry.item;
                const value = Math.round((this.game.itemSystem?.itemValue(item) || 10) * 0.3);
                const row = document.createElement('div');
                row.className = `arpg-vendor-row rarity-${item.rarity}`;
                row.innerHTML = `<span>${item.name}</span><span class="arpg-vendor-price">+${value}g</span>`;
                row.addEventListener('click', () => {
                    this.call.sellItem(item.uid);
                    render();
                });
                sellEl.appendChild(row);
            }
        };
        render();
    }

    // ─── Stash panel ──────────────────────────────────────────────────────────

    openStashPanel() {
        this.closePanel();
        document.getElementById('arpgStash')?.remove();

        const panel = document.createElement('div');
        panel.id = 'arpgStash';
        panel.className = 'arpg-panel arpg-panel-wide';
        panel.innerHTML = `
            <div class="arpg-panel-titlebar">
                <span>Stash</span>
                <button class="arpg-panel-close">✕</button>
            </div>
            <div class="arpg-panel-body">
                <div class="arpg-vendor-cols">
                    <div class="arpg-vendor-col">
                        <div class="arpg-section-title">Stash (click to withdraw)</div>
                        <div id="arpgStashList"></div>
                    </div>
                    <div class="arpg-vendor-col">
                        <div class="arpg-section-title">Inventory (click to deposit)</div>
                        <div id="arpgStashInv"></div>
                    </div>
                </div>
            </div>`;
        document.getElementById('gameContainer')?.appendChild(panel);
        panel.querySelector('.arpg-panel-close').addEventListener('click', () => panel.remove());

        const render = () => {
            const stashEl = panel.querySelector('#arpgStashList');
            stashEl.innerHTML = '';
            for (const item of this.game.state.stashItems || []) {
                const row = document.createElement('div');
                row.className = `arpg-vendor-row rarity-${item.rarity}`;
                row.innerHTML = `<span>${item.name}</span>`;
                row.addEventListener('click', () => { this.call.withdrawFromStash(item.uid); render(); });
                stashEl.appendChild(row);
            }
            const invEl = panel.querySelector('#arpgStashInv');
            invEl.innerHTML = '';
            const pid = this.call.getPlayerCharacter?.();
            const inv = pid != null ? this.game.getComponent(pid, 'inventory') : null;
            for (const entry of inv?.items || []) {
                const row = document.createElement('div');
                row.className = `arpg-vendor-row rarity-${entry.item.rarity}`;
                row.innerHTML = `<span>${entry.item.name}</span>`;
                row.addEventListener('click', () => { this.call.depositToStash(entry.item.uid); render(); });
                invEl.appendChild(row);
            }
        };
        render();
    }

    // ─── Inventory panel ──────────────────────────────────────────────────────

    itemLabel(item) {
        if (item.rarity === 'gem') return item.icon || '💎';
        const base = this.collections.itemBases?.[item.baseId];
        return base?.icon || '❔';
    }

    renderInventoryPanel() {
        const body = document.getElementById('arpgInventoryBody');
        if (!body) return;
        const entityId = this.call.getPlayerCharacter?.();
        if (entityId == null) return;
        const inv = this.game.getComponent(entityId, 'inventory');
        const eq = this.game.getComponent(entityId, 'arpgEquipment');
        if (!inv || !eq) return;

        const itemsByUid = {};
        const registerTooltip = (item) => { itemsByUid[item.uid] = item; return item.uid; };
        this._tooltipItems = itemsByUid;

        // Paper doll
        const slotDefs = [
            ['helmet', '🪖'], ['amulet', '📿'],
            ['mainHand', '🗡️'], ['chest', '🥋'], ['offHand', '🛡️'],
            ['ring1', '💍'], ['belt', '🎗️'], ['ring2', '💍'],
            ['gloves', '🧤'], ['boots', '🥾']
        ];
        const dollHtml = slotDefs.map(([slot, placeholder]) => {
            const item = eq.slots?.[slot];
            const filled = item ? '1' : '0';
            const rarityClass = item ? `rarity-${item.rarity}` : '';
            const inner = item
                ? `<span class="arpg-eq-icon" data-tooltip-uid="${registerTooltip(item)}">${this.itemLabel(item)}</span>`
                : `<span class="arpg-eq-placeholder">${placeholder}</span>`;
            return `<div class="arpg-eq-slot ${rarityClass}" data-slot="${slot}" data-filled="${filled}" title="${slot}">${inner}</div>`;
        }).join('');

        // Grid
        const cell = 34;
        const gridItems = inv.items.map(entry => {
            const item = entry.item;
            const selected = this.selectedGemUid === item.uid ? 'selected' : '';
            return `<div class="arpg-inv-item rarity-${item.rarity} ${selected}"
                data-uid="${item.uid}" data-rarity="${item.rarity}" data-tooltip-uid="${registerTooltip(item)}"
                style="left:${entry.x * cell}px; top:${entry.y * cell}px; width:${entry.w * cell - 2}px; height:${entry.h * cell - 2}px;">
                ${this.itemLabel(item)}</div>`;
        }).join('');

        body.innerHTML = `
            <div class="arpg-inv-top">
                <div class="arpg-paper-doll">${dollHtml}</div>
                <div class="arpg-inv-side">
                    <div class="arpg-gold-line">💰 ${this.call.getGold?.() ?? 0} gold</div>
                    <div class="arpg-belt">
                        <div class="arpg-belt-slot" data-potion="life" title="Drink life potion (Q)">
                            ❤️ × ${inv.beltLife || 0} <span class="arpg-belt-key">Q</span>
                        </div>
                        <div class="arpg-belt-slot" data-potion="mana" title="Drink mana potion (E)">
                            💙 × ${inv.beltMana || 0} <span class="arpg-belt-key">E</span>
                        </div>
                    </div>
                    ${this.selectedGemUid != null
                        ? '<div class="arpg-gem-hint">Gem selected — click an item with an open socket</div>'
                        : ''}
                </div>
            </div>
            <div class="arpg-inv-grid" style="width:${inv.gridW * cell}px; height:${inv.gridH * cell}px;">
                ${gridItems}
            </div>
            <div class="arpg-skilltree-hint">Click item to equip · click equipped to remove · click gem then item to socket</div>`;
    }

    // ─── Tooltip ──────────────────────────────────────────────────────────────

    ensureTooltip() {
        let tip = document.getElementById('arpgTooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'arpgTooltip';
            document.body.appendChild(tip);
        }
        return tip;
    }

    showItemTooltip(el) {
        const uid = parseInt(el.dataset.tooltipUid, 10);
        const item = this._tooltipItems?.[uid];
        if (!item) return;
        const tip = this.ensureTooltip();
        const base = this.collections.itemBases?.[item.baseId];
        const rarityColors = {
            normal: '#e8e6e3', magic: '#7f7fff', rare: '#ffff77',
            unique: '#c7893c', gem: '#2fbf71'
        };

        let lines = [];
        if (item.rarity === 'gem') {
            const gemDef = this.collections.gems?.[item.gemId];
            lines.push(`<div class="tt-type">${item.gem?.type === 'skill' ? 'Skill Gem' : 'Support Gem'}</div>`);
            if (gemDef?.description) lines.push(`<div class="tt-affix">${gemDef.description}</div>`);
        } else if (base) {
            lines.push(`<div class="tt-type">${base.title}</div>`);
            if (base.category === 'weapon') {
                lines.push(`<div class="tt-stat">Damage: ${base.minDamage}–${base.maxDamage}</div>`);
                lines.push(`<div class="tt-stat">Attack Speed: ${base.attackSpeed}</div>`);
            }
            if (base.armor) lines.push(`<div class="tt-stat">Armor: ${base.armor}</div>`);
            if (base.blockChance) lines.push(`<div class="tt-stat">Block: ${Math.round(base.blockChance * 100)}%</div>`);
            for (const a of item.affixes || []) {
                lines.push(`<div class="tt-affix">${a.text}</div>`);
            }
            if (item.sockets?.length) {
                const socketStr = item.sockets.map(s => s ? (s.icon || '💎') : '◯').join(' ');
                lines.push(`<div class="tt-sockets">Sockets: ${socketStr}</div>`);
            }
            const reqs = [];
            const reqLevel = item.reqLevel || base.reqLevel;
            if (reqLevel > 1) reqs.push(`Level ${reqLevel}`);
            if (base.reqStr) reqs.push(`${base.reqStr} Str`);
            if (base.reqDex) reqs.push(`${base.reqDex} Dex`);
            if (base.reqInt) reqs.push(`${base.reqInt} Int`);
            if (reqs.length) lines.push(`<div class="tt-req">Requires: ${reqs.join(', ')}</div>`);
            if (item.lore) lines.push(`<div class="tt-lore">"${item.lore}"</div>`);
        }

        tip.innerHTML = `
            <div class="tt-name" style="color:${rarityColors[item.rarity] || '#fff'}">${item.name}</div>
            ${lines.join('')}`;
        tip.style.display = 'block';

        const rect = el.getBoundingClientRect();
        tip.style.left = `${Math.min(window.innerWidth - 260, rect.right + 10)}px`;
        tip.style.top = `${Math.max(8, rect.top - 20)}px`;
    }

    hideTooltip() {
        const tip = document.getElementById('arpgTooltip');
        if (tip) tip.style.display = 'none';
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

    onActCompleted() {
        if (document.getElementById('arpgActComplete')) return;
        const el = document.createElement('div');
        el.id = 'arpgActComplete';
        el.innerHTML = `
            <div class="act-title">ACT I COMPLETE</div>
            <div class="act-sub">Pyrelord Vazruk is no more. Emberrest breathes free air for the
                first time in a generation — and beyond the mountains, the ash is still falling...</div>
            <button class="btn" style="margin-top:26px;">Continue</button>`;
        el.querySelector('button').addEventListener('click', () => el.remove());
        document.getElementById('gameContainer')?.appendChild(el);
    }

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
