/**
 * EditorSystemsGraph — scene systems viewed as a service-dependency graph.
 *
 * For a scene object (systems / clientSystems / serverSystems arrays), renders
 * every system as a node card listing the services it registers (the parsed
 * `static services = [...]` on the systems collection objects), with edges for
 * service dependencies: A → B when B's script calls a service A provides
 * (extracted statically from `.call.name(...)` / `.call('name'...)`).
 *
 * By default only the selected node's edges are shown (30-system scenes are an
 * unreadable web otherwise): amber = services it consumes, cyan = dependents
 * consuming its services. Toolbar toggles all edges.
 *
 * Editing: add/remove systems per list; saved through the standard object seam.
 * Editor-only; opened in a center tab from the Inspector on scene assets.
 */
class EditorSystemsGraph {
  static LISTS = ['systems', 'clientSystems', 'serverSystems'];
  static LIST_COLORS = { systems: '#35e0c8', clientSystems: '#3ddc97', serverSystems: '#f5a623' };

  constructor(shell, pane, sceneId) {
    this.shell = shell;
    this.pane = pane;
    this.sceneId = sceneId;
    this.nodes = new Map();     // name -> {id, list, obj, provides[], consumes[], missing, x, y, el}
    this.selected = null;
    this.showAllEdges = false;
    this.pan = { x: 40, y: 30 };
    this.zoom = 1;
    this._listeners = [];
  }

  _cols() { return this.shell._collections(); }
  _scene() { return (this._cols().scenes || {})[this.sceneId]; }

  // ---- graph assembly ---------------------------------------------------------
  assemble() {
    this.nodes.clear();
    const scene = this._scene();
    if (!scene) return;
    const systems = this._cols().systems || {};
    EditorSystemsGraph.LISTS.forEach(list => {
      (scene[list] || []).forEach(name => {
        if (this.nodes.has(name)) { this.nodes.get(name).list += '+' + list; return; }
        const obj = systems[name];
        this.nodes.set(name, {
          id: name, list, obj: obj || null, missing: !obj,
          provides: (obj && Array.isArray(obj.services)) ? obj.services.slice() : this._parseProvides(obj),
          consumes: this._parseConsumes(obj),
          x: 0, y: 0
        });
      });
    });
    // service -> provider map (within this scene)
    this.providerOf = {};
    this.nodes.forEach(n => n.provides.forEach(s => { this.providerOf[s] = this.providerOf[s] || []; this.providerOf[s].push(n.id); }));
    this.autoLayout(false);
  }
  _parseProvides(obj) {
    if (!obj || typeof obj.script !== 'string') return [];
    const m = obj.script.match(/static\s+services\s*=\s*\[([^\]]*)\]/);
    if (!m) return [];
    return (m[1].match(/['"]([\w$]+)['"]/g) || []).map(s => s.slice(1, -1));
  }
  _parseConsumes(obj) {
    if (!obj || typeof obj.script !== 'string') return [];
    const out = new Set();
    const re1 = /\.call\.([A-Za-z_$][\w$]*)\s*\(/g;
    const re2 = /\.call\(\s*['"]([\w$]+)['"]/g;
    let m;
    while ((m = re1.exec(obj.script))) out.add(m[1]);
    while ((m = re2.exec(obj.script))) out.add(m[1]);
    return [...out];
  }

  /** Edges: provider -> consumer, with the service names on the edge. */
  _edges() {
    const out = [];
    const seen = {};
    this.nodes.forEach(consumer => {
      consumer.consumes.forEach(svc => {
        (this.providerOf[svc] || []).forEach(provider => {
          if (provider === consumer.id) return;
          const key = provider + '→' + consumer.id;
          if (seen[key]) { seen[key].services.push(svc); return; }
          const e = { from: provider, to: consumer.id, services: [svc] };
          seen[key] = e; out.push(e);
        });
      });
    });
    return out;
  }

  autoLayout(render = true) {
    // Columns grouped by list membership; wrap long columns.
    const groups = { systems: [], clientSystems: [], serverSystems: [] };
    this.nodes.forEach(n => { (groups[n.list.split('+')[0]] || groups.systems).push(n.id); });
    let gx = 40;
    EditorSystemsGraph.LISTS.forEach(list => {
      const names = groups[list].sort();
      const perCol = 9;
      const cols = Math.max(1, Math.ceil(names.length / perCol));
      names.forEach((name, i) => {
        const n = this.nodes.get(name);
        n.x = gx + Math.floor(i / perCol) * 235;
        n.y = 40 + (i % perCol) * 92;
      });
      gx += cols * 235 + 70;
    });
    if (render) this.render();
  }

  validate() {
    const issues = [];
    this.nodes.forEach(n => {
      if (n.missing) { issues.push({ node: n.id, level: 'error', msg: `system '${n.id}' not found in the systems collection` }); return; }
      n.consumes.forEach(svc => {
        if (!this.providerOf[svc]) issues.push({ node: n.id, level: 'warn', msg: `calls '${svc}' — no provider in this scene (may be registered dynamically)` });
      });
    });
    return issues;
  }

  // ---- mutations ----------------------------------------------------------------
  addSystem(name, list) {
    const scene = this._scene();
    if (!scene) return;
    scene[list] = scene[list] || [];
    if (EditorSystemsGraph.LISTS.some(l => (scene[l] || []).includes(name))) { this.shell._toast('Already in the scene'); return; }
    scene[list].push(name);
    this._persistScene();
    this.assemble();
    this.select(name);
    this.render();
  }
  removeSystem(name) {
    const scene = this._scene();
    if (!scene) return;
    EditorSystemsGraph.LISTS.forEach(l => {
      if (Array.isArray(scene[l])) {
        const i = scene[l].indexOf(name);
        if (i >= 0) scene[l].splice(i, 1);
      }
    });
    this._persistScene();
    if (this.selected === name) this.selected = null;
    this.assemble();
    this.render();
  }
  _persistScene() {
    try {
      const fs = this.shell.controller.fs;
      if (fs && fs.syncObjectToFilesystem) fs.syncObjectToFilesystem('scenes', this.sceneId, this._scene());
      this.shell._toast('Scene saved');
    } catch (e) { console.warn('[systems graph] persist failed', e); }
  }

  // ---- UI -------------------------------------------------------------------------
  build() {
    this.pane.classList.add('btg');
    this.pane.innerHTML =
      '<div class="btg__bar">' +
        `<span class="btg__root">${this.sceneId} · systems</span>` +
        '<span class="btg__issues" data-ref="issues"></span>' +
        '<span class="btg__spacer"></span>' +
        '<button class="btg__btn" data-ref="edges">Edges: selected</button>' +
        '<button class="btg__btn" data-ref="layout">Auto-layout</button>' +
      '</div>' +
      '<div class="btg__body">' +
        '<div class="btg__canvas" data-ref="canvas">' +
          '<div class="btg__world" data-ref="world">' +
            '<svg class="btg__edges" data-ref="svg" width="4000" height="3000"></svg>' +
          '</div>' +
        '</div>' +
        '<div class="btg__inspector" data-ref="inspector"></div>' +
      '</div>';
    this.refs = {};
    this.pane.querySelectorAll('[data-ref]').forEach(el => { this.refs[el.dataset.ref] = el; });
    this.refs.layout.addEventListener('click', () => this.autoLayout());
    this.refs.edges.addEventListener('click', () => {
      this.showAllEdges = !this.showAllEdges;
      this.refs.edges.textContent = 'Edges: ' + (this.showAllEdges ? 'all' : 'selected');
      this._renderEdges();
    });
    this._wireCanvas();
    this.assemble();
    this.render();
    return this;
  }

  _wireCanvas() {
    const canvas = this.refs.canvas;
    let panning = null;
    const md = (e) => {
      if (e.target.closest('.btg__node')) return;
      panning = { x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
      e.preventDefault();
    };
    const mm = (e) => { if (panning) { this.pan.x = e.clientX - panning.x; this.pan.y = e.clientY - panning.y; this._applyTransform(); } };
    const mu = () => { panning = null; };
    const wheel = (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoom = Math.max(0.25, Math.min(2.2, this.zoom * f));
      this._applyTransform();
    };
    canvas.addEventListener('mousedown', md);
    canvas.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
    this._listeners.push(() => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); });
  }
  _applyTransform() {
    this.refs.world.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
  }

  render() {
    const world = this.refs.world;
    world.querySelectorAll('.btg__node').forEach(n => n.remove());
    const issues = this.validate();
    const issueByNode = {};
    issues.forEach(i => { (issueByNode[i.node] = issueByNode[i.node] || []).push(i); });

    this.nodes.forEach(n => {
      const color = n.missing ? '#ff5c6c' : (EditorSystemsGraph.LIST_COLORS[n.list.split('+')[0]] || '#5e708a');
      const el = document.createElement('div');
      el.className = 'btg__node sg__node' + (n.id === this.selected ? ' btg__node--selected' : '') + (n.missing ? ' btg__node--missing' : '');
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      el.style.setProperty('--btg-node-color', color);
      el.style.setProperty('--btg-node-fill', '#141d2b');
      const nodeIssues = issueByNode[n.id] || [];
      const badge = nodeIssues.length
        ? `<span class="btg__badge btg__badge--${nodeIssues.some(i => i.level === 'error') ? 'error' : 'warn'}" title="${nodeIssues.map(i => i.msg).join('\n')}">!</span>` : '';
      const svcs = n.provides.length
        ? n.provides.slice(0, 3).map(s => `<span class="sg__svc">${s}</span>`).join('') +
          (n.provides.length > 3 ? `<span class="sg__svc sg__svc--more">+${n.provides.length - 3}</span>` : '')
        : '<span class="sg__svc sg__svc--none">no services</span>';
      el.innerHTML =
        `<div class="btg__node-head">${n.list}${badge}</div>` +
        `<div class="btg__node-title">${n.id.replace(/System$/, '')}</div>` +
        `<div class="sg__svcs">${svcs}</div>`;
      el.addEventListener('mousedown', (e) => this._dragNode(e, n));
      el.addEventListener('click', (e) => { e.stopPropagation(); this.select(n.id); });
      world.appendChild(el);
      n.el = el;
    });

    this._renderEdges();
    this._applyTransform();
    const errs = issues.filter(i => i.level === 'error').length;
    const warns = issues.length - errs;
    this.refs.issues.textContent = issues.length
      ? `${errs ? errs + ' error' + (errs > 1 ? 's' : '') : ''}${errs && warns ? ' · ' : ''}${warns ? warns + ' warning' + (warns > 1 ? 's' : '') : ''}`
      : '✓ all services resolved';
    this.refs.issues.className = 'btg__issues' + (errs ? ' btg__issues--error' : warns ? ' btg__issues--warn' : ' btg__issues--ok');
    this._renderInspector();
  }

  _renderEdges() {
    const svg = this.refs.svg;
    const NW = 190, NH = 74;
    let html = '';
    this._edges().forEach(e => {
      const touchesSel = e.from === this.selected || e.to === this.selected;
      if (!this.showAllEdges && !touchesSel) return;
      const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
      if (!a || !b) return;
      const x1 = a.x + NW / 2, y1 = a.y + NH;
      const x2 = b.x + NW / 2, y2 = b.y;
      const my = (y1 + y2) / 2;
      let stroke = '#2a3a50', width = 1.5, op = 0.8;
      if (touchesSel) {
        stroke = e.to === this.selected ? '#f5a623' : '#35e0c8';   // consuming from / providing to
        width = 2; op = 1;
      }
      const title = `${e.from} → ${e.to}: ${e.services.join(', ')}`;
      html += `<path d="M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${op}"><title>${title}</title></path>`;
    });
    svg.innerHTML = html;
  }

  _dragNode(e, node) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, nx: node.x, ny: node.y };
    const mm = (ev) => {
      node.x = start.nx + (ev.clientX - start.x) / this.zoom;
      node.y = start.ny + (ev.clientY - start.y) / this.zoom;
      node.el.style.left = node.x + 'px';
      node.el.style.top = node.y + 'px';
      this._renderEdges();
    };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  }

  select(name) {
    this.selected = name;
    this.pane.querySelectorAll('.btg__node').forEach(el => el.classList.remove('btg__node--selected'));
    const n = this.nodes.get(name);
    if (n && n.el) n.el.classList.add('btg__node--selected');
    this._renderEdges();
    this._renderInspector();
  }

  _renderInspector() {
    const box = this.refs && this.refs.inspector;
    if (!box) return;
    box.innerHTML = '';
    const scene = this._scene();

    const n = this.nodes.get(this.selected);
    if (n) {
      const head = document.createElement('div');
      head.className = 'btg__insp-head';
      head.innerHTML = `<span class="btg__insp-kind">${n.list}</span><b>${n.id}</b>`;
      box.appendChild(head);

      const provTitle = document.createElement('div'); provTitle.className = 'btg__insp-sub';
      provTitle.textContent = `Provides (${n.provides.length})`;
      box.appendChild(provTitle);
      if (!n.provides.length) { const d = document.createElement('div'); d.className = 'eshell__empty'; d.textContent = 'No registered services.'; box.appendChild(d); }
      n.provides.forEach(svc => {
        const consumers = [];
        this.nodes.forEach(o => { if (o.id !== n.id && o.consumes.includes(svc)) consumers.push(o.id); });
        const row = document.createElement('div'); row.className = 'sg__insp-svc';
        row.innerHTML = `<span class="sg__insp-svc-name">${svc}</span>` +
          `<span class="eshell__row-count" title="${consumers.join(', ')}">${consumers.length ? '→ ' + consumers.length : 'unused'}</span>`;
        box.appendChild(row);
      });

      const conTitle = document.createElement('div'); conTitle.className = 'btg__insp-sub';
      conTitle.textContent = `Consumes (${n.consumes.length})`;
      box.appendChild(conTitle);
      n.consumes.forEach(svc => {
        const providers = this.providerOf[svc] || [];
        const row = document.createElement('div'); row.className = 'sg__insp-svc' + (providers.length ? '' : ' sg__insp-svc--unresolved');
        row.innerHTML = `<span class="sg__insp-svc-name">${svc}</span>` +
          `<span class="eshell__row-count" title="${providers.join(', ')}">${providers.length ? '← ' + providers.join(', ') : '⚠ no provider'}</span>`;
        box.appendChild(row);
      });

      const bar = document.createElement('div'); bar.className = 'eshell__insp-actions';
      const rm = document.createElement('button'); rm.className = 'btg__btn'; rm.textContent = 'Remove from scene';
      rm.addEventListener('click', () => this.removeSystem(n.id));
      bar.appendChild(rm);
      box.appendChild(bar);
    } else {
      const d = document.createElement('div'); d.className = 'eshell__empty';
      d.textContent = 'Select a system to see its services and dependencies.';
      box.appendChild(d);
    }

    // Add-system controls (scene-level)
    const addTitle = document.createElement('div'); addTitle.className = 'btg__insp-sub'; addTitle.textContent = 'Add system';
    box.appendChild(addTitle);
    const inScene = new Set([...this.nodes.keys()]);
    const all = Object.keys(this._cols().systems || {}).filter(s => !inScene.has(s)).sort();
    const addRow = document.createElement('div'); addRow.className = 'btg__insp-add';
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">system…</option>' + all.map(s => `<option value="${s}">${s}</option>`).join('');
    addRow.appendChild(sel); box.appendChild(addRow);
    const listRow = document.createElement('div'); listRow.className = 'btg__insp-add';
    const listSel = document.createElement('select');
    listSel.innerHTML = EditorSystemsGraph.LISTS.map(l => `<option value="${l}">${l}</option>`).join('');
    listRow.appendChild(listSel); box.appendChild(listRow);
    const addBtn = document.createElement('button'); addBtn.className = 'btg__btn btg__btn--block'; addBtn.textContent = '+ Add to scene';
    addBtn.addEventListener('click', () => { if (sel.value) this.addSystem(sel.value, listSel.value); });
    box.appendChild(addBtn);
  }

  dispose() {
    this._listeners.forEach(fn => { try { fn(); } catch (e) {} });
    this._listeners = [];
  }
}

if (typeof window !== 'undefined') { window.EditorSystemsGraph = EditorSystemsGraph; }
