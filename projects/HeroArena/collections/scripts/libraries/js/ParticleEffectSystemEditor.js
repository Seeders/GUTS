class ParticleEffectSystemEditor {
  constructor(controller, moduleConfig, GUTS) {
    this.controller = controller;
    this.moduleConfig = moduleConfig;
    this.GUTS = GUTS;

    this.currentData = null;
    this.propertyName = null;
    this.objectData = null;

    // Playback state
    this.isPlaying = false;
    this.isLooping = false;
    this.playbackSpeed = 1.0;
    this.loopIntervalId = null;
    this.activeRepeatingEffect = null;

    // 3D preview state
    this.editorGame = null;
    this.particleSystem = null;
    this.animationFrameId = null;
    this.previewPosition = new THREE.Vector3(0, 0, 0);

    // System layers for editing
    this.systemLayers = [];

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Listen for load hook
    document.body.addEventListener(this.moduleConfig.loadHook, (event) => {
      this.loadSystem(event.detail);
    });

    // Listen for unload event
    document.body.addEventListener(this.moduleConfig.unloadHook, () => {
      this.handleUnload();
    });

    // Get container
    const container = document.getElementById(this.moduleConfig.container);
    if (!container) return;

    // Playback controls
    document.getElementById('pePlayBtn')?.addEventListener('click', () => this.playSystem());
    document.getElementById('peLoopBtn')?.addEventListener('click', () => this.toggleLoop());
    document.getElementById('peResetBtn')?.addEventListener('click', () => this.resetPreview());

    // Save button
    document.getElementById('peSaveBtn')?.addEventListener('click', () => this.saveCurrentData());

    // Playback speed slider
    const speedSlider = document.getElementById('pePlaybackSpeed');
    speedSlider?.addEventListener('input', (e) => {
      this.playbackSpeed = parseFloat(e.target.value);
      document.getElementById('pePlaybackSpeedValue').textContent = `${this.playbackSpeed}x`;
    });

    // System settings inputs
    this.setupSystemInputListeners();

    // Preset category filter
    document.getElementById('pePresetCategory')?.addEventListener('change', () => this.updatePresetsList());

    // Add layer button
    document.getElementById('peAddLayerBtn')?.addEventListener('click', () => this.addSystemLayer());
  }

  setupSystemInputListeners() {
    // System info inputs
    const infoInputs = ['peSystemTitle', 'peSystemCategory', 'peSystemTags'];
    infoInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => this.onSystemInputChange());
      }
    });

    // System repeat settings
    const systemInputs = ['peSystemRepeating', 'peSystemRepeatInterval'];
    systemInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => this.onSystemInputChange());
      }
    });

    // Screen effect inputs
    const screenEffectInputs = ['peScreenShake', 'peShakeDuration', 'peShakeIntensity', 'peScreenFlash', 'peFlashColor', 'peFlashDuration'];
    screenEffectInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => this.onSystemInputChange());
      }
    });

    this.setupSliderDisplay('peSystemRepeatInterval', 'peSystemRepeatIntervalValue', v => `${v}s`);
    this.setupSliderDisplay('peShakeDuration', 'peShakeDurationValue', v => `${v}s`);
    this.setupSliderDisplay('peShakeIntensity', 'peShakeIntensityValue', v => v);
    this.setupSliderDisplay('peFlashDuration', 'peFlashDurationValue', v => `${v}s`);
  }

  setupSliderDisplay(sliderId, displayId, formatter) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    if (slider && display) {
      slider.addEventListener('input', () => {
        display.textContent = formatter(slider.value);
      });
    }
  }

  loadSystem(detail) {
    this.propertyName = detail.propertyName;
    this.objectData = detail.objectData || this.controller.getCurrentObject();

    // When propertyName is "layers", the data is just the layers array from a system
    // We need to reconstruct the full system data from the objectData
    if (this.propertyName === 'layers' && Array.isArray(detail.data)) {
      // This is a particle effect system - build full system data from objectData
      this.currentData = {
        title: this.objectData?.title || '',
        category: this.objectData?.category || 'explosion',
        tags: this.objectData?.tags || [],
        layers: detail.data,
        repeating: this.objectData?.repeating || false,
        repeatInterval: this.objectData?.repeatInterval || 0.5,
        screenShakeDuration: this.objectData?.screenShakeDuration,
        screenShakeIntensity: this.objectData?.screenShakeIntensity,
        screenFlashColor: this.objectData?.screenFlashColor,
        screenFlashDuration: this.objectData?.screenFlashDuration
      };
    } else if (Array.isArray(detail.data)) {
      // Array but not layers property - treat as system layers
      this.currentData = { layers: detail.data };
    } else if (detail.data?.layers) {
      // Full system object passed
      this.currentData = detail.data;
    } else {
      // Fallback - create empty system
      this.currentData = { layers: [] };
    }


    // Show the editor
    Object.values(document.getElementsByClassName('editor-module')).forEach((editor) => {
      editor.classList.remove('show');
    });
    document.getElementById('particle-effect-system-editor-container').classList.add('show');

    // Load system data into UI
    this.loadSystemData(this.currentData);

    // Initialize 3D preview
    this.init3DPreview();

    // Populate presets list
    this.updatePresetsList();

    this.updateStatusBar('Ready');
  }

  loadSystemData(data) {
    if (!data) return;

    // Prevent auto-save while loading
    this._isLoading = true;

    // System info
    this.setInputValue('peSystemTitle', data.title || '');
    this.setSelectValue('peSystemCategory', data.category || 'explosion');
    this.setInputValue('peSystemTags', (data.tags || []).join(', '));

    // Repeat settings
    this.setCheckbox('peSystemRepeating', !!data.repeating);
    this.setSliderValue('peSystemRepeatInterval', data.repeatInterval || 0.5);

    // Layers
    this.systemLayers = (data.layers || []).map(layer => ({ ...layer }));
    this.renderLayersList();

    // Screen effects (flattened format)
    this.setCheckbox('peScreenShake', !!data.screenShakeDuration);
    if (data.screenShakeDuration) {
      this.setSliderValue('peShakeDuration', data.screenShakeDuration || 0.2);
      this.setSliderValue('peShakeIntensity', data.screenShakeIntensity || 3);
    }
    this.setCheckbox('peScreenFlash', !!data.screenFlashColor);
    if (data.screenFlashColor) {
      this.setColorValue('peFlashColor', data.screenFlashColor || '#ffffff');
      this.setSliderValue('peFlashDuration', data.screenFlashDuration || 0.1);
    }

    this._isLoading = false;
  }

  // Input helpers
  setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  setSelectValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  setSliderValue(id, value) {
    const el = document.getElementById(id);
    if (el) {
      el.value = value;
      // Trigger display update
      el.dispatchEvent(new Event('input'));
    }
  }

  setColorValue(id, value) {
    const picker = document.getElementById(id);
    const hex = document.getElementById(id + 'Hex');
    if (picker) picker.value = value;
    if (hex) hex.value = value;
  }

  setCheckbox(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  }

  getInputValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  getInputNumber(id) {
    const el = document.getElementById(id);
    return el ? parseFloat(el.value) || 0 : 0;
  }

  getCheckbox(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  }

  // Build system data from UI inputs (flattened format)
  buildSystemData() {
    const data = {
      title: this.getInputValue('peSystemTitle'),
      category: this.getInputValue('peSystemCategory'),
      tags: this.getInputValue('peSystemTags').split(',').map(t => t.trim()).filter(t => t),
      layers: this.systemLayers.map(l => ({ ...l }))
    };

    if (this.getCheckbox('peSystemRepeating')) {
      data.repeating = true;
      data.repeatInterval = this.getInputNumber('peSystemRepeatInterval');
    }

    // Screen effects (flattened format)
    if (this.getCheckbox('peScreenShake')) {
      data.screenShakeDuration = this.getInputNumber('peShakeDuration');
      data.screenShakeIntensity = this.getInputNumber('peShakeIntensity');
    }

    if (this.getCheckbox('peScreenFlash')) {
      data.screenFlashColor = this.getInputValue('peFlashColor');
      data.screenFlashDuration = this.getInputNumber('peFlashDuration');
    }

    return data;
  }

  // Event handlers
  onSystemInputChange() {
    if (this._isLoading) return;

    // Update current data (but don't save - user must click Save button)
    this.currentData = this.buildSystemData();
    this.markUnsaved();
  }

  markUnsaved() {
    this._hasUnsavedChanges = true;
    const saveBtn = document.getElementById('peSaveBtn');
    if (saveBtn) {
      saveBtn.classList.add('editor-module__btn--unsaved');
    }
  }

  markSaved() {
    this._hasUnsavedChanges = false;
    const saveBtn = document.getElementById('peSaveBtn');
    if (saveBtn) {
      saveBtn.classList.remove('editor-module__btn--unsaved');
    }
  }

  saveCurrentData() {
    if (this._isLoading) return;

    // Determine what data to save based on propertyName
    let saveData = this.currentData;
    if (this.propertyName === 'layers' && this.currentData?.layers) {
      // When editing a system via "layers" property, only save the layers array
      saveData = this.currentData.layers;
    }

    // Dispatch save event
    const saveEvent = new CustomEvent(this.moduleConfig.saveHook, {
      detail: {
        data: saveData,
        propertyName: this.propertyName
      }
    });
    document.body.dispatchEvent(saveEvent);

    this.markSaved();
    this.updateStatusBar('Saved');
  }

  // 3D Preview
  async init3DPreview() {
    const canvas = document.getElementById('peCanvas');
    if (!canvas) return;

    // Cleanup existing
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Create simple Three.js scene for preview
    const width = canvas.parentElement.clientWidth;
    const height = canvas.parentElement.clientHeight;

    // Create scene
    this.previewScene = new THREE.Scene();
    this.previewScene.background = new THREE.Color(0x1a1a2e);

    // Camera
    this.previewCamera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.previewCamera.position.set(100, 80, 100);
    this.previewCamera.lookAt(0, 30, 0);

    // Renderer
    this.previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.previewRenderer.setSize(width, height);

    // Ground plane
    const groundGeom = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshBasicMaterial({
      color: 0x2a2a4a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5
    });
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.previewScene.add(ground);

    // Grid
    const grid = new THREE.GridHelper(200, 20, 0x444466, 0x333355);
    this.previewScene.add(grid);

    // Center marker
    const markerGeom = new THREE.SphereGeometry(3, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x44ff88, wireframe: true });
    this.centerMarker = new THREE.Mesh(markerGeom, markerMat);
    this.centerMarker.position.set(0, 0, 0);
    this.previewScene.add(this.centerMarker);

    // Ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.previewScene.add(ambient);

    // Initialize particle system for preview
    this.initPreviewParticleSystem();

    // Simple orbit controls
    this.setupOrbitControls(canvas);

    // Start render loop
    this.startRenderLoop();
  }

  initPreviewParticleSystem() {
    // Create a minimal particle system for preview
    // We'll reuse the ParticleSystem logic

    const CAPACITY = 500;

    // Create geometry and material similar to main ParticleSystem
    const geometry = new THREE.PlaneGeometry(0.25, 0.25);

    const vertexShader = `
      attribute vec3 aColorStart;
      attribute vec3 aColorEnd;
      attribute float aLifetime;
      attribute float aStartTime;
      attribute float aInitScale;
      attribute vec2 aFlags;
      varying vec3 vColor;
      varying float vAlpha;
      varying vec2 vUv;
      uniform float uTime;

      vec3 camRight() { return vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]); }
      vec3 camUp()    { return vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]); }

      void main() {
        vUv = uv;
        float age = max(uTime - aStartTime, 0.0);
        float lifeT = clamp(1.0 - age / max(aLifetime, 0.0001), 0.0, 1.0);
        vColor = mix(aColorEnd, aColorStart, lifeT);
        vAlpha = aFlags.x > 0.5 ? lifeT : 1.0;

        float s = aInitScale;
        if (aFlags.y > 0.5) {
          if (lifeT > 0.8) s *= (1.0 - lifeT) * 5.0;
          else if (lifeT > 0.2) s *= 1.0;
          else s *= lifeT * 5.0;
        }

        vec3 right = camRight();
        vec3 up = camUp();
        vec3 instT = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vec3 worldPos = instT + right * (position.x * s) + up * (position.y * s);
        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
      }
    `;

    const fragmentShader = `
      precision mediump float;
      varying vec3 vColor;
      varying float vAlpha;
      varying vec2 vUv;

      void main() {
        vec2 c = vUv - vec2(0.5);
        float r = length(c) * 2.0;
        float mask = smoothstep(1.0, 0.6, r);
        float a = vAlpha * mask;
        if (a <= 0.001) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `;

    this.previewMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      toneMapped: false
    });

    this.previewMesh = new THREE.InstancedMesh(geometry, this.previewMaterial, CAPACITY);
    this.previewMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Attribute arrays
    this.previewParticles = {
      capacity: CAPACITY,
      activeCount: 0,
      freeList: [],
      positions: new Array(CAPACITY),
      velocities: new Array(CAPACITY),
      gravityArr: new Float32Array(CAPACITY),
      dragArr: new Float32Array(CAPACITY),
      aColorStart: new Float32Array(CAPACITY * 3),
      aColorEnd: new Float32Array(CAPACITY * 3),
      aLifetime: new Float32Array(CAPACITY),
      aStartTime: new Float32Array(CAPACITY),
      aInitScale: new Float32Array(CAPACITY),
      aFlags: new Float32Array(CAPACITY * 2)
    };

    const addAttr = (arr, itemSize, name) => {
      const a = new THREE.InstancedBufferAttribute(arr, itemSize);
      this.previewMesh.geometry.setAttribute(name, a);
      return a;
    };

    this.previewParticles.attrColorStart = addAttr(this.previewParticles.aColorStart, 3, 'aColorStart');
    this.previewParticles.attrColorEnd = addAttr(this.previewParticles.aColorEnd, 3, 'aColorEnd');
    this.previewParticles.attrLifetime = addAttr(this.previewParticles.aLifetime, 1, 'aLifetime');
    this.previewParticles.attrStartTime = addAttr(this.previewParticles.aStartTime, 1, 'aStartTime');
    this.previewParticles.attrInitScale = addAttr(this.previewParticles.aInitScale, 1, 'aInitScale');
    this.previewParticles.attrFlags = addAttr(this.previewParticles.aFlags, 2, 'aFlags');

    this._tmpMat = new THREE.Matrix4();

    // Initialize particles
    for (let i = 0; i < CAPACITY; i++) {
      this._writePreviewTranslation(i, 1e9, 1e9, 1e9);
      this.previewParticles.positions[i] = new THREE.Vector3(1e9, 1e9, 1e9);
      this.previewParticles.velocities[i] = new THREE.Vector3(0, 0, 0);
      this.previewParticles.gravityArr[i] = 0;
      this.previewParticles.dragArr[i] = 1;
      this.previewParticles.freeList.push(i);
    }

    this.previewMesh.frustumCulled = false;
    this.previewScene.add(this.previewMesh);

    this.previewStartTime = performance.now() / 1000;
  }

  _writePreviewTranslation(index, x, y, z) {
    this._tmpMat.identity();
    this._tmpMat.setPosition(x, y, z);
    this.previewMesh.setMatrixAt(index, this._tmpMat);
  }

  setupOrbitControls(canvas) {
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      // Orbit around center
      const spherical = new THREE.Spherical();
      spherical.setFromVector3(this.previewCamera.position);

      spherical.theta -= deltaX * 0.01;
      spherical.phi += deltaY * 0.01;

      // Clamp phi
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));

      this.previewCamera.position.setFromSpherical(spherical);
      this.previewCamera.lookAt(0, 30, 0);

      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('mouseup', () => { isDragging = false; });
    canvas.addEventListener('mouseleave', () => { isDragging = false; });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const distance = this.previewCamera.position.length();
      const newDistance = distance * (1 + e.deltaY * 0.001);
      const clampedDistance = Math.max(50, Math.min(300, newDistance));
      this.previewCamera.position.normalize().multiplyScalar(clampedDistance);
      this.previewCamera.lookAt(0, 30, 0);
    });
  }

  startRenderLoop() {
    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);

      const now = performance.now() / 1000;
      const elapsed = (now - this.previewStartTime) * this.playbackSpeed;

      // Update particle system
      this.updatePreviewParticles(elapsed);

      // Update shader time
      this.previewMaterial.uniforms.uTime.value = elapsed;

      // Render
      this.previewRenderer.render(this.previewScene, this.previewCamera);

      // Update status bar
      this.updateParticleCountStatus();
    };

    animate();
  }

  updatePreviewParticles(dt) {
    const p = this.previewParticles;
    const now = this.previewMaterial.uniforms.uTime.value;

    for (let i = 0; i < p.capacity; i++) {
      if (p.aLifetime[i] <= 0) continue;

      const age = now - p.aStartTime[i];
      if (age >= p.aLifetime[i]) {
        // Particle expired
        this._writePreviewTranslation(i, 1e9, 1e9, 1e9);
        p.positions[i].set(1e9, 1e9, 1e9);
        p.aLifetime[i] = 0;
        p.freeList.push(i);
        p.activeCount--;
        continue;
      }

      // Physics update
      const vel = p.velocities[i];
      vel.y += p.gravityArr[i] * 0.016 * this.playbackSpeed;
      vel.multiplyScalar(Math.pow(p.dragArr[i], this.playbackSpeed));

      const pos = p.positions[i];
      pos.x += vel.x * 0.016 * this.playbackSpeed;
      pos.y += vel.y * 0.016 * this.playbackSpeed;
      pos.z += vel.z * 0.016 * this.playbackSpeed;

      this._writePreviewTranslation(i, pos.x, pos.y, pos.z);
    }

    this.previewMesh.instanceMatrix.needsUpdate = true;
    p.attrLifetime.needsUpdate = true;
  }

  // Play system in preview
  playSystem() {
    // Use currentData if available (from loaded file), otherwise build from UI
    const systemData = this.currentData || this.buildSystemData();
    this.playSystemLayers(systemData);
    this.updateStatusBar('Playing system...');
  }

  spawnParticlesFromEffect(effectData, position) {
    const p = this.previewParticles;
    if (!p) {
      console.warn('[ParticleEffectEditor] Preview particles not initialized');
      return;
    }

    // Parse colors
    const parseColor = (colorStr) => {
      if (!colorStr || colorStr === '') return [1, 1, 1];
      if (typeof colorStr === 'string' && colorStr.startsWith('#')) {
        const hex = parseInt(colorStr.slice(1), 16);
        return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
      }
      return [1, 1, 1];
    };

    // Use flattened format
    const startColor = parseColor(effectData.startColor);
    const endColor = parseColor(effectData.endColor || effectData.startColor);

    const count = effectData.count || 10;
    const lifetime = effectData.lifetime || 1;
    const scale = (effectData.scale || 10) * (effectData.scaleMultiplier || 1);
    const velRange = {
      x: [effectData.velocityXMin ?? -50, effectData.velocityXMax ?? 50],
      y: [effectData.velocityYMin ?? 0, effectData.velocityYMax ?? 100],
      z: [effectData.velocityZMin ?? -50, effectData.velocityZMax ?? 50]
    };
    const gravity = effectData.gravity || 0;
    const drag = effectData.drag || 1;
    const emitterShape = effectData.emitterShape || 'point';
    const emitterRadius = effectData.emitterRadius || 0;
    const heightOffset = effectData.heightOffset || 0;
    const fadeOut = effectData.fadeOut !== false;
    const scaleOverTime = effectData.scaleOverTime !== false;

    // Set blending
    const blendMode = effectData.blending === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (this.previewMaterial.blending !== blendMode) {
      this.previewMaterial.blending = blendMode;
      this.previewMaterial.needsUpdate = true;
    }

    const rv = (min, max) => min + Math.random() * (max - min);
    const now = this.previewMaterial.uniforms.uTime.value;

    let spawned = 0;
    while (spawned < count && p.freeList.length > 0) {
      const i = p.freeList.pop();

      // Position based on emitter shape
      let px = position.x;
      let py = position.y + heightOffset;
      let pz = position.z;

      if (emitterShape === 'sphere' && emitterRadius > 0) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = Math.cbrt(Math.random()) * emitterRadius;
        px += r * Math.sin(phi) * Math.cos(theta);
        py += r * Math.cos(phi);
        pz += r * Math.sin(phi) * Math.sin(theta);
      } else if (emitterShape === 'ring' && emitterRadius > 0) {
        const theta = Math.random() * Math.PI * 2;
        px += Math.cos(theta) * emitterRadius;
        pz += Math.sin(theta) * emitterRadius;
      } else if (emitterShape === 'disk' && emitterRadius > 0) {
        const theta = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * emitterRadius;
        px += Math.cos(theta) * r;
        pz += Math.sin(theta) * r;
      }

      p.positions[i].set(px, py, pz);
      this._writePreviewTranslation(i, px, py, pz);

      // Velocity
      const vx = rv(velRange.x[0], velRange.x[1]);
      const vy = rv(velRange.y[0], velRange.y[1]);
      const vz = rv(velRange.z[0], velRange.z[1]);
      p.velocities[i].set(vx, vy, vz);

      // Physics
      p.gravityArr[i] = gravity;
      p.dragArr[i] = drag;

      // Colors
      const idx3 = i * 3;
      p.aColorStart[idx3] = startColor[0];
      p.aColorStart[idx3 + 1] = startColor[1];
      p.aColorStart[idx3 + 2] = startColor[2];
      p.aColorEnd[idx3] = endColor[0];
      p.aColorEnd[idx3 + 1] = endColor[1];
      p.aColorEnd[idx3 + 2] = endColor[2];

      // Timing
      p.aLifetime[i] = lifetime;
      p.aStartTime[i] = now;
      p.aInitScale[i] = scale;

      // Flags
      const idx2 = i * 2;
      p.aFlags[idx2] = fadeOut ? 1 : 0;
      p.aFlags[idx2 + 1] = scaleOverTime ? 1 : 0;

      p.activeCount++;
      spawned++;
    }

    // Mark attributes dirty
    p.attrColorStart.needsUpdate = true;
    p.attrColorEnd.needsUpdate = true;
    p.attrLifetime.needsUpdate = true;
    p.attrStartTime.needsUpdate = true;
    p.attrInitScale.needsUpdate = true;
    p.attrFlags.needsUpdate = true;
    this.previewMesh.instanceMatrix.needsUpdate = true;
  }

  playSystemLayers(systemData) {
    const layers = systemData.layers || [];
    const collections = this.controller.getCollections();

    layers.forEach(layer => {
      const effectName = layer.effect;
      const effectObj = collections.particleEffects?.[effectName];

      if (!effectObj) {
        console.warn(`[ParticleEffectEditor] Effect '${effectName}' not found`);
        return;
      }

      // Support both new format (particleEffectData wrapper) and legacy flat format
      const effectData = effectObj.particleEffectData || effectObj;

      // Apply layer overrides (flattened format)
      const mergedEffect = { ...effectData };
      if (layer.countMultiplier) {
        mergedEffect.count = Math.round((mergedEffect.count || 10) * layer.countMultiplier);
      }

      // Position offset (flattened format uses positionOffsetX/Y/Z)
      const pos = new THREE.Vector3(
        this.previewPosition.x + (layer.positionOffsetX || 0),
        this.previewPosition.y + (layer.positionOffsetY || 0),
        this.previewPosition.z + (layer.positionOffsetZ || 0)
      );

      if (layer.delay > 0) {
        setTimeout(() => {
          this.spawnParticlesFromEffect(mergedEffect, pos);
        }, layer.delay * 1000);
      } else {
        this.spawnParticlesFromEffect(mergedEffect, pos);
      }
    });
  }

  toggleLoop() {
    this.isLooping = !this.isLooping;

    document.getElementById('peLoopBtn')?.classList.toggle('editor-module__btn--active', this.isLooping);
    document.getElementById('peLoopStatus').textContent = this.isLooping ? 'Looping' : '';

    if (this.isLooping) {
      this.startLoop();
    } else {
      this.stopLoop();
    }
  }

  startLoop() {
    this.stopLoop();

    const interval = this.getCheckbox('peSystemRepeating')
      ? this.getInputNumber('peSystemRepeatInterval') * 1000
      : 1500;

    this.playSystem();
    this.loopIntervalId = setInterval(() => {
      this.playSystem();
    }, interval / this.playbackSpeed);
  }

  stopLoop() {
    if (this.loopIntervalId) {
      clearInterval(this.loopIntervalId);
      this.loopIntervalId = null;
    }
  }

  stopActiveEffects() {
    this.stopLoop();
    if (this.activeRepeatingEffect) {
      this.activeRepeatingEffect.stop();
      this.activeRepeatingEffect = null;
    }
  }

  resetPreview() {
    this.stopActiveEffects();

    // Clear all active particles
    const p = this.previewParticles;
    for (let i = 0; i < p.capacity; i++) {
      if (p.aLifetime[i] > 0) {
        this._writePreviewTranslation(i, 1e9, 1e9, 1e9);
        p.positions[i].set(1e9, 1e9, 1e9);
        p.aLifetime[i] = 0;
        p.freeList.push(i);
      }
    }
    p.activeCount = 0;

    this.previewMesh.instanceMatrix.needsUpdate = true;
    p.attrLifetime.needsUpdate = true;

    this.updateStatusBar('Reset');
  }

  // Layers management
  addSystemLayer() {
    this.systemLayers.push({
      effect: '',
      delay: 0
    });
    this.renderLayersList();
    this.onSystemInputChange();
  }

  removeSystemLayer(index) {
    this.systemLayers.splice(index, 1);
    this.renderLayersList();
    this.onSystemInputChange();
  }

  renderLayersList() {
    const container = document.getElementById('peLayersList');
    if (!container) return;

    const collections = this.controller.getCollections();
    const effectNames = Object.keys(collections.particleEffects || {});

    container.innerHTML = this.systemLayers.map((layer, index) => `
      <div class="particle-editor__layer-item" data-index="${index}">
        <div class="particle-editor__layer-header">
          <span class="particle-editor__layer-number">#${index + 1}</span>
          <button class="editor-module__btn editor-module__btn--small editor-module__btn--danger pe-remove-layer" data-index="${index}">X</button>
        </div>
        <div class="editor-module__form-row">
          <label class="editor-module__label">Effect:</label>
          <select class="editor-module__select pe-layer-effect" data-index="${index}">
            <option value="">-- Select --</option>
            ${effectNames.map(name => `<option value="${name}" ${layer.effect === name ? 'selected' : ''}>${name}</option>`).join('')}
          </select>
        </div>
        <div class="editor-module__form-row">
          <label class="editor-module__label">Delay:</label>
          <input type="number" class="editor-module__input editor-module__input--small pe-layer-delay" data-index="${index}" value="${layer.delay || 0}" step="0.05" min="0">
        </div>
        <div class="editor-module__form-row">
          <label class="editor-module__label">Count Mult:</label>
          <input type="number" class="editor-module__input editor-module__input--small pe-layer-count-mult" data-index="${index}" value="${layer.countMultiplier || 1}" step="0.1" min="0.1">
        </div>
      </div>
    `).join('');

    // Bind event listeners
    container.querySelectorAll('.pe-remove-layer').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.removeSystemLayer(idx);
      });
    });

    container.querySelectorAll('.pe-layer-effect').forEach(select => {
      select.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.systemLayers[idx].effect = e.target.value;
        this.onSystemInputChange();
      });
    });

    container.querySelectorAll('.pe-layer-delay').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.systemLayers[idx].delay = parseFloat(e.target.value) || 0;
        this.onSystemInputChange();
      });
    });

    container.querySelectorAll('.pe-layer-count-mult').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this.systemLayers[idx].countMultiplier = parseFloat(e.target.value) || 1;
        this.onSystemInputChange();
      });
    });
  }

  // Presets list
  updatePresetsList() {
    const container = document.getElementById('pePresetsList');
    if (!container) return;

    const collections = this.controller.getCollections();
    const category = document.getElementById('pePresetCategory')?.value || 'all';

    // Show particle effect systems as presets (for quickly loading other systems)
    let items = Object.entries(collections.particleEffectSystems || {});

    // Filter by category
    if (category !== 'all') {
      items = items.filter(([, data]) => data.category === category);
    }

    container.innerHTML = items.map(([name, data]) => `
      <div class="particle-editor__preset-item" data-name="${name}">
        <div class="particle-editor__preset-name">${data.title || name}</div>
        <div class="particle-editor__preset-category">${data.category || 'uncategorized'}</div>
      </div>
    `).join('') || '<div class="particle-editor__no-presets">No presets found</div>';

    // Bind click handlers
    container.querySelectorAll('.particle-editor__preset-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.name;
        this.loadPreset(name);
      });
      item.addEventListener('dblclick', () => {
        const name = item.dataset.name;
        this.loadPreset(name);
        this.playSystem();
      });
    });
  }

  loadPreset(name) {
    const collections = this.controller.getCollections();
    const data = collections.particleEffectSystems?.[name];

    if (data) {
      this.loadSystemData(data);
      this.currentData = { ...data };
      this.updateStatusBar(`Loaded: ${name}`);
    }
  }

  // Status bar
  updateStatusBar(message) {
    const el = document.getElementById('peStatusText');
    if (el) el.textContent = message;
  }

  updateParticleCountStatus() {
    const el = document.getElementById('peParticleCountStatus');
    if (el) el.textContent = this.previewParticles.activeCount;
  }

  // Unload
  handleUnload() {
    this.stopActiveEffects();

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.previewRenderer) {
      this.previewRenderer.dispose();
      this.previewRenderer = null;
    }

    if (this.previewScene) {
      // Clean up scene objects
      this.previewScene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
      this.previewScene = null;
    }

    this.previewCamera = null;
    this.previewMesh = null;
    this.previewMaterial = null;
    this.previewParticles = null;
  }
}
