// DeckBuilderSystem — the meta (out-of-match) deck editor + deck persistence.
//
// All units and buildings remain available in every match; a DECK only CUSTOMIZES:
//   • per-unit abilities — units[] = { unitId, abilities:[abilityPoolId,...] } (≤4
//     each; these become the unit's purchasable ability techs, replacing its default
//     ability set — its inherent non-ability techs stay). Defaults to the unit's
//     original abilities.
//   • banned commanders — bannedCommanders[] (≤2) removed from the draft.
//
// Decks do NOT choose a building. Every player starts with a Cottage and converts it
// into a Barracks / Mage Tower / Fletcher's Hall in-match (upgradeTrees/cottage.json),
// so that decision belongs to the match, not the deck — and a deck naming one building
// would silently delete the other two choices.
//
// Decks live in localStorage (heroarena_decks_v1). The runtime side is
// ArmyShopSystem / AutobattlerRoundSystem (they read stats.deck); a null deck means
// "no customization" (full defaults), so the system is optional.
class DeckBuilderSystem extends GUTS.BaseSystem {
    static STORAGE_KEY = 'heroarena_decks_v1';
    static MAX_ABILITIES = 3;
    static MAX_BANS = 2;
    static services = ['listDecks', 'getDeck', 'openDeckBuilder'];

    constructor(game) {
        super(game);
        this.game.deckBuilderSystem = this;
        this._decks = this._load();
        this._editingId = null;
        this._root = null;
    }

    onSceneLoad() {
        if (this.game.isServer) return;
        if (!this._decks.length) this._seedDefault();   // ship one ready-made deck
        const wire = () => {
            const btn = document.getElementById('mainMenu_DecksBtn');
            if (btn && !btn._deckWired) { btn._deckWired = true; btn.onclick = () => this.openDeckBuilder(); }
        };
        wire();
        setTimeout(wire, 100);
    }

    // ─── Public API (lobby deck dropdown) ───────────────────────────────────────
    listDecks() { return this._decks.map(d => ({ id: d.id, name: d.name, valid: this._isValid(d) })); }
    getDeck(id) { return this._decks.find(d => d.id === id) || null; }
    _isValid(d) { return !!d; }

    // ─── Persistence ────────────────────────────────────────────────────────────
    _storage() { try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch { return null; } }
    _load() {
        const s = this._storage(); if (!s) return [];
        try { const d = JSON.parse(s.getItem(DeckBuilderSystem.STORAGE_KEY) || '{}'); return Array.isArray(d.decks) ? d.decks : []; }
        catch { return []; }
    }
    _persist() {
        const s = this._storage(); if (!s) return;
        s.setItem(DeckBuilderSystem.STORAGE_KEY, JSON.stringify({ version: 1, decks: this._decks }));
    }
    _uuid() { return 'deck_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

    // ─── Collection helpers (static classes are global regardless of scene) ─────
    _tieredUnitIds() {
        const T = GUTS.ArmyShopSystem;
        return Object.keys(this.collections.units || {})
            .filter(id => T?.unitTier?.(id) != null && !T?.NOT_OFFERED?.has?.(id))
            .sort((a, b) => (T.unitTier(a) - T.unitTier(b)) || a.localeCompare(b));
    }
    _leaders() { return GUTS.LeaderSystem?.LEADERS || []; }
    // The unit's ORIGINAL techs as pool ids (≤MAX), pre-selected as the default.
    // unitTechs entries now reference the pool directly; drop innate entries
    // (transforms etc.) since those aren't customizable deck slots.
    _defaultAbilityPoolIds(unitId) {
        const out = [];
        for (const pid of (this.collections.unitTechs?.[unitId]?.abilityPool || [])) {
            const p = this.collections.abilityPool?.[pid];
            if (p && !p.innate && !out.includes(pid)) out.push(pid);
        }
        return out.slice(0, DeckBuilderSystem.MAX_ABILITIES);
    }

    // Does a unit def satisfy an ability-pool entry's requirements? (matchesCombo shape.)
    _qualifies(def, requirements) {
        if (!requirements || !requirements.length) return true;
        const p = { str: def.strength || 0, dex: def.dexterity || 0, int: def.intelligence || 0,
                    weaponType: def.weaponType || 'none' };
        const min = (c, v) => !c || c.min == null || v >= c.min;
        return requirements.some(c =>
            min(c.str, p.str) && min(c.dex, p.dex) && min(c.int, p.int) &&
            (!Array.isArray(c.weaponType) || !c.weaponType.length || c.weaponType.includes(p.weaponType)));
    }

    // ─── Deck creation ──────────────────────────────────────────────────────────
    _newDeck(name = 'New Deck') {
        const d = { id: this._uuid(), name, units: [], bannedCommanders: [] };
        // Fill EVERY unit to its cap. Each ability belongs to one unit, so: take the
        // unit's own defaults first (shared ones go to whoever's first), then top up
        // from any unused ability the unit qualifies for. Universal filler passives
        // guarantee enough supply to fill all units.
        const used = new Set();
        const unitDefs = this.collections.units || {};
        const pool = Object.values(this.collections.abilityPool || {}).filter(p => !p.innate);
        for (const uid of this._tieredUnitIds()) {
            const def = unitDefs[uid] || {};
            const abils = [];
            const take = (poolId) => {
                if (used.has(poolId) || abils.length >= DeckBuilderSystem.MAX_ABILITIES) return;
                abils.push(poolId); used.add(poolId);
            };
            for (const poolId of this._defaultAbilityPoolIds(uid)) take(poolId);
            if (abils.length < DeckBuilderSystem.MAX_ABILITIES) {
                for (const p of pool) {
                    if (abils.length >= DeckBuilderSystem.MAX_ABILITIES) break;
                    if (used.has(p.id) || !this._qualifies(def, p.requirements)) continue;
                    take(p.id);
                }
            }
            d.units.push({ unitId: uid, abilities: abils });
        }
        this._decks.push(d); this._editingId = d.id; this._persist(); return d;
    }
    _seedDefault() {
        this._newDeck('Default');
        this._persist();
    }
    _duplicate(id) {
        const src = this.getDeck(id); if (!src) return;
        const copy = JSON.parse(JSON.stringify(src)); copy.id = this._uuid(); copy.name = src.name + ' (copy)';
        this._decks.push(copy); this._editingId = copy.id; this._persist();
    }
    _delete(id) {
        this._decks = this._decks.filter(d => d.id !== id);
        if (this._editingId === id) this._editingId = null;
        this._persist();
    }

    // ─── Deck mutation ──────────────────────────────────────────────────────────
    _deck() { return this.getDeck(this._editingId); }
    _unitEntry(d, unitId) {
        let e = (d.units || []).find(u => u.unitId === unitId);
        if (!e) { e = { unitId, abilities: [] }; (d.units ||= []).push(e); }
        return e;
    }
    // Which unit currently holds each ability (global 1-ability-per-unit).
    _usedByMap(d) {
        const map = {};
        for (const u of (d.units || [])) for (const a of (u.abilities || [])) map[a] = u.unitId;
        return map;
    }
    _toggleAbility(unitId, poolId) {
        const d = this._deck(); const e = this._unitEntry(d, unitId);
        const i = e.abilities.indexOf(poolId);
        if (i >= 0) { e.abilities.splice(i, 1); this._persist(); this._render(); return; }
        // Assigned to another unit? Always UNASSIGN it from that unit first (one-owner
        // rule) — even if the current unit is full, so clicking it frees it.
        const holder = this._usedByMap(d)[poolId];
        if (holder && holder !== unitId) {
            const he = (d.units || []).find(u => u.unitId === holder);
            const j = he ? he.abilities.indexOf(poolId) : -1;
            if (j >= 0) he.abilities.splice(j, 1);
        }
        // Then equip it onto the current unit if there's room.
        if (e.abilities.length < DeckBuilderSystem.MAX_ABILITIES) {
            e.abilities.push(poolId);
        } else if (!holder || holder === unitId) {
            GUTS.NotificationSystem?.show?.(`Max ${DeckBuilderSystem.MAX_ABILITIES} abilities per unit`, 'error');
            return;
        }
        this._persist(); this._render();
    }
    _toggleBan(leaderId) {
        const d = this._deck(); if (!d) return;
        const i = d.bannedCommanders.indexOf(leaderId);
        if (i >= 0) d.bannedCommanders.splice(i, 1);
        else {
            if (d.bannedCommanders.length >= DeckBuilderSystem.MAX_BANS) {
                GUTS.NotificationSystem?.show?.(`Max ${DeckBuilderSystem.MAX_BANS} commander bans`, 'error');
                return;
            }
            d.bannedCommanders.push(leaderId);
        }
        this._persist(); this._render();
    }
    _rename(name) { const d = this._deck(); if (d) { d.name = name; this._persist(); } }

    // ─── UI ─────────────────────────────────────────────────────────────────────
    openDeckBuilder() {
        this._ensureRoot(); this._root.style.display = 'flex';
        if (!this._editingId && this._decks[0]) this._editingId = this._decks[0].id;
        if (!this._selectedUnitId) this._selectedUnitId = this._tieredUnitIds()[0] || null;
        this._render();
    }
    close() {
        if (this._root) this._root.style.display = 'none';
        if (this._previewTimer) { clearInterval(this._previewTimer); this._previewTimer = null; }
    }

    _ensureRoot() {
        if (this._root) return;
        if (!document.getElementById('deckBuilderStyles')) {
            const st = document.createElement('style');
            st.id = 'deckBuilderStyles';
            st.textContent = `
              #deckBuilderRoot{position:fixed;inset:0;z-index:4000;background:rgba(8,10,14,0.96);
                display:none;flex-direction:column;color:#e8e2d0;font-family:sans-serif;padding:18px 24px;}
              #deckBuilderRoot h1{margin:0 0 10px;font-size:22px;color:#d8b45a;}
              .db-wrap{display:flex;gap:18px;flex:1;min-height:0;}
              .db-list{width:220px;flex-shrink:0;overflow:auto;border-right:1px solid #333;padding-right:12px;}
              .db-edit{flex:1;overflow:auto;}
              .db-deck{padding:7px 9px;border:1px solid #333;border-radius:6px;margin-bottom:6px;cursor:pointer;background:#161a22;}
              .db-deck.sel{border-color:#d8b45a;background:#22262f;}
              .db-btn{background:#2a2f3a;color:#e8e2d0;border:1px solid #444;border-radius:5px;padding:6px 10px;cursor:pointer;margin:2px;}
              .db-btn:hover{border-color:#d8b45a;}
              .db-sec{margin:14px 0;} .db-sec h2{font-size:15px;color:#d8b45a;border-bottom:1px solid #333;padding-bottom:4px;}
              .db-row{display:flex;align-items:flex-start;gap:8px;padding:4px 0;border-bottom:1px solid #1c2028;}
              .db-uname{width:150px;flex-shrink:0;font-size:12px;padding-top:4px;}
              .db-chip{display:inline-block;padding:5px 9px;margin:3px;border:1px solid #444;border-radius:5px;cursor:pointer;background:#161a22;font-size:12px;}
              .db-chip.on{border-color:#5aa0d8;background:#1d2a38;color:#cfe6ff;}
              .db-chip.ban{border-color:#d85a5a;background:#361d1d;color:#ffcccc;}
              .db-ab{display:inline-block;padding:3px 7px;margin:2px;border:1px solid #3a3f4a;border-radius:4px;cursor:pointer;font-size:11px;background:#12151c;}
              .db-ab.on{border-color:#7ad87a;background:#1d381d;color:#ccffcc;}
              .db-ab.no{opacity:0.35;cursor:not-allowed;}
              .db-name{background:#12151c;border:1px solid #444;color:#e8e2d0;border-radius:5px;padding:6px 8px;font-size:15px;width:260px;}
              .db-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
              .db-muted{opacity:0.6;font-size:12px;} .db-warn{color:#e0a35a;font-size:12px;}
              .db-sub{margin:4px 0 8px 158px;}
              .db-ua{display:flex;gap:18px;}
              .db-col{flex:1;min-width:0;} .db-col h3{font-size:13px;color:#9fb0c0;margin:0 0 6px;}
              .db-unitcol{flex:0 0 300px;}
              .db-agroup{margin:0 0 12px;} .db-agroup h4{font-size:12px;color:#d8b45a;margin:6px 0 4px;
                text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #2a2f3a;padding-bottom:3px;}
              .db-preview{display:flex;gap:14px;align-items:center;background:#12151c;border:1px solid #2a2f3a;
                border-radius:8px;padding:10px 12px;margin:0 0 12px;}
              .db-sprite{width:120px;height:120px;flex-shrink:0;background:#0a0c10;border-radius:6px;image-rendering:pixelated;}
              .db-stats{display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:2px 16px;flex:1;}
              .db-stat{display:flex;justify-content:space-between;font-size:12px;border-bottom:1px solid #1c2028;padding:2px 0;}
              .db-stat span{opacity:0.7;} .db-stat b{color:#e8e2d0;}
              .db-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;}
              .db-grid.wide{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));}
              .db-desc{display:block;font-size:9px;opacity:0.72;margin-top:4px;line-height:1.25;}
              .db-cell{border:1px solid #333;border-radius:7px;background:#12151c;padding:8px 6px;text-align:center;
                cursor:pointer;font-size:11px;line-height:1.2;position:relative;}
              .db-cell img{width:38px;height:38px;object-fit:contain;display:block;margin:0 auto 4px;}
              .db-cell .db-fb{font-size:26px;display:block;margin:2px auto 4px;}
              .db-cell .db-cnt{position:absolute;top:3px;right:5px;font-size:10px;color:#8fa;}
              .db-unit.sel{border-color:#d8b45a;background:#2a2418;box-shadow:0 0 0 1px #d8b45a inset;}
              /* ability states, relative to the selected unit */
              .db-abil.equipped{border-color:#7ad87a;background:#183018;color:#ccffcc;}      /* on this unit */
              .db-abil.available{border-color:#5aa0d8;}                                       /* free + compatible */
              .db-abil.inuse{border-color:#c98a3a;background:#241c10;color:#e0b070;} /* taken by another unit — click to steal/free */
              .db-abil.incompat{opacity:0.28;cursor:not-allowed;filter:grayscale(1);}         /* unit fails requirement */
              .db-tag{display:block;font-size:9px;opacity:0.8;margin-top:2px;}`;
            document.head.appendChild(st);
        }
        this._root = document.createElement('div');
        this._root.id = 'deckBuilderRoot';
        document.body.appendChild(this._root);
    }

    _render() {
        if (!this._root) return;
        const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const d = this._deck();

        const listHtml = this._decks.map(x =>
            `<div class="db-deck ${x.id === this._editingId ? 'sel' : ''}" data-pick="${x.id}">${esc(x.name)}${this._isValid(x) ? '' : ' <span class="db-warn">⚠</span>'}</div>`).join('')
            || '<div class="db-muted">No decks yet.</div>';

        let editHtml = '<div class="db-muted">Select or create a deck to edit.</div>';
        if (d) {
            const unitDefs = this.collections.units || {};
            const pool = Object.values(this.collections.abilityPool || {}).filter(p => !p.innate);
            const T = GUTS.ArmyShopSystem;

            // Ensure a selected unit; build the global ability→unit map.
            if (!this._selectedUnitId || !unitDefs[this._selectedUnitId]) this._selectedUnitId = this._tieredUnitIds()[0] || null;
            const selId = this._selectedUnitId;
            const selDef = unitDefs[selId] || {};
            const usedBy = this._usedByMap(d);
            const selEntry = (d.units || []).find(u => u.unitId === selId) || { abilities: [] };

            const iconImg = (def, fb) => {
                const p = this.collections?.icons?.[def?.icon]?.imagePath;
                return p ? `<img src="./resources/${p}" alt="">` : `<span class="db-fb">${fb}</span>`;
            };

            // Unit grid (icon + name), selected one highlighted, with n/4 counter.
            const unitGrid = this._tieredUnitIds().map(id => {
                const def = unitDefs[id] || {};
                const cnt = ((d.units || []).find(u => u.unitId === id)?.abilities || []).length;
                return `<div class="db-cell db-unit ${id === selId ? 'sel' : ''}" data-unit="${id}">
                    <span class="db-cnt">${cnt}/${DeckBuilderSystem.MAX_ABILITIES}</span>
                    ${iconImg(def, '🪖')}${esc(def.title || id)}<span class="db-tag">T${T.unitTier(id)}</span></div>`;
            }).join('');

            // Only abilities the selected unit is COMPATIBLE with are shown. Each cell
            // is clickable: equip (available), unequip (equipped), or STEAL from
            // another unit (in use) — all onto the current unit without switching.
            const unitTitle = (uid) => esc(unitDefs[uid]?.title || uid);
            const cellHtml = (p) => {
                const equipped = selEntry.abilities.includes(p.id);
                const holder = usedBy[p.id];
                const desc = p.description || this.collections.abilities?.[p.unlockAbility]?.description || '';
                let cls, tag = '';
                if (equipped) { cls = 'equipped'; tag = 'equipped'; }
                else if (holder && holder !== selId) { cls = 'inuse'; tag = `steal from ${unitTitle(holder)}`; }
                else { cls = 'available'; }
                return `<div class="db-cell db-abil ${cls}" data-ab="${selId}::${p.id}" title="${esc(desc)}">
                    ${iconImg(p, '✦')}${esc(p.title || p.id)}
                    <span class="db-desc">${esc(desc)}</span>
                    ${tag ? `<span class="db-tag">${esc(tag)}</span>` : ''}</div>`;
            };
            const groups = { str: [], dex: [], int: [] };
            const GRID_ORDER = [['str', 'Strength'], ['dex', 'Dexterity'], ['int', 'Intelligence']];
            for (const p of pool) {
                if (!this._qualifies(selDef, p.requirements)) continue;   // compatible only
                groups[this._abilityBucket(p.requirements)].push(p);
            }
            const abilGrids = GRID_ORDER.filter(([k]) => groups[k].length).map(([k, label]) => {
                const items = groups[k].map(cellHtml).join('');
                return `<div class="db-agroup"><h4>${label} <span class="db-muted">(${groups[k].length})</span></h4>
                    <div class="db-grid wide">${items}</div></div>`;
            }).join('') || '<div class="db-muted">No compatible abilities.</div>';

            // Selected-unit panel: rotating sprite preview + stats.
            const st = (label, val) => `<div class="db-stat"><span>${esc(label)}</span><b>${esc(val)}</b></div>`;
            const statsPanel = `<div class="db-preview">
                <canvas class="db-sprite" width="120" height="120" data-set="${esc(selDef.spriteAnimationSet || '')}"></canvas>
                <div class="db-stats">
                    ${st('Tier', 'T' + (T.unitTier(selId) ?? '-'))}
                    ${st('HP', selDef.hp ?? '-')} ${st('Damage', selDef.damage ?? '-')}
                    ${st('Atk Spd', selDef.attackSpeed ?? '-')} ${st('Range', selDef.range ?? '-')}
                    ${st('Armor', selDef.armor ?? '-')} ${st('Speed', selDef.speed ?? '-')}
                    ${st('S/D/I', `${selDef.strength || 0}/${selDef.dexterity || 0}/${selDef.intelligence || 0}`)}
                    ${st('Weapon', selDef.weaponType || 'none')}
                </div></div>`;

            const unitsHtml = `<div class="db-ua">
                <div class="db-col db-unitcol"><h3>Units</h3><div class="db-grid">${unitGrid}</div></div>
                <div class="db-col">
                    <h3>${esc(selDef.title || selId || '')} — ${selEntry.abilities.length}/${DeckBuilderSystem.MAX_ABILITIES} abilities</h3>
                    ${statsPanel}${abilGrids}
                </div>
              </div>`;

            const cmdHtml = this._leaders().map(l => {
                const banned = (d.bannedCommanders || []).includes(l.id);
                return `<span class="db-chip ${banned ? 'ban' : ''}" data-ban="${l.id}">${banned ? '🚫 ' : ''}${esc(l.label)}</span>`;
            }).join('');

            editHtml = `
              <div class="db-head">
                <input class="db-name" data-name value="${esc(d.name)}"/>
                <div><button class="db-btn" data-dup>Duplicate</button><button class="db-btn" data-del>Delete</button></div>
              </div>
              <div class="db-sec"><h2>Units &amp; Abilities — select a unit, then assign abilities (each ability belongs to one unit)</h2>${unitsHtml}</div>
              <div class="db-sec"><h2>Banned Commanders (${d.bannedCommanders.length}/${DeckBuilderSystem.MAX_BANS})</h2>${cmdHtml}</div>`;
        }

        // Preserve scroll of the panels across the full re-render (toggling an ability
        // rebuilds innerHTML, which would otherwise jump both back to the top).
        const prevEdit = this._root.querySelector('.db-edit')?.scrollTop || 0;
        const prevList = this._root.querySelector('.db-list')?.scrollTop || 0;
        this._root.innerHTML = `
          <div class="db-head"><h1>⚔ Deck Builder</h1>
            <div><button class="db-btn" data-new>+ New Deck</button><button class="db-btn" data-close>Close</button></div></div>
          <div class="db-wrap"><div class="db-list">${listHtml}</div><div class="db-edit">${editHtml}</div></div>`;
        this._wire();
        const editEl = this._root.querySelector('.db-edit'); if (editEl) editEl.scrollTop = prevEdit;
        const listEl = this._root.querySelector('.db-list'); if (listEl) listEl.scrollTop = prevList;
        this._startPreview();
    }

    _spriteImg(path) {
        this._imgCache = this._imgCache || {};
        if (!this._imgCache[path]) { const i = new Image(); i.src = './resources/' + path; this._imgCache[path] = i; }
        return this._imgCache[path];
    }

    // Rotating sprite preview of the selected unit — cycles idle directions (like the
    // editor asset preview) by blitting sheet frames onto the canvas.
    _startPreview() {
        if (this._previewTimer) { clearInterval(this._previewTimer); this._previewTimer = null; }
        const canvas = this._root?.querySelector('.db-sprite');
        const set = canvas && this.collections.spriteAnimationSets?.[canvas.dataset.set];
        if (!canvas || !set || !set.frames) return;
        // Use only the GROUND-perspective idle frames (the sheet also has an elevated
        // angle); spin through the 8 compass directions in order.
        const ORDER = ['Down', 'DownLeft', 'Left', 'UpLeft', 'Up', 'UpRight', 'Right', 'DownRight'];
        const suf = Object.keys(set.frames).some(k => /^idle.*Ground_\d+$/.test(k)) ? 'Ground' : '';
        const dirs = ORDER.filter(dir => set.frames[`idle${dir}${suf}_0`]);
        if (!dirs.length) return;
        const img = this._spriteImg(set.spriteSheet);
        const ctx = canvas.getContext('2d');
        this._previewTimer = setInterval(() => {
            if (!canvas.isConnected) { clearInterval(this._previewTimer); this._previewTimer = null; return; }
            const tick = (this._previewTick = (this._previewTick || 0) + 1);
            const dir = dirs[Math.floor(tick / 6) % dirs.length];   // rotate every ~0.8s
            const fr = tick % 5;                                     // idle animation frame
            const f = set.frames[`idle${dir}${suf}_${fr}`] || set.frames[`idle${dir}${suf}_0`];
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (img.complete && img.naturalWidth && f) {
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, canvas.width, canvas.height);
            }
        }, 130);
    }

    // Which of the three archetype grids an ability belongs to, from the stat its
    // requirement targets: str / dex / int. (Requirements are single-archetype.)
    _abilityBucket(reqs) {
        const s = new Set();
        for (const c of (reqs || [])) for (const k of ['str', 'dex', 'int']) if (c[k] && c[k].min) s.add(k);
        return s.has('int') ? 'int' : s.has('dex') ? 'dex' : 'str';
    }

    _reqText(reqs) {
        if (!reqs || !reqs.length) return 'nothing';
        return reqs.map(c => ['str', 'dex', 'int'].filter(k => c[k]?.min).map(k => `${k} ${c[k].min}`).join('+')
            + (c.weaponType ? ` [${c.weaponType.join('/')}]` : '')).join(' or ');
    }

    _wire() {
        const r = this._root;
        const on = (sel, fn) => r.querySelectorAll(sel).forEach(el => el.onclick = () => fn(el));
        r.querySelector('[data-new]').onclick = () => { this._newDeck(); this._render(); };
        r.querySelector('[data-close]').onclick = () => this.close();
        on('[data-pick]', el => { this._editingId = el.dataset.pick; this._render(); });
        const dup = r.querySelector('[data-dup]'); if (dup) dup.onclick = () => { this._duplicate(this._editingId); this._render(); };
        const del = r.querySelector('[data-del]'); if (del) del.onclick = () => { if (confirm('Delete this deck?')) { this._delete(this._editingId); this._render(); } };
        const name = r.querySelector('[data-name]'); if (name) name.oninput = () => this._rename(name.value);
        on('[data-unit]', el => { this._selectedUnitId = el.dataset.unit; this._render(); });
        on('[data-ab]', el => { const [u, p] = el.dataset.ab.split('::'); this._toggleAbility(u, p); });
        on('[data-ban]', el => this._toggleBan(el.dataset.ban));
    }
}
