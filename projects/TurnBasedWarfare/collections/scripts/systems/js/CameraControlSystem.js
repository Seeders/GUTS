class CameraControlSystem extends GUTS.BaseSystem {
  static services = [
    'cameraLookAt',
    'toggleCameraFollow',
    'getCameraFollowTarget',
    'rotateCamera',
    'positionCameraAtStart'
  ];

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

    // Camera follow mode
    this.followingEntityId = null;

    // Camera rotation (yaw angle in radians)
    this.cameraYaw = 135 * Math.PI / 180; // Default isometric angle
  }

  init() {
    this.onMove  = (e)=>this.onMouseMove(e);
    this.onEnter = ()=>{ this.inside = true; this.holdDirX = 0; this.holdDirZ = 0; };
    this.onLeave = ()=>this.onMouseLeave();
    this.onBlur  = ()=>{ this.inside = false; this.holdDirX = 0; this.holdDirZ = 0; };
    this.onWheel = (e) => this.handleWheel(e);

    window.addEventListener('mousemove', this.onMove, { passive: true });
    window.addEventListener('mouseenter', this.onEnter);
    window.addEventListener('mouseleave', this.onLeave);
    window.addEventListener('blur',      this.onBlur);
    window.addEventListener('wheel', this.onWheel);
  }

  // Alias methods for service names
  cameraLookAt(worldX, worldZ) {
    return this.lookAtRequest(worldX, worldZ);
  }

  toggleCameraFollow(entityId) {
    return this.toggleFollow(entityId);
  }

  getCameraFollowTarget() {
    return this.followingEntityId;
  }

  lookAtRequest(worldX, worldZ){
      this.followingEntityId = null;
      this.game.triggerEvent('onUnFollowEntity');
      this.lookAt(worldX, worldZ);
  }

  onSceneLoad(sceneData) {
    // Camera is now available from WorldSystem
    if (!this.game.camera) {
      console.warn('[CameraControlSystem] Camera not available in onSceneLoad');
      return;
    }

    // Position camera to look at player's starting position (town hall or first building)
    this.positionCameraAtStart();
  }

  positionCameraAtStart() {
    // Find player's town hall or first building
    const buildings = this.game.getEntitiesWith('transform', 'team', 'unitType');
    let targetPos = null;

    for (const entityId of buildings) {
      const team = this.game.getComponent(entityId, 'team');
      const unitTypeComp = this.game.getComponent(entityId, 'unitType');
      const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

      if (team?.team === this.game.call('getActivePlayerTeam') && unitType?.collection === 'buildings') {
        const transform = this.game.getComponent(entityId, 'transform');
        if (transform?.position) {
          targetPos = transform.position;
          break;
        }
      }
    }

    // Default to center if no building found
    if (!targetPos) {
      targetPos = { x: 0, z: 0 };
    }

    this.lookAt(targetPos.x, targetPos.z);
  }

  update() {
    // Follow unit if in follow mode
    if (this.followingEntityId) {
      const transform = this.game.getComponent(this.followingEntityId, 'transform');
      const pos = transform?.position;
      if (pos) {
        this.lookAt(pos.x, pos.z);
      } else {
        // Entity no longer exists, stop following
        this.followingEntityId = null;
      }
    }
  }

  /**
   * Toggle camera follow mode for an entity
   * @param {string} entityId - The entity to follow, or null to stop following
   * @returns {boolean} - Whether camera is now following
   */
  toggleFollow(entityId) {
    if (this.followingEntityId === entityId) {
      // Already following this entity, stop following
      this.followingEntityId = null;
      return false;
    } else {
      // Start following this entity
      this.followingEntityId = entityId;
      // Immediately look at the entity
      if (entityId) {
        const transform = this.game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        if (pos) {
          this.lookAt(pos.x, pos.z);
        }
      }
      return true;
    }
  }

  handleWheel(e) {
    if (!this.game.camera) return;

    let dy = e.deltaY;
    if(dy > 0){
      //scrolling down
      this.game.camera.zoom = this.game.camera.zoom * 0.9;
    } else {
      this.game.camera.zoom = this.game.camera.zoom * 1.1;
    }
    this.game.camera.zoom = Math.min(2, this.game.camera.zoom);
    this.game.camera.updateProjectionMatrix();
  }

  dispose() {
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseenter', this.onEnter);
    window.removeEventListener('mouseleave', this.onLeave);
    window.removeEventListener('blur',       this.onBlur);
    window.removeEventListener('wheel', this.onWheel);
  }

  onSceneUnload() {
    // Note: dispose() is called by SceneManager after onSceneUnload
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
    const extendedSize = this.game.call('getWorldExtendedSize');
    const half = extendedSize ? extendedSize * 0.5 : 1000;
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

  lookAt(worldX, worldZ){
    const pitch = 35.264 * Math.PI / 180;
    const yaw = this.cameraYaw;
    const distance = this.getCameraHeight();

    const cdx = Math.sin(yaw) * Math.cos(pitch);
    const cdz = Math.cos(yaw) * Math.cos(pitch);

    const cameraPosition = {
        x: worldX - cdx * distance,
        y: distance,
        z: worldZ - cdz * distance
    };

    const lookAtPos = { x: worldX, y: 0, z: worldZ };

    this.game.camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    this.game.camera.lookAt(lookAtPos.x, lookAtPos.y, lookAtPos.z);
    this.game.camera.userData.lookAt = new THREE.Vector3(lookAtPos.x, lookAtPos.y, lookAtPos.z);
  }

  /**
   * Get camera height from main camera settings in collections
   * Falls back to 512 if not found
   */
  getCameraHeight() {
    if (this._cameraHeight !== undefined) {
      return this._cameraHeight;
    }

    const collections = this.collections;
    const cameraSettings = collections?.cameras?.main;

    this._cameraHeight = cameraSettings?.position?.y || 512;

    return this._cameraHeight;
  }

  /**
   * Rotate the camera 45 degrees around the look-at point
   * @param {string} direction - 'left' or 'right'
   */
  rotateCamera(direction) {
    const camera = this.game.camera;
    if (!camera) return;

    // Raycast from center of screen to find ground point
    const raycaster = new THREE.Raycaster();
    const centerScreen = new THREE.Vector2(0, 0); // NDC center
    raycaster.setFromCamera(centerScreen, camera);

    // Find the terrain/ground
    const ground = this.game.call('getGroundMesh');
    if (!ground) return;

    const intersects = raycaster.intersectObject(ground, true);
    if (intersects.length === 0) return;

    const groundPoint = intersects[0].point;

    // Update yaw and rotate around the ground point
    const rotationAngle = direction === 'left' ? -Math.PI / 4 : Math.PI / 4;
    this.cameraYaw += rotationAngle;

    // Set the look-at point and reposition camera
    this.lookAt(groundPoint.x, groundPoint.z);
  }


  moveCamera() {
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
