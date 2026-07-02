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
      this._message(sceneName
        ? `Scene not found: ${sceneName}`
        : 'No editor scene in this project (add a terrainMapEditor scene, or set configs.editor.viewportScene)');
      return false;
    }
    const levelName = this.options.level || this._defaultLevel(collections);
    this.levelName = levelName;

    // 1. Embedded ECS context bound to our canvas.
    this.editorContext = new G.EditorECSGame(this.app, this.canvas);

    // 2. Load assets + init (empty systems list => scene may enable any system).
    //    A single missing asset (404 model etc.) must not kill the whole viewport.
    this.editorLoader = new G.EditorLoader(this.editorContext);
    try {
      await this.editorLoader.load({ systems: [], levelName });
    } catch (e) {
      console.warn('[EditorViewportService] asset loading had errors (continuing):', e);
      // Ensure the ECS context is initialized even if loadAssets threw mid-way.
      try { if (!this.editorContext.sceneManager) await this.editorContext.init(false, { systems: [], managers: [] }); } catch (e2) {
        console.error('[EditorViewportService] context init failed:', e2);
        this._message('Viewport init failed — see console');
        return false;
      }
    }

    // 3. Level index must be set before scene load (TerrainSystem reads state.level).
    const enums = this.editorContext.getEnums ? this.editorContext.getEnums() : {};
    this.editorContext.state.level = (enums.levels && levelName != null ? enums.levels[levelName] : 0) ?? 0;

    // 4. Load the scene: configures + enables systems; TerrainSystem spawns terrain,
    //    WorldSystem builds the WorldRenderer/WebGLRenderer on our canvas.
    try {
      await this.editorContext.sceneManager.loadScene(sceneName);
    } catch (e) {
      console.error(`[EditorViewportService] scene '${sceneName}' failed to load:`, e);
      this._message(`Scene '${sceneName}' failed to load — see console`);
      return false;
    }

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
    // Center the initial game view on the terrain. The controller's built-in
    // default looks at (terrainSize/2, 0, terrainSize/2), but grid<->world math
    // centers the map at the ORIGIN — so seed a saved-state it restores verbatim,
    // using the same isometric angles/height as its default.
    try {
      const THREE = window.THREE;
      const camSettings = (collections.cameras || {}).main;
      const h = (camSettings && camSettings.position && camSettings.position.y) || 512;
      const pitch = 35.264 * Math.PI / 180, yaw = 135 * Math.PI / 180;
      const cdx = Math.sin(yaw) * Math.cos(pitch), cdz = Math.cos(yaw) * Math.cos(pitch);
      this.cameraController.gameCameraState = {
        position: new THREE.Vector3(-cdx * h, h, -cdz * h),
        zoom: 1,
        lookAt: new THREE.Vector3(0, 0, 0)
      };
    } catch (e) { /* fall back to controller default */ }
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

    // Terrain painting state (data mutated is terrainDataManager.tileMap === the
    // live level.tileMap the renderer reads, so incremental updates show at once).
    this.terrainDataManager = ctx.terrainSystem && ctx.terrainSystem.terrainDataManager;
    this.tileMap = this.terrainDataManager && this.terrainDataManager.tileMap;
    this.interactionMode = 'select';
    this._brushSize = 1; this._paintTool = 'brush'; this._terrainId = 0; this._heightLevel = 1;
    this._activeTeam = null;
    this._updateStartMarkers();   // show existing team start locations

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
          scene: wr.getScene(), camera: wr.getCamera(), renderer: wr.renderer,
          controls: this._makeControlsProxy(),   // suspends camera pan during gizmo drag
          onTransformChange: (pos, rot, scale) => this._onGizmoChange(pos, rot, scale)
        });
      }
    } catch (e) { console.warn('[viewport] gizmo init failed', e); }

    // Left-click select (only in 'select' mode; guarded against gizmo drag).
    this._onCanvasClick = (e) => {
      if (e.button !== 0 || this.interactionMode !== 'select') return;
      if (this.gizmo && this.gizmo.isDraggingGizmo && this.gizmo.isDraggingGizmo()) return;
      if (this._placement) { this._placeSelected(e); return; }   // place instead of pick
      const id = this._pickEntity(e);
      if (id != null) this.selectEntity(id); else this.deselectAll();
    };
    this.canvas.addEventListener('click', this._onCanvasClick);

    // Terrain paint stroke (left-drag) — active only in a paint mode.
    this._onPaintDown = (e) => {
      if (e.button !== 0 || this.interactionMode === 'select') return;
      e.preventDefault();
      this._painting = true; this._lastCell = null; this._heightDirty = false;
      this._paintAt(e);
    };
    this._onPaintMove = (e) => {
      if (this._placement && this.interactionMode === 'select') this._updatePlacementGhost(e);
      if (this.interactionMode !== 'select') this._updateBrushPreview(e);
      if (this._painting) this._paintAt(e);
    };
    this._onPaintUp = () => { if (!this._painting) return; this._painting = false; this._lastCell = null; this._finalizeStroke(); };
    this._onCanvasLeave = () => this._clearBrushPreview();
    this.canvas.addEventListener('mousedown', this._onPaintDown);
    this.canvas.addEventListener('mousemove', this._onPaintMove);
    this.canvas.addEventListener('mouseleave', this._onCanvasLeave);
    window.addEventListener('mouseup', this._onPaintUp);

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
    if (this.worldRenderer.getCamera) this.gizmo.camera = this.worldRenderer.getCamera(); // keep drag math on the live camera
    if (this.gizmo.attach) this.gizmo.attach(this.gizmoHelper);
  }
  setGizmoMode(mode) { if (this.gizmo && this.gizmo.setMode) this.gizmo.setMode(mode); }

  /**
   * A `controls` object handed to SE_GizmoManager. The gizmo sets `.enabled=false`
   * when a handle drag starts and `.enabled=true` on release — we use that to
   * suspend BOTH scene-mode OrbitControls AND EditorCameraController's game-mode
   * right-drag pan (which has no enabled flag), fixing the gizmo/pan conflict
   * without editing either shared class.
   */
  _makeControlsProxy() {
    const wr = this.worldRenderer, self = this;
    const proxy = {
      _enabled: true,
      get enabled() { return this._enabled; },
      set enabled(v) {
        this._enabled = v;
        try { if (wr && wr.controls && wr.controls !== proxy) wr.controls.enabled = v; } catch (e) {}
        self._suspendCameraPan(!v);
      }
    };
    return proxy;
  }
  _suspendCameraPan(suspend) {
    const cc = this.cameraController, canvas = this.canvas;
    if (!cc || !canvas || !cc.gameCameraMouseDownHandler) return;
    try {
      if (suspend) {
        canvas.removeEventListener('mousedown', cc.gameCameraMouseDownHandler);
        canvas.removeEventListener('mousemove', cc.gameCameraMouseMoveHandler);
      } else {
        canvas.addEventListener('mousedown', cc.gameCameraMouseDownHandler);
        canvas.addEventListener('mousemove', cc.gameCameraMouseMoveHandler);
      }
    } catch (e) {}
  }

  _onGizmoChange(position, rotation, scale) {
    const id = this._selectedEntity; if (id == null) return;
    const t = this.editorContext.getComponent(id, 'transform'); if (!t) return;
    // `t` is a component proxy that rejects TOP-LEVEL property assignment (t.rotation = …
    // throws). Mutate the existing nested {x,y,z} sub-objects in place instead.
    if (position && t.position) { t.position.x = position.x; t.position.y = position.y; t.position.z = position.z; }
    if (rotation && t.rotation) { t.rotation.x = rotation.x; t.rotation.y = rotation.y; t.rotation.z = rotation.z; }
    if (scale && t.scale) { t.scale.x = scale.x; t.scale.y = scale.y; t.scale.z = scale.z; }
    try {
      if (this.editorContext.renderSystem && this.editorContext.renderSystem.updateEntity) {
        this.editorContext.renderSystem.updateEntity(id, { position: t.position, rotation: (t.rotation && t.rotation.y) || 0, transform: t });
      }
    } catch (e) {}
    if (this.onEntityTransform) this.onEntityTransform(id, t);
    this._scheduleLevelPersist();
  }

  placeEntity(collection, spawnType, e, autoSelect = true) {
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
    if (autoSelect) this.selectEntity(id);
    if (this.onSceneChange) this.onSceneChange();
    this._scheduleLevelPersist();
    return id;
  }
  _prefabForCollection(collection) {
    const cols = this.app.getCollections();
    const def = (cols.objectTypeDefinitions || {})[collection];
    return (def && def.singular) || collection.replace(/s$/, '');
  }

  // ---- Terrain painting ------------------------------------------------------
  setInteractionMode(mode) {
    this.interactionMode = mode || 'select';
    const painting = this.interactionMode !== 'select';
    if (painting) { this.deselectAll(); this._ensureTerrainMapperReady(); } else this._clearBrushPreview();
    if (painting && this._placement) {
      if (this._placement.ghost) this._placement.ghost.visible = false;
      else if (this._placement.sbr && this._placement.sbr.setInstanceCount) { this._placement.sbr.setInstanceCount(0); if (this._placement.sbr.finalizeUpdates) this._placement.sbr.finalizeUpdates(); }
    }
    // Suppress SelectedUnitSystem's left-drag box-select while painting (it has no
    // enable flag), so a paint stroke isn't hijacked by the green selection box.
    this._setSelectionInput(!painting);
  }

  // HeroArena levels load from a baked terrain PNG (renderTerrainFromCache), which
  // SKIPS tileMapper.draw — leaving the tileMapper's map empty, so incremental
  // redraws (redrawTiles) crash. Run the full tile paint once to populate the
  // tileMapper; after that per-dab updateTerrainTiles works.
  _ensureTerrainMapperReady() {
    const wr = this.worldRenderer, tm = wr && wr.tileMapper;
    if (!wr || !tm || !wr.renderTerrain) return Promise.resolve();
    if (this._terrainMapperReady || (tm.numColumns > 0 && tm.tileMap && tm.tileMap.length > 0)) {
      this._terrainMapperReady = true; return Promise.resolve();
    }
    if (this._terrainReadyPromise) return this._terrainReadyPromise;
    this._terrainReadyPromise = Promise.resolve()
      .then(() => wr.renderTerrain())
      .then(() => { this._terrainMapperReady = true; })
      .catch(e => console.warn('[viewport] renderTerrain (paint prep) failed:', e))
      .finally(() => { this._terrainReadyPromise = null; });
    return this._terrainReadyPromise;
  }
  _setSelectionInput(enabled) {
    const sys = this.editorContext && this.editorContext.selectedUnitSystem;
    const canvas = this.canvas;
    if (!sys || !canvas || !sys._mousedownHandler) return;
    if (enabled) {
      canvas.addEventListener('mousedown', sys._mousedownHandler);
      canvas.addEventListener('mousemove', sys._mousemoveHandler);
      canvas.addEventListener('mouseup', sys._mouseupHandler);
    } else {
      canvas.removeEventListener('mousedown', sys._mousedownHandler);
      canvas.removeEventListener('mousemove', sys._mousemoveHandler);
      canvas.removeEventListener('mouseup', sys._mouseupHandler);
      if (sys.boxSelection) {
        sys.boxSelection.active = false;
        if (sys.boxSelection.element) sys.boxSelection.element.style.display = 'none';
      }
    }
  }
  setPaintOptions(opts) {
    if (!opts) return;
    if (opts.terrainId != null) this._terrainId = opts.terrainId | 0;
    if (opts.heightLevel != null) this._heightLevel = opts.heightLevel | 0;
    if (opts.brushSize != null) this._brushSize = Math.max(1, opts.brushSize | 0);
    if (opts.tool) this._paintTool = opts.tool;
  }
  getTerrainTypes() {
    const tm = this.tileMap;
    if (!tm || !Array.isArray(tm.terrainTypes)) return [];
    const defs = (this.app.getCollections().terrainTypes) || {};
    return tm.terrainTypes.map((name, index) => ({ index, name, color: (defs[name] && defs[name].color) || '#7a8aa0' }));
  }

  _eventToCell(e) {
    const wp = this._groundFromEvent(e);
    if (!wp || !this.terrainDataManager || !this.tileMap) return null;
    const gs = this.terrainDataManager.gridSize, ts = this.terrainDataManager.terrainSize;
    const x = Math.floor((wp.x + ts / 2) / gs);
    const z = Math.floor((wp.z + ts / 2) / gs);
    const size = this.tileMap.size;
    if (x < 0 || z < 0 || x >= size || z >= size) return null;
    return { x, z };
  }
  _brushTiles(cx, cz) {
    const size = this.tileMap.size, r = Math.floor((this._brushSize || 1) / 2), tiles = [];
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.sqrt(dx * dx + dz * dz) > r + 0.5) continue;
      const x = cx + dx, z = cz + dz;
      if (x >= 0 && z >= 0 && x < size && z < size) tiles.push({ x, z });
    }
    return tiles;
  }
  _floodFill(mapName, cell) {
    const map = this.tileMap[mapName], size = this.tileMap.size, orig = map[cell.z][cell.x];
    const out = [], seen = new Set(), stack = [[cell.x, cell.z]];
    while (stack.length) {
      const c = stack.pop(), x = c[0], z = c[1];
      if (x < 0 || z < 0 || x >= size || z >= size) continue;
      const k = x + ',' + z; if (seen.has(k)) continue; seen.add(k);
      if (map[z][x] !== orig) continue;
      out.push({ x, z });
      stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
    }
    return out;
  }
  _paintAt(e) {
    if (!this.tileMap) return;
    const cell = this._eventToCell(e);
    if (!cell) return;
    const key = cell.x + ',' + cell.z;
    const strokeOnce = this._paintTool === 'fill' || this.interactionMode === 'ramp' || this.interactionMode === 'teams';
    if (strokeOnce) { if (this._lastCell !== null) return; }
    else if (this._lastCell === key && (this._brushSize || 1) <= 1) return;
    this._lastCell = key;
    if (this.interactionMode === 'terrain') this._paintTerrain(cell);
    else if (this.interactionMode === 'height') this._paintHeight(cell);
    else if (this.interactionMode === 'ramp') this._paintRamp(cell);
    else if (this.interactionMode === 'teams') this._placeStartLocation(cell);
  }

  // ---- Team start locations ---------------------------------------------------
  /** Teams (from the team enum asset) with their current start locations. */
  getTeams() {
    const cols = this.app.getCollections() || {};
    const enumObj = cols.enums && cols.enums.team;
    const teams = (enumObj && Array.isArray(enumObj.enum)) ? enumObj.enum.slice() : ['left', 'right'];
    const locs = (this.tileMap && this.tileMap.startingLocations) || [];
    return teams.map(t => ({ team: t, location: locs.find(l => l.side === t) || null, color: this._teamColorHex(t) }));
  }
  setActiveTeam(team) { this._activeTeam = team; }
  _placeStartLocation(cell) {
    if (!this._activeTeam || !this.tileMap) return;
    const locs = this.tileMap.startingLocations = this.tileMap.startingLocations || [];
    const entry = locs.find(l => l.side === this._activeTeam);
    if (entry) { entry.gridX = cell.x; entry.gridZ = cell.z; }
    else locs.push({ side: this._activeTeam, gridX: cell.x, gridZ: cell.z });
    this._updateStartMarkers();
    this._scheduleLevelPersist();
    if (this.onTeamsChange) this.onTeamsChange();
  }
  clearStartLocation(team) {
    const locs = (this.tileMap && this.tileMap.startingLocations) || [];
    const i = locs.findIndex(l => l.side === team);
    if (i >= 0) {
      locs.splice(i, 1);
      this._updateStartMarkers();
      this._scheduleLevelPersist();
      if (this.onTeamsChange) this.onTeamsChange();
    }
  }
  _teamColor(team) {
    const preset = { left: 0x35e0c8, right: 0xf5a623, hostile: 0xff5c6c, neutral: 0x90a2ba };
    if (preset[team] != null) return preset[team];
    let h = 0; for (let i = 0; i < team.length; i++) h = (h * 31 + team.charCodeAt(i)) >>> 0;
    const c = new window.THREE.Color(); c.setHSL((h % 360) / 360, 0.7, 0.55);
    return c.getHex();
  }
  _teamColorHex(team) { return '#' + this._teamColor(team).toString(16).padStart(6, '0'); }

  /** Flag markers at each team's start location (disc + pole + pennant). */
  _updateStartMarkers() {
    const THREE = window.THREE;
    if (!THREE || !this.worldRenderer || !this.terrainDataManager || !this.tileMap) return;
    if (!this._startMarkers) {
      this._startMarkers = new THREE.Group();
      this._startMarkers.renderOrder = 998;
      this.worldRenderer.getScene().add(this._startMarkers);
    }
    while (this._startMarkers.children.length) {
      const m = this._startMarkers.children.pop();
      this._startMarkers.remove(m);
      m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    const gs = this.terrainDataManager.gridSize, ts = this.terrainDataManager.terrainSize;
    (this.tileMap.startingLocations || []).forEach(loc => {
      const wx = loc.gridX * gs - ts / 2 + gs / 2;
      const wz = loc.gridZ * gs - ts / 2 + gs / 2;
      const wy = this.terrainDataManager.getTerrainHeightAtPosition ? this.terrainDataManager.getTerrainHeightAtPosition(wx, wz) : 0;
      const color = this._teamColor(loc.side);
      const g = new THREE.Group();
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(gs * 0.45, gs * 0.45, 2, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: false }));
      disc.position.y = 2;
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.4, gs * 1.2, 8),
        new THREE.MeshBasicMaterial({ color }));
      pole.position.y = gs * 0.6;
      const flag = new THREE.Mesh(
        new THREE.ConeGeometry(gs * 0.2, gs * 0.34, 4),
        new THREE.MeshBasicMaterial({ color }));
      flag.rotation.z = Math.PI / 2;
      flag.position.set(gs * 0.14, gs * 1.05, 0);
      g.add(disc, pole, flag);
      g.position.set(wx, wy, wz);
      this._startMarkers.add(g);
    });
  }
  _paintTerrain(cell) {
    const id = this._terrainId | 0;
    const tiles = this._paintTool === 'fill' ? this._floodFill('terrainMap', cell) : this._brushTiles(cell.x, cell.z);
    const modified = [];
    tiles.forEach(t => { if (this.tileMap.terrainMap[t.z][t.x] !== id) { this.tileMap.terrainMap[t.z][t.x] = id; modified.push({ x: t.x, y: t.z }); } });
    if (!modified.length) return;
    if (this._terrainMapperReady && this.worldRenderer.updateTerrainTiles) {
      try { this.worldRenderer.updateTerrainTiles(modified); }
      catch (e) { console.warn('[viewport] updateTerrainTiles failed; re-preparing tileMapper', e); this._terrainMapperReady = false; this._ensureTerrainMapperReady(); }
    } else {
      this._ensureTerrainMapperReady();   // data mutated; full redraw will reflect it
    }
    this._terrainTextureDirty = true;
    this._scheduleLevelPersist();
  }
  _paintHeight(cell) {
    const level = this._heightLevel | 0;
    const tiles = this._paintTool === 'fill' ? this._floodFill('heightMap', cell) : this._brushTiles(cell.x, cell.z);
    const modified = [];
    tiles.forEach(t => { if (this.tileMap.heightMap[t.z][t.x] !== level) { this.tileMap.heightMap[t.z][t.x] = level; modified.push(t); } });
    if (!modified.length) return;
    const tdm = this.terrainDataManager, wr = this.worldRenderer;
    if (tdm && tdm.processHeightMapFromData) tdm.processHeightMapFromData();
    if (modified.length > 1 && wr.batchUpdateHeights) {
      wr.batchUpdateHeights(modified.map(t => ({ gridX: t.x, gridZ: t.z, heightLevel: this.tileMap.heightMap[t.z][t.x] })));
    } else if (wr.setHeightAtGridPosition) {
      modified.forEach(t => wr.setHeightAtGridPosition(t.x, t.z, this.tileMap.heightMap[t.z][t.x]));
    }
    this._heightDirty = true;
    this._scheduleLevelPersist();
  }
  _paintRamp(cell) {
    const ramps = this.tileMap.ramps = this.tileMap.ramps || [];
    const idx = ramps.findIndex(r => r.gridX === cell.x && r.gridZ === cell.z);
    if (idx >= 0) {
      ramps.splice(idx, 1);                                   // remove existing (always allowed)
    } else if (this._isValidRamp(cell.x, cell.z)) {
      ramps.push({ gridX: cell.x, gridZ: cell.z });           // add only where valid
    } else {
      return;                                                 // invalid placement — do nothing
    }
    const wr = this.worldRenderer, er = this.editorContext.renderSystem && this.editorContext.renderSystem.entityRenderer;
    try {
      if (wr.tileMapper && wr.tileMapper.setRamps) wr.tileMapper.setRamps(ramps);
      if (wr.updateTerrainTiles) wr.updateTerrainTiles([{ x: cell.x, y: cell.z }]);
      if (wr.spawnCliffs) wr.spawnCliffs(er, false);
      if (wr.updateHeightMap) wr.updateHeightMap();
    } catch (e) { console.warn('[viewport] ramp update failed', e); }
    this._terrainTextureDirty = true;
    this._scheduleLevelPersist();
  }
  _hasRamp(x, z) {
    const ramps = this.tileMap && this.tileMap.ramps;
    return !!(ramps && ramps.some(r => r.gridX === x && r.gridZ === z));
  }
  // Valid ramp = exactly one lower cardinal neighbor (matches TerrainMapEditor).
  _isValidRamp(x, z) {
    const hm = this.tileMap && this.tileMap.heightMap;
    if (!hm || !hm.length) return false;
    const cur = hm[z] && hm[z][x];
    if (cur === undefined) return false;
    const size = this.tileMap.size;
    let lower = 0;
    if (z > 0 && hm[z - 1][x] < cur) lower++;
    if (z < size - 1 && hm[z + 1][x] < cur) lower++;
    if (x > 0 && hm[z][x - 1] < cur) lower++;
    if (x < size - 1 && hm[z][x + 1] < cur) lower++;
    return lower === 1;
  }

  _finalizeStroke() {
    if (this._heightDirty) {
      this._heightDirty = false;
      const wr = this.worldRenderer, er = this.editorContext.renderSystem && this.editorContext.renderSystem.entityRenderer;
      try { if (wr.spawnCliffs) wr.spawnCliffs(er, false); } catch (e) {}
    }
    this._scheduleLevelPersist();
  }

  // ---- Brush preview (highlights the cells a stroke would affect) ------------
  _ensureBrushPreview(count) {
    const THREE = window.THREE;
    if (!THREE || !this.worldRenderer) return;
    if (!this._brushPreview) {
      this._brushPreview = new THREE.Group();
      this._brushPreview.renderOrder = 999;
      this.worldRenderer.getScene().add(this._brushPreview);
    }
    const gs = this.terrainDataManager ? this.terrainDataManager.gridSize : 48;
    while (this._brushPreview.children.length < count) {
      const geo = new THREE.PlaneGeometry(gs * 0.94, gs * 0.94);
      const mat = new THREE.MeshBasicMaterial({ color: 0x35e0c8, transparent: true, opacity: 0.35, depthTest: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      this._brushPreview.add(m);
    }
  }
  _updateBrushPreview(e) {
    if (!window.THREE || !this.terrainDataManager || this.interactionMode === 'select') { this._clearBrushPreview(); return; }
    const cell = this._eventToCell(e);
    if (!cell) { this._clearBrushPreview(); return; }
    const tiles = (this.interactionMode === 'ramp' || this.interactionMode === 'teams')
      ? [{ x: cell.x, z: cell.z }] : this._brushTiles(cell.x, cell.z);
    this._ensureBrushPreview(tiles.length);
    if (!this._brushPreview) return;
    const gs = this.terrainDataManager.gridSize, ts = this.terrainDataManager.terrainSize, tdm = this.terrainDataManager;
    // Ramp mode: red when placing would be invalid (removal of an existing ramp is fine).
    let valid = true;
    if (this.interactionMode === 'ramp') valid = this._hasRamp(cell.x, cell.z) || this._isValidRamp(cell.x, cell.z);
    const colorHex = valid ? 0x35e0c8 : 0xff5c6c;
    this._brushPreview.visible = true;
    const kids = this._brushPreview.children;
    for (let i = 0; i < kids.length; i++) {
      if (i < tiles.length) {
        const t = tiles[i];
        const wx = t.x * gs - ts / 2 + gs / 2;
        const wz = t.z * gs - ts / 2 + gs / 2;
        const wy = (tdm.getTerrainHeightAtPosition ? tdm.getTerrainHeightAtPosition(wx, wz) : 0) + 2;
        kids[i].position.set(wx, wy, wz);
        if (kids[i].material && kids[i].material.color) kids[i].material.color.setHex(colorHex);
        kids[i].visible = true;
      } else { kids[i].visible = false; }
    }
  }
  _clearBrushPreview() { if (this._brushPreview) this._brushPreview.visible = false; }

  // ==========================================================================
  // Visual asset preview (graphics render defs / sprites / particles)
  // Shows the selected visual asset on a floating pedestal in the shared scene,
  // animated via a dedicated RAF (the scene renders at the ~20 TPS tick). Reuses
  // ModelManager/SpriteBillboardRenderer/ParticleSystem — no shared-file edits.
  // ==========================================================================
  async previewAsset(collection, id) {
    this.clearPreview();
    const THREE = window.THREE;
    const obj = ((this.app.getCollections() || {})[collection] || {})[id];
    if (!obj || !THREE || !this.worldRenderer) return;
    const token = ++this._previewToken;

    // Spawn with one or more render pipelines: build the render-type selector and
    // preview the highest-priority available pipeline (configs.render.renderTypes
    // order; default sprite > model). The user can switch pipelines in the selector.
    const options = this._availableRenderTypes(obj);
    if (options.length) {
      this._renderCtx = { collection, id, options };
      this._currentRenderTypeId = options[0].id;
      if (this.onRenderOptions) this.onRenderOptions(options, this._currentRenderTypeId);
      await this._applyRenderType(options[0]);
      return;
    }

    // Sprite / particle: floating in-scene preview (as before).
    let handle = null;
    try {
      if (collection === 'spriteAnimationSets') handle = await this._previewSprite(obj);
      else if (collection === 'particleEffects') handle = this._previewParticle(id, false);
      else if (collection === 'particleEffectSystems') handle = this._previewParticle(id, true);
      else return; // not a visual asset
    } catch (e) { console.warn('[viewport] preview build failed:', e); return; }
    if (!handle) return;
    if (token !== this._previewToken) { try { handle.dispose(); } catch (e) {} return; } // superseded mid-load
    this._preview = handle;
    this._showPreviewLabel(id);
    this._startPreviewLoop();
  }

  _clearPreviewContent() {
    this._previewToken = (this._previewToken || 0) + 1;
    if (this._previewRAF) { cancelAnimationFrame(this._previewRAF); this._previewRAF = null; }
    if (this._preview) { try { this._preview.dispose(); } catch (e) {} this._preview = null; }
    this._hideModelPreview();
    this._cancelPlacement();
  }
  clearPreview() {
    this._clearPreviewContent();
    this._renderCtx = null; this._currentRenderTypeId = null;
    if (this.onRenderOptions) this.onRenderOptions([], null);   // clear the selector
    this._hidePreviewLabel();
  }

  // Resolve which render pipeline to preview/place for a spawn. Priority order comes
  // from configs.render.renderTypes (a list of renderTypes ids); each renderTypes
  // entry describes a pipeline via {propertyName, collection, pipeline}. Falls back
  // to built-in defaults (sprite before model) when no data is present.
  // All render pipelines a spawn actually supports, in priority order.
  _availableRenderTypes(obj) {
    if (!obj) return [];
    const cols = this.app.getCollections() || {};
    const rt = cols.renderTypes || {};
    const cfg = (cols.configs && cols.configs.render) || {};
    let order = (Array.isArray(cfg.renderTypes) && cfg.renderTypes.length) ? cfg.renderTypes.slice() : Object.keys(rt);
    if (!order.length) order = ['spriteAnimationSet', 'render'];
    const out = [];
    for (const rid of order) {
      const def = rt[rid] || this._defaultRenderType(rid);
      if (!def || !def.propertyName) continue;
      const val = obj[def.propertyName];
      if (val == null || val === '' || (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0)) continue;
      const pipeline = def.pipeline || rid;
      if (pipeline === 'sprite' && !((cols[def.collection] || {})[val])) continue;   // referenced set must exist
      if (pipeline === 'model' && !(obj.render && obj.render.model)) continue;
      out.push({ id: rid, pipeline, propertyName: def.propertyName, collection: def.collection, value: val, label: (rt[rid] && rt[rid].title) || rid });
    }
    return out;
  }
  async selectRenderType(rtId) {
    const ctx = this._renderCtx; if (!ctx) return;
    const rt = ctx.options.find(o => o.id === rtId); if (!rt) return;
    this._currentRenderTypeId = rtId;
    if (this.onRenderOptions) this.onRenderOptions(ctx.options, rtId);
    await this._applyRenderType(rt);
  }
  async _applyRenderType(rt) {
    this._clearPreviewContent();
    const token = ++this._previewToken;
    const ctx = this._renderCtx; if (!ctx) return;
    if (rt.pipeline === 'sprite') {
      const set = (this.app.getCollections()[rt.collection] || {})[rt.value];
      if (set) {
        await this._showSpritePreviewMini(set, token);
        await this._beginSpritePlacement(ctx.collection, ctx.id, set, token);
        this._showPreviewLabel(ctx.id);
        return;
      }
    }
    const obj = (this.app.getCollections()[ctx.collection] || {})[ctx.id];
    if (obj && obj.render && obj.render.model) {
      await this._showModelPreview(obj.render, token);
      await this._beginPlacement(ctx.collection, ctx.id, obj.render, token);
      this._showPreviewLabel(ctx.id);
    }
  }
  _defaultRenderType(id) {
    const D = {
      spriteAnimationSet: { propertyName: 'spriteAnimationSet', collection: 'spriteAnimationSets', pipeline: 'sprite' },
      render: { propertyName: 'render', pipeline: 'model' }
    };
    return D[id] || null;
  }

  _previewAnchor() { return new window.THREE.Vector3(0, 80, 0); }

  _startPreviewLoop() {
    if (this._previewRAF) return;
    this._previewClock = new window.THREE.Clock();
    const loop = () => {
      if (!this._preview) { this._previewRAF = null; return; }
      const dt = Math.min(this._previewClock.getDelta(), 0.1);
      try { this._preview.update(dt); } catch (e) {}
      this._previewRAF = requestAnimationFrame(loop);
    };
    this._previewRAF = requestAnimationFrame(loop);
  }

  async _previewModel(renderDef) {
    const THREE = window.THREE, mm = this.editorContext.modelManager;
    if (!mm || !mm.createModel) return null;
    const group = await mm.createModel(renderDef.model);
    if (!group) return null;
    // Models arrive at raw glTF scale — normalize + center on a holder we spin.
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fit = 80 / maxDim;
    group.scale.multiplyScalar(fit);
    group.position.copy(center).multiplyScalar(-fit);
    const holder = new THREE.Group();
    holder.position.copy(this._previewAnchor());
    holder.add(group);
    this.worldRenderer.getScene().add(holder);
    return {
      update: (dt) => {
        holder.rotation.y += 0.7 * dt;
        group.traverse(o => { if (o.userData && o.userData.mixer) o.userData.mixer.update(dt); if (o.isSkinnedMesh && o.skeleton) o.skeleton.update(); });
      },
      dispose: () => {
        this.worldRenderer.getScene().remove(holder);
        try { const sf = mm.shapeFactory; if (sf && sf.disposeObject) sf.disposeObject(holder); } catch (e) {}
      }
    };
  }

  async _previewSprite(set) {
    const G = this.GUTS;
    if (!G.SpriteBillboardRenderer || !set.spriteSheet) return null;
    const sbr = new G.SpriteBillboardRenderer({
      scene: this.worldRenderer.getScene(), capacity: 1,
      resourcesPath: this.app.getResourcesPath ? this.app.getResourcesPath() : ''
    });
    await sbr.init(set.spriteSheet, set);
    const gs = set.generatorSettings || {};
    sbr.currentAnimationType = (gs.animationTypes && gs.animationTypes[0]) || 'idle';
    if (sbr.buildFrameLookupTexture) sbr.buildFrameLookupTexture();
    const a = this._previewAnchor();
    if (sbr.setInstanceCount) sbr.setInstanceCount(1);
    if (sbr.setInstance) sbr.setInstance(0, a.x, a.y, a.z, 64, 0, -1);
    if (sbr.setAmbientLight) { try { sbr.setAmbientLight(new window.THREE.Color(1, 1, 1)); } catch (e) {} }
    if (sbr.finalizeUpdates) sbr.finalizeUpdates();
    let t = 0; const fps = gs.fps || 4;
    return {
      update: (dt) => { t += dt; if (sbr.setAnimationFrame) sbr.setAnimationFrame(Math.floor(t * fps)); if (sbr.finalizeUpdates) sbr.finalizeUpdates(); },
      dispose: () => { try { sbr.dispose(); } catch (e) {} }
    };
  }

  _previewParticle(name, isSystem) {
    const G = this.GUTS, THREE = window.THREE;
    if (!G.ParticleSystem) return null;
    let ps = this.editorContext.particleSystem;
    if (!ps) { try { ps = new G.ParticleSystem(this.editorContext); if (ps.initialize) ps.initialize(); this._ownedParticleSystem = ps; } catch (e) { return null; } }
    const a = this._previewAnchor();
    const pos = new THREE.Vector3(a.x, a.y, a.z);
    const play = () => { try { if (isSystem) ps.playEffectSystem(name, pos); else ps.playEffect(name, pos); } catch (e) { console.warn('[viewport] particle play failed', e); } };
    play();
    let loopT = 0;
    return {
      update: (dt) => { try { if (ps.update) ps.update(); } catch (e) {} loopT += dt; if (loopT > 1.5) { loopT = 0; play(); } },
      dispose: () => {
        try { if (ps.clearAllParticles) ps.clearAllParticles(); } catch (e) {}
        if (this._ownedParticleSystem === ps) { try { if (ps.destroy) ps.destroy(); else if (ps.onSceneUnload) ps.onSceneUnload(); } catch (e) {} this._ownedParticleSystem = null; }
      }
    };
  }

  _showPreviewLabel(text) {
    if (!this._previewLabel) {
      this._previewLabel = document.createElement('div');
      this._previewLabel.className = 'eshell__preview-label';
      this.container.appendChild(this._previewLabel);
    }
    this._previewLabel.textContent = '◈ Preview · ' + text;
    this._previewLabel.style.display = 'block';
  }
  _hidePreviewLabel() { if (this._previewLabel) this._previewLabel.style.display = 'none'; }

  // ---- Corner preview window (dedicated mini renderer for render defs) --------
  _ensureMiniRenderer() {
    if (this._mini) return this._mini;
    if (!this.previewCanvas || !window.THREE) return null;
    const THREE = window.THREE, canvas = this.previewCanvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const w = canvas.clientWidth || 200, h = canvas.clientHeight || 200;
    renderer.setSize(w, h, false);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h || 1, 0.01, 100);
    camera.position.set(0, 0.7, 2.6); camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7); dir.position.set(2, 3, 2); scene.add(dir);
    const holder = new THREE.Group(); scene.add(holder);
    this._mini = { renderer, scene, camera, holder, model: null, clock: new THREE.Clock(), raf: null, active: false };
    return this._mini;
  }
  async _showModelPreview(renderDef, token) {
    const THREE = window.THREE, mm = this.editorContext.modelManager;
    if (!this.previewCanvas || !mm || !mm.createModel) return;
    const mini = this._ensureMiniRenderer();
    if (!mini) return;
    const model = await mm.createModel(renderDef.model);
    if (!model || token !== this._previewToken) { if (model) this._disposeModel(model); return; }
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = 1.7 / maxDim;
    model.scale.multiplyScalar(s);
    model.position.copy(center).multiplyScalar(-s);
    this._miniClearContent();
    mini.holder.add(model); mini.model = model; mini.active = true;
    mini.camera.position.set(0, 0.7, 2.6); mini.camera.lookAt(0, 0, 0);   // 3/4 view for models
    this._playIdleAnimation(model, renderDef);       // load + loop the idle clip
    if (this.previewWindow) this.previewWindow.classList.add('has-model');
    if (!mini.raf) this._miniLoop();
  }
  // Load the render def's idle animation (a separate GLB clip, per render.animations.idle)
  // and play it looping on a mixer — mirrors GE_SceneRenderer's animation loading.
  _playIdleAnimation(model, renderDef) {
    try {
      const THREE = window.THREE;
      const sf = this.editorContext.modelManager && this.editorContext.modelManager.shapeFactory;
      if (!sf || !sf.gltfLoader || !renderDef) return;
      const anims = renderDef.animations || {};
      const idle = anims.idle || anims.Idle;
      const frame = idle && idle[0];
      const shapes = frame && frame.main && frame.main.shapes;
      const animShape = shapes && shapes.find(s => s.animation || (s.url && String(s.url).includes('animations/')));
      if (!animShape) return;
      let url = (sf.resolveModelUrl && sf.resolveModelUrl(animShape)) || animShape.url;
      if (!url) return;
      const path = sf.getResourcesPath ? sf.getResourcesPath(url) : url;
      const mixer = new THREE.AnimationMixer(model);
      if (this._mini) this._mini.animMixer = mixer;
      sf.gltfLoader.load(path, (gltf) => {
        if (this._mini && this._mini.animMixer === mixer && gltf && gltf.animations && gltf.animations.length) {
          const action = mixer.clipAction(gltf.animations[0]);
          action.setLoop(THREE.LoopRepeat);
          action.play();
        }
      }, undefined, () => {});
    } catch (e) { console.warn('[viewport] idle animation load failed:', e); }
  }
  // Set a sprite renderer to the 'idle' animation (preferred) and REBIND the frame
  // lookup uniform — buildFrameLookupTexture() creates a fresh DataTexture but does
  // not update material.uniforms.frameLookup, so init()'s default 'walk' would stick.
  _applySpriteAnim(sbr, gs) {
    const types = (gs && gs.animationTypes) || [];
    sbr.currentAnimationType = types.includes('idle') ? 'idle' : (types[0] || 'idle');
    if (sbr.buildFrameLookupTexture) sbr.buildFrameLookupTexture();
    if (sbr.material && sbr.material.uniforms && sbr.material.uniforms.frameLookup) {
      sbr.material.uniforms.frameLookup.value = sbr.frameLookupTexture;
    }
  }
  async _showSpritePreviewMini(set, token) {
    const G = this.GUTS;
    if (!this.previewCanvas || !G.SpriteBillboardRenderer || !set.spriteSheet) return;
    const mini = this._ensureMiniRenderer();
    if (!mini) return;
    this._miniClearContent();
    const sbr = new G.SpriteBillboardRenderer({
      scene: mini.scene, capacity: 1, resourcesPath: this.app.getResourcesPath ? this.app.getResourcesPath() : ''
    });
    await sbr.init(set.spriteSheet, set);
    if (token !== this._previewToken) { try { sbr.dispose(); } catch (e) {} return; }
    const gs = set.generatorSettings || {};
    this._applySpriteAnim(sbr, gs);
    if (sbr.setInstanceCount) sbr.setInstanceCount(1);
    if (sbr.setInstance) sbr.setInstance(0, 0, 0, 0, 1.7, 0, -1);   // centered on origin
    if (sbr.setAmbientLight) { try { sbr.setAmbientLight(new window.THREE.Color(1, 1, 1)); } catch (e) {} }
    if (sbr.finalizeUpdates) sbr.finalizeUpdates();
    // Billboards read "from above" with the model's 3/4 camera — use a level, head-on one.
    mini.camera.position.set(0, 0.05, 2.6); mini.camera.lookAt(0, 0, 0);
    mini.sprite = sbr; mini.spriteTime = 0; mini.spriteFps = gs.fps || 4;
    mini.spriteScale = 1.7; mini.spriteHeading = 0; mini.active = true;
    if (this.previewWindow) this.previewWindow.classList.add('has-model');
    if (!mini.raf) this._miniLoop();
  }
  _miniClearContent() {
    const mini = this._mini; if (!mini) return;
    if (mini.animMixer) { try { mini.animMixer.stopAllAction(); } catch (e) {} mini.animMixer = null; }
    if (mini.model) { mini.holder.remove(mini.model); this._disposeModel(mini.model); mini.model = null; }
    if (mini.sprite) { try { mini.sprite.dispose(); } catch (e) {} mini.sprite = null; }
  }
  _miniLoop() {
    const mini = this._mini; if (!mini) return;
    const loop = () => {
      if (!this._mini || !this._mini.active) { if (this._mini) this._mini.raf = null; return; }
      const dt = mini.clock.getDelta();
      if (mini.model) {
        mini.holder.rotation.y += 0.4 * dt;   // slow idle spin
        if (mini.animMixer) mini.animMixer.update(dt);
        mini.model.traverse(o => { if (o.userData && o.userData.mixer) o.userData.mixer.update(dt); if (o.isSkinnedMesh && o.skeleton) o.skeleton.update(); });
      }
      if (mini.sprite) {
        mini.spriteTime += dt;
        mini.spriteHeading = (mini.spriteHeading || 0) + 0.4 * dt;   // cycle directional perspectives
        const hx = Math.sin(mini.spriteHeading), hz = -Math.cos(mini.spriteHeading);
        if (mini.sprite.setInstance) mini.sprite.setInstance(0, 0, 0, 0, mini.spriteScale || 1.7, hx, hz);
        if (mini.sprite.setAnimationFrame) mini.sprite.setAnimationFrame(Math.floor(mini.spriteTime * (mini.spriteFps || 4)));
        if (mini.sprite.finalizeUpdates) mini.sprite.finalizeUpdates();
      }
      const c = mini.renderer.domElement;
      if (c.clientWidth && (c.width !== c.clientWidth || c.height !== c.clientHeight)) {
        mini.renderer.setSize(c.clientWidth, c.clientHeight, false);
        mini.camera.aspect = c.clientWidth / c.clientHeight; mini.camera.updateProjectionMatrix();
      }
      mini.renderer.render(mini.scene, mini.camera);
      mini.raf = requestAnimationFrame(loop);
    };
    mini.raf = requestAnimationFrame(loop);
  }
  _hideModelPreview() {
    const mini = this._mini; if (!mini) return;
    mini.active = false;
    if (mini.raf) { cancelAnimationFrame(mini.raf); mini.raf = null; }
    this._miniClearContent();
    if (this.previewWindow) this.previewWindow.classList.remove('has-model');
  }
  _disposeModel(m) {
    try { const sf = this.editorContext.modelManager && this.editorContext.modelManager.shapeFactory; if (sf && sf.disposeObject) sf.disposeObject(m); } catch (e) {}
  }

  // ---- Placement (ghost follows the cursor; left-click places) ----------------
  async _beginPlacement(collection, spawnType, renderDef, token) {
    this._cancelPlacement();
    const THREE = window.THREE, mm = this.editorContext.modelManager;
    if (!mm || !mm.createModel) return;
    const model = await mm.createModel(renderDef.model);
    if (!model || token !== this._previewToken) { if (model) this._disposeModel(model); return; }
    // Raw glTF scale is tiny vs the terrain grid — normalize to a visible world size,
    // centered on x/z and resting on the ground (min y = 0).
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const target = (this.terrainDataManager && this.terrainDataManager.gridSize) ? this.terrainDataManager.gridSize * 1.6 : 80;
    model.scale.multiplyScalar(target / maxDim);
    const b2 = new THREE.Box3().setFromObject(model);
    const c2 = b2.getCenter(new THREE.Vector3());
    model.position.x -= c2.x; model.position.z -= c2.z; model.position.y -= b2.min.y;
    const ghost = new THREE.Group();
    ghost.add(model); ghost.visible = false;
    this.worldRenderer.getScene().add(ghost);
    this._placement = { collection, spawnType, type: 'model', ghost };
  }
  async _beginSpritePlacement(collection, spawnType, set, token) {
    this._cancelPlacement();
    const G = this.GUTS;
    if (!G.SpriteBillboardRenderer || !set.spriteSheet) return;
    const sbr = new G.SpriteBillboardRenderer({
      scene: this.worldRenderer.getScene(), capacity: 1, resourcesPath: this.app.getResourcesPath ? this.app.getResourcesPath() : ''
    });
    await sbr.init(set.spriteSheet, set);
    if (token !== this._previewToken) { try { sbr.dispose(); } catch (e) {} return; }
    const gs = set.generatorSettings || {};
    this._applySpriteAnim(sbr, gs);
    if (sbr.setAmbientLight) { try { sbr.setAmbientLight(new window.THREE.Color(1, 1, 1)); } catch (e) {} }
    if (sbr.setInstanceCount) sbr.setInstanceCount(0);
    if (sbr.finalizeUpdates) sbr.finalizeUpdates();
    const scale = (this.terrainDataManager && this.terrainDataManager.gridSize) ? this.terrainDataManager.gridSize * 1.4 : 64;
    this._placement = { collection, spawnType, type: 'sprite', sbr, scale };
  }
  _updatePlacementGhost(e) {
    const pl = this._placement; if (!pl) return;
    const wp = this._groundFromEvent(e);
    const tdm = this.terrainDataManager;
    if (pl.type === 'sprite') {
      const sbr = pl.sbr;
      if (!wp) { if (sbr.setInstanceCount) sbr.setInstanceCount(0); if (sbr.finalizeUpdates) sbr.finalizeUpdates(); return; }
      const y = (tdm && tdm.getTerrainHeightAtPosition) ? tdm.getTerrainHeightAtPosition(wp.x, wp.z) : (wp.y || 0);
      if (sbr.setInstanceCount) sbr.setInstanceCount(1);
      if (sbr.setInstance) sbr.setInstance(0, wp.x, y + pl.scale / 2, wp.z, pl.scale, 0, -1);
      if (sbr.setAnimationFrame) sbr.setAnimationFrame(0);
      if (sbr.finalizeUpdates) sbr.finalizeUpdates();
      return;
    }
    if (!wp) { pl.ghost.visible = false; return; }
    const y = (tdm && tdm.getTerrainHeightAtPosition) ? tdm.getTerrainHeightAtPosition(wp.x, wp.z) : (wp.y || 0);
    pl.ghost.position.set(wp.x, y, wp.z);
    pl.ghost.visible = true;
  }
  _placeSelected(e) {
    if (!this._placement) return false;
    const id = this.placeEntity(this._placement.collection, this._placement.spawnType, e, false); // keep placing
    return id != null;
  }
  _cancelPlacement() {
    const pl = this._placement;
    if (pl) {
      if (pl.type === 'sprite' && pl.sbr) { try { pl.sbr.dispose(); } catch (e) {} }
      else if (pl.ghost) { this.worldRenderer.getScene().remove(pl.ghost); this._disposeModel(pl.ghost); }
      this._placement = null;
    }
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
    if (this._terrainTextureDirty) this._saveBakedTerrainPng();
  }

  /**
   * Re-bake the terrain cache PNG after texture-affecting paints. Levels load
   * via renderTerrainFromCache(resources/levels/<level>.png), so without this
   * the next load would show the stale pre-paint texture. The live groundCanvas
   * is always current (incremental repaints land on it), so it IS the bake.
   */
  async _saveBakedTerrainPng() {
    try {
      const wr = this.worldRenderer;
      const canvas = wr && (wr.groundCanvas || (wr.tileMapper && wr.tileMapper.canvas));
      const project = this.app.getCurrentProject ? this.app.getCurrentProject() : null;
      if (!canvas || !project || !this.levelName) return;
      const base64 = canvas.toDataURL('image/png').split(',')[1];
      if (!base64) return;
      const res = await fetch('/save-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${project}/resources/levels/${this.levelName}.png`, content: base64, encoding: 'base64' })
      });
      if (res.ok) this._terrainTextureDirty = false;
      else console.warn('[viewport] baked terrain PNG save failed:', res.status);
    } catch (e) { console.warn('[viewport] baked terrain PNG save failed:', e); }
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
    // Only auto-load editor-safe scenes. Gameplay scenes (e.g. 'game') pull in
    // systems that crash outside the real game (no UI DOM, missing services) —
    // seen when a project without terrainMapEditor loaded its 'game' scene.
    const scenes = collections.scenes || {};
    if (scenes.terrainMapEditor) return 'terrainMapEditor';
    if (scenes.simulationEditor) return 'simulationEditor';
    return null;
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
    // The camera object is swapped on mode change; keep gizmo drag math in sync.
    if (this.gizmo && this.worldRenderer && this.worldRenderer.getCamera) {
      this.gizmo.camera = this.worldRenderer.getCamera();
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
        this.canvas.removeEventListener('mousedown', this._onPaintDown);
        this.canvas.removeEventListener('mousemove', this._onPaintMove);
        this.canvas.removeEventListener('mouseleave', this._onCanvasLeave);
      }
      if (this._onPaintUp) window.removeEventListener('mouseup', this._onPaintUp);
    } catch (e) {}
    try {
      if (this._brushPreview) {
        if (this._brushPreview.parent) this._brushPreview.parent.remove(this._brushPreview);
        this._brushPreview.children.forEach(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
        this._brushPreview = null;
      }
    } catch (e) {}
    try { this.clearPreview(); if (this._previewLabel && this._previewLabel.parentElement) this._previewLabel.parentElement.removeChild(this._previewLabel); this._previewLabel = null; } catch (e) {}
    try {
      if (this._startMarkers) {
        if (this._startMarkers.parent) this._startMarkers.parent.remove(this._startMarkers);
        this._startMarkers.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this._startMarkers = null;
      }
    } catch (e) {}
    try { if (this._mini && this._mini.renderer && this._mini.renderer.dispose) this._mini.renderer.dispose(); this._mini = null; } catch (e) {}
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
