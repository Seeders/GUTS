/**
 * EditorShell — the new Unity-like editor shell (Phase 0 scaffolding).
 *
 * Editor-only. Owns the top-level layout: menubar / hierarchy / viewport /
 * inspector / assets. Wraps the existing EditorModel + FileSystemSyncService
 * (data + persistence are unchanged). Activated by EditorController when the
 * URL has ?ui=new; the legacy #container chrome is hidden while active.
 *
 * Phases:
 *   0 (this) — layout, resizable splitters, theme, live assets list from model.
 *   1        — replace the viewport placeholder with a persistent EditorECSGame.
 *   2/3/4    — assets browser, inspector, hierarchy + scene composition.
 */
class EditorShell {
  constructor(controller = null) {
    this.controller = controller;
    this.model = controller ? controller.model : null;
    this.root = null;
    this.panels = {};
    this.selectedType = null;
    this.selectedObjectId = null;
    this.viewport = null;
    this._tabs = {};        // center-view tabs: id -> { content, btn, dispose? }
    this._activeTab = null;
  }

  /** Build the shell into <body> and hide the legacy chrome. */
  mount(parent = document.body) {
    document.body.classList.add('eshell-active');

    this.root = document.createElement('div');
    this.root.className = 'eshell';
    this.root.id = 'eshell-root';

    this.root.appendChild(this._buildMenu());
    this.panels.hierarchy = this._buildPanel('hierarchy', 'Hierarchy');
    this.panels.viewport = this._buildViewport();
    this.panels.inspector = this._buildPanel('inspector', 'Inspector');
    this.panels.assets = this._buildPanel('assets', 'Project · Assets');
    this.panels.preview = this._buildPreviewPanel();
    this.root.appendChild(this.panels.hierarchy);
    this.root.appendChild(this.panels.viewport);
    this.root.appendChild(this.panels.inspector);
    this.root.appendChild(this.panels.assets);
    this.root.appendChild(this.panels.preview);

    parent.appendChild(this.root);

    this._setupSplitters();
    this._setupShortcuts();
    // Legacy modules dispatch this after mutating the selected object.
    if (!this._updateCurrentWired) {
      this._updateCurrentWired = true;
      document.body.addEventListener('updateCurrentObject', () => {
        if (this.selectedType && this.selectedObjectId) this._renderInspector(this.selectedType, this.selectedObjectId);
      });
    }
    this.renderAssets();
    this._renderInspectorEmpty('Select an asset to inspect.');
    this._renderHierarchyEmpty('No entities yet — drag an asset into the viewport.');
    // Defer viewport start one frame so the grid layout has real pixel sizes.
    requestAnimationFrame(() => this._startViewport());
    return this;
  }

  // ---- Keyboard shortcuts ----------------------------------------------------
  _setupShortcuts() {
    if (this._onKeyDown) return;
    this._onKeyDown = (e) => {
      // Ctrl/Cmd+S always saves, even from a field.
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); this._save(); return; }
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      const vp = this.viewport;
      switch (e.key) {
        case 'w': case 'W': if (vp) vp.setGizmoMode('translate'); break;
        case 'e': case 'E': if (vp) vp.setGizmoMode('rotate'); break;
        case 'r': case 'R': if (vp) vp.setGizmoMode('scale'); break;
        case 'Delete': case 'Backspace':
          if (vp && vp.getSelectedEntity && vp.getSelectedEntity() != null) { e.preventDefault(); vp.removeSelected(); }
          break;
        case 'Escape': if (vp) { if (vp.clearPreview) vp.clearPreview(); if (vp.deselectAll) vp.deselectAll(); } break;
        default: break;
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  /** Re-render data panels and restart the viewport for a (re)loaded project. */
  refresh() {
    this._levelChoice = null;   // per-project level memory is read from localStorage
    this.renderAssets();
    this._restartViewport();
  }

  // ---- Viewport (always-on 3D world) -----------------------------------------
  _startViewport() {
    const Svc = (typeof window !== 'undefined') && (window.EditorViewportService || (window.GUTS && window.GUTS.EditorViewportService));
    if (!Svc || !this.controller) return; // skipped in standalone preview (no bundle)
    const body = this._body('viewport');
    if (!body) return;
    try {
      this.viewport = new Svc(this.controller, body, this._viewportOptions());
      this.viewport.previewCanvas = this._previewCanvasEl;
      this.viewport.previewWindow = this._previewWindowEl;
      this.viewport.onRenderOptions = (opts, cur) => this._renderPreviewSelector(opts, cur);
      // Scene entity <-> hierarchy <-> inspector sync.
      this.viewport.onSelectionChange = (id, rec) => this._onEntitySelected(id, rec);
      this.viewport.onSceneChange = () => this._renderHierarchy();
      this.viewport.onTeamsChange = () => { if (this._renderTeamRows) this._renderTeamRows(); };
      const started = this.viewport.start();
      Promise.resolve(started).then((ok) => {
        this._populateLevelSelect();
        if (ok === false) return;
        // Entities spawn a few ticks after scene load; refresh the hierarchy a couple times.
        this._renderHierarchy();
        setTimeout(() => this._renderHierarchy(), 800);
        setTimeout(() => this._renderHierarchy(), 2500);
      });
    } catch (e) { console.error('[EditorShell] viewport start failed:', e); }
  }
  _restartViewport() {
    try { if (this.viewport && this.viewport.stop) this.viewport.stop(); } catch (e) {}
    this.viewport = null;
    requestAnimationFrame(() => this._startViewport());
  }
  _viewportOptions() {
    try {
      const cfg = (this.model.getCollections().configs || {}).editor || {};
      const levels = this.model.getCollections().levels || {};
      // Level priority: explicit user choice > remembered per project > config.
      let lvl = this._levelChoice;
      if (!lvl) {
        try { lvl = localStorage.getItem('guts-editor-level-' + (this.controller.getCurrentProject ? this.controller.getCurrentProject() : '')); } catch (e) {}
      }
      if (lvl && !levels[lvl]) lvl = null;     // stale choice — level no longer exists
      return { scene: cfg.viewportScene, level: lvl || cfg.viewportLevel };
    } catch (e) { return {}; }
  }

  _onLevelChange(name) {
    this._levelChoice = name;
    try { localStorage.setItem('guts-editor-level-' + (this.controller.getCurrentProject ? this.controller.getCurrentProject() : ''), name); } catch (e) {}
    this._restartViewport();
  }

  _populateLevelSelect() {
    const sel = this._levelSelect;
    if (!sel) return;
    const levels = this._collections().levels || {};
    const current = (this.viewport && this.viewport.levelName) || this._levelChoice || '';
    sel.innerHTML = '';
    const ids = Object.keys(levels).sort();
    if (!ids.length) { const o = document.createElement('option'); o.textContent = '(no levels)'; sel.appendChild(o); sel.disabled = true; return; }
    sel.disabled = false;
    ids.forEach(id => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = this._title(levels[id], id);
      if (id === current) o.selected = true;
      sel.appendChild(o);
    });
  }

  // Docked bottom-right Preview panel (mini renderer driven by the viewport) with a
  // render-type selector in the header to switch between rendering pipelines.
  _buildPreviewPanel() {
    const panel = this._buildPanel('preview', 'Preview');
    const header = panel.querySelector('.eshell__panel-header');
    const sel = document.createElement('div');
    sel.className = 'eshell__preview-select'; sel.id = 'eshell-preview-select';
    header.appendChild(sel);
    this._previewSelectEl = sel;
    const body = panel.querySelector('.eshell__panel-body');
    body.style.padding = '0';
    const canvas = document.createElement('canvas');
    canvas.className = 'eshell__preview-canvas';
    const empty = document.createElement('div');
    empty.className = 'eshell__preview-empty';
    empty.textContent = 'Select a model asset to preview';
    body.append(canvas, empty);
    this._previewCanvasEl = canvas;
    this._previewWindowEl = body;   // toggled via .has-model
    return panel;
  }
  _renderPreviewSelector(opts, currentId) {
    const sel = this._previewSelectEl; if (!sel) return;
    sel.innerHTML = '';
    if (!opts || !opts.length) return;
    opts.forEach(o => {
      const b = document.createElement('button');
      b.className = 'eshell__preview-tab' + (o.id === currentId ? ' eshell__preview-tab--active' : '');
      b.textContent = o.label || o.pipeline || o.id;
      b.addEventListener('click', () => { if (this.viewport && this.viewport.selectRenderType) this.viewport.selectRenderType(o.id); });
      sel.appendChild(b);
    });
  }

  // ---- Scene hierarchy (Phase 4) ---------------------------------------------
  _renderHierarchy() {
    const body = this._body('hierarchy');
    if (!body) return;
    const entities = (this.viewport && this.viewport.getSceneEntities && this.viewport.getSceneEntities()) || [];
    body.innerHTML = '';
    if (!entities.length) { this._empty(body, 'No entities yet — drag an asset into the viewport to place one.'); return; }
    if (!this._collapsedHierarchy) this._collapsedHierarchy = new Set();
    const groups = {};
    entities.forEach(e => { (groups[e.collection] = groups[e.collection] || []).push(e); });
    const sel = this.viewport && this.viewport.getSelectedEntity && this.viewport.getSelectedEntity();
    Object.keys(groups).sort().forEach(col => {
      const collapsed = this._collapsedHierarchy.has(col);
      const title = document.createElement('div');
      title.className = 'eshell__group-title eshell__group-title--toggle';
      title.textContent = `${collapsed ? '▸' : '▾'} ${col} (${groups[col].length})`;
      title.addEventListener('click', () => {
        if (this._collapsedHierarchy.has(col)) this._collapsedHierarchy.delete(col);
        else this._collapsedHierarchy.add(col);
        this._renderHierarchy();
      });
      body.appendChild(title);
      if (collapsed) return;
      groups[col].sort((a, b) => String(a.spawnType).localeCompare(String(b.spawnType))).forEach(e => {
        const row = document.createElement('div');
        row.className = 'eshell__row' + (e.id === sel ? ' eshell__row--active' : '');
        row.dataset.eid = e.id;
        const pos = e.position ? `<span class="eshell__row-count">${Math.round(e.position.x)}, ${Math.round(e.position.z)}</span>` : '';
        row.innerHTML = `<span>${e.spawnType}</span>${pos}`;
        row.addEventListener('click', () => { if (this.viewport) this.viewport.selectEntity(e.id); });
        body.appendChild(row);
      });
    });
  }

  _onEntitySelected(id, rec) {
    if (this.viewport && this.viewport.clearPreview) this.viewport.clearPreview();  // scene entity, not an asset
    // Auto-expand the selected entity's group so its row is visible.
    if (rec && rec.collection && this._collapsedHierarchy && this._collapsedHierarchy.has(rec.collection)) {
      this._collapsedHierarchy.delete(rec.collection);
      this._renderHierarchy();
    }
    const body = this._body('hierarchy');
    if (body) body.querySelectorAll('.eshell__row').forEach(r => r.classList.toggle('eshell__row--active', Number(r.dataset.eid) === id));
    if (id == null) { this._renderInspectorEmpty('Select an asset or entity to inspect.'); return; }
    this._renderEntityInspector(id, rec);
  }

  _renderEntityInspector(id, rec) {
    const body = this._body('inspector');
    body.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'eshell__insp-head';
    head.innerHTML = `<span class="eshell__insp-type">${rec ? rec.collection : 'entity'}</span><span class="eshell__insp-id">${rec ? rec.spawnType : ('#' + id)}</span>`;
    body.appendChild(head);
    const t = (this.viewport && this.viewport.getEntityTransform && this.viewport.getEntityTransform(id)) || {};
    const fmt = (v) => v ? `${(+v.x || 0).toFixed(1)}, ${(+v.y || 0).toFixed(1)}, ${(+v.z || 0).toFixed(1)}` : '—';
    [['Position', t.position], ['Rotation', t.rotation], ['Scale', t.scale]].forEach(([label, v]) => {
      const row = document.createElement('div'); row.className = 'eshell__row';
      row.innerHTML = `<span>${label}</span><span class="eshell__row-count">${fmt(v)}</span>`;
      body.appendChild(row);
    });
    const hint = document.createElement('div'); hint.className = 'eshell__empty';
    hint.textContent = 'Transform with the viewport gizmo (Move/Rotate/Scale · right-drag).';
    body.appendChild(hint);
    const bar = document.createElement('div'); bar.className = 'eshell__insp-actions';
    bar.appendChild(this._miniBtn('Remove Entity', () => { if (this.viewport) this.viewport.removeSelected(); }, 'danger'));
    body.appendChild(bar);
  }

  // ---- Terrain tools overlay (Phase 5) ---------------------------------------
  _toggleTerrainTools() {
    if (!this.viewport) return;
    const existing = this.root.querySelector('#eshell-terrain-tools');
    if (existing) { existing.remove(); this.viewport.setInteractionMode('select'); return; }
    const host = this._body('viewport');
    if (host) host.appendChild(this._buildTerrainTools());
  }
  _buildTerrainTools() {
    const ov = document.createElement('div');
    ov.className = 'eshell__terrain-tools'; ov.id = 'eshell-terrain-tools';
    const state = { mode: 'terrain', tool: 'brush', brush: 1, height: 1, terrainId: 0, team: null };
    const apply = () => {
      this.viewport.setInteractionMode(state.mode);
      this.viewport.setPaintOptions({ terrainId: state.terrainId, heightLevel: state.height, brushSize: state.brush, tool: state.tool });
    };
    // Show only the controls relevant to the active mode.
    const updateVis = () => {
      const paint = state.mode === 'terrain' || state.mode === 'height';
      if (this._ttToolGroup) this._ttToolGroup.style.display = paint ? '' : 'none';
      if (this._ttBrushGroup) this._ttBrushGroup.style.display = paint ? '' : 'none';
      if (this._ttPaletteGroup) this._ttPaletteGroup.style.display = (state.mode === 'terrain') ? '' : 'none';
      if (this._ttHeightGroup) this._ttHeightGroup.style.display = (state.mode === 'height') ? '' : 'none';
      if (this._ttTeamsGroup) this._ttTeamsGroup.style.display = (state.mode === 'teams') ? '' : 'none';
    };

    const head = document.createElement('div'); head.className = 'eshell__tt-head';
    const title = document.createElement('span'); title.textContent = 'Terrain'; head.appendChild(title);
    const close = document.createElement('span'); close.className = 'eshell__tab-close'; close.textContent = '×';
    close.addEventListener('click', () => this._toggleTerrainTools());
    head.appendChild(close);
    ov.appendChild(head);

    const modeRow = document.createElement('div'); modeRow.className = 'eshell__tt-row';
    [['Select', 'select'], ['Paint', 'terrain'], ['Height', 'height'], ['Ramp', 'ramp'], ['Teams', 'teams']].forEach(([label, m]) => {
      const b = this._miniBtn(label, () => { state.mode = m; modeRow.querySelectorAll('.eshell__btn').forEach(x => x.classList.toggle('eshell__btn--primary', x === b)); apply(); updateVis(); });
      if (m === state.mode) b.classList.add('eshell__btn--primary');
      modeRow.appendChild(b);
    });
    ov.appendChild(this._ttGroup('Mode', modeRow));

    const toolRow = document.createElement('div'); toolRow.className = 'eshell__tt-row';
    [['Brush', 'brush'], ['Fill', 'fill']].forEach(([label, t]) => {
      const b = this._miniBtn(label, () => { state.tool = t; toolRow.querySelectorAll('.eshell__btn').forEach(x => x.classList.toggle('eshell__btn--primary', x === b)); apply(); });
      if (t === state.tool) b.classList.add('eshell__btn--primary');
      toolRow.appendChild(b);
    });
    this._ttToolGroup = this._ttGroup('Tool', toolRow);
    ov.appendChild(this._ttToolGroup);

    const brushRow = document.createElement('div'); brushRow.className = 'eshell__tt-row';
    const brush = document.createElement('input'); brush.type = 'range'; brush.min = '1'; brush.max = '9'; brush.step = '1'; brush.value = '1'; brush.className = 'eshell__tt-range';
    const brushVal = document.createElement('span'); brushVal.className = 'eshell__row-count'; brushVal.textContent = '1';
    brush.addEventListener('input', () => { state.brush = +brush.value; brushVal.textContent = brush.value; apply(); });
    brushRow.append(brush, brushVal);
    this._ttBrushGroup = this._ttGroup('Brush size', brushRow);
    ov.appendChild(this._ttBrushGroup);

    const hgt = document.createElement('input'); hgt.type = 'number'; hgt.min = '0'; hgt.max = '20'; hgt.value = '1'; hgt.className = 'eshell__insp-input';
    hgt.addEventListener('input', () => { state.height = +hgt.value; apply(); });
    this._ttHeightGroup = this._ttGroup('Height level', hgt);
    ov.appendChild(this._ttHeightGroup);

    const pal = document.createElement('div'); pal.className = 'eshell__tt-palette';
    const renderPal = () => {
      pal.innerHTML = '';
      const types = this.viewport.getTerrainTypes ? this.viewport.getTerrainTypes() : [];
      if (!types.length) { const e = document.createElement('div'); e.className = 'eshell__empty'; e.textContent = 'No terrain types'; pal.appendChild(e); return; }
      types.forEach(t => {
        const sw = document.createElement('div');
        sw.className = 'eshell__tt-swatch' + (t.index === state.terrainId ? ' eshell__tt-swatch--active' : '');
        sw.style.background = t.color; sw.title = `${t.name} [${t.index}]`;
        sw.addEventListener('click', () => { state.terrainId = t.index; renderPal(); apply(); });
        pal.appendChild(sw);
      });
    };
    renderPal();
    this._ttPaletteGroup = this._ttGroup('Terrain', pal);
    ov.appendChild(this._ttPaletteGroup);

    // Teams: pick a team, click the terrain to set its start location.
    // (Teams themselves are the team enum — add/remove them via the Inspector.)
    const teamsWrap = document.createElement('div');
    teamsWrap.className = 'eshell__tt-teams';
    const renderTeams = () => {
      teamsWrap.innerHTML = '';
      const teams = (this.viewport && this.viewport.getTeams) ? this.viewport.getTeams() : [];
      if (!teams.length) { const e = document.createElement('div'); e.className = 'eshell__empty'; e.textContent = 'No team enum in project'; teamsWrap.appendChild(e); return; }
      teams.forEach(t => {
        const row = document.createElement('div');
        row.className = 'eshell__tt-team' + (t.team === state.team ? ' eshell__tt-team--active' : '');
        const chip = document.createElement('span');
        chip.className = 'eshell__tt-team-chip';
        chip.style.background = t.color;
        const name = document.createElement('span');
        name.className = 'eshell__tt-team-name';
        name.textContent = t.team;
        const loc = document.createElement('span');
        loc.className = 'eshell__row-count';
        loc.textContent = t.location ? `${t.location.gridX}, ${t.location.gridZ}` : '—';
        row.append(chip, name, loc);
        if (t.location) {
          const clear = document.createElement('button');
          clear.className = 'eshell__insp-del';
          clear.textContent = '×';
          clear.title = 'Clear start location';
          clear.addEventListener('click', (e) => { e.stopPropagation(); this.viewport.clearStartLocation(t.team); });
          row.appendChild(clear);
        }
        row.addEventListener('click', () => {
          state.team = t.team;
          this.viewport.setActiveTeam(t.team);
          renderTeams();
        });
        teamsWrap.appendChild(row);
      });
      const hint = document.createElement('div');
      hint.className = 'eshell__hint-line';
      hint.textContent = state.team ? `Click the terrain to set ${state.team}'s start location.` : 'Select a team, then click the terrain.';
      teamsWrap.appendChild(hint);
    };
    renderTeams();
    this._renderTeamRows = renderTeams;   // survives viewport restarts (rewired in _startViewport)
    if (this.viewport) this.viewport.onTeamsChange = () => renderTeams();
    this._ttTeamsGroup = this._ttGroup('Start locations', teamsWrap);
    ov.appendChild(this._ttTeamsGroup);

    updateVis();
    apply();
    return ov;
  }
  _ttGroup(title, contentEl) {
    const g = document.createElement('div'); g.className = 'eshell__tt-group';
    const t = document.createElement('div'); t.className = 'eshell__group-title'; t.textContent = title;
    g.append(t, contentEl);
    return g;
  }

  // ---- Menu bar --------------------------------------------------------------
  _buildMenu() {
    const menu = document.createElement('div');
    menu.className = 'eshell__panel eshell__panel--menu';

    const brand = document.createElement('div');
    brand.className = 'eshell__brand';
    brand.innerHTML = '<span class="eshell__brand-dot"></span><span>GUTS Editor</span>';
    menu.appendChild(brand);

    // Project selector
    const projGroup = document.createElement('div');
    projGroup.className = 'eshell__menu-group';
    const projSel = document.createElement('select');
    projSel.className = 'eshell__select';
    projSel.id = 'eshell-project-selector';
    this._fillProjects(projSel);
    projSel.addEventListener('change', () => this._onProjectChange(projSel.value));
    projGroup.appendChild(projSel);
    menu.appendChild(projGroup);

    const spacer = document.createElement('div');
    spacer.className = 'eshell__menu-spacer';
    menu.appendChild(spacer);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'eshell__menu-group';
    actions.appendChild(this._btn('Save', () => this._save(), false));
    actions.appendChild(this._btn('Launch', () => this._launch(), false));
    actions.appendChild(this._btn('▶ Play', () => this._togglePlay(), true));
    menu.appendChild(actions);

    return menu;
  }

  _btn(label, onClick, primary) {
    const b = document.createElement('button');
    b.className = 'eshell__btn' + (primary ? ' eshell__btn--primary' : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---- Generic panel ---------------------------------------------------------
  _buildPanel(area, title) {
    const panel = document.createElement('div');
    panel.className = `eshell__panel eshell__panel--${area}`;
    const header = document.createElement('div');
    header.className = 'eshell__panel-header';
    header.textContent = title;
    const body = document.createElement('div');
    body.className = 'eshell__panel-body';
    body.dataset.body = area;
    panel.appendChild(header);
    panel.appendChild(body);
    return panel;
  }

  // Center panel = tabbed area: a persistent "Scene" tab (the 3D viewport) plus
  // on-demand tool tabs (Script editor, etc.) opened from the Inspector.
  _buildViewport() {
    const panel = document.createElement('div');
    panel.className = 'eshell__panel eshell__panel--viewport';

    const tabbar = document.createElement('div');
    tabbar.className = 'eshell__tabs'; tabbar.id = 'eshell-tabs';
    panel.appendChild(tabbar);

    const content = document.createElement('div');
    content.className = 'eshell__tab-content'; content.id = 'eshell-tab-content';
    panel.appendChild(content);

    // Scene pane
    const pane = document.createElement('div');
    pane.className = 'eshell__tab-pane';
    const toolbar = document.createElement('div');
    toolbar.className = 'eshell__vp-toolbar';
    // Level selector — makes it explicit WHICH level the viewport is editing.
    const lvlWrap = document.createElement('span');
    lvlWrap.className = 'eshell__vp-level';
    const lvlLabel = document.createElement('span');
    lvlLabel.className = 'eshell__vp-level-label';
    lvlLabel.textContent = 'Level';
    this._levelSelect = document.createElement('select');
    this._levelSelect.className = 'eshell__select';
    this._levelSelect.addEventListener('change', () => this._onLevelChange(this._levelSelect.value));
    lvlWrap.append(lvlLabel, this._levelSelect);
    toolbar.appendChild(lvlWrap);
    const sepL = document.createElement('span'); sepL.className = 'eshell__vp-sep'; toolbar.appendChild(sepL);
    const camBtns = {};
    [['Game', 'game'], ['Scene', 'scene']].forEach(([label, mode]) => {
      const b = this._miniBtn(label, () => {
        if (this.viewport) this.viewport.setCameraMode(mode);
        Object.keys(camBtns).forEach(m => camBtns[m].classList.toggle('eshell__btn--primary', m === mode));
      });
      if (mode === 'game') b.classList.add('eshell__btn--primary');   // controller defaults to game mode
      camBtns[mode] = b;
      toolbar.appendChild(b);
    });
    const sep = document.createElement('span'); sep.className = 'eshell__vp-sep'; toolbar.appendChild(sep);
    [['Move', 'translate'], ['Rotate', 'rotate'], ['Scale', 'scale']].forEach(([label, mode]) =>
      toolbar.appendChild(this._miniBtn(label, () => { if (this.viewport) this.viewport.setGizmoMode(mode); })));
    toolbar.appendChild(this._miniBtn('Delete', () => { if (this.viewport) this.viewport.removeSelected(); }, 'danger'));
    const sep2 = document.createElement('span'); sep2.className = 'eshell__vp-sep'; toolbar.appendChild(sep2);
    toolbar.appendChild(this._miniBtn('Terrain', () => this._toggleTerrainTools()));
    pane.appendChild(toolbar);

    const host = document.createElement('div');
    host.className = 'eshell__viewport-host';
    host.dataset.body = 'viewport';           // viewport service + _body('viewport') target this
    const ph = document.createElement('div');
    ph.className = 'eshell__viewport-placeholder'; ph.id = 'eshell-viewport-placeholder';
    ph.innerHTML = '<h2>3D Viewport</h2><p>always-on scene view</p>';
    host.appendChild(ph);
    pane.appendChild(host);
    content.appendChild(pane);

    this._activeTab = 'scene';
    this._tabs = { scene: { content: pane, btn: this._addTabButton('scene', 'Scene', false, tabbar) } };
    return panel;
  }

  // ---- Center tabs -----------------------------------------------------------
  _addTabButton(id, title, closable, barEl) {
    const host = barEl || (this.root && this.root.querySelector('#eshell-tabs')) || document.querySelector('#eshell-tabs');
    const btn = document.createElement('div');
    btn.className = 'eshell__tab' + (id === this._activeTab ? ' eshell__tab--active' : '');
    btn.dataset.tab = id;
    const label = document.createElement('span'); label.textContent = title; btn.appendChild(label);
    btn.addEventListener('click', () => this.switchTab(id));
    if (closable) {
      const x = document.createElement('span'); x.className = 'eshell__tab-close'; x.textContent = '×';
      x.addEventListener('click', (e) => { e.stopPropagation(); this.closeTab(id); });
      btn.appendChild(x);
    }
    if (host) host.appendChild(btn);
    return btn;
  }
  openTab(id, title, buildFn) {
    if (this._tabs[id]) { this.switchTab(id); return this._tabs[id]; }
    const content = this.root.querySelector('#eshell-tab-content');
    const pane = document.createElement('div');
    pane.className = 'eshell__tab-pane';
    content.appendChild(pane);
    const btn = this._addTabButton(id, title, true);
    const tab = { content: pane, btn };
    this._tabs[id] = tab;
    try { buildFn(pane, tab); } catch (e) { console.error('[EditorShell] openTab build failed:', e); }
    this.switchTab(id);
    return tab;
  }
  switchTab(id) {
    if (!this._tabs[id]) return;
    this._activeTab = id;
    Object.keys(this._tabs).forEach(k => {
      const t = this._tabs[k];
      t.content.classList.toggle('eshell__tab-pane--hidden', k !== id);
      t.btn.classList.toggle('eshell__tab--active', k === id);
    });
    if (id === 'scene' && this.viewport && this.viewport.onResize) setTimeout(() => this.viewport.onResize(), 0);
    // Nudge embedded editors (Monaco / GE canvas) to relayout now that the pane is visible.
    setTimeout(() => { try { window.dispatchEvent(new Event('resize')); document.body.dispatchEvent(new CustomEvent('resizedEditor')); } catch (e) {} }, 0);
  }
  closeTab(id) {
    const t = this._tabs[id];
    if (!t || id === 'scene') return;
    if (typeof t.dispose === 'function') { try { t.dispose(); } catch (e) {} }
    t.content.remove(); t.btn.remove();
    delete this._tabs[id];
    if (this._activeTab === id) this.switchTab('scene');
  }

  // ---- Legacy editor-module hosting (full-featured tools in a center tab) -----
  // Re-hosts an editorModule (e.g. graphicsModule) exactly as the legacy chrome
  // did: inject its interface html/css + declared modals, instantiate its
  // Editor/Module classes once (they self-wire to their hooks), then drive it via
  // loadHook/saveHook/unloadHook CustomEvents. Preserves all module functionality.
  _openModuleEditor(moduleId, type, id) {
    const cols = this._collections();
    const mod = (cols.editorModules || {})[moduleId];
    if (!mod) { this._toast(moduleId + ' not found in this project'); return; }
    const obj = (cols[type] || {})[id];
    const prop = mod.propertyName;
    if (!obj || !prop || obj[prop] == null) { this._toast('No ' + (prop || 'data') + ' on this asset'); return; }

    // Select in the model so the module's saveHook updates the right object.
    this.model.setSelectedType(type); this.model.selectObject(id);

    // The module's own canvas takes over as the preview — clear the docked
    // corner preview (and any placement ghost) so the model isn't shown twice
    // (e.g. idle looping in the Preview panel while an animation plays here).
    if (this.viewport && this.viewport.clearPreview) this.viewport.clearPreview();

    const tabId = 'module:' + moduleId;
    const title = `${id} ⟨${prop}⟩`;
    if (!this._tabs[tabId]) {
      this.openTab(tabId, title, (pane, tab) => this._buildModulePane(pane, tab, mod));
    } else {
      const label = this._tabs[tabId].btn.querySelector('span');
      if (label) label.textContent = title;
      this.switchTab(tabId);
    }
    // Load the object into the module on the next frame (DOM/instances settled).
    requestAnimationFrame(() => {
      try {
        document.body.dispatchEvent(new CustomEvent(mod.loadHook, {
          detail: { data: obj[prop], propertyName: prop, objectData: obj, config: mod }
        }));
      } catch (e) { console.error('[EditorShell] module loadHook failed:', e); }
    });
  }

  _buildModulePane(pane, tab, mod) {
    pane.classList.add('eshell__module-pane');
    const cols = this._collections();
    const iface = (cols.interfaces || {})[mod.interface] || {};
    if (!iface.html) { this._empty(pane, `Interface '${mod.interface}' not found.`); return; }

    // Interface CSS (once per interface).
    if (iface.css && !document.getElementById('eshell-ifacecss-' + mod.interface)) {
      const st = document.createElement('style');
      st.id = 'eshell-ifacecss-' + mod.interface;
      st.textContent = iface.css;
      document.head.appendChild(st);
    }
    pane.innerHTML = iface.html;

    // Declared modals -> #modals, legacy structure (#modal-<id> > .modal-content).
    const modalHost = document.getElementById('modals');
    (iface.modals || mod.modals || []).forEach(modalId => {
      if (!modalHost || document.getElementById('modal-' + modalId)) return;
      const m = (cols.modals || {})[modalId];
      if (!m || !m.html) { console.warn('[EditorShell] modal not found:', modalId); return; }
      const modal = document.createElement('div');
      modal.id = 'modal-' + modalId;
      modal.className = 'modal';
      const content = document.createElement('div');
      content.className = 'modal-content';
      content.innerHTML = m.html;
      modal.appendChild(content);
      modalHost.appendChild(modal);
    });

    // Instantiate the module's Editor/Module classes once (constructor signature
    // matches the legacy chrome: (controller, moduleDef, GUTS)).
    this._moduleInstances = this._moduleInstances || {};
    const libs = mod.library ? [mod.library]
      : (mod.libraries || []).filter(l => l.endsWith('Editor') || l.endsWith('Module'));
    libs.forEach(name => {
      if (this._moduleInstances[name]) return;
      const Cls = window.GUTS && window.GUTS[name];
      if (!Cls) { console.warn('[EditorShell] module library not in bundle:', name); return; }
      try { this._moduleInstances[name] = new Cls(this.controller, mod, window.GUTS); }
      catch (e) { console.error('[EditorShell] failed to instantiate', name, e); }
    });

    // Save wiring: module dispatches saveHook with {propertyName, data}.
    this._wiredSaveHooks = this._wiredSaveHooks || {};
    if (mod.saveHook && !this._wiredSaveHooks[mod.saveHook]) {
      this._wiredSaveHooks[mod.saveHook] = true;
      document.body.addEventListener(mod.saveHook, (ev) => {
        const d = ev.detail || {};
        const prop = d.propertyName || mod.propertyName;
        if (!prop) return;
        this.controller.updateObject({ [prop]: d.data });
        this._persistCurrent();
        this._toast('Saved ' + prop);
        if (this.selectedType && this.selectedObjectId) this._renderInspector(this.selectedType, this.selectedObjectId);
      });
    }

    tab.dispose = () => {
      try { if (mod.unloadHook) document.body.dispatchEvent(new CustomEvent(mod.unloadHook, { detail: {} })); } catch (e) {}
    };
  }

  // ---- Sub-editor: Behavior graph (Unity-style node view) --------------------
  _openBehaviorGraph(type, id) {
    const Graph = window.EditorBehaviorGraph || (window.GUTS && window.GUTS.EditorBehaviorGraph);
    if (!Graph) { this._toast('Behavior graph editor not in bundle'); return; }
    this.openTab('btgraph:' + id, id + ' ⟨tree⟩', (pane, tab) => {
      const g = new Graph(this, pane, type, id);
      g.build();
      tab.dispose = () => g.dispose();
    });
  }

  // ---- Sub-editor: Script / markup / style (Monaco) --------------------------
  _openScriptEditor(type, id) {
    const obj = (this._collections()[type] || {})[id];
    if (!obj) return;
    const MAP = [['script', 'javascript'], ['html', 'html'], ['css', 'css'], ['testScript', 'javascript']];
    const props = MAP.filter(([k]) => typeof obj[k] === 'string');
    if (!props.length) { this._toast('No code on this asset'); return; }
    this.openTab('script:' + type + '/' + id, id + ' ⟨code⟩', (pane, tab) => this._buildScriptEditor(pane, tab, type, id, props));
  }
  _buildScriptEditor(pane, tab, type, id, props) {
    pane.classList.add('eshell__script-pane');
    const bar = document.createElement('div'); bar.className = 'eshell__script-bar';
    const body = document.createElement('div'); body.className = 'eshell__script-body';
    const host = document.createElement('div'); host.className = 'eshell__script-editor';
    body.appendChild(host);
    pane.append(bar, body);
    const monaco = window.monaco;
    if (!monaco) { host.innerHTML = '<div class="eshell__empty">Monaco editor not available in this build.</div>'; return; }

    const obj = (this._collections()[type] || {})[id];
    const state = { models: {}, current: null };
    const editor = monaco.editor.create(host, {
      theme: 'vs-dark', automaticLayout: true, fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false
    });

    // Live preview (interfaces: html + css). Sandboxed iframe, no scripts;
    // <base> points at the project so relative resource paths resolve.
    const hasMarkup = props.some(([p]) => p === 'html' || p === 'css');
    let preview = null, previewTimer = null;
    const currentValue = (prop) => state.models[prop] ? state.models[prop].getValue() : (obj[prop] || '');
    const renderPreview = () => {
      if (!preview || preview.style.display === 'none') return;
      const project = this.controller.getCurrentProject ? this.controller.getCurrentProject() : '';
      const css = props.some(([p]) => p === 'css') ? currentValue('css') : '';
      const html = props.some(([p]) => p === 'html') ? currentValue('html') : '';
      preview.querySelector('iframe').srcdoc =
        `<!DOCTYPE html><html><head><base href="/projects/${project}/">` +
        `<style>html,body{margin:0;min-height:100%;background:#10141c;color:#e7eef7;font-family:system-ui,sans-serif;}</style>` +
        `<style>${css}</style></head><body>${html}</body></html>`;
    };
    const schedulePreview = () => {
      if (!preview) return;
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 350);
    };
    if (hasMarkup) {
      preview = document.createElement('div');
      preview.className = 'eshell__script-preview';
      const phead = document.createElement('div');
      phead.className = 'eshell__script-preview-head';
      phead.textContent = 'Live preview';
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-same-origin');   // styles + images, no scripts
      preview.append(phead, iframe);
      body.appendChild(preview);
      editor.onDidChangeModelContent(() => schedulePreview());
    }

    const select = (prop, lang) => {
      if (!state.models[prop]) state.models[prop] = monaco.editor.createModel(obj[prop] || '', lang);
      editor.setModel(state.models[prop]); state.current = prop;
      bar.querySelectorAll('[data-prop]').forEach(b => b.classList.toggle('eshell__btn--primary', b.dataset.prop === prop));
    };
    props.forEach(([prop, lang]) => { const b = this._miniBtn(prop, () => select(prop, lang)); b.dataset.prop = prop; bar.appendChild(b); });
    const spacer = document.createElement('span'); spacer.style.flex = '1'; bar.appendChild(spacer);
    if (hasMarkup) {
      const previewBtn = this._miniBtn('◧ Preview', () => {
        const off = preview.style.display === 'none';
        preview.style.display = off ? '' : 'none';
        previewBtn.classList.toggle('eshell__btn--primary', off);
        if (off) renderPreview();
      });
      previewBtn.classList.add('eshell__btn--primary');
      bar.appendChild(previewBtn);
    }
    const save = this._miniBtn('Save', () => {
      const o = (this._collections()[type] || {})[id];
      props.forEach(([prop]) => { if (state.models[prop]) o[prop] = state.models[prop].getValue(); });
      this.model.setSelectedType(type); this.model.selectObject(id);
      if (this.model.saveObject) this.model.saveObject(o);
      this._persistCurrent();
      this._toast('Saved ' + id);
    });
    save.classList.add('eshell__btn--primary'); bar.appendChild(save);
    select(props[0][0], props[0][1]);
    renderPreview();
    tab.dispose = () => {
      if (previewTimer) clearTimeout(previewTimer);
      try { Object.values(state.models).forEach(m => m.dispose()); editor.dispose(); } catch (e) {}
    };
  }

  _body(area) { return this.root.querySelector(`[data-body="${area}"]`); }

  // ---- Assets browser (collection tree + object grid + CRUD) -----------------
  renderAssets() {
    const body = this._body('assets');
    body.innerHTML = '';
    body.style.padding = '0';

    const toolbar = document.createElement('div');
    toolbar.className = 'eshell__assets-toolbar';
    const crumb = document.createElement('span');
    crumb.className = 'eshell__assets-crumb'; crumb.id = 'eshell-assets-crumb';
    crumb.textContent = this.selectedType || 'Assets';
    const spacer = document.createElement('span'); spacer.style.flex = '1';
    const search = document.createElement('input');
    search.className = 'eshell__assets-search'; search.id = 'eshell-assets-search';
    search.placeholder = 'Search…'; search.value = this._search || '';
    search.addEventListener('input', () => { this._search = search.value; this._renderObjectGrid(); });
    // View toggle: tiles vs list.
    if (!this._assetView) this._assetView = 'tiles';
    const viewWrap = document.createElement('div');
    viewWrap.className = 'eshell__assets-viewtoggle';
    [['⊞', 'tiles', 'Tile view'], ['☰', 'list', 'List view']].forEach(([glyph, mode, tip]) => {
      const b = this._miniBtn(glyph, () => {
        this._assetView = mode;
        viewWrap.querySelectorAll('.eshell__btn').forEach(x => x.classList.toggle('eshell__btn--primary', x.dataset.view === mode));
        this._renderObjectGrid();
      });
      b.dataset.view = mode; b.title = tip;
      if (mode === this._assetView) b.classList.add('eshell__btn--primary');
      viewWrap.appendChild(b);
    });
    toolbar.append(crumb, spacer, search, viewWrap,
      this._miniBtn('+ New', () => this._newObject()),
      this._miniBtn('Duplicate', () => this._duplicateObject()),
      this._miniBtn('Delete', () => this._deleteObject(), 'danger'),
      this._miniBtn('+ Collection', () => this._newCollection()));
    body.appendChild(toolbar);

    // Miller columns (Finder-style): categories | collections | objects.
    const main = document.createElement('div');
    main.className = 'eshell__assets-main';
    main.innerHTML = '<div class="eshell__assets-col" id="eshell-assets-cats"></div>' +
                     '<div class="eshell__assets-col" id="eshell-assets-cols"></div>' +
                     '<div class="eshell__assets-grid" id="eshell-assets-grid"></div>';
    body.appendChild(main);

    // Derive the category from the current collection (e.g. after a refresh).
    if (this.selectedType && !this.selectedCategory) {
      const def = this._collectionDefs().find(d => d.id === this.selectedType);
      this.selectedCategory = (def && def.objectTypeCategory) || null;
    }

    this._renderCollectionTree();
    this._renderObjectGrid();
  }

  // Renders both selector columns (categories, then collections in the selected one).
  _renderCollectionTree() {
    this._renderCategoryColumn();
    this._renderCollectionColumn();
  }

  _categoryGroups() {
    const groups = {};
    this._collectionDefs().forEach(def => {
      const c = def.objectTypeCategory || 'uncategorized';
      (groups[c] = groups[c] || []).push(def);
    });
    return groups;
  }

  _renderCategoryColumn() {
    const pane = this.root.querySelector('#eshell-assets-cats');
    if (!pane) return;
    pane.innerHTML = '';
    const cats = this._categories();
    const groups = this._categoryGroups();
    const keys = Object.keys(groups).sort();
    if (!keys.length) { this._empty(pane, 'No categories.'); return; }
    keys.forEach(catKey => {
      const row = document.createElement('div');
      row.className = 'eshell__row' + (catKey === this.selectedCategory ? ' eshell__row--active' : '');
      row.dataset.cat = catKey;
      row.innerHTML = `<span>${(cats[catKey] && cats[catKey].title) || catKey}</span><span class="eshell__row-count">${groups[catKey].length} ›</span>`;
      row.addEventListener('click', () => this.selectCategory(catKey));
      pane.appendChild(row);
    });
  }

  selectCategory(catKey) {
    this.selectedCategory = catKey;
    this.selectedType = null;          // Finder-like: picking a category resets deeper columns
    this.selectedObjectId = null;
    const crumb = this.root.querySelector('#eshell-assets-crumb');
    if (crumb) crumb.textContent = catKey;
    this._renderCategoryColumn();
    this._renderCollectionColumn();
    this._renderObjectGrid();
  }

  _renderCollectionColumn() {
    const pane = this.root.querySelector('#eshell-assets-cols');
    if (!pane) return;
    pane.innerHTML = '';
    if (!this.selectedCategory) { this._empty(pane, 'Select a category.'); return; }
    const defs = this._categoryGroups()[this.selectedCategory] || [];
    if (!defs.length) { this._empty(pane, 'Empty category.'); return; }
    const collections = this._collections();
    defs.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)).forEach(def => {
      const count = collections[def.id] ? Object.keys(collections[def.id]).length : 0;
      const row = document.createElement('div');
      row.className = 'eshell__row' + (def.id === this.selectedType ? ' eshell__row--active' : '');
      row.dataset.type = def.id;
      row.innerHTML = `<span>${def.name || def.id}</span><span class="eshell__row-count">${count} ›</span>`;
      row.addEventListener('click', () => this.selectCollection(def.id));
      pane.appendChild(row);
    });
  }

  selectCollection(typeId) {
    this.selectedType = typeId;
    this.selectedObjectId = null;
    // Keep the category column in sync (e.g. when called after creating a collection).
    const def = this._collectionDefs().find(d => d.id === typeId);
    const cat = (def && def.objectTypeCategory) || 'uncategorized';
    if (cat !== this.selectedCategory) { this.selectedCategory = cat; this._renderCategoryColumn(); this._renderCollectionColumn(); }
    if (this.model && this.model.setSelectedType) this.model.setSelectedType(typeId);
    const crumb = this.root.querySelector('#eshell-assets-crumb');
    if (crumb) crumb.textContent = `${this.selectedCategory} · ${typeId}`;
    this.root.querySelectorAll('#eshell-assets-cols .eshell__row').forEach(r =>
      r.classList.toggle('eshell__row--active', r.dataset.type === typeId));
    this._renderObjectGrid();
  }

  _renderObjectGrid() {
    const grid = this.root.querySelector('#eshell-assets-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const listView = this._assetView === 'list';
    grid.classList.toggle('eshell__assets-grid--list', listView);
    if (!this.selectedType) { this._empty(grid, 'Select a collection.'); return; }
    const objs = this._collections()[this.selectedType] || {};
    let ids = Object.keys(objs);
    const q = (this._search || '').trim().toLowerCase();
    if (q) ids = ids.filter(id => id.toLowerCase().includes(q) || this._title(objs[id], id).toLowerCase().includes(q));
    if (!ids.length) { this._empty(grid, q ? 'No matches.' : 'Empty collection — use + New.'); return; }
    if (listView) {
      ids.sort((a, b) => this._title(objs[a], a).localeCompare(this._title(objs[b], b))).forEach(id => {
        const title = this._title(objs[id], id);
        const row = document.createElement('div');
        row.className = 'eshell__asset-listrow' + (id === this.selectedObjectId ? ' eshell__asset-listrow--active' : '');
        row.dataset.id = id;
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          const payload = JSON.stringify({ collection: this.selectedType, type: id });
          e.dataTransfer.setData('application/x-guts-asset', payload);
          e.dataTransfer.setData('text/plain', payload);
          e.dataTransfer.effectAllowed = 'copy';
        });
        const iconDiv = document.createElement('div');
        iconDiv.className = 'eshell__asset-listicon';
        const iconUrl = this._assetIconUrl(objs[id]);
        if (iconUrl) {
          const img = document.createElement('img');
          img.className = 'eshell__asset-img'; img.src = iconUrl; img.alt = '';
          img.addEventListener('error', () => { iconDiv.textContent = (title[0] || '?').toUpperCase(); });
          iconDiv.appendChild(img);
        } else iconDiv.textContent = (title[0] || '?').toUpperCase();
        const name = document.createElement('span'); name.className = 'eshell__asset-listname'; name.textContent = title;
        const idSpan = document.createElement('span'); idSpan.className = 'eshell__row-count'; idSpan.textContent = id;
        row.append(iconDiv, name, idSpan);
        row.addEventListener('click', () => this.selectObject(this.selectedType, id));
        grid.appendChild(row);
      });
      return;
    }
    ids.sort((a, b) => this._title(objs[a], a).localeCompare(this._title(objs[b], b))).forEach(id => {
      const card = document.createElement('div');
      card.className = 'eshell__asset' + (id === this.selectedObjectId ? ' eshell__asset--active' : '');
      card.dataset.id = id;
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        const payload = JSON.stringify({ collection: this.selectedType, type: id });
        e.dataTransfer.setData('application/x-guts-asset', payload);
        e.dataTransfer.setData('text/plain', payload);
        e.dataTransfer.effectAllowed = 'copy';
      });
      const title = this._title(objs[id], id);
      const iconDiv = document.createElement('div');
      iconDiv.className = 'eshell__asset-icon';
      const iconUrl = this._assetIconUrl(objs[id]);
      if (iconUrl) {
        const img = document.createElement('img');
        img.className = 'eshell__asset-img'; img.src = iconUrl; img.alt = '';
        img.addEventListener('error', () => { iconDiv.textContent = (title[0] || '?').toUpperCase(); });
        iconDiv.appendChild(img);
      } else {
        iconDiv.textContent = (title[0] || '?').toUpperCase();
      }
      const labelDiv = document.createElement('div');
      labelDiv.className = 'eshell__asset-label'; labelDiv.textContent = title;
      card.append(iconDiv, labelDiv);
      card.addEventListener('click', () => this.selectObject(this.selectedType, id));
      grid.appendChild(card);
    });
  }

  selectObject(typeId, id) {
    this.selectedType = typeId;
    this.selectedObjectId = id;
    // Drive selection through the MODEL only — never controller.selectObject(),
    // which re-renders the legacy view and can spin up a second EditorECSGame.
    if (this.model) {
      if (this.model.setSelectedType) this.model.setSelectedType(typeId);
      if (this.model.selectObject) this.model.selectObject(id);
    }
    this.root.querySelectorAll('#eshell-assets-grid .eshell__asset').forEach(c =>
      c.classList.toggle('eshell__asset--active', c.dataset.id === id));
    this.root.querySelectorAll('#eshell-assets-grid .eshell__asset-listrow').forEach(c =>
      c.classList.toggle('eshell__asset-listrow--active', c.dataset.id === id));
    this._renderInspector(typeId, id);
    // Preview visual assets (render defs / sprites / particles) in the viewport.
    if (this.viewport && this.viewport.previewAsset) this.viewport.previewAsset(typeId, id);
  }

  // ---- Inspector (Phase 3: typed, editable fields) ---------------------------
  _renderInspector(typeId, id) {
    const obj = (this._collections()[typeId] || {})[id];
    const body = this._body('inspector');
    body.innerHTML = '';
    if (!obj) { this._empty(body, 'Select an asset to inspect.'); return; }

    const head = document.createElement('div');
    head.className = 'eshell__insp-head';
    head.innerHTML = `<span class="eshell__insp-type">${typeId}</span><span class="eshell__insp-id">${id}</span>`;
    body.appendChild(head);

    const form = document.createElement('div');
    form.className = 'eshell__insp-form';
    body.appendChild(form);

    this._inspFields = [];
    Object.keys(obj).forEach(k => form.appendChild(this._inspField(typeId, k, obj[k])));

    const add = this._miniBtn('+ Field', () => form.appendChild(this._inspField(typeId, '', '')));
    add.classList.add('eshell__insp-add');
    body.appendChild(add);

    const bar = document.createElement('div');
    bar.className = 'eshell__insp-actions';
    if (['script', 'html', 'css', 'testScript'].some(k => typeof obj[k] === 'string')) {
      bar.appendChild(this._miniBtn('⧉ Script Editor', () => this._openScriptEditor(typeId, id)));
    }
    if (obj.render && typeof obj.render === 'object') {
      bar.appendChild(this._miniBtn('⧉ Graphics Editor', () => this._openModuleEditor('graphicsModule', typeId, id)));
    }
    if (typeof obj.imagePath === 'string') {
      bar.appendChild(this._miniBtn('⧉ Texture Editor', () => this._openModuleEditor('textureEditor', typeId, id)));
    }
    if (['behaviorTrees', 'sequenceBehaviorTrees', 'behaviorActions', 'behaviorDecorators'].includes(typeId)) {
      bar.appendChild(this._miniBtn('⧉ Behavior Graph', () => this._openBehaviorGraph(typeId, id)));
    }
    const save = this._miniBtn('Save', () => this._saveInspector(typeId, id));
    save.classList.add('eshell__btn--primary');
    bar.append(this._miniBtn('Revert', () => this._renderInspector(typeId, id)), save);
    body.appendChild(bar);
  }

  _inspField(type, key, value) {
    const row = document.createElement('div');
    row.className = 'eshell__insp-field';

    const keyInput = document.createElement('input');
    keyInput.className = 'eshell__insp-key';
    keyInput.value = key; keyInput.placeholder = 'field';

    const kind = this._fieldKind(type, key, value);
    const widget = this._inspWidget(type, key, value, kind);
    if (kind === 'code' || kind === 'json' || kind === 'text' || kind === 'refarray') row.classList.add('eshell__insp-field--wide');

    const del = document.createElement('button');
    del.className = 'eshell__insp-del'; del.textContent = '×'; del.title = 'Remove field';
    del.addEventListener('click', () => { row.remove(); this._inspFields = this._inspFields.filter(f => f.row !== row); });

    row.append(keyInput, widget.el, del);
    this._inspFields.push({ row, read: () => { const k = keyInput.value.trim(); return k ? [k, widget.read()] : null; } });
    return row;
  }

  _fieldKind(type, key, value) {
    const CODE = ['script', 'html', 'css', 'testScript'];
    if (CODE.includes(key)) return 'code';
    if (typeof value === 'boolean') return 'bool';
    if (typeof value === 'number') return 'number';
    if (Array.isArray(value) && this._referenceCollection(key)) return 'refarray'; // list of references
    if (value && typeof value === 'object') return 'json';       // array or object
    if (/color$/i.test(key) || (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value))) return 'color';
    if (this._referenceCollection(key)) return 'ref';
    if (typeof value === 'string' && (value.length > 60 || value.includes('\n'))) return 'text';
    return 'string';
  }

  /**
   * Resolve which collection a field references. Matches the runtime convention
   * (exact, then suffix): a `requiresBuildings` field with no `requiresBuildings`
   * collection maps to the `buildings` collection — its values are building ids.
   * Order: exact plural → exact singular → endsWith plural → endsWith singular
   * (longest suffix wins). Meta collections are excluded.
   */
  _referenceCollection(key) {
    if (!key) return null;
    const EXCLUDE = { objectTypeCategories: 1, objectTypeDefinitions: 1 };
    const cols = this._collections();
    const lk = key.toLowerCase();
    if (cols[key] && !EXCLUDE[key]) return key;                            // exact plural
    const defs = this._collectionDefs();
    const exactSing = defs.find(d => d.singular && d.singular.toLowerCase() === lk);
    if (exactSing && !EXCLUDE[exactSing.id]) return exactSing.id;          // exact singular
    let best = null;
    for (const id of Object.keys(cols)) {                                  // endsWith plural
      if (EXCLUDE[id] || id.length >= key.length) continue;
      if (lk.endsWith(id.toLowerCase()) && (!best || id.length > best.length)) best = id;
    }
    if (best) return best;
    let bestDef = null;
    for (const d of defs) {                                                // endsWith singular
      if (!d.singular || EXCLUDE[d.id] || d.singular.length >= key.length) continue;
      if (lk.endsWith(d.singular.toLowerCase()) && (!bestDef || d.singular.length > bestDef.singular.length)) bestDef = d;
    }
    return bestDef ? bestDef.id : null;
  }

  _inspWidget(type, key, value, kind) {
    if (kind === 'bool') {
      const el = document.createElement('input'); el.type = 'checkbox'; el.className = 'eshell__insp-check'; el.checked = !!value;
      return { el, read: () => el.checked };
    }
    if (kind === 'number') {
      const el = document.createElement('input'); el.type = 'number'; el.className = 'eshell__insp-input'; el.value = value;
      return { el, read: () => { const n = parseFloat(el.value); return el.value === '' || isNaN(n) ? el.value : n; } };
    }
    if (kind === 'color') {
      const wrap = document.createElement('div'); wrap.className = 'eshell__insp-color';
      const pick = document.createElement('input'); pick.type = 'color'; pick.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#35e0c8';
      const hex = document.createElement('input'); hex.type = 'text'; hex.className = 'eshell__insp-input'; hex.value = value || '';
      pick.addEventListener('input', () => { hex.value = pick.value; });
      hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) pick.value = hex.value; });
      wrap.append(pick, hex);
      return { el: wrap, read: () => hex.value };
    }
    if (kind === 'ref') {
      const col = this._referenceCollection(key);
      const el = document.createElement('select'); el.className = 'eshell__insp-input';
      const blank = document.createElement('option'); blank.value = ''; blank.textContent = '—'; el.appendChild(blank);
      const objs = this._collections()[col] || {};
      Object.keys(objs).sort().forEach(oid => {
        const o = document.createElement('option'); o.value = oid; o.textContent = this._title(objs[oid], oid);
        if (oid === value) o.selected = true; el.appendChild(o);
      });
      if (value && !objs[value]) { const o = document.createElement('option'); o.value = value; o.textContent = value + ' (?)'; o.selected = true; el.appendChild(o); }
      return { el, read: () => el.value };
    }
    if (kind === 'refarray') {
      const col = this._referenceCollection(key);
      const options = Object.keys(this._collections()[col] || {}).sort();
      const wrap = document.createElement('div'); wrap.className = 'eshell__insp-refarray';
      const rows = [];
      const addRow = (v) => {
        const row = document.createElement('div'); row.className = 'eshell__insp-refrow';
        const sel = document.createElement('select'); sel.className = 'eshell__insp-input';
        const blank = document.createElement('option'); blank.value = ''; blank.textContent = '—'; sel.appendChild(blank);
        options.forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; if (o === v) op.selected = true; sel.appendChild(op); });
        if (v && !options.includes(v)) { const op = document.createElement('option'); op.value = v; op.textContent = v + ' (?)'; op.selected = true; sel.appendChild(op); }
        const del = document.createElement('button'); del.className = 'eshell__insp-del'; del.textContent = '×';
        const entry = { row, sel };
        del.addEventListener('click', () => { row.remove(); const i = rows.indexOf(entry); if (i >= 0) rows.splice(i, 1); });
        row.append(sel, del); rows.push(entry); addBtn.before(row);
      };
      const addBtn = document.createElement('button');
      addBtn.className = 'eshell__btn'; addBtn.style.padding = '3px 8px'; addBtn.textContent = '+ Add';
      addBtn.addEventListener('click', () => addRow(''));
      wrap.appendChild(addBtn);
      (Array.isArray(value) ? value : []).forEach(v => addRow(v));
      return { el: wrap, read: () => rows.map(r => r.sel.value).filter(Boolean) };
    }
    if (kind === 'code' || kind === 'text' || kind === 'json') {
      const el = document.createElement('textarea');
      el.className = 'eshell__insp-textarea' + (kind === 'code' ? ' eshell__insp-code' : '');
      el.value = (kind === 'json') ? JSON.stringify(value, null, 2) : (value == null ? '' : String(value));
      el.addEventListener('input', () => el.classList.remove('eshell__insp-invalid'));
      if (kind === 'json') {
        return { el, read: () => { try { return JSON.parse(el.value); } catch (e) { el.classList.add('eshell__insp-invalid'); return value; } } };
      }
      return { el, read: () => el.value };
    }
    const el = document.createElement('input'); el.type = 'text'; el.className = 'eshell__insp-input'; el.value = value == null ? '' : String(value);
    return { el, read: () => el.value };
  }

  _saveInspector(type, id) {
    const complete = {};
    let invalid = false;
    (this._inspFields || []).forEach(f => { const kv = f.read(); if (kv) complete[kv[0]] = kv[1]; });
    invalid = !!this.root.querySelector('.eshell__insp-invalid');
    if (invalid) { this._toast('Fix invalid JSON before saving'); return; }
    this.model.setSelectedType(type); this.model.selectObject(id);
    if (this.model.saveObject) this.model.saveObject(complete);
    else this._collections()[type][id] = complete;
    this._persistCurrent();
    this._toast('Saved ' + id);
    this._renderObjectGrid();          // title/label may have changed
    this._renderInspector(type, id);
  }

  // ---- Asset CRUD (persist via existing Model + FileSystemSyncService seam) ---
  _persistCurrent() {
    // FS sync's 'saveObject' listener snapshots the model's current selection and writes it.
    try { document.body.dispatchEvent(new CustomEvent('saveObject')); } catch (e) { console.warn(e); }
  }
  _newObject() {
    if (!this.selectedType) { this._toast('Select a collection first'); return; }
    const type = this.selectedType;
    this._modal(`New ${type}`, [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }], { id: '', name: '' }, ({ id, name }) => {
      if (!id) return this._toast('ID required');
      const res = this.controller.createObject(type, id, name ? { title: name } : {});
      if (!res || !res.success) return this._toast((res && res.message) || 'Failed');
      this._renderCollectionTree();
      this.selectObject(type, id);
      this._persistCurrent();
      this._renderObjectGrid();
    });
  }
  _duplicateObject() {
    if (!this.selectedType || !this.selectedObjectId) { this._toast('Select an asset'); return; }
    const type = this.selectedType, base = this.selectedObjectId;
    const baseTitle = this._title((this._collections()[type] || {})[base], base);
    this._modal('Duplicate asset', [{ key: 'id', label: 'New ID' }, { key: 'name', label: 'New name' }],
      { id: base + '_copy', name: 'Copy of ' + baseTitle }, ({ id, name }) => {
        if (!id) return this._toast('ID required');
        this.model.setSelectedType(type); this.model.selectObject(base);
        const res = this.controller.duplicateObject(id, name);
        if (!res || !res.success) return this._toast((res && res.message) || 'Failed');
        this._renderCollectionTree();
        this.selectObject(type, id);
        this._persistCurrent();
        this._renderObjectGrid();
      });
  }
  _deleteObject() {
    if (!this.selectedType || !this.selectedObjectId) { this._toast('Select an asset'); return; }
    const type = this.selectedType, id = this.selectedObjectId;
    const data = (this._collections()[type] || {})[id];
    if (!window.confirm(`Delete ${type} "${this._title(data, id)}"? This removes its file.`)) return;
    this.model.setSelectedType(type); this.model.selectObject(id);
    this.controller.deleteObject();
    if (this.controller.fs && this.controller.fs.deleteObjectFromFilesystem) {
      this.controller.fs.deleteObjectFromFilesystem(type, id, data);
    }
    this.selectedObjectId = null;
    this._renderCollectionTree();
    this._renderObjectGrid();
    this._renderInspectorEmpty('Select an asset to inspect.');
  }
  _newCollection() {
    // Category is a dropdown of existing categories (from the objectTypeCategories
    // collection + any categories in use), plus a "+ New category…" option.
    const cats = this._categories();
    const known = new Set([...Object.keys(cats), ...Object.keys(this._categoryGroups())]);
    const options = [...known].sort().map(k => ({ value: k, label: (cats[k] && cats[k].title) || k }));
    const initialCat = this.selectedCategory && known.has(this.selectedCategory) ? this.selectedCategory : (options[0] && options[0].value) || '';
    this._modal('New collection',
      [
        { key: 'id', label: 'ID (plural)' },
        { key: 'name', label: 'Name' },
        { key: 'category', label: 'Category', options, allowNew: true, newLabel: 'category' }
      ],
      { id: '', name: '', category: initialCat }, ({ id, name, category }) => {
        if (!id) return this._toast('ID required');
        const res = this.controller.createType(id, name || id, (name || id).replace(/s$/, ''), category || 'uncategorized');
        if (!res || !res.success) return this._toast((res && res.message) || 'Failed');
        this.renderAssets();
        this.selectCollection(id);
      });
  }

  _miniBtn(label, onClick, variant) {
    const b = document.createElement('button');
    b.className = 'eshell__btn' + (variant === 'danger' ? ' eshell__btn--danger' : '');
    b.style.padding = '3px 9px';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  // Lightweight modal for create/duplicate/collection prompts.
  /**
   * Lightweight modal. Fields are text inputs by default; a field with
   * `options: [{value,label}]` renders a <select>, and `allowNew: true` appends
   * a "+ New …" option that reveals a text input for a fresh value.
   */
  _modal(title, fields, initial, onOk) {
    const overlay = document.createElement('div');
    overlay.className = 'eshell__modal-overlay';
    const box = document.createElement('div');
    box.className = 'eshell__modal';
    const h = document.createElement('div'); h.className = 'eshell__modal-title'; h.textContent = title;
    box.appendChild(h);
    const readers = {};
    let firstFocus = null;
    fields.forEach(f => {
      const wrap = document.createElement('label'); wrap.className = 'eshell__modal-field';
      const lab = document.createElement('span'); lab.textContent = f.label;
      wrap.appendChild(lab);
      if (Array.isArray(f.options)) {
        const sel = document.createElement('select');
        const init = initial && initial[f.key];
        f.options.forEach(o => {
          const op = document.createElement('option');
          op.value = o.value; op.textContent = o.label;
          if (o.value === init) op.selected = true;
          sel.appendChild(op);
        });
        let newInput = null;
        if (f.allowNew) {
          const op = document.createElement('option');
          op.value = '__new__';
          op.textContent = '+ New ' + (f.newLabel || f.label.toLowerCase()) + '…';
          sel.appendChild(op);
          newInput = document.createElement('input');
          newInput.placeholder = 'new ' + (f.newLabel || f.label.toLowerCase()) + ' name';
          newInput.style.display = 'none';
          newInput.style.marginTop = '5px';
          sel.addEventListener('change', () => {
            newInput.style.display = sel.value === '__new__' ? '' : 'none';
            if (sel.value === '__new__') newInput.focus();
          });
        }
        wrap.appendChild(sel);
        if (newInput) wrap.appendChild(newInput);
        readers[f.key] = () => (sel.value === '__new__' && newInput) ? newInput.value.trim() : sel.value;
        if (!firstFocus) firstFocus = sel;
      } else {
        const inp = document.createElement('input'); inp.value = (initial && initial[f.key]) || '';
        wrap.appendChild(inp);
        readers[f.key] = () => inp.value.trim();
        if (!firstFocus) firstFocus = inp;
      }
      box.appendChild(wrap);
    });
    const actions = document.createElement('div'); actions.className = 'eshell__modal-actions';
    const ok = this._miniBtn('OK', () => {
      const vals = {}; Object.keys(readers).forEach(k => vals[k] = readers[k]());
      overlay.remove(); onOk(vals);
    });
    ok.classList.add('eshell__btn--primary');
    actions.append(this._miniBtn('Cancel', () => overlay.remove()), ok);
    box.appendChild(actions);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') overlay.remove(); });
    this.root.appendChild(overlay);
    if (firstFocus) { firstFocus.focus(); if (firstFocus.select) firstFocus.select(); }
  }

  _toast(msg) {
    const t = document.createElement('div'); t.className = 'eshell__toast'; t.textContent = msg;
    this.root.appendChild(t); setTimeout(() => t.remove(), 2200);
  }

  // ---- Menu actions (delegate to legacy controller where available) ----------
  _fillProjects(sel) {
    const projects = (this.model && this.model.projects) || [];
    const current = this.model && this.model.state && this.model.state.currentProject;
    projects.forEach(p => {
      const name = typeof p === 'string' ? p : (p.id || p.name);
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      if (name === current) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!projects.length) { const o = document.createElement('option'); o.textContent = '(no project)'; sel.appendChild(o); }
  }
  _onProjectChange(name) { if (this.controller && this.controller.loadProject) this.controller.loadProject(name); }
  _save() {
    try {
      if (this.controller.fs && this.controller.fs.saveProjectToFilesystem) {
        this.controller.fs.saveProjectToFilesystem();
        this._toast('Project saved');
      } else if (this.controller.saveProject) {
        this.controller.saveProject();
        this._toast('Saved');
      }
    } catch (e) { console.warn('[EditorShell] save failed:', e); }
  }
  _launch() { const p = this.model && this.model.state && this.model.state.currentProject; if (p) window.open(`/projects/${p}/index.html`, '_blank'); }
  _togglePlay() { /* Phase 1: start/stop the viewport simulation */ }

  // ---- Model accessors (defensive; support mock in standalone preview) --------
  _collectionDefs() { try { return (this.model && this.model.getCollectionDefs && this.model.getCollectionDefs()) || this._mock.defs || []; } catch (e) { return []; } }
  _collections() { try { return (this.model && this.model.getCollections && this.model.getCollections()) || this._mock.collections || {}; } catch (e) { return {}; } }
  _categories() { const c = this._collections(); return (c && c.objectTypeCategories) || (this._mock && this._mock.categories) || {}; }
  _title(obj, fallback) { return (obj && (obj.title || obj.name)) || fallback; }

  /** Image URL for an asset's icon (icon-by-name or a direct imagePath), or null. */
  _assetIconUrl(obj) {
    if (!obj || !this.controller || !this.controller.getResourcesPath) return null;
    const res = this.controller.getResourcesPath();
    const cols = this._collections();
    if (obj.icon && cols.icons && cols.icons[obj.icon] && typeof cols.icons[obj.icon].imagePath === 'string') {
      return res + cols.icons[obj.icon].imagePath;                 // referenced by name
    }
    if (typeof obj.imagePath === 'string' && obj.imagePath) return res + obj.imagePath; // is/has a direct image
    return null;
  }

  // ---- Helpers ---------------------------------------------------------------
  _empty(body, msg) { const d = document.createElement('div'); d.className = 'eshell__empty'; d.textContent = msg; body.appendChild(d); }
  _renderInspectorEmpty(msg) { const b = this._body('inspector'); b.innerHTML = ''; this._empty(b, msg); }
  _renderHierarchyEmpty(msg) { const b = this._body('hierarchy'); b.innerHTML = ''; this._empty(b, msg); }

  // ---- Resizable splitters ---------------------------------------------------
  _setupSplitters() {
    this._addSplitter(this.panels.hierarchy, 'col', 'left', '--eshell-left', 160, 520);
    this._addSplitter(this.panels.inspector, 'col', 'right', '--eshell-right', 220, 560, true);
    this._addSplitter(this.panels.assets, 'row', 'bottom', '--eshell-bottom', 120, 460, true);
  }

  _addSplitter(panel, axis, edge, cssVar, min, max, invert = false) {
    const s = document.createElement('div');
    s.className = `eshell__splitter eshell__splitter--${axis} eshell__splitter--${edge}`;
    panel.appendChild(s);
    const onDown = (e) => {
      e.preventDefault();
      s.classList.add('eshell__splitter--active');
      const rect = this.root.getBoundingClientRect();
      const move = (ev) => {
        let px;
        if (axis === 'col') px = invert ? (rect.right - ev.clientX) : (ev.clientX - rect.left);
        else px = rect.bottom - ev.clientY; // bottom row
        px = Math.max(min, Math.min(max, px));
        this.root.style.setProperty(cssVar, px + 'px');
        window.dispatchEvent(new Event('resize'));
      };
      const up = () => {
        s.classList.remove('eshell__splitter--active');
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    };
    s.addEventListener('pointerdown', onDown);
  }
}

// Mock data hook for standalone headless preview (ignored in the real bundle).
EditorShell.prototype._mock = { defs: [], collections: {}, categories: {} };

if (typeof window !== 'undefined') { window.EditorShell = EditorShell; }
