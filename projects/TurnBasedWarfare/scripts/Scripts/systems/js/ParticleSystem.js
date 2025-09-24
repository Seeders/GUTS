class ParticleSystem extends engine.BaseSystem {
  constructor(game) {
    super(game);
    this.game.particleSystem = this;

    this.CAPACITY = 2000;
    this.initialized = false;
    this.activeCount = 0;
    this.freeList = [];

    this.positions = new Array(this.CAPACITY);
    this.velocities = new Array(this.CAPACITY);
    this.gravityArr = new Float32Array(this.CAPACITY);
    this.dragArr = new Float32Array(this.CAPACITY);

    this.aColorStart = new Float32Array(this.CAPACITY * 3);
    this.aColorEnd   = new Float32Array(this.CAPACITY * 3);
    this.aLifetime   = new Float32Array(this.CAPACITY);
    this.aStartTime  = new Float32Array(this.CAPACITY);
    this.aInitScale  = new Float32Array(this.CAPACITY);
    this.aFlags      = new Float32Array(this.CAPACITY * 2);

    this._tmpMat = new THREE.Matrix4();
    this._cursor = 0;

    this.UPDATE_STRIDE = 2;
  }

  initialize() {
    if (this.initialized || !this.game.scene) return;

    const geometry = new THREE.PlaneGeometry(0.25, 0.25);

    const vertexShader = `
      attribute vec3 aColorStart;
      attribute vec3 aColorEnd;
      attribute float aLifetime;
      attribute float aStartTime;
      attribute float aInitScale;
      attribute vec2 aFlags; // x: fadeOut, y: scaleOverTime
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
          if (lifeT > 0.8)       s *= (1.0 - lifeT) * 5.0;
          else if (lifeT > 0.2)  s *= 1.0;
          else                   s *= lifeT * 5.0;
        }

        vec3 right = camRight();
        vec3 up    = camUp();

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

        // CHANGED: simple straight output (no tone mapping), alpha not premultiplied here
        gl_FragColor = vec4(vColor, a); // CHANGED
      }
    `;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,          // CHANGED: sane default; per-effect override allowed
      uniforms: { uTime: { value: 0 } },
      toneMapped: false                        // CHANGED: ensure shader output isn't remapped
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, this.CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const addAttr = (arr, itemSize, name) => {
      const a = new THREE.InstancedBufferAttribute(arr, itemSize);
      this.mesh.geometry.setAttribute(name, a);
      return a;
    };
    this.attrColorStart = addAttr(this.aColorStart, 3, 'aColorStart');
    this.attrColorEnd   = addAttr(this.aColorEnd,   3, 'aColorEnd');
    this.attrLifetime   = addAttr(this.aLifetime,   1, 'aLifetime');
    this.attrStartTime  = addAttr(this.aStartTime,  1, 'aStartTime');
    this.attrInitScale  = addAttr(this.aInitScale,  1, 'aInitScale');
    this.attrFlags      = addAttr(this.aFlags,      2, 'aFlags');

    for (let i = 0; i < this.CAPACITY; i++) {
      this._writeTranslation(i, 1e9, 1e9, 1e9);
      this.positions[i]  = new THREE.Vector3(1e9, 1e9, 1e9);
      this.velocities[i] = new THREE.Vector3(0, 0, 0);
      this.gravityArr[i] = 0.0;
      this.dragArr[i]    = 1.0;
      this.freeList.push(i);
    }

    this.mesh.frustumCulled = false;
    this.game.scene.add(this.mesh);

    this.initialized = true;
  }

  _writeTranslation(index, x, y, z) {
    const m = this._tmpMat;
    m.identity();
    m.setPosition(x, y, z);
    this.mesh.setMatrixAt(index, m);
  }

  /**
   * createParticles(config)
   * Config preserved:
   *   position, count, lifetime,
   *   visual.{color|colorRange{start,end}|scale|fadeOut|scaleOverTime|blending|scaleMultiplier},
   *   velocityRange, gravity, drag, speedMultiplier, heightOffset, shape? (ignored)
   */
  createParticles(config) {
    if (!this.initialized) {
      this.initialize();
      if (!this.initialized) return;
    }

    const {
      position = new THREE.Vector3(0, 0, 0),
      count = 10,
      lifetime = 1.25,
      visual = {},
      velocityRange = { x: [-30, 30], y: [50, 120], z: [-30, 30] },
      gravity = -100.0,
      drag = 0.98,
      speedMultiplier: speedMulTop = 1.0,
      heightOffset = 0
    } = config;

    // ---------- COLOR RESOLUTION (broad compatibility) ----------
    // CHANGED: find start/end colors across multiple common fields
    const { startColorResolved, endColorResolved } = this._resolveColorPair(config, visual); // CHANGED

    // ---------- SCALE / SPEED ----------
    const scaleMul = (visual.scaleMultiplier != null ? visual.scaleMultiplier : 1.0);
    const initScale = ((visual.scale != null) ? visual.scale : 16.0) * scaleMul;

    const speedMulVisual = (visual.speedMultiplier != null ? visual.speedMultiplier : 1.0);
    const speedMul = speedMulTop * speedMulVisual;

    const fadeOut = (visual.fadeOut === undefined) ? true : !!visual.fadeOut;
    const scaleOverTime = (visual.scaleOverTime === undefined) ? true : !!visual.scaleOverTime;

    // Per-effect blending (global switch for the single material)
    if (visual.blending) {
      const b = String(visual.blending).toLowerCase();
      const target =
        b === 'additive' ? THREE.AdditiveBlending :
        b === 'multiply' ? THREE.MultiplyBlending :
                           THREE.NormalBlending;
      if (this.material.blending !== target) {
        this.material.blending = target;
        this.material.needsUpdate = true;
      }
    }

    const rv = (min, max) => min + Math.random() * (max - min);
    const now = this._now();

    let spawned = 0;
    const want = Math.max(1, Math.floor(count));
    while (spawned < want && this.freeList.length > 0) {
      const i = this.freeList.pop();

      const px = position.x;
      const py = position.y + heightOffset;
      const pz = position.z;

      this.positions[i].set(px, py, pz);
      this._writeTranslation(i, px, py, pz);

      const vx = rv(velocityRange.x[0], velocityRange.x[1]) * speedMul;
      const vy = rv(velocityRange.y[0], velocityRange.y[1]) * speedMul;
      const vz = rv(velocityRange.z[0], velocityRange.z[1]) * speedMul;
      this.velocities[i].set(vx, vy, vz);
      this.gravityArr[i] = gravity;
      this.dragArr[i]    = drag;

      // CHANGED: write resolved colors
      const si = i * 3;
      this.aColorStart[si    ] = startColorResolved.r;
      this.aColorStart[si + 1] = startColorResolved.g;
      this.aColorStart[si + 2] = startColorResolved.b;

      this.aColorEnd[si    ] = endColorResolved.r;
      this.aColorEnd[si + 1] = endColorResolved.g;
      this.aColorEnd[si + 2] = endColorResolved.b;

      this.aLifetime[i]  = lifetime;
      this.aStartTime[i] = now;
      this.aInitScale[i] = initScale;
      this.aFlags[i * 2    ] = fadeOut ? 1.0 : 0.0;
      this.aFlags[i * 2 + 1] = scaleOverTime ? 1.0 : 0.0;

      spawned++;
      this.activeCount++;
    }

    this.attrColorStart.needsUpdate = true;
    this.attrColorEnd.needsUpdate   = true;
    this.attrLifetime.needsUpdate   = true;
    this.attrStartTime.needsUpdate  = true;
    this.attrInitScale.needsUpdate  = true;
    this.attrFlags.needsUpdate      = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clearAllParticles() {
    if (!this.initialized) return;
    for (let i = 0; i < this.CAPACITY; i++) {
      this.aLifetime[i] = 0.0;
      this._writeTranslation(i, 1e9, 1e9, 1e9);
      this.positions[i].set(1e9, 1e9, 1e9);
      this.velocities[i].set(0, 0, 0);
      this.gravityArr[i] = 0.0;
      this.dragArr[i] = 1.0;
      if (!this.freeList.includes(i)) this.freeList.push(i);
    }
    this.activeCount = 0;
    this.attrLifetime.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update() {
    if (!this.initialized) return;

    const dt = this.game?.state?.deltaTime || 0.016;
    const now = this._now();
    this.material.uniforms.uTime.value = now;

    if (this.activeCount === 0) return;

    const total = this.CAPACITY;
    let processed = 0;
    const target = Math.max(1, Math.floor(this.activeCount / this.UPDATE_STRIDE));

    for (let loop = 0; loop < total && processed < target; loop++) {
      const i = this._cursor;
      this._cursor = (this._cursor + 1) % total;

      const life = this.aLifetime[i];
      if (life <= 0.0) continue;

      if ((now - this.aStartTime[i]) >= life) {
        this.aLifetime[i] = 0.0;
        this.attrLifetime.needsUpdate = true;

        this._writeTranslation(i, 1e9, 1e9, 1e9);
        this.mesh.instanceMatrix.needsUpdate = true;

        this.positions[i].set(1e9, 1e9, 1e9);
        this.velocities[i].set(0, 0, 0);
        this.gravityArr[i] = 0.0;
        this.dragArr[i] = 1.0;

        this.freeList.push(i);
        this.activeCount--;
        processed++;
        continue;
      }

      const vel = this.velocities[i];
      vel.y += this.gravityArr[i] * dt;
      vel.x *= this.dragArr[i];
      vel.y *= this.dragArr[i];
      vel.z *= this.dragArr[i];

      const pos = this.positions[i];
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      pos.z += vel.z * dt;

      this._writeTranslation(i, pos.x, pos.y, pos.z);
      processed++;
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  destroy() {
    if (!this.initialized) return;
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.initialized = false;
  }

  // ===== helpers =====

  // CHANGED: resolve *pair* of colors from many possible config shapes
  _resolveColorPair(config, visual) {
    // Try pairs first (most explicit)
    const pairCandidates = [
      visual?.colorRange,
      config?.colorRange,
      (visual && (visual.startColor || visual.endColor)) ? { start: visual.startColor, end: visual.endColor } : null,
      (config && (config.startColor || config.endColor)) ? { start: config.startColor, end: config.endColor } : null
    ].filter(Boolean);

    for (const pair of pairCandidates) {
      if (pair?.start != null && pair?.end != null) {
        return {
          startColorResolved: this._resolveColor(pair.start),
          endColorResolved:   this._resolveColor(pair.end)
        };
      }
    }

    // Single color fallbacks (use same for start/end)
    const singleCandidates = [
      visual?.color,
      config?.color
    ].filter((v) => v != null);

    if (singleCandidates.length) {
      const c = this._resolveColor(singleCandidates[0]);
      return { startColorResolved: c, endColorResolved: c };
    }

    // Default white
    const white = { r: 1, g: 1, b: 1 };
    return { startColorResolved: white, endColorResolved: white };
  }

  // Normalize many color forms to {r,g,b} floats (0..1)
  _resolveColor(input) {
    if (input instanceof THREE.Color) {
      return { r: input.r, g: input.g, b: input.b };
    }
    if (typeof input === 'number' || typeof input === 'string') {
      const c = new THREE.Color(input);
      return { r: c.r, g: c.g, b: c.b };
    }
    if (Array.isArray(input) && input.length >= 3) {
      let [r, g, b] = input;
      if (r > 1 || g > 1 || b > 1) { r /= 255; g /= 255; b /= 255; }
      return { r, g, b };
    }
    if (input && typeof input === 'object' && 'r' in input && 'g' in input && 'b' in input) {
      let { r, g, b } = input;
      if (r > 1 || g > 1 || b > 1) { r /= 255; g /= 255; b /= 255; }
      return { r, g, b };
    }
    return { r: 1, g: 1, b: 1 };
  }

  _now() {
    if (this.game?.state?.simTime != null) return this.game.state.simTime;
    return performance.now() / 1000;
  }
}