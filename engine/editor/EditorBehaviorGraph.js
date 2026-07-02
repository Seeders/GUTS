/**
 * EditorBehaviorGraph — Unity-style visual behavior-tree editor (from scratch).
 *
 * GUTS behavior trees are a FLAT, NAME-REFERENCED GRAPH: every node is a
 * standalone object in one of four collections (behaviorTrees,
 * sequenceBehaviorTrees, behaviorActions, behaviorDecorators); composites list
 * ordered child NAMES in `behaviorActions`, decorators reference one name in
 * `childAction`, and runtime semantics come from the node's JS class. This
 * editor renders the resolved DAG from a root tree and edits the references,
 * order, parameters and memory — writing back the exact runtime format.
 *
 * Layout positions persist as `editorLayout: {nodeName: {x,y}}` on the root
 * tree object (the runtime provably ignores unknown keys).
 *
 * Editor-only; opened in a center tab from the Inspector.
 */
class EditorBehaviorGraph {
  static COLLECTIONS = ['behaviorTrees', 'sequenceBehaviorTrees', 'behaviorActions', 'behaviorDecorators'];

  constructor(shell, pane, rootCollection, rootId) {
    this.shell = shell;
    this.pane = pane;
    this.rootCollection = rootCollection;
    this.rootId = rootId;
    this.nodes = new Map();       // name -> {id, obj, collection, kind, children, childAction, missing, x, y, el}
    this.selected = null;
    this.dirty = new Set();       // node names whose objects changed
    this.layoutDirty = false;
    this.pan = { x: 60, y: 40 };
    this.zoom = 1;
    this._listeners = [];
  }

  _cols() { return this.shell._collections(); }
  _findNode(name) {
    const cols = this._cols();
    for (const c of EditorBehaviorGraph.COLLECTIONS) {
      if (cols[c] && cols[c][name]) return { collection: c, obj: cols[c][name] };
    }
    return null;
  }
  _typeMeta(node) {
    const types = this._cols().behaviorNodeTypes || {};
    const t = (node.obj && node.obj.behaviorNodeType) || node.kind;
    return types[t] || { color: '#5e708a', fillColor: '#1a2332', title: t };
  }
  _kindOf(obj, collection) {
    if (obj.childAction !== undefined || collection === 'behaviorDecorators') return 'decorator';
    if (Array.isArray(obj.behaviorActions) || Array.isArray(obj.children) ||
        collection === 'behaviorTrees' || collection === 'sequenceBehaviorTrees') return 'composite';
    return 'leaf';
  }
  _childrenOf(obj) { return obj.children || obj.behaviorActions || []; }

  // ---- graph assembly --------------------------------------------------------
  assemble() {
    this.nodes.clear();
    const visit = (name) => {
      if (this.nodes.has(name)) return;
      const found = this._findNode(name);
      if (!found) { this.nodes.set(name, { id: name, missing: true, children: [], x: 0, y: 0 }); return; }
      const kind = this._kindOf(found.obj, found.collection);
      const node = {
        id: name, obj: found.obj, collection: found.collection, kind,
        children: kind === 'composite' ? this._childrenOf(found.obj).slice() : [],
        childAction: kind === 'decorator' ? (found.obj.childAction || null) : null,
        missing: false, x: 0, y: 0
      };
      this.nodes.set(name, node);
      node.children.forEach(visit);
      if (node.childAction) visit(node.childAction);
    };
    visit(this.rootId);
    this._applyLayout();
  }

  _edges() {
    const out = [];
    this.nodes.forEach(n => {
      if (n.missing) return;
      n.children.forEach((c, i) => { if (this.nodes.has(c)) out.push({ from: n.id, to: c, order: i, count: n.children.length }); });
      if (n.childAction && this.nodes.has(n.childAction)) out.push({ from: n.id, to: n.childAction, order: 0, count: 1, decorator: true });
    });
    return out;
  }

  _applyLayout() {
    const saved = (this.nodes.get(this.rootId) && this.nodes.get(this.rootId).obj && this.nodes.get(this.rootId).obj.editorLayout) || {};
    let missing = false;
    this.nodes.forEach(n => {
      if (saved[n.id]) { n.x = saved[n.id].x; n.y = saved[n.id].y; }
      else missing = true;
    });
    if (missing) this.autoLayout(false);
  }

  /** Layered auto-layout: depth = row, siblings spread horizontally. */
  autoLayout(markDirty = true) {
    const depth = new Map(); const order = [];
    const bfs = [[this.rootId, 0]];
    while (bfs.length) {
      const [name, d] = bfs.shift();
      const n = this.nodes.get(name);
      if (!n || (depth.has(name) && depth.get(name) >= d)) { if (!depth.has(name)) depth.set(name, d); continue; }
      depth.set(name, d); order.push(name);
      if (n.children) n.children.forEach(c => bfs.push([c, d + 1]));
      if (n.childAction) bfs.push([n.childAction, d + 1]);
    }
    const rows = new Map();
    this.nodes.forEach((n, name) => {
      const d = depth.has(name) ? depth.get(name) : 0;
      if (!rows.has(d)) rows.set(d, []);
      rows.get(d).push(name);
    });
    const W = 210, H = 120;
    rows.forEach((names, d) => {
      names.forEach((name, i) => {
        const n = this.nodes.get(name);
        n.x = i * W - ((names.length - 1) * W) / 2 + 500;
        n.y = d * H + 40;
      });
    });
    if (markDirty) { this.layoutDirty = true; this.render(); }
  }

  // ---- validation --------------------------------------------------------------
  validate() {
    const issues = [];
    this.nodes.forEach(n => {
      if (n.missing) { issues.push({ node: n.id, level: 'error', msg: `'${n.id}' not found in any behavior collection (crashes at battle start)` }); return; }
      (n.children || []).forEach(c => { if (!this._findNode(c)) issues.push({ node: n.id, level: 'error', msg: `child '${c}' unresolved` }); });
      if (n.kind === 'composite' && n.children.length === 0) issues.push({ node: n.id, level: 'warn', msg: 'composite has no children (always fails)' });
      if (n.kind === 'decorator' && !n.childAction) issues.push({ node: n.id, level: 'warn', msg: 'decorator has no child (always fails)' });
    });
    return issues;
  }
  _wouldCycle(parentName, childName) {
    if (parentName === childName) return true;
    const stack = [childName]; const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === parentName) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const n = this.nodes.get(cur) || (() => { const f = this._findNode(cur); return f ? { children: this._childrenOf(f.obj), childAction: f.obj.childAction } : null; })();
      if (!n) continue;
      (n.children || []).forEach(c => stack.push(c));
      if (n.childAction) stack.push(n.childAction);
    }
    return false;
  }

  // ---- mutations ---------------------------------------------------------------
  _markDirty(name) { this.dirty.add(name); this._updateSaveState(); }
  addChild(parentName, childName) {
    const p = this.nodes.get(parentName);
    if (!p || p.missing) return;
    if (this._wouldCycle(parentName, childName)) { this.shell._toast('That would create a cycle'); return; }
    if (p.kind === 'decorator') {
      p.childAction = childName;
      p.obj.childAction = childName;
    } else if (p.kind === 'composite') {
      if (p.children.includes(childName)) { this.shell._toast('Already a child'); return; }
      p.children.push(childName);
      this._writeChildren(p);
    } else { this.shell._toast('Actions are leaves — they cannot have children'); return; }
    this._markDirty(parentName);
    this.assembleIncremental(childName);
    this.render();
  }
  removeChild(parentName, childName) {
    const p = this.nodes.get(parentName);
    if (!p) return;
    if (p.kind === 'decorator' && p.childAction === childName) { p.childAction = null; p.obj.childAction = null; }
    else { const i = p.children.indexOf(childName); if (i < 0) return; p.children.splice(i, 1); this._writeChildren(p); }
    this._markDirty(parentName);
    this.assemble();     // drop now-orphaned nodes from the view
    this.render();
  }
  moveChild(parentName, index, dir) {
    const p = this.nodes.get(parentName);
    if (!p || p.kind !== 'composite') return;
    const j = index + dir;
    if (j < 0 || j >= p.children.length) return;
    [p.children[index], p.children[j]] = [p.children[j], p.children[index]];
    this._writeChildren(p);
    this._markDirty(parentName);
    this.render();
  }
  _writeChildren(node) {
    // Runtime reads `children` first, else `behaviorActions` — write whichever the object uses.
    if (node.obj.children) node.obj.children = node.children.slice();
    else node.obj.behaviorActions = node.children.slice();
  }
  assembleIncremental(newName) {
    if (!this.nodes.has(newName)) {
      const before = new Map(this.nodes);
      this.assemble();
      // keep previous positions
      before.forEach((n, k) => { const cur = this.nodes.get(k); if (cur) { cur.x = n.x; cur.y = n.y; } });
      const fresh = this.nodes.get(newName);
      const sel = this.nodes.get(this.selected) || this.nodes.get(this.rootId);
      if (fresh && sel) { fresh.x = sel.x; fresh.y = sel.y + 120; }
    }
  }

  // ---- persistence ---------------------------------------------------------------
  save() {
    const fs = this.shell.controller.fs;
    if (!fs || !fs.syncObjectToFilesystem) { this.shell._toast('No filesystem sync available'); return; }
    // layout always rides on the root object
    const root = this.nodes.get(this.rootId);
    if (root && !root.missing) {
      const layout = {};
      this.nodes.forEach(n => { if (!n.missing) layout[n.id] = { x: Math.round(n.x), y: Math.round(n.y) }; });
      root.obj.editorLayout = layout;
      this.dirty.add(this.rootId);
    }
    let count = 0;
    this.dirty.forEach(name => {
      const n = this.nodes.get(name);
      if (n && !n.missing) { fs.syncObjectToFilesystem(n.collection, n.id, n.obj); count++; }
    });
    this.dirty.clear();
    this.layoutDirty = false;
    this._updateSaveState();
    this.shell._toast(`Saved ${count} node${count === 1 ? '' : 's'}`);
  }

  // ---- UI ------------------------------------------------------------------------
  build() {
    this.pane.classList.add('btg');
    this.pane.innerHTML =
      '<div class="btg__bar">' +
        `<span class="btg__root">${this.rootId}</span>` +
        '<span class="btg__issues" data-ref="issues"></span>' +
        '<span class="btg__spacer"></span>' +
        '<button class="btg__btn" data-ref="layout">Auto-layout</button>' +
        '<button class="btg__btn" data-ref="newnode">+ New Node</button>' +
        '<button class="btg__btn btg__btn--primary" data-ref="save">Save</button>' +
      '</div>' +
      '<div class="btg__body">' +
        '<div class="btg__canvas" data-ref="canvas">' +
          '<div class="btg__world" data-ref="world">' +
            '<svg class="btg__edges" data-ref="edges" width="4000" height="3000"></svg>' +
          '</div>' +
        '</div>' +
        '<div class="btg__inspector" data-ref="inspector"></div>' +
      '</div>';
    this.refs = {};
    this.pane.querySelectorAll('[data-ref]').forEach(el => { this.refs[el.dataset.ref] = el; });

    this.refs.layout.addEventListener('click', () => this.autoLayout());
    this.refs.save.addEventListener('click', () => this.save());
    this.refs.newnode.addEventListener('click', () => this._newNode());
    this._wireCanvas();

    this.assemble();
    this.select(this.rootId);
    this.render();
    return this;
  }

  _wireCanvas() {
    const canvas = this.refs.canvas;
    let panning = null;
    const md = (e) => {
      if (e.target !== canvas && e.target !== this.refs.world && e.target.tagName !== 'svg' && e.target.tagName !== 'path' && e.target.tagName !== 'text') return;
      panning = { x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
      e.preventDefault();
    };
    const mm = (e) => { if (panning) { this.pan.x = e.clientX - panning.x; this.pan.y = e.clientY - panning.y; this._applyTransform(); } };
    const mu = () => { panning = null; };
    const wheel = (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoom = Math.max(0.25, Math.min(2.5, this.zoom * f));
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

    // reference counts across ALL trees (shared-node badge)
    const refCount = {};
    const cols = this._cols();
    EditorBehaviorGraph.COLLECTIONS.forEach(c => Object.values(cols[c] || {}).forEach(o => {
      this._childrenOf(o).forEach(ch => refCount[ch] = (refCount[ch] || 0) + 1);
      if (o.childAction) refCount[o.childAction] = (refCount[o.childAction] || 0) + 1;
    }));

    this.nodes.forEach(n => {
      const el = document.createElement('div');
      const meta = n.missing ? { color: '#ff5c6c', fillColor: '#3a1418', title: 'missing' } : this._typeMeta(n);
      el.className = 'btg__node' + (n.id === this.selected ? ' btg__node--selected' : '') + (n.missing ? ' btg__node--missing' : '');
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      el.style.setProperty('--btg-node-color', meta.color);
      el.style.setProperty('--btg-node-fill', meta.fillColor || '#1a2332');
      const nodeIssues = issueByNode[n.id] || [];
      const badge = nodeIssues.length
        ? `<span class="btg__badge btg__badge--${nodeIssues.some(i => i.level === 'error') ? 'error' : 'warn'}" title="${nodeIssues.map(i => i.msg).join('\n')}">!</span>` : '';
      const shared = (refCount[n.id] || 0) > 1 ? `<span class="btg__shared" title="Referenced by ${refCount[n.id]} parents — edits affect all of them">⧉${refCount[n.id]}</span>` : '';
      el.innerHTML =
        `<div class="btg__node-head">${n.missing ? 'missing' : ((n.obj && n.obj.behaviorNodeType) || n.kind)}${shared}${badge}</div>` +
        `<div class="btg__node-title">${(n.obj && n.obj.title) || n.id}</div>` +
        `<div class="btg__node-sub">${n.id}</div>`;
      el.addEventListener('mousedown', (e) => this._dragNode(e, n));
      el.addEventListener('click', (e) => { e.stopPropagation(); this.select(n.id); });
      world.appendChild(el);
      n.el = el;
    });

    this._renderEdges();
    this._applyTransform();
    this._renderIssues(issues);
    this._renderInspector();
    this._updateSaveState();
  }

  _renderEdges() {
    const svg = this.refs.edges;
    const NW = 190, NH = 62;
    let html = '';
    this._edges().forEach(e => {
      const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
      if (!a || !b) return;
      const x1 = a.x + NW / 2, y1 = a.y + NH;
      const x2 = b.x + NW / 2, y2 = b.y;
      const my = (y1 + y2) / 2;
      const dash = e.decorator ? ' stroke-dasharray="6 4"' : '';
      html += `<path d="M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}" fill="none" stroke="#35506e" stroke-width="2"${dash}/>`;
      if (e.count > 1) {
        html += `<circle cx="${(x1 + x2) / 2}" cy="${my}" r="9" fill="#16202f" stroke="#35506e"/>` +
                `<text x="${(x1 + x2) / 2}" y="${my + 3.5}" text-anchor="middle" fill="#90a2ba" font-size="10" font-family="monospace">${e.order + 1}</text>`;
      }
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
      this.layoutDirty = true;
      this._updateSaveState();
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
    this._renderInspector();
  }

  _renderIssues(issues) {
    const errs = issues.filter(i => i.level === 'error').length;
    const warns = issues.length - errs;
    this.refs.issues.textContent = issues.length ? `${errs ? errs + ' error' + (errs > 1 ? 's' : '') : ''}${errs && warns ? ' · ' : ''}${warns ? warns + ' warning' + (warns > 1 ? 's' : '') : ''}` : '✓ valid';
    this.refs.issues.className = 'btg__issues' + (errs ? ' btg__issues--error' : warns ? ' btg__issues--warn' : ' btg__issues--ok');
  }
  _updateSaveState() {
    if (!this.refs) return;
    const dirty = this.dirty.size > 0 || this.layoutDirty;
    this.refs.save.textContent = dirty ? 'Save *' : 'Save';
  }

  _allNodeOptions() {
    const cols = this._cols();
    const out = [];
    EditorBehaviorGraph.COLLECTIONS.forEach(c => Object.keys(cols[c] || {}).sort().forEach(id => out.push({ id, collection: c })));
    return out;
  }

  _renderInspector() {
    const box = this.refs && this.refs.inspector;
    if (!box) return;
    box.innerHTML = '';
    const n = this.nodes.get(this.selected);
    if (!n) { box.innerHTML = '<div class="eshell__empty">Select a node.</div>'; return; }
    if (n.missing) {
      box.innerHTML = `<div class="btg__insp-head"><b>${n.id}</b></div>` +
        '<div class="eshell__empty">This node does not exist in any behavior collection. Remove the reference from its parent, or create a node with this exact name.</div>';
      return;
    }
    const head = document.createElement('div');
    head.className = 'btg__insp-head';
    head.innerHTML = `<span class="btg__insp-kind">${(n.obj.behaviorNodeType) || n.kind} · ${n.collection}</span><b>${n.id}</b>`;
    box.appendChild(head);

    const field = (label, value, onChange, textarea) => {
      const row = document.createElement('div'); row.className = 'btg__insp-row';
      const lab = document.createElement('label'); lab.textContent = label;
      const inp = document.createElement(textarea ? 'textarea' : 'input');
      inp.value = value == null ? '' : value;
      inp.addEventListener('change', () => onChange(inp));
      row.append(lab, inp); box.appendChild(row);
      return inp;
    };
    field('Title', n.obj.title, (i) => { n.obj.title = i.value; this._markDirty(n.id); n.el.querySelector('.btg__node-title').textContent = i.value || n.id; });
    field('Description', n.obj.description, (i) => { n.obj.description = i.value; this._markDirty(n.id); }, true);

    // Parameters (typed rows from current values; add/remove keys)
    const ptitle = document.createElement('div'); ptitle.className = 'btg__insp-sub'; ptitle.textContent = 'Parameters';
    box.appendChild(ptitle);
    const params = n.obj.parameters && typeof n.obj.parameters === 'object' ? n.obj.parameters : {};
    Object.keys(params).forEach(k => {
      const row = document.createElement('div'); row.className = 'btg__insp-row btg__insp-row--param';
      const lab = document.createElement('label'); lab.textContent = k;
      const v = params[k];
      let inp;
      if (typeof v === 'boolean') { inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = v; }
      else { inp = document.createElement('input'); inp.value = typeof v === 'object' ? JSON.stringify(v) : v; }
      inp.addEventListener('change', () => {
        let nv;
        if (inp.type === 'checkbox') nv = inp.checked;
        else if (inp.value !== '' && !isNaN(parseFloat(inp.value)) && String(parseFloat(inp.value)) === inp.value.trim()) nv = parseFloat(inp.value);
        else { try { nv = JSON.parse(inp.value); } catch (e) { nv = inp.value; } }
        n.obj.parameters = n.obj.parameters || {};
        n.obj.parameters[k] = nv;
        this._markDirty(n.id);
      });
      const del = document.createElement('button'); del.className = 'eshell__insp-del'; del.textContent = '×';
      del.addEventListener('click', () => { delete n.obj.parameters[k]; this._markDirty(n.id); this._renderInspector(); });
      row.append(lab, inp, del); box.appendChild(row);
    });
    const addP = document.createElement('button'); addP.className = 'btg__btn btg__btn--block'; addP.textContent = '+ Parameter';
    addP.addEventListener('click', () => {
      this.shell._modal('New parameter', [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }], { name: '', value: '' }, ({ name, value }) => {
        if (!name) return;
        n.obj.parameters = n.obj.parameters || {};
        let v; try { v = JSON.parse(value); } catch (e) { v = value; }
        n.obj.parameters[name] = v;
        this._markDirty(n.id); this._renderInspector();
      });
    });
    box.appendChild(addP);

    // Children (composite) / child (decorator)
    if (n.kind === 'composite' || n.kind === 'decorator') {
      const ctitle = document.createElement('div'); ctitle.className = 'btg__insp-sub';
      ctitle.textContent = n.kind === 'decorator' ? 'Child' : `Children (${n.children.length}, in execution order)`;
      box.appendChild(ctitle);
      if (n.kind === 'composite') {
        n.children.forEach((c, i) => {
          const row = document.createElement('div'); row.className = 'btg__insp-child';
          row.innerHTML = `<span class="btg__insp-child-n">${i + 1}</span><span class="btg__insp-child-name">${c}</span>`;
          const up = document.createElement('button'); up.className = 'btg__mini'; up.textContent = '↑';
          up.addEventListener('click', () => this.moveChild(n.id, i, -1));
          const dn = document.createElement('button'); dn.className = 'btg__mini'; dn.textContent = '↓';
          dn.addEventListener('click', () => this.moveChild(n.id, i, 1));
          const del = document.createElement('button'); del.className = 'eshell__insp-del'; del.textContent = '×';
          del.addEventListener('click', () => this.removeChild(n.id, c));
          row.append(up, dn, del); box.appendChild(row);
        });
      } else if (n.childAction) {
        const row = document.createElement('div'); row.className = 'btg__insp-child';
        row.innerHTML = `<span class="btg__insp-child-name">${n.childAction}</span>`;
        const del = document.createElement('button'); del.className = 'eshell__insp-del'; del.textContent = '×';
        del.addEventListener('click', () => this.removeChild(n.id, n.childAction));
        row.appendChild(del); box.appendChild(row);
      }
      // add-child dropdown
      const addRow = document.createElement('div'); addRow.className = 'btg__insp-add';
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="">+ add child…</option>' +
        EditorBehaviorGraph.COLLECTIONS.map(c => {
          const opts = Object.keys(this._cols()[c] || {}).sort().map(id => `<option value="${id}">${id}</option>`).join('');
          return opts ? `<optgroup label="${c}">${opts}</optgroup>` : '';
        }).join('');
      sel.addEventListener('change', () => { if (sel.value) { this.addChild(n.id, sel.value); sel.value = ''; } });
      addRow.appendChild(sel); box.appendChild(addRow);
    }

    // shared-node caution
    const refs = [];
    EditorBehaviorGraph.COLLECTIONS.forEach(c => Object.entries(this._cols()[c] || {}).forEach(([id, o]) => {
      if (this._childrenOf(o).includes(n.id) || o.childAction === n.id) refs.push(id);
    }));
    if (refs.length > 1) {
      const note = document.createElement('div'); note.className = 'btg__insp-note';
      note.textContent = `⧉ Shared node — referenced by ${refs.length} parents (${refs.join(', ')}). Edits affect all of them.`;
      box.appendChild(note);
    }
  }

  _newNode() {
    const KINDS = [
      { value: 'selector', label: 'Selector (first success wins)' },
      { value: 'sequence', label: 'Sequence (all must succeed)' },
      { value: 'parallel', label: 'Parallel' },
      { value: 'action', label: 'Action (leaf)' },
      { value: 'decorator', label: 'Decorator' }
    ];
    this.shell._modal('New behavior node',
      [{ key: 'name', label: 'Name (ClassName)' }, { key: 'kind', label: 'Type', options: KINDS }],
      { name: '', kind: 'sequence' }, ({ name, kind }) => {
        if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { this.shell._toast('Name must be a valid class name'); return; }
        if (this._findNode(name)) { this.shell._toast('A node with that name already exists'); return; }
        const MAP = {
          selector:  { collection: 'behaviorTrees',         base: 'BaseBehaviorTree',      props: { behaviorActions: [] } },
          sequence:  { collection: 'sequenceBehaviorTrees', base: 'SequenceBehaviorTree',  props: { behaviorActions: [] } },
          parallel:  { collection: 'behaviorTrees',         base: 'ParallelBehaviorTree',  props: { behaviorActions: [], parameters: { successPolicy: 'any', failurePolicy: 'all' } } },
          action:    { collection: 'behaviorActions',       base: 'BaseBehaviorAction',    props: { parameters: {} } },
          decorator: { collection: 'behaviorDecorators',    base: 'BaseBehaviorDecorator', props: { childAction: null, parameters: {} } }
        };
        const m = MAP[kind];
        const obj = {
          title: name.replace(/([A-Z])/g, ' $1').trim(),
          description: '',
          behaviorNodeType: kind === 'selector' || kind === 'parallel' ? kind : (kind === 'sequence' ? 'sequence' : kind),
          fileName: name,
          ...m.props,
          script: kind === 'action'
            ? `class ${name} extends GUTS.${m.base} {\n    execute(entityId, game) {\n        // return this.success() / this.running() / null (failure)\n        return this.success();\n    }\n}`
            : `class ${name} extends GUTS.${m.base} {\n}`
        };
        const res = this.shell.controller.createObject(m.collection, name, obj);
        if (!res || !res.success) { this.shell._toast((res && res.message) || 'Failed'); return; }
        try { this.shell.controller.fs.syncObjectToFilesystem(m.collection, name, this._cols()[m.collection][name]); } catch (e) {}
        this.shell._toast('Node created — rebuild the game for it to execute');
        // place it near the selected node, unconnected
        this.assembleIncremental(name);
        if (!this.nodes.has(name)) {
          const f = this._findNode(name);
          this.nodes.set(name, { id: name, obj: f.obj, collection: m.collection, kind: this._kindOf(f.obj, m.collection), children: [], childAction: null, missing: false, x: 500, y: 40 });
        }
        this.render();
      });
  }

  dispose() {
    this._listeners.forEach(fn => { try { fn(); } catch (e) {} });
    this._listeners = [];
  }
}

if (typeof window !== 'undefined') { window.EditorBehaviorGraph = EditorBehaviorGraph; }
