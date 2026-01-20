/**
 * CameraControlSystem - Third-person follow camera for UseYourIllusions
 *
 * Features:
 * - Follows the player character
 * - Mouse wheel zoom from first-person (zoomed in) to top-down (zoomed out)
 * - Mouse controls facing direction (player and camera rotate together)
 * - Smooth camera movement
 */
class CameraControlSystem extends GUTS.BaseSystem {
  static services = [
    'getCamera',
    'setCamera',
    'setFollowTarget',
    'getFacingAngle',
    'getPitchAngle',
    'getZoomLevel'
  ];

  constructor(game) {
    super(game);
    this.game.cameraControlSystem = this;
    this.activeCamera = null;

    // Follow target (entity ID)
    this.followTargetId = null;

    // Zoom controls distance and angle
    // 0 = first person, 1 = top-down
    this.zoomLevel = 0.5; // Start at middle zoom
    this.minZoom = 0;     // First person
    this.maxZoom = 1;     // Top down
    this.zoomSpeed = 0.05;

    // Camera distance at different zoom levels
    this.minDistance = 5;    // First person (close)
    this.maxDistance = 800;  // Top down (far)

    // Camera pitch at different zoom levels (radians)
    this.minPitch = 0;                    // First person (horizontal)
    this.maxPitch = -Math.PI / 2 + 0.1;   // Top down (looking straight down)

    // Camera height offset above target
    this.targetHeightOffset = 25; // Eye level of character

    // Mouse-controlled facing direction
    this.facingAngle = 0; // Current yaw angle in radians (left/right)
    this.pitchAngle = 0;  // Current pitch angle in radians (up/down)
    this.minPitchAngle = -Math.PI / 2 + 0.1; // Looking almost straight down
    this.maxPitchAngle = Math.PI / 2 - 0.1;  // Looking almost straight up
    this.mouseSensitivity = 0.003;

    // Smoothing
    this.smoothSpeed = 8;
    this.rotationSmoothSpeed = 2; // Slower rotation smoothing
    this.currentPosition = new THREE.Vector3();
    this.currentAngle = 0; // Smoothed camera angle
    this.initialized = false;

    // Bind event handlers
    this._onWheel = this._onWheel.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onClick = this._onClick.bind(this);
    this.isPointerLocked = false;
  }

  init() {
    // Add mouse wheel listener
    window.addEventListener('wheel', this._onWheel, { passive: false });

    // Add mouse move listener for rotation
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    // Click to capture pointer
    const canvas = document.getElementById('gameCanvas');
    if (canvas) {
      canvas.addEventListener('click', this._onClick);
    }
  }

  _onClick(event) {
    // Request pointer lock on click for mouse control
    const canvas = document.getElementById('gameCanvas');
    if (canvas && !this.isPointerLocked) {
      canvas.requestPointerLock();
    }
  }

  _onPointerLockChange() {
    this.isPointerLocked = document.pointerLockElement === document.getElementById('gameCanvas');
  }

  _onMouseMove(event) {
    // Only rotate when pointer is locked
    if (!this.isPointerLocked) return;

    // Update yaw (left/right) based on mouse X movement
    this.facingAngle += event.movementX * this.mouseSensitivity;

    // Keep yaw angle in reasonable range
    while (this.facingAngle > Math.PI) this.facingAngle -= Math.PI * 2;
    while (this.facingAngle < -Math.PI) this.facingAngle += Math.PI * 2;

    // Update pitch (up/down) based on mouse Y movement
    // Negative because moving mouse up should look up (negative Y movement)
    this.pitchAngle -= event.movementY * this.mouseSensitivity;

    // Clamp pitch to prevent flipping
    this.pitchAngle = Math.max(this.minPitchAngle, Math.min(this.maxPitchAngle, this.pitchAngle));

    // Update player's rotation to match (only yaw, not pitch)
    this.updatePlayerRotation();
  }

  updatePlayerRotation() {
    if (!this.followTargetId) return;

    const transform = this.game.getComponent(this.followTargetId, 'transform');
    if (transform && transform.rotation) {
      transform.rotation.y = this.facingAngle;
    }
  }

  getFacingAngle() {
    return this.facingAngle;
  }

  getPitchAngle() {
    return this.pitchAngle;
  }

  getZoomLevel() {
    return this.zoomLevel;
  }

  getCamera() {
    return this.activeCamera;
  }

  setCamera(camera) {
    this.activeCamera = camera;
  }

  setFollowTarget(entityId) {
    this.followTargetId = entityId;
    this.initialized = false; // Reset to snap to new target

    // Initialize facing angle from player's current rotation
    if (entityId) {
      const transform = this.game.getComponent(entityId, 'transform');
      if (transform && transform.rotation) {
        this.facingAngle = transform.rotation.y || 0;
      }
    }
  }

  _onWheel(event) {
    // Zoom in/out
    const delta = event.deltaY > 0 ? this.zoomSpeed : -this.zoomSpeed;
    this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel + delta));
    event.preventDefault();
  }

  _getTargetTransform() {
    if (!this.followTargetId) return null;

    const transform = this.game.getComponent(this.followTargetId, 'transform');
    if (!transform || !transform.position) return null;

    return {
      x: transform.position.x,
      y: (transform.position.y || 0) + this.targetHeightOffset,
      z: transform.position.z,
      rotation: transform.rotation?.y || 0 // Character's Y rotation (facing direction)
    };
  }

  onSceneLoad(sceneData) {
    // Camera setup happens after player spawns
  }

  onPlayerSpawned(data) {
    if (data && data.entityId) {
      this.setFollowTarget(data.entityId);
    }
  }

  update() {
    if (!this.activeCamera || !this.followTargetId) return;

    const target = this._getTargetTransform();
    if (!target) return;

    const dt = this.game.state.deltaTime || 1/60;

    // Calculate camera position based on zoom level
    // Interpolate between first-person and top-down

    // Distance from target
    const distance = this.minDistance + (this.maxDistance - this.minDistance) * this.zoomLevel;

    // Pitch angle (0 = horizontal, -PI/2 = looking down)
    const pitch = this.minPitch + (this.maxPitch - this.minPitch) * this.zoomLevel;

    // Calculate camera offset from target
    // Camera is behind and above the target
    const horizontalDist = distance * Math.cos(-pitch);
    const verticalDist = distance * Math.sin(-pitch);

    // Position camera behind the character based on mouse-controlled facing direction
    // Camera should be behind the character (opposite of facing direction)
    const cameraAngle = this.facingAngle;

    const desiredX = target.x - Math.cos(cameraAngle) * horizontalDist;
    const desiredY = target.y + verticalDist;
    const desiredZ = target.z - Math.sin(cameraAngle) * horizontalDist;

    // Smooth camera movement
    if (!this.initialized) {
      this.currentPosition.set(desiredX, desiredY, desiredZ);
      this.initialized = true;
    } else {
      const t = 1 - Math.exp(-this.smoothSpeed * dt);
      this.currentPosition.x += (desiredX - this.currentPosition.x) * t;
      this.currentPosition.y += (desiredY - this.currentPosition.y) * t;
      this.currentPosition.z += (desiredZ - this.currentPosition.z) * t;
    }

    // Update camera position
    this.activeCamera.position.copy(this.currentPosition);

    // In first-person mode (small distance), look in the direction the player is facing
    // In third-person/top-down, look at the player
    const isFirstPerson = this.zoomLevel < 0.1;
    if (isFirstPerson) {
      // Look in the direction the player is facing with pitch (up/down)
      const lookDistance = 100;
      // Horizontal distance is affected by pitch (looking up/down reduces horizontal component)
      const horizontalLookDist = lookDistance * Math.cos(this.pitchAngle);
      const verticalLookDist = lookDistance * Math.sin(this.pitchAngle);
      const lookX = this.currentPosition.x + Math.cos(cameraAngle) * horizontalLookDist;
      const lookY = this.currentPosition.y + verticalLookDist;
      const lookZ = this.currentPosition.z + Math.sin(cameraAngle) * horizontalLookDist;
      this.activeCamera.lookAt(lookX, lookY, lookZ);
    } else {
      // In third-person, also apply pitch to look point
      // Calculate a look point that's offset by pitch from the target
      const lookDistance = 50;
      const verticalOffset = lookDistance * Math.sin(this.pitchAngle);
      this.activeCamera.lookAt(target.x, target.y + verticalOffset, target.z);
    }
  }

  dispose() {
    window.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    const canvas = document.getElementById('gameCanvas');
    if (canvas) {
      canvas.removeEventListener('click', this._onClick);
    }
    this.activeCamera = null;
    this.followTargetId = null;
  }

  onSceneUnload() {
    this.followTargetId = null;
    this.initialized = false;
  }
}
