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
      this.viewport.start();
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

  _buildViewport() {
    const panel = this._buildPanel('viewport', 'Viewport · Scene');
    // Camera-mode toggles in the header.
    const header = panel.querySelector('.eshell__panel-header');
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    header.appendChild(spacer);
    [['Game', 'game'], ['Scene', 'scene']].forEach(([label, mode]) => {
      const b = document.createElement('button');
      b.className = 'eshell__btn';
      b.style.padding = '2px 8px';
      b.textContent = label;
      b.addEventListener('click', () => { if (this.viewport) this.viewport.setCameraMode(mode); });
      header.appendChild(b);
    });
    const body = panel.querySelector('.eshell__panel-body');
    body.style.padding = '0';
    const ph = document.createElement('div');
    ph.className = 'eshell__viewport-placeholder';
    ph.id = 'eshell-viewport-placeholder';
    ph.innerHTML =
      '<h2>3D Viewport</h2>' +
      '<p>always-on scene view — lands in Phase 1</p>';
    body.appendChild(ph);
    return panel;
  }

  _body(area) { return this.root.querySelector(`.eshell__panel-body[data-body="${area}"]`); }

  // ---- Assets (collections grouped by category) ------------------------------
  renderAssets() {
    const body = this._body('assets');
    body.innerHTML = '';
    const defs = this._collectionDefs();
    if (!defs.length) { this._empty(body, 'No collections loaded.'); return; }

    const cats = this._categories();
    const groups = {};
    defs.forEach(def => {
      const cat = def.objectTypeCategory || 'uncategorized';
      (groups[cat] = groups[cat] || []).push(def);
    });

    Object.keys(groups).sort().forEach(catKey => {
      const title = document.createElement('div');
      title.className = 'eshell__group-title';
      title.textContent = (cats[catKey] && cats[catKey].title) || catKey;
      body.appendChild(title);

      groups[catKey]
        .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
        .forEach(def => {
          const collections = this._collections();
          const count = collections[def.id] ? Object.keys(collections[def.id]).length : 0;
          const row = document.createElement('div');
          row.className = 'eshell__row';
          row.dataset.type = def.id;
          row.innerHTML = `<span>${def.name || def.id}</span><span class="eshell__row-count">${count}</span>`;
          row.addEventListener('click', () => this.selectCollection(def.id));
          body.appendChild(row);
        });
    });
  }

  selectCollection(typeId) {
    this.selectedType = typeId;
    this.selectedObjectId = null;
    this._body('assets').querySelectorAll('.eshell__row').forEach(r =>
      r.classList.toggle('eshell__row--active', r.dataset.type === typeId));
    // Phase 0: list the collection's objects in the Hierarchy panel as a proof of wiring.
    const body = this._body('hierarchy');
    body.innerHTML = '';
    const objs = (this._collections()[typeId]) || {};
    const ids = Object.keys(objs);
    if (!ids.length) { this._empty(body, 'Empty collection.'); return; }
    ids.sort((a, b) => this._title(objs[a], a).localeCompare(this._title(objs[b], b)))
      .forEach(id => {
        const row = document.createElement('div');
        row.className = 'eshell__row';
        row.textContent = this._title(objs[id], id);
        row.addEventListener('click', () => this.selectObject(typeId, id, row));
        body.appendChild(row);
      });
  }

  selectObject(typeId, id, rowEl) {
    this.selectedObjectId = id;
    if (rowEl) {
      this._body('hierarchy').querySelectorAll('.eshell__row').forEach(r => r.classList.remove('eshell__row--active'));
      rowEl.classList.add('eshell__row--active');
    }
    // Phase 0 inspector: raw key/value readout (Phase 3 replaces with typed widgets).
    const obj = (this._collections()[typeId] || {})[id] || {};
    const body = this._body('inspector');
    body.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'eshell__group-title';
    head.textContent = `${typeId} · ${id}`;
    body.appendChild(head);
    Object.keys(obj).forEach(k => {
      const row = document.createElement('div');
      row.className = 'eshell__row';
      const v = obj[k];
      const disp = (v && typeof v === 'object') ? `{${Array.isArray(v) ? v.length + ' items' : '…'}}` : String(v);
      row.innerHTML = `<span>${k}</span><span class="eshell__row-count">${disp.slice(0, 40)}</span>`;
      body.appendChild(row);
    });
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
