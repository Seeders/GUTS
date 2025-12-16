class ParticleEffectEditor {
  constructor(controller, moduleConfig, GUTS) {
    this.controller = controller;
    this.moduleConfig = moduleConfig;
    this.GUTS = GUTS;

    this.currentData = null;
    this.propertyName = null;
    this.objectData = null;

    // Playback state
    this.isLooping = false;
    this.playbackSpeed = 1.0;
    this.loopIntervalId = null;

    // 3D preview state
    this.previewScene = null;
    this.previewCamera = null;
    this.previewRenderer = null;
    this.previewMesh = null;
    this.previewMaterial = null;
    this.previewParticles = null;
    this.animationFrameId = null;
    this.previewPosition = new THREE.Vector3(0, 0, 0);

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Listen for load hook
    document.body.addEventListener(this.moduleConfig.loadHook, (event) => {
      this.loadEffect(event.detail);
    });

    // Listen for unload event
    document.body.addEventListener(this.moduleConfig.unloadHook, () => {
      this.handleUnload();
    });

    // Get container
    const container = document.getElementById(this.moduleConfig.container);
    if (!container) return;

    // Playback controls
    document.getElementById('spePlayBtn')?.addEventListener('click', () => this.playEffect());
    document.getElementById('speLoopBtn')?.addEventListener('click', () => this.toggleLoop());
    document.getElementById('speResetBtn')?.addEventListener('click', () => this.resetPreview());

    // Playback speed slider
    const speedSlider = document.getElementById('spePlaybackSpeed');
    speedSlider?.addEventListener('input', (e) => {
      this.playbackSpeed = parseFloat(e.target.value);
      document.getElementById('spePlaybackSpeedValue').textContent = `${this.playbackSpeed}x`;
    });

    // Effect settings inputs
    this.setupEffectInputListeners();

    // Color inputs sync
    this.setupColorInputSync();
  }

  setupEffectInputListeners() {
    // All input sliders and fields
    const inputIds = [
      'speParticleCount', 'speParticleLifetime', 'speParticleScale', 'speParticleScaleMultiplier',
      'speEmitterShape', 'speEmitterRadius', 'speEmitterHeightOffset',
      'speGravity', 'speDrag',
      'speVelXMin', 'speVelXMax', 'speVelYMin', 'speVelYMax', 'speVelZMin', 'speVelZMax',
      'speFadeOut', 'speScaleOverTime', 'speBlending',
      'speColorStart', 'speColorEnd'
    ];

    inputIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const eventType = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(eventType, () => this.onEffectInputChange());
      }
    });

    // Value displays for sliders
    this.setupSliderDisplay('speParticleCount', 'speParticleCountValue', v => v);
    this.setupSliderDisplay('speParticleLifetime', 'speParticleLifetimeValue', v => `${v}s`);
    this.setupSliderDisplay('speParticleScale', 'speParticleScaleValue', v => v);
    this.setupSliderDisplay('speParticleScaleMultiplier', 'speParticleScaleMultiplierValue', v => `${v}x`);
    this.setupSliderDisplay('speEmitterRadius', 'speEmitterRadiusValue', v => v);
    this.setupSliderDisplay('speEmitterHeightOffset', 'speEmitterHeightOffsetValue', v => v);
    this.setupSliderDisplay('speGravity', 'speGravityValue', v => v);
    this.setupSliderDisplay('speDrag', 'speDragValue', v => parseFloat(v).toFixed(2));
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

  setupColorInputSync() {
    const syncColor = (pickerId, hexId) => {
      const picker = document.getElementById(pickerId);
      const hex = document.getElementById(hexId);
      if (picker && hex) {
        picker.addEventListener('input', () => {
          hex.value = picker.value;
          this.onEffectInputChange();
        });
        hex.addEventListener('change', () => {
          picker.value = hex.value;
          this.onEffectInputChange();
        });
      }
    };

    syncColor('speColorStart', 'speColorStartHex');
    syncColor('speColorEnd', 'speColorEndHex');
  }

  loadEffect(detail) {
    this.propertyName = detail.propertyName;
    this.objectData = detail.objectData || this.controller.getCurrentObject();
    this.currentData = detail.data || {};

    // Show the editor
    Object.values(document.getElementsByClassName('editor-module')).forEach((editor) => {
      editor.classList.remove('show');
    });
    document.getElementById('particle-effect-editor-container').classList.add('show');

    // Load effect data into UI
    this.loadEffectData(this.currentData);

    // Initialize 3D preview
    this.init3DPreview();

    this.updateStatusBar('Ready');
  }

  loadEffectData(data) {
    if (!data) return;

    this._isLoading = true;

    // Particle settings
    this.setSliderValue('speParticleCount', data.count || 10);
    this.setSliderValue('speParticleLifetime', data.lifetime || 1);
    this.setSliderValue('speParticleScale', data.scale || 10);
    this.setSliderValue('speParticleScaleMultiplier', data.scaleMultiplier || 1);

    // Colors
    this.setColorValue('speColorStart', data.startColor || '#ffffff');
    this.setColorValue('speColorEnd', data.endColor || '#888888');

    // Emitter
    this.setSelectValue('speEmitterShape', data.emitterShape || 'point');
    this.setSliderValue('speEmitterRadius', data.emitterRadius || 0);
    this.setSliderValue('speEmitterHeightOffset', data.heightOffset || 0);

    // Physics
    this.setSliderValue('speGravity', data.gravity !== undefined ? data.gravity : 0);
    this.setSliderValue('speDrag', data.drag || 1);

    // Velocity range
    this.setInputValue('speVelXMin', data.velocityXMin ?? -50);
    this.setInputValue('speVelXMax', data.velocityXMax ?? 50);
    this.setInputValue('speVelYMin', data.velocityYMin ?? 0);
    this.setInputValue('speVelYMax', data.velocityYMax ?? 100);
    this.setInputValue('speVelZMin', data.velocityZMin ?? -50);
    this.setInputValue('speVelZMax', data.velocityZMax ?? 50);

    // Visual options
    this.setCheckbox('speFadeOut', data.fadeOut !== false);
    this.setCheckbox('speScaleOverTime', data.scaleOverTime !== false);
    this.setSelectValue('speBlending', data.blending || 'additive');

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

  // Build effect data from UI inputs
  buildEffectData() {
    return {
      count: this.getInputNumber('speParticleCount'),
      lifetime: this.getInputNumber('speParticleLifetime'),
      scale: this.getInputNumber('speParticleScale'),
      scaleMultiplier: this.getInputNumber('speParticleScaleMultiplier'),
      startColor: this.getInputValue('speColorStart'),
      endColor: this.getInputValue('speColorEnd'),
      emitterShape: this.getInputValue('speEmitterShape'),
      emitterRadius: this.getInputNumber('speEmitterRadius'),
      heightOffset: this.getInputNumber('speEmitterHeightOffset'),
      velocityXMin: this.getInputNumber('speVelXMin'),
      velocityXMax: this.getInputNumber('speVelXMax'),
      velocityYMin: this.getInputNumber('speVelYMin'),
      velocityYMax: this.getInputNumber('speVelYMax'),
      velocityZMin: this.getInputNumber('speVelZMin'),
      velocityZMax: this.getInputNumber('speVelZMax'),
      gravity: this.getInputNumber('speGravity'),
      drag: this.getInputNumber('speDrag'),
      fadeOut: this.getCheckbox('speFadeOut'),
      scaleOverTime: this.getCheckbox('speScaleOverTime'),
      blending: this.getInputValue('speBlending')
    };
  }

  // Event handler - auto-save on change
  onEffectInputChange() {
    if (this._isLoading) return;

    this.currentData = this.buildEffectData();
    this.saveCurrentData();
  }

  saveCurrentData() {
    if (this._isLoading) return;

    const saveEvent = new CustomEvent(this.moduleConfig.saveHook, {
      detail: {
        data: this.currentData,
        propertyName: this.propertyName
      }
    });
    document.body.dispatchEvent(saveEvent);
  }

  // 3D Preview
  async init3DPreview() {
    const canvas = document.getElementById('speCanvas');
    if (!canvas) return;

    // Cleanup existing
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

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
    const CAPACITY = 500;

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

      const spherical = new THREE.Spherical();
      spherical.setFromVector3(this.previewCamera.position);

      spherical.theta -= deltaX * 0.01;
      spherical.phi += deltaY * 0.01;

      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));

      this.previewCamera.position.setFromSpherical(spherical);
      this.previewCamera.lookAt(0, 30, 0);

      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('mouseup', () => { isDragging = false; });
    canvas.addEventListener('mouseleave', () => { isDragging = false; });

    canvas.addEventListener('wheel', (e) => {
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      this.previewCamera.position.multiplyScalar(factor);
      this.previewCamera.position.clampLength(50, 500);
    });
  }

  startRenderLoop() {
    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);

      const now = performance.now() / 1000 - this.previewStartTime;
      this.previewMaterial.uniforms.uTime.value = now;

      // Update particles
      this.updatePreviewParticles(1 / 60 * this.playbackSpeed);

      this.previewRenderer.render(this.previewScene, this.previewCamera);
      this.updateParticleCountStatus();
    };
    animate();
  }

  updatePreviewParticles(dt) {
    const p = this.previewParticles;
    if (!p) return;

    const now = this.previewMaterial.uniforms.uTime.value;

    for (let i = 0; i < p.capacity; i++) {
      if (p.aLifetime[i] <= 0) continue;

      const age = now - p.aStartTime[i];
      if (age >= p.aLifetime[i]) {
        p.aLifetime[i] = 0;
        this._writePreviewTranslation(i, 1e9, 1e9, 1e9);
        p.positions[i].set(1e9, 1e9, 1e9);
        p.freeList.push(i);
        p.activeCount--;
        continue;
      }

      // Physics update
      const vel = p.velocities[i];
      const gravity = p.gravityArr[i];
      const drag = p.dragArr[i];

      vel.y -= gravity * dt;
      vel.multiplyScalar(Math.pow(drag, dt * 60));

      const pos = p.positions[i];
      pos.addScaledVector(vel, dt);

      this._writePreviewTranslation(i, pos.x, pos.y, pos.z);
    }

    this.previewMesh.instanceMatrix.needsUpdate = true;
    p.attrLifetime.needsUpdate = true;
  }

  // Play effect in preview
  playEffect() {
    const effectData = this.currentData || this.buildEffectData();
    this.spawnParticlesFromEffect(effectData, this.previewPosition);
    this.updateStatusBar('Playing effect...');
  }

  spawnParticlesFromEffect(effectData, position) {
    const p = this.previewParticles;
    if (!p) return;

    const parseColor = (colorStr) => {
      if (!colorStr || colorStr === '') return [1, 1, 1];
      if (typeof colorStr === 'string' && colorStr.startsWith('#')) {
        const hex = parseInt(colorStr.slice(1), 16);
        return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
      }
      return [1, 1, 1];
    };

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

  toggleLoop() {
    this.isLooping = !this.isLooping;

    document.getElementById('speLoopBtn')?.classList.toggle('editor-module__btn--active', this.isLooping);
    document.getElementById('speLoopStatus').textContent = this.isLooping ? 'Looping' : '';

    if (this.isLooping) {
      this.startLoop();
    } else {
      this.stopLoop();
    }
  }

  startLoop() {
    this.stopLoop();

    this.playEffect();
    this.loopIntervalId = setInterval(() => {
      this.playEffect();
    }, 1500 / this.playbackSpeed);
  }

  stopLoop() {
    if (this.loopIntervalId) {
      clearInterval(this.loopIntervalId);
      this.loopIntervalId = null;
    }
  }

  resetPreview() {
    this.stopLoop();

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

  // Status bar
  updateStatusBar(message) {
    const el = document.getElementById('speStatusText');
    if (el) el.textContent = message;
  }

  updateParticleCountStatus() {
    const el = document.getElementById('speParticleCountStatus');
    if (el && this.previewParticles) el.textContent = this.previewParticles.activeCount;
  }

  // Unload
  handleUnload() {
    this.stopLoop();

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.previewRenderer) {
      this.previewRenderer.dispose();
      this.previewRenderer = null;
    }

    if (this.previewScene) {
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
