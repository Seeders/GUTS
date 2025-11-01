class CameraControlSystem extends engine.BaseSystem {
  constructor(game) {
    super(game);
    this.game.cameraControlSystem = this;

    this.SPEED = 900; // world units per second

    // Mouse state
    this.mouseX = -1;
    this.mouseY = -1;
    this.inside = false;

    // When mouse leaves the window, keep panning in these directions
    this.holdDirX = 0; // -1 left, +1 right
    this.holdDirZ = 0; // +1 up/forward, -1 down/backward

    this.vertical_threshold = 10;

    // Reusable vectors
    this.right = new THREE.Vector3();
    this.fwd   = new THREE.Vector3();
    this.delta = new THREE.Vector3();
  }

  init() {
    this.onMove  = (e)=>this.onMouseMove(e);
    this.onEnter = ()=>{ this.inside = true; this.holdDirX = 0; this.holdDirZ = 0; };
    this.onLeave = ()=>this.onMouseLeave();
    this.onBlur  = ()=>{ this.inside = false; this.holdDirX = 0; this.holdDirZ = 0; };

    window.addEventListener('mousemove', this.onMove, { passive: true });
    window.addEventListener('mouseenter', this.onEnter);
    window.addEventListener('mouseleave', this.onLeave);
    window.addEventListener('blur',      this.onBlur);
  }

  dispose() {
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseenter', this.onEnter);
    window.removeEventListener('mouseleave', this.onLeave);
    window.removeEventListener('blur',       this.onBlur);
  }

  onMouseMove(e) {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.inside = true;
  }

  onMouseLeave() {
    // Decide which edge we left from and “hold” that pan direction
    const w = window.innerWidth  || document.documentElement.clientWidth;
    const h = window.innerHeight || document.documentElement.clientHeight;

    // X hold
    if (this.mouseX <= 0)            this.holdDirX = -1;
    else if (this.mouseX >= w - 1)   this.holdDirX =  1;
    else                              this.holdDirX =  0;

    // Z hold (reversed per your request: top = +forward, bottom = -backward)
    if (this.mouseY <= this.vertical_threshold)            this.holdDirZ =  1;  // went off top -> forward
    else if (this.mouseY >= h - this.vertical_threshold)   this.holdDirZ = -1;  // went off bottom -> backward
    else                              this.holdDirZ =  0;

    this.inside = false;
  }

  clampCamera(camera, padding = 0) {
    const half = this.game.worldSystem?.extendedSize ? this.game.worldSystem.extendedSize * 0.5 : 1000;
    camera.position.x = Math.max(-half + padding, Math.min(half - padding, camera.position.x));
    camera.position.z = Math.max(-half + padding, Math.min(half - padding, camera.position.z));

    if (camera.userData?.lookAt instanceof THREE.Vector3) {
      camera.userData.lookAt.x = Math.max(-half + padding, Math.min(half - padding, camera.userData.lookAt.x));
      camera.userData.lookAt.z = Math.max(-half + padding, Math.min(half - padding, camera.userData.lookAt.z));
    }
  }

  updateGroundBasis(camera) {
    this.right.set(1,0,0).applyQuaternion(camera.quaternion);
    this.fwd.set(0,0,-1).applyQuaternion(camera.quaternion);
    this.right.y = 0; this.fwd.y = 0;
    if (this.right.lengthSq() > 0) this.right.normalize();
    if (this.fwd.lengthSq() > 0) this.fwd.normalize();
  }

  update() {
    const cam = this.game.camera;
    if (!cam) return;

    const dt = this.game.state.deltaTime || 1/60;

    const w = window.innerWidth  || document.documentElement.clientWidth;
    const h = window.innerHeight || document.documentElement.clientHeight;

    // Compute directions from current mouse position (supports off-screen values too)
    let dirX = 0;
    let dirZ = 0;

    if (this.inside) {
      if (this.mouseX <= 0)           dirX = -1;
      else if (this.mouseX >= w - 1)  dirX =  1;

      // Z reversed: top edge -> +1 (forward), bottom -> -1 (backward)
      if (this.mouseY <= this.vertical_threshold)           dirZ =  1;
      else if (this.mouseY >= h - this.vertical_threshold)  dirZ = -1;

      // Clear holds while inside; we’ll recompute every frame
      this.holdDirX = 0;
      this.holdDirZ = 0;
    } else {
      // Outside window—keep moving in the last known edge direction
      dirX = this.holdDirX;
      dirZ = this.holdDirZ;
    }

    if (dirX === 0 && dirZ === 0) return;

    this.updateGroundBasis(cam);

    this.delta.set(0,0,0)
      .addScaledVector(this.right, dirX * this.SPEED * dt)
      .addScaledVector(this.fwd,   dirZ * this.SPEED * dt);

    cam.position.add(this.delta);

    if (cam.userData?.lookAt instanceof THREE.Vector3) {
      cam.userData.lookAt.add(this.delta);
      cam.lookAt(cam.userData.lookAt);
    }

    this.clampCamera(cam, 0);
  }
}
