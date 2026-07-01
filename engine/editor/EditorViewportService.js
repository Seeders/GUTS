/**
 * EditorViewportService — the always-on 3D viewport (Phase 1).
 *
 * Editor-only. Stands up a PERSISTENT embedded ECS world by reusing the exact
 * engine setup the Terrain/Simulation modules already use (EditorECSGame +
 * EditorLoader + SceneManager + WorldSystem/WorldRenderer + EditorCameraController).
 * It does NOT modify any shared engine/system file — it only instantiates and
 * consumes them, so no game runtime is affected.
 *
 * Lifecycle: start() brings the world up in a container; stop() tears it down
 * (RAF loop, camera listeners, WebGL context) so switching projects can't leak.
 *
 * Recipe reference: TerrainMapEditor.init3DRendering (global lib, ~line 1669).
 */
class EditorViewportService {
  /**
   * @param {Object} app        the EditorController (exposes getCollections()).
   * @param {HTMLElement} container  a SIZED element to fill with the canvas.
   * @param {Object} options    { scene?:string, level?:string }
   */
  constructor(app, container, options = {}) {
    this.app = app;
    this.container = container;
    this.options = options;

    this.canvas = null;
    this.editorContext = null;
    this.editorLoader = null;
    this.worldRenderer = null;
    this.cameraController = null;

    this._resizeObserver = null;
    this._started = false;
    this._starting = false;
    this._msgEl = null;
  }

  get GUTS() { return (typeof window !== 'undefined' && window.GUTS) || {}; }

  /** True if the engine classes needed for a viewport are present in the bundle. */
  isAvailable() {
    const G = this.GUTS;
    return !!(G.EditorECSGame && G.EditorLoader && G.SceneManager && G.EditorCameraController);
  }

  /** Bring the world up. Returns true if a renderer was created. */
  async start() {
    if (this._started || this._starting) return this._started;
    this._starting = true;
    try {
      if (!this.isAvailable()) { this._message('3D engine not available in this bundle'); return false; }
      this._buildCanvas();
      this._message('Loading scene…');
      const ok = await this._bringUp();
      if (ok) { this._clearMessage(); this._observeResize(); this._started = true; }
      return ok;
    } catch (e) {
      console.error('[EditorViewportService] start failed:', e);
      this._message('Viewport error — see console');
      return false;
    } finally {
      this._starting = false;
    }
  }

  _buildCanvas() {
    if (this.canvas) return;
    // container hosts an absolutely-positioned canvas that fills it. WorldRenderer
    // sizes off canvas.parentElement.clientWidth/Height, so the container must be sized.
    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'eshell__viewport-canvas';
    canvas.id = 'eshell-viewport-canvas';
    const w = this.container.clientWidth || 1280;
    const h = this.container.clientHeight || 720;
    canvas.width = w; canvas.height = h;
    this.container.appendChild(canvas);
    this.canvas = canvas;
  }

  async _bringUp() {
    const G = this.GUTS;
    const collections = this.app.getCollections();
    if (!collections || !collections.scenes) { this._message('No scenes in project'); return false; }

    const sceneName = this.options.scene || this._defaultScene(collections);
    if (!sceneName || !collections.scenes[sceneName]) {
      this._message(`Scene not found: ${sceneName || '(none)'}`);
      return false;
    }
    const levelName = this.options.level || this._defaultLevel(collections);
    this.levelName = levelName;

    // 1. Embedded ECS context bound to our canvas.
    this.editorContext = new G.EditorECSGame(this.app, this.canvas);

    // 2. Load assets + init (empty systems list => scene may enable any system).
    this.editorLoader = new G.EditorLoader(this.editorContext);
    await this.editorLoader.load({ systems: [], levelName });

    // 3. Level index must be set before scene load (TerrainSystem reads state.level).
    const enums = this.editorContext.getEnums ? this.editorContext.getEnums() : {};
    this.editorContext.state.level = (enums.levels && levelName != null ? enums.levels[levelName] : 0) ?? 0;

    // 4. Load the scene: configures + enables systems; TerrainSystem spawns terrain,
    //    WorldSystem builds the WorldRenderer/WebGLRenderer on our canvas.
    await this.editorContext.sceneManager.loadScene(sceneName);

    // 5. Borrow references the systems just created.
    this.worldRenderer = this.editorContext.worldSystem && this.editorContext.worldSystem.worldRenderer;
    if (this.worldRenderer) {
      this.editorContext.scene = this.worldRenderer.getScene();
      this.editorContext.camera = this.worldRenderer.getCamera();
    }

    // 6. Register services gameplay systems expect (RenderSystem bails without getCamera;
    //    isVisibleAt/getCollections are already registered in the EditorECSGame ctor).
    if (!this.editorContext.hasService('getCamera')) {
      this.editorContext.register('getCamera', () => (this.worldRenderer ? this.worldRenderer.getCamera() : null));
    }
    if (!this.editorContext.hasService('isVisibleAt')) {
      this.editorContext.register('isVisibleAt', () => true);
    }

    if (!this.worldRenderer) {
      console.error('[EditorViewportService] WorldRenderer not created (invalid level/scene?)');
      this._message('Renderer not initialized');
      return false;
    }

    // 7. Camera controller (orbit/pan/zoom; swaps worldRenderer.camera).
    const tdm = this.editorContext.terrainSystem && this.editorContext.terrainSystem.terrainDataManager;
    const terrainSize = (tdm && (tdm.extendedSize || tdm.terrainSize)) || 1024;
    this.cameraController = new G.EditorCameraController(this.worldRenderer, this.canvas, collections);
    this.cameraController.initialize(terrainSize);

    // 8. Start the fixed-timestep update/render loop (its own RAF).
    this.editorContext.startRenderLoop();

    // 9. Interaction layer (Phase 4): picking, selection sync, placement, gizmos.
    try { this._initInteraction(); } catch (e) { console.warn('[EditorViewportService] interaction init failed:', e); }
    return true;
  }

  // ==========================================================================
  // Phase 4 — scene interaction (picking / selection / placement / gizmos)
  // Entities are batched (no per-entity Object3D), so we pick via ground-raycast
  // + nearest transform, reuse SelectedUnitSystem for highlight, and attach the
  // SE_GizmoManager to a proxy Object3D. All read off editorContext/worldRenderer.
  // ==========================================================================
  _initInteraction() {
    const G = this.GUTS, ctx = this.editorContext, wr = this.worldRenderer;
    if (!ctx || !wr) return;

    if (G.RaycastHelper) this.raycast = new G.RaycastHelper(wr.getCamera(), wr.getScene());
    this.sceneEntities = [];
    this._syncEntitiesFromECS();

    // Selection system (highlight + events) — reuse SelectedUnitSystem.
    try {
      if (!ctx.hasService('getWorldPositionFromMouse')) {
        ctx.register('getWorldPositionFromMouse', (sx, sy) => this._worldFromScreen(sx, sy));
      }
      if (ctx.hasService('configureSelectionSystem')) {
        ctx.call('configureSelectionSystem', {
          enableTeamFilter: false, excludeCollections: [], includeCollections: null,
          prioritizeUnitsOverBuildings: false, showGameUI: false, camera: wr.getCamera()
        });
      }
      if (ctx.on) {
        ctx.on('onMultipleUnitsSelected', (ids) => this._onEcsSelection(ids));
        ctx.on('onDeSelectAll', () => this._onEcsSelection(null));
      }
    } catch (e) { console.warn('[viewport] selection config failed', e); }

    // Gizmo (SE_GizmoManager) attached to a proxy Object3D.
    try {
      if (G.SE_GizmoManager && window.THREE) {
        this.gizmo = new G.SE_GizmoManager();
        this.gizmoHelper = new window.THREE.Object3D();
        wr.getScene().add(this.gizmoHelper);
        this.gizmo.init({
          scene: wr.getScene(), camera: wr.getCamera(), renderer: wr.renderer, controls: wr.controls,
          onTransformChange: (pos, rot, scale) => this._onGizmoChange(pos, rot, scale)
        });
      }
    } catch (e) { console.warn('[viewport] gizmo init failed', e); }

    // Left-click select (guarded against gizmo drag).
    this._onCanvasClick = (e) => {
      if (e.button !== 0) return;
      if (this.gizmo && this.gizmo.isDraggingGizmo && this.gizmo.isDraggingGizmo()) return;
      const id = this._pickEntity(e);
      if (id != null) this.selectEntity(id); else this.deselectAll();
    };
    this.canvas.addEventListener('click', this._onCanvasClick);

    // Drag-drop placement from the Assets browser.
    this._onDragOver = (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    this._onDrop = (e) => {
      e.preventDefault();
      let payload = null;
      try { payload = JSON.parse((e.dataTransfer && (e.dataTransfer.getData('application/x-guts-asset') || e.dataTransfer.getData('text/plain'))) || 'null'); } catch (_) {}
      if (payload && payload.collection && payload.type) this.placeEntity(payload.collection, payload.type, e);
    };
    this.canvas.addEventListener('dragover', this._onDragOver);
    this.canvas.addEventListener('drop', this._onDrop);
  }

  _worldFromScreen(sx, sy) {
    if (!this.raycast || !this.worldRenderer) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((sx - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((sy - rect.top) / rect.height) * 2 + 1;
    const ground = this.worldRenderer.getGroundMesh && this.worldRenderer.getGroundMesh();
    if (this.raycast.getWorldPositionFromMouse) return this.raycast.getWorldPositionFromMouse(ndcX, ndcY, 0, ground);
    return this.raycast.rayCastGround ? this.raycast.rayCastGround(ndcX, ndcY, ground) : null;
  }
  _groundFromEvent(e) {
    if (!this.raycast) return null;
    const ground = this.worldRenderer.getGroundMesh && this.worldRenderer.getGroundMesh();
    if (this.raycast.mouseEventToNDC && this.raycast.rayCastGround) {
      const ndc = this.raycast.mouseEventToNDC(e, this.canvas);
      if (ndc) return this.raycast.rayCastGround(ndc.x, ndc.y, ground);
    }
    return this._worldFromScreen(e.clientX, e.clientY);
  }
  _pickEntity(e) {
    const wp = this._groundFromEvent(e);
    if (!wp) return null;
    let best = null, bestD = Infinity;
    for (const le of (this.sceneEntities || [])) {
      const t = this.editorContext.getComponent(le.id, 'transform'); if (!t || !t.position) continue;
      const radius = (this.editorContext.getComponent(le.id, 'collision') || {}).radius || 25;
      const dx = wp.x - t.position.x, dz = wp.z - t.position.z, d = dx * dx + dz * dz;
      if (d < radius * radius && d < bestD) { bestD = d; best = le; }
    }
    return best ? best.id : null;
  }

  _syncEntitiesFromECS() {
    const ctx = this.editorContext;
    if (!ctx || !ctx.getAllEntities) { this.sceneEntities = []; return this.sceneEntities; }
    const rev = (ctx.getReverseEnums && ctx.getReverseEnums()) || {};
    const markers = [['worldObject', 'worldObjects'], ['building', 'buildings'], ['unit', 'units'], ['exitZone', 'exitZones']];
    const out = [];
    for (const id of ctx.getAllEntities()) {
      let collection = null;
      for (const m of markers) { if (ctx.getComponent(id, m[0]) != null) { collection = m[1]; break; } }
      if (!collection) continue;
      const ut = ctx.getComponent(id, 'unitType');
      if (!ut || ut.type == null) continue;
      const spawnType = rev[collection] && rev[collection][ut.type];
      if (!spawnType) continue;
      const t = ctx.getComponent(id, 'transform');
      out.push({ id, collection, spawnType, position: t && t.position });
    }
    this.sceneEntities = out;
    return out;
  }
  getSceneEntities() { return this._syncEntitiesFromECS(); }
  getSelectedEntity() { return this._selectedEntity != null ? this._selectedEntity : null; }
  getEntityTransform(id) { return this.editorContext ? this.editorContext.getComponent(id, 'transform') : null; }

  selectEntity(id) {
    this._selectedEntity = id;
    try { if (this.editorContext.hasService('selectEntity')) this.editorContext.call('selectEntity', id); } catch (e) {}
    this._attachGizmo(id);
    if (this.onSelectionChange) this.onSelectionChange(id, this._entityRecord(id));
  }
  deselectAll() {
    this._selectedEntity = null;
    try { if (this.editorContext.hasService('deselectAllUnits')) this.editorContext.call('deselectAllUnits'); } catch (e) {}
    if (this.gizmo && this.gizmo.detach) this.gizmo.detach();
    if (this.onSelectionChange) this.onSelectionChange(null, null);
  }
  _onEcsSelection(ids) {
    let first = null;
    if (ids && ids.size) first = ids.values().next().value;
    else if (Array.isArray(ids) && ids.length) first = ids[0];
    if (first === this._selectedEntity) return;   // avoid feedback loop
    this._selectedEntity = first;
    this._attachGizmo(first);
    if (this.onSelectionChange) this.onSelectionChange(first, this._entityRecord(first));
  }
  _entityRecord(id) { return (this.sceneEntities || []).find(e => e.id === id) || null; }

  _attachGizmo(id) {
    if (!this.gizmo || !this.gizmoHelper) return;
    if (id == null) { if (this.gizmo.detach) this.gizmo.detach(); return; }
    const t = this.editorContext.getComponent(id, 'transform');
    if (!t) return;
    const p = t.position || {}, r = t.rotation || {}, s = t.scale || {};
    this.gizmoHelper.position.set(p.x || 0, p.y || 0, p.z || 0);
    this.gizmoHelper.rotation.set(r.x || 0, r.y || 0, r.z || 0);
    this.gizmoHelper.scale.set(s.x || 1, s.y || 1, s.z || 1);
    if (this.gizmo.attach) this.gizmo.attach(this.gizmoHelper);
  }
  setGizmoMode(mode) { if (this.gizmo && this.gizmo.setMode) this.gizmo.setMode(mode); }

  _onGizmoChange(position, rotation, scale) {
    const id = this._selectedEntity; if (id == null) return;
    const t = this.editorContext.getComponent(id, 'transform'); if (!t) return;
    if (position) Object.assign(t.position, position);
    if (rotation) { t.rotation = t.rotation || { x: 0, y: 0, z: 0 }; Object.assign(t.rotation, rotation); }
    if (scale) { t.scale = t.scale || { x: 1, y: 1, z: 1 }; Object.assign(t.scale, scale); }
    try {
      if (this.editorContext.renderSystem && this.editorContext.renderSystem.updateEntity) {
        this.editorContext.renderSystem.updateEntity(id, { position: t.position, rotation: (t.rotation && t.rotation.y) || 0, transform: t });
      }
    } catch (e) {}
    if (this.onEntityTransform) this.onEntityTransform(id, t);
    this._scheduleLevelPersist();
  }

  placeEntity(collection, spawnType, e) {
    const ctx = this.editorContext;
    if (!ctx || !ctx.hasService('createEntityFromPrefab')) { console.warn('[viewport] createEntityFromPrefab unavailable'); return null; }
    const wp = this._groundFromEvent(e);
    if (!wp) return null;
    const tdm = ctx.terrainSystem && ctx.terrainSystem.terrainDataManager;
    const y = (tdm && tdm.getTerrainHeightAtPosition) ? tdm.getTerrainHeightAtPosition(wp.x, wp.z) : (wp.y || 0);
    const enums = ctx.getEnums ? ctx.getEnums() : {};
    let id = null;
    try {
      id = ctx.call('createEntityFromPrefab', {
        prefab: this._prefabForCollection(collection), type: spawnType, collection,
        team: (enums.team && enums.team.neutral) || 0,
        componentOverrides: { transform: { position: { x: wp.x, y, z: wp.z } } }
      });
    } catch (err) { console.error('[viewport] placeEntity failed', err); return null; }
    if (id == null) return null;
    this._syncEntitiesFromECS();
    this.selectEntity(id);
    if (this.onSceneChange) this.onSceneChange();
    this._scheduleLevelPersist();
    return id;
  }
  _prefabForCollection(collection) {
    const cols = this.app.getCollections();
    const def = (cols.objectTypeDefinitions || {})[collection];
    return (def && def.singular) || collection.replace(/s$/, '');
  }

  removeSelected() {
    const id = this._selectedEntity; if (id == null) return;
    try { if (this.editorContext.removeEntity) this.editorContext.removeEntity(id); } catch (e) {}
    this.deselectAll();
    this._syncEntitiesFromECS();
    if (this.onSceneChange) this.onSceneChange();
    this._scheduleLevelPersist();
  }

  _scheduleLevelPersist() {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => this._persistLevel(), 700);
  }
  _persistLevel() {
    if (!this.levelName) return;
    const collections = this.app.getCollections();
    const level = collections.levels && collections.levels[this.levelName];
    if (!level) return;
    level.tileMap = level.tileMap || {};
    level.tileMap.levelEntities = this._exportLevelEntities(collections);
    try {
      if (this.app.fs && this.app.fs.syncObjectToFilesystem) this.app.fs.syncObjectToFilesystem('levels', this.levelName, level);
    } catch (e) { console.warn('[viewport] level persist failed', e); }
  }
  _exportLevelEntities(collections) {
    const defs = collections.objectTypeDefinitions || {};
    return (this.sceneEntities || []).map(le => {
      const t = this.editorContext.getComponent(le.id, 'transform') || {};
      const def = defs[le.collection];
      return {
        spawnType: (def && def.singular) || le.collection,
        type: le.spawnType,
        components: { transform: {
          position: { ...(t.position || { x: 0, y: 0, z: 0 }) },
          rotation: { ...(t.rotation || { x: 0, y: 0, z: 0 }) },
          scale: { ...(t.scale || { x: 1, y: 1, z: 1 }) }
        } }
      };
    });
  }

  _defaultScene(collections) {
    const scenes = collections.scenes || {};
    if (scenes.terrainMapEditor) return 'terrainMapEditor';
    return Object.keys(scenes)[0] || null;
  }
  _defaultLevel(collections) {
    const levels = collections.levels || {};
    return Object.keys(levels)[0] || null;
  }

  /** Switch camera between 'game' (ortho isometric) and 'scene' (perspective orbit). */
  setCameraMode(mode) {
    if (this.cameraController && this.cameraController.setCameraMode) {
      this.cameraController.setCameraMode(mode);
    }
  }

  // ---- Resize (WorldRenderer only listens on window, not the container) --------
  _observeResize() {
    if (typeof ResizeObserver === 'undefined') return;
    this._resizeObserver = new ResizeObserver(() => this.onResize());
    this._resizeObserver.observe(this.container);
  }
  onResize() {
    if (!this.worldRenderer) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w > 0 && h > 0 && this.canvas) { this.canvas.width = w; this.canvas.height = h; }
    if (typeof this.worldRenderer.onWindowResize === 'function') this.worldRenderer.onWindowResize();
  }

  // ---- Teardown ---------------------------------------------------------------
  stop() {
    try { if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; } } catch (e) {}
    if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; }
    try {
      if (this.canvas && this._onCanvasClick) {
        this.canvas.removeEventListener('click', this._onCanvasClick);
        this.canvas.removeEventListener('dragover', this._onDragOver);
        this.canvas.removeEventListener('drop', this._onDrop);
      }
    } catch (e) {}
    try { if (this.gizmo && this.gizmo.dispose) this.gizmo.dispose(); } catch (e) {}
    this.gizmo = null; this.gizmoHelper = null; this.raycast = null; this.sceneEntities = null; this._selectedEntity = null;
    try { if (this.cameraController && this.cameraController.destroy) this.cameraController.destroy(); } catch (e) {}
    try {
      if (this.editorContext) {
        if (this.editorContext.stopRenderLoop) this.editorContext.stopRenderLoop();
        if (this.editorContext.destroy) this.editorContext.destroy();
      }
    } catch (e) { console.warn('[EditorViewportService] teardown warning:', e); }
    // Best-effort WebGL context release to avoid hitting the browser context ceiling.
    try { if (this.worldRenderer && this.worldRenderer.renderer && this.worldRenderer.renderer.dispose) this.worldRenderer.renderer.dispose(); } catch (e) {}
    this.editorContext = null;
    this.cameraController = null;
    this.worldRenderer = null;
    this.editorLoader = null;
    if (this.canvas && this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
    this.canvas = null;
    this._started = false;
  }

  // ---- Message overlay --------------------------------------------------------
  _message(text) {
    const ph = this.container.querySelector('#eshell-viewport-placeholder');
    if (ph) { ph.querySelector('p') && (ph.querySelector('p').textContent = text); ph.style.display = 'flex'; return; }
    if (!this._msgEl) {
      this._msgEl = document.createElement('div');
      this._msgEl.className = 'eshell__viewport-placeholder';
      this.container.appendChild(this._msgEl);
    }
    this._msgEl.innerHTML = `<h2>3D Viewport</h2><p>${text}</p>`;
    this._msgEl.style.display = 'flex';
  }
  _clearMessage() {
    const ph = this.container.querySelector('#eshell-viewport-placeholder');
    if (ph) ph.style.display = 'none';
    if (this._msgEl) this._msgEl.style.display = 'none';
  }
}

if (typeof window !== 'undefined') { window.EditorViewportService = EditorViewportService; }
