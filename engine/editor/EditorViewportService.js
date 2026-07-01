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
    return true;
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
