class ParticleSystem extends engine.BaseSystem {
  constructor(game) {
    super(game);
    this.game.particleSystem = this;

    // CHANGED: unified pool for all particles
    this.CAPACITY = 4000;                     // tune per device
    this.initialized = false;
    this.activeCount = 0;
    this.freeList = [];                       // available instance indices

    // CHANGED: CPU-side motion (per-instance)
    this.positions = new Array(this.CAPACITY);
    this.velocities = new Array(this.CAPACITY);
    this.gravityArr = new Float32Array(this.CAPACITY);
    this.dragArr = new Float32Array(this.CAPACITY);

    // CHANGED: GPU attributes (per-instance)
    this.aColorStart = new Float32Array(this.CAPACITY * 3);
    this.aColorEnd   = new Float32Array(this.CAPACITY * 3);
    this.aLifetime   = new Float32Array(this.CAPACITY);
    this.aStartTime  = new Float32Array(this.CAPACITY);
    this.aInitScale  = new Float32Array(this.CAPACITY);
    this.aFlags      = new Float32Array(this.CAPACITY * 2); // x: fadeOut(0/1), y: scaleOverTime(0/1)

    // Temps
    this._tmpMat = new THREE.Matrix4();
    this._cursor = 0;

    // CHANGED: distribute work across frames
    this.UPDATE_STRIDE = 2;
  }

  initialize() {
    if (this.initialized || !this.game.scene) return;

    // CHANGED: single billboarded quad; fragment creates soft-round mask (works for sparks/glows)
    const geometry = new THREE.PlaneGeometry(1, 1);
    // keep PlaneGeometry's built-in 'uv' for radial mask
    const vertexShader = `
      attribute vec3 aColorStart;
      attribute vec3 aColorEnd;
      attribute float aLifetime;
      attribute float aStartTime;
      attribute float aInitScale;
      attribute vec2 aFlags; // x: fadeOut, y: scaleOverTime
      varying vec3 vColor;
      varying float vAlpha;
      varying vec2 vUv; // passthrough for radial mask
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
        // Soft round mask from quad UVs (center at 0.5,0.5)
        vec2 c = vUv - vec2(0.5);
        float r = length(c) * 2.0;           // 0 at center, ~1 at edge
        float mask = smoothstep(1.0, 0.6, r); // soft falloff
        float a = vAlpha * mask;

        if (a <= 0.001) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `;

    // CHANGED: one shared ShaderMaterial (default additive)
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,  // EffectsSystem may request different blending in config; per-particle is not possible with one material
      uniforms: { uTime: { value: 0 } }
    });

    // CHANGED: single InstancedMesh
    this.mesh = new THREE.InstancedMesh(geometry, this.material, this.CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // CHANGED: attach instanced attributes
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

    // CHANGED: initialize offscreen & pool
    for (let i = 0; i < this.CAPACITY; i++) {
      this._writeTranslation(i, 1e9, 1e9, 1e9);
      this.positions[i]  = new THREE.Vector3(1e9, 1e9, 1e9);
      this.velocities[i] = new THREE.Vector3(0, 0, 0);
      this.gravityArr[i] = 0.0;
      this.dragArr[i]    = 1.0;
      this.freeList.push(i);
    }

    this.mesh.frustumCulled = false; // safe for screen-space quads
    this.game.scene.add(this.mesh);

    this.initialized = true;
  }

  // CHANGED: translation-only instance matrix write
  _writeTranslation(index, x, y, z) {
    const m = this._tmpMat;
    m.identity();
    m.setPosition(x, y, z);
    this.mesh.setMatrixAt(index, m);
  }

  // ===== Public API (preserved signature) =====
  /**
   * createParticles(config)
   * Preserves your original config: {
   *   position: THREE.Vector3, count, lifetime,
   *   visual: { color, colorRange:{start,end}, scale, fadeOut, scaleOverTime, blending? },
   *   velocityRange: {x:[min,max], y:[], z:[]}, gravity, drag, shape?
   * }
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
      shape // CHANGED: accepted for compatibility; ignored for unified backend
    } = config;

    // CHANGED: honor color / colorRange exactly as before
    const startHex = (visual.colorRange && visual.colorRange.start != null)
      ? visual.colorRange.start
      : (visual.color != null ? visual.color : 0xffffff);
    const endHex = (visual.colorRange && visual.colorRange.end != null)
      ? visual.colorRange.end
      : (visual.color != null ? visual.color : startHex);

    const initScale = (visual.scale != null) ? visual.scale : 16.0;
    const fadeOut = (visual.fadeOut === undefined) ? true : !!visual.fadeOut;
    const scaleOverTime = (visual.scaleOverTime === undefined) ? true : !!visual.scaleOverTime;

    // CHANGED: Single material cannot vary blending per particle; if caller asks for Normal or Multiply,
    // we switch the *global* material blending (best-effort). If you need per-effect blending,
    // we can add a second InstancedMesh+material while still being very cheap.
    if (visual.blending) {
      const b = String(visual.blending).toLowerCase();
      const target =
        b === 'normal'   ? THREE.NormalBlending :
        b === 'multiply' ? THREE.MultiplyBlending :
                           THREE.AdditiveBlending;
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

      // motion
      this.positions[i].set(position.x, position.y, position.z);
      this._writeTranslation(i, position.x, position.y, position.z);

      this.velocities[i].set(
        rv(velocityRange.x[0], velocityRange.x[1]),
        rv(velocityRange.y[0], velocityRange.y[1]),
        rv(velocityRange.z[0], velocityRange.z[1])
      );
      this.gravityArr[i] = gravity;
      this.dragArr[i]    = drag;

      // attributes
      this._setColor3(this.aColorStart, i * 3, startHex); // CHANGED
      this._setColor3(this.aColorEnd,   i * 3, endHex);   // CHANGED
      this.aLifetime[i]  = lifetime;
      this.aStartTime[i] = now;
      this.aInitScale[i] = initScale;
      this.aFlags[i * 2    ] = fadeOut ? 1.0 : 0.0;
      this.aFlags[i * 2 + 1] = scaleOverTime ? 1.0 : 0.0;

      spawned++;
      this.activeCount++;
    }

    // mark buffers dirty
    this.attrColorStart.needsUpdate = true;
    this.attrColorEnd.needsUpdate   = true;
    this.attrLifetime.needsUpdate   = true;
    this.attrStartTime.needsUpdate  = true;
    this.attrInitScale.needsUpdate  = true;
    this.attrFlags.needsUpdate      = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // CHANGED: keep same name used by EffectsSystem
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
    this.material.uniforms.uTime.value = now;  // CHANGED: drive shader time

    if (this.activeCount === 0) return;

    // CHANGED: slice updates to reduce CPU spikes
    const total = this.CAPACITY;
    let processed = 0;
    const target = Math.max(1, Math.floor(this.activeCount / this.UPDATE_STRIDE));

    for (let loop = 0; loop < total && processed < target; loop++) {
      const i = this._cursor;
      this._cursor = (this._cursor + 1) % total;

      const life = this.aLifetime[i];
      if (life <= 0.0) continue;

      // expire
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

      // integrate motion (seconds-based)
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
  // CHANGED: hex -> rgb float triplet
  _setColor3(buf, idx, hex) {
    const c = new THREE.Color(hex);
    buf[idx    ] = c.r;
    buf[idx + 1] = c.g;
    buf[idx + 2] = c.b;
  }

  _now() {
    if (this.game?.state?.simTime != null) return this.game.state.simTime;
    return performance.now() / 1000;
  }
}