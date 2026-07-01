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
    this.root.appendChild(this.panels.hierarchy);
    this.root.appendChild(this.panels.viewport);
    this.root.appendChild(this.panels.inspector);
    this.root.appendChild(this.panels.assets);

    parent.appendChild(this.root);

    this._setupSplitters();
    this.renderAssets();
    this._renderInspectorEmpty('Select an asset to inspect.');
    this._renderHierarchyEmpty('Scene hierarchy — Phase 4.');
    // Defer viewport start one frame so the grid layout has real pixel sizes.
    requestAnimationFrame(() => this._startViewport());
    return this;
  }

  /** Re-render data panels and restart the viewport for a (re)loaded project. */
  refresh() {
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
      // Scene entity <-> hierarchy <-> inspector sync.
      this.viewport.onSelectionChange = (id, rec) => this._onEntitySelected(id, rec);
      this.viewport.onSceneChange = () => this._renderHierarchy();
      const started = this.viewport.start();
      Promise.resolve(started).then((ok) => {
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
      return { scene: cfg.viewportScene, level: cfg.viewportLevel };
    } catch (e) { return {}; }
  }

  // ---- Scene hierarchy (Phase 4) ---------------------------------------------
  _renderHierarchy() {
    const body = this._body('hierarchy');
    if (!body) return;
    const entities = (this.viewport && this.viewport.getSceneEntities && this.viewport.getSceneEntities()) || [];
    body.innerHTML = '';
    if (!entities.length) { this._empty(body, 'No entities yet — drag an asset into the viewport to place one.'); return; }
    const groups = {};
    entities.forEach(e => { (groups[e.collection] = groups[e.collection] || []).push(e); });
    const sel = this.viewport && this.viewport.getSelectedEntity && this.viewport.getSelectedEntity();
    Object.keys(groups).sort().forEach(col => {
      const title = document.createElement('div');
      title.className = 'eshell__group-title';
      title.textContent = `${col} (${groups[col].length})`;
      body.appendChild(title);
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
    const state = { mode: 'terrain', tool: 'brush', brush: 1, height: 1, terrainId: 0 };
    const apply = () => {
      this.viewport.setInteractionMode(state.mode);
      this.viewport.setPaintOptions({ terrainId: state.terrainId, heightLevel: state.height, brushSize: state.brush, tool: state.tool });
    };
    // Show only the controls relevant to the active mode.
    const updateVis = () => {
      if (this._ttPaletteGroup) this._ttPaletteGroup.style.display = (state.mode === 'terrain') ? '' : 'none';
      if (this._ttHeightGroup) this._ttHeightGroup.style.display = (state.mode === 'height') ? '' : 'none';
    };

    const head = document.createElement('div'); head.className = 'eshell__tt-head';
    const title = document.createElement('span'); title.textContent = 'Terrain'; head.appendChild(title);
    const close = document.createElement('span'); close.className = 'eshell__tab-close'; close.textContent = '×';
    close.addEventListener('click', () => this._toggleTerrainTools());
    head.appendChild(close);
    ov.appendChild(head);

    const modeRow = document.createElement('div'); modeRow.className = 'eshell__tt-row';
    [['Select', 'select'], ['Paint', 'terrain'], ['Height', 'height'], ['Ramp', 'ramp']].forEach(([label, m]) => {
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
    ov.appendChild(this._ttGroup('Tool', toolRow));

    const brushRow = document.createElement('div'); brushRow.className = 'eshell__tt-row';
    const brush = document.createElement('input'); brush.type = 'range'; brush.min = '1'; brush.max = '9'; brush.step = '1'; brush.value = '1'; brush.className = 'eshell__tt-range';
    const brushVal = document.createElement('span'); brushVal.className = 'eshell__row-count'; brushVal.textContent = '1';
    brush.addEventListener('input', () => { state.brush = +brush.value; brushVal.textContent = brush.value; apply(); });
    brushRow.append(brush, brushVal);
    ov.appendChild(this._ttGroup('Brush size', brushRow));

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
    [['Game', 'game'], ['Scene', 'scene']].forEach(([label, mode]) =>
      toolbar.appendChild(this._miniBtn(label, () => { if (this.viewport) this.viewport.setCameraMode(mode); })));
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
  }
  closeTab(id) {
    const t = this._tabs[id];
    if (!t || id === 'scene') return;
    if (typeof t.dispose === 'function') { try { t.dispose(); } catch (e) {} }
    t.content.remove(); t.btn.remove();
    delete this._tabs[id];
    if (this._activeTab === id) this.switchTab('scene');
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
    const host = document.createElement('div'); host.className = 'eshell__script-editor';
    pane.append(bar, host);
    const monaco = window.monaco;
    if (!monaco) { host.innerHTML = '<div class="eshell__empty">Monaco editor not available in this build.</div>'; return; }

    const obj = (this._collections()[type] || {})[id];
    const state = { models: {}, current: null };
    const editor = monaco.editor.create(host, {
      theme: 'vs-dark', automaticLayout: true, fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false
    });
    const select = (prop, lang) => {
      if (!state.models[prop]) state.models[prop] = monaco.editor.createModel(obj[prop] || '', lang);
      editor.setModel(state.models[prop]); state.current = prop;
      bar.querySelectorAll('[data-prop]').forEach(b => b.classList.toggle('eshell__btn--primary', b.dataset.prop === prop));
    };
    props.forEach(([prop, lang]) => { const b = this._miniBtn(prop, () => select(prop, lang)); b.dataset.prop = prop; bar.appendChild(b); });
    const spacer = document.createElement('span'); spacer.style.flex = '1'; bar.appendChild(spacer);
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
    tab.dispose = () => { try { Object.values(state.models).forEach(m => m.dispose()); editor.dispose(); } catch (e) {} };
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
    toolbar.append(crumb, spacer, search,
      this._miniBtn('+ New', () => this._newObject()),
      this._miniBtn('Duplicate', () => this._duplicateObject()),
      this._miniBtn('Delete', () => this._deleteObject(), 'danger'),
      this._miniBtn('+ Collection', () => this._newCollection()));
    body.appendChild(toolbar);

    const main = document.createElement('div');
    main.className = 'eshell__assets-main';
    main.innerHTML = '<div class="eshell__assets-tree" id="eshell-assets-tree"></div>' +
                     '<div class="eshell__assets-grid" id="eshell-assets-grid"></div>';
    body.appendChild(main);

    this._renderCollectionTree();
    this._renderObjectGrid();
  }

  _renderCollectionTree() {
    const tree = this.root.querySelector('#eshell-assets-tree');
    if (!tree) return;
    tree.innerHTML = '';
    const defs = this._collectionDefs();
    const cats = this._categories();
    const collections = this._collections();
    const groups = {};
    defs.forEach(def => { const c = def.objectTypeCategory || 'uncategorized'; (groups[c] = groups[c] || []).push(def); });

    Object.keys(groups).sort().forEach(catKey => {
      const title = document.createElement('div');
      title.className = 'eshell__group-title';
      title.textContent = (cats[catKey] && cats[catKey].title) || catKey;
      tree.appendChild(title);
      groups[catKey].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)).forEach(def => {
        const count = collections[def.id] ? Object.keys(collections[def.id]).length : 0;
        const row = document.createElement('div');
        row.className = 'eshell__row' + (def.id === this.selectedType ? ' eshell__row--active' : '');
        row.dataset.type = def.id;
        row.innerHTML = `<span>${def.name || def.id}</span><span class="eshell__row-count">${count}</span>`;
        row.addEventListener('click', () => this.selectCollection(def.id));
        tree.appendChild(row);
      });
    });
  }

  selectCollection(typeId) {
    this.selectedType = typeId;
    this.selectedObjectId = null;
    if (this.model && this.model.setSelectedType) this.model.setSelectedType(typeId);
    const crumb = this.root.querySelector('#eshell-assets-crumb');
    if (crumb) crumb.textContent = typeId;
    this.root.querySelectorAll('#eshell-assets-tree .eshell__row').forEach(r =>
      r.classList.toggle('eshell__row--active', r.dataset.type === typeId));
    this._renderObjectGrid();
  }

  _renderObjectGrid() {
    const grid = this.root.querySelector('#eshell-assets-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!this.selectedType) { this._empty(grid, 'Select a collection.'); return; }
    const objs = this._collections()[this.selectedType] || {};
    let ids = Object.keys(objs);
    const q = (this._search || '').trim().toLowerCase();
    if (q) ids = ids.filter(id => id.toLowerCase().includes(q) || this._title(objs[id], id).toLowerCase().includes(q));
    if (!ids.length) { this._empty(grid, q ? 'No matches.' : 'Empty collection — use + New.'); return; }
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
      const letter = (this._title(objs[id], id)[0] || '?').toUpperCase();
      card.innerHTML = `<div class="eshell__asset-icon">${letter}</div><div class="eshell__asset-label">${this._title(objs[id], id)}</div>`;
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
    this._renderInspector(typeId, id);
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
    if (kind === 'code' || kind === 'json' || kind === 'text') row.classList.add('eshell__insp-field--wide');

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
    if (value && typeof value === 'object') return 'json';       // array or object
    if (/color$/i.test(key) || (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value))) return 'color';
    if (this._referenceCollection(key)) return 'ref';
    if (typeof value === 'string' && (value.length > 60 || value.includes('\n'))) return 'text';
    return 'string';
  }

  _referenceCollection(key) {
    if (!key) return null;
    const cols = this._collections();
    if (cols[key] && key !== 'objectTypeCategories') return key;          // plural key names a collection
    const def = this._collectionDefs().find(d => d.singular && d.singular.toLowerCase() === key.toLowerCase());
    return def ? def.id : null;
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
    this._modal('New collection', [{ key: 'id', label: 'ID (plural)' }, { key: 'name', label: 'Name' }, { key: 'category', label: 'Category' }],
      { id: '', name: '', category: '' }, ({ id, name, category }) => {
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
  _modal(title, fields, initial, onOk) {
    const overlay = document.createElement('div');
    overlay.className = 'eshell__modal-overlay';
    const box = document.createElement('div');
    box.className = 'eshell__modal';
    const h = document.createElement('div'); h.className = 'eshell__modal-title'; h.textContent = title;
    box.appendChild(h);
    const inputs = {};
    fields.forEach(f => {
      const wrap = document.createElement('label'); wrap.className = 'eshell__modal-field';
      const lab = document.createElement('span'); lab.textContent = f.label;
      const inp = document.createElement('input'); inp.value = (initial && initial[f.key]) || '';
      inputs[f.key] = inp;
      wrap.append(lab, inp); box.appendChild(wrap);
    });
    const actions = document.createElement('div'); actions.className = 'eshell__modal-actions';
    const ok = this._miniBtn('OK', () => {
      const vals = {}; Object.keys(inputs).forEach(k => vals[k] = inputs[k].value.trim());
      overlay.remove(); onOk(vals);
    });
    ok.classList.add('eshell__btn--primary');
    actions.append(this._miniBtn('Cancel', () => overlay.remove()), ok);
    box.appendChild(actions);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') overlay.remove(); });
    this.root.appendChild(overlay);
    const first = inputs[fields[0].key]; if (first) { first.focus(); first.select(); }
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
  _save() { if (this.controller && this.controller.saveProjectToFilesystem) this.controller.saveProjectToFilesystem(); else if (this.controller && this.controller.model) this.controller.model.saveProject(); }
  _launch() { const p = this.model && this.model.state && this.model.state.currentProject; if (p) window.open(`/projects/${p}/index.html`, '_blank'); }
  _togglePlay() { /* Phase 1: start/stop the viewport simulation */ }

  // ---- Model accessors (defensive; support mock in standalone preview) --------
  _collectionDefs() { try { return (this.model && this.model.getCollectionDefs && this.model.getCollectionDefs()) || this._mock.defs || []; } catch (e) { return []; } }
  _collections() { try { return (this.model && this.model.getCollections && this.model.getCollections()) || this._mock.collections || {}; } catch (e) { return {}; } }
  _categories() { const c = this._collections(); return (c && c.objectTypeCategories) || (this._mock && this._mock.categories) || {}; }
  _title(obj, fallback) { return (obj && (obj.title || obj.name)) || fallback; }

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
