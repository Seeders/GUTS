/**
 * ThirdPersonCameraSystem - Third-person follow camera for action/adventure games
 *
 * Features:
 * - Follows the player character
 * - Mouse wheel zoom from first-person (zoomed in) to top-down (zoomed out)
 * - Mouse controls facing direction (player and camera rotate together)
 * - Smooth camera movement
 * - Terrain collision avoidance
 */
class ThirdPersonCameraSystem extends GUTS.BaseSystem {
  static services = [
    'getCamera',
    'setCamera',
    'setFollowTarget',
    'getFacingAngle',
    'getPitchAngle',
    'getZoomLevel'
  ];

  static serviceDependencies = [
    'getTerrainHeightAtPositionSmooth',
    'isTerrainInitialized',
    'getCurrentLevelId'
  ];

  constructor(game) {
    super(game);
    this.game.cameraControlSystem = this;
    this.activeCamera = null;

    // Follow target (entity ID)
    this.followTargetId = null;

    // Zoom controls distance and angle
    // 0 = first person, 0.08 = third person (only two modes)
    this.firstPersonSnapThreshold = 0.08;
    this.zoomLevel = this.firstPersonSnapThreshold; // Start in third person mode
    this.minZoom = 0;     // First person
    this.maxZoom = 1;     // Top down (not used with two-mode system)
    this.zoomSpeed = 0.05;

    // Camera distance at different zoom levels
    this.minDistance = 5;    // First person (close)
    this.maxDistance = 800;  // Top down (far)

    // Camera pitch at different zoom levels (radians)
    this.minPitch = 0;                    // First person (horizontal)
    this.maxPitch = -Math.PI / 2 + 0.1;   // Top down (looking straight down)

    // Camera height offset above target (interpolated based on zoom)
    this.minHeightOffset = 25; // First person (eye level)
    this.maxHeightOffset = 35; // Zoomed out (head level)

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

    // Terrain collision settings
    this.minHeightAboveTerrain = 20; // Minimum camera height above terrain
    this.wallCollisionSamples = 10;  // Number of samples to check along camera ray
    this.wallHeightThreshold = 32;   // Height difference that counts as a wall

    // Indoor level detection - limits zoom range
    this.isIndoorLevel = false;

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
    console.log('[ThirdPersonCameraSystem] _onClick called, canvas:', !!canvas, 'isPointerLocked:', this.isPointerLocked);
    if (canvas && !this.isPointerLocked) {
      console.log('[ThirdPersonCameraSystem] Requesting pointer lock');
      canvas.requestPointerLock();
    }
  }

  _onPointerLockChange() {
    const newState = document.pointerLockElement === document.getElementById('gameCanvas');
    console.log('[ThirdPersonCameraSystem] Pointer lock changed:', this.isPointerLocked, '->', newState);
    this.isPointerLocked = newState;
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
    // Two zoom modes only: first person and third person
    // Scroll up (negative deltaY) = first person
    // Scroll down (positive deltaY) = third person
    if (event.deltaY > 0) {
      // Scroll down = third person
      this.zoomLevel = this.firstPersonSnapThreshold;
    } else {
      // Scroll up = first person
      this.zoomLevel = 0;
    }
    event.preventDefault();
  }

  _getTargetTransform() {
    if (!this.followTargetId) return null;

    const transform = this.game.getComponent(this.followTargetId, 'transform');
    if (!transform || !transform.position) return null;

    // Use different height offset for first-person vs third-person
    const isFirstPerson = this.zoomLevel === 0;
    const heightOffset = isFirstPerson ? this.minHeightOffset : this.maxHeightOffset;

    return {
      x: transform.position.x,
      y: (transform.position.y || 0) + heightOffset,
      z: transform.position.z,
      rotation: transform.rotation?.y || 0 // Character's Y rotation (facing direction)
    };
  }

  /**
   * Adjusts camera position to avoid terrain collision.
   * Returns adjusted position that doesn't clip through terrain or walls.
   */
  _adjustForTerrainCollision(targetX, targetY, targetZ, desiredX, desiredY, desiredZ) {
    // Check if terrain service is available
    if (!this.call.isTerrainInitialized || !this.call.isTerrainInitialized()) {
      return { x: desiredX, y: desiredY, z: desiredZ };
    }

    let adjustedX = desiredX;
    let adjustedY = desiredY;
    let adjustedZ = desiredZ;

    // Check for wall collisions along the path from target to camera
    // Sample points along the ray and check for significant height changes
    const dx = desiredX - targetX;
    const dz = desiredZ - targetZ;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    if (horizontalDist > 1) {
      let collisionT = 1.0; // Parameter along ray where collision occurs (0=target, 1=camera)

      // Sample along the ray from target to camera
      for (let i = 1; i <= this.wallCollisionSamples; i++) {
        const t = i / this.wallCollisionSamples;
        const sampleX = targetX + dx * t;
        const sampleZ = targetZ + dz * t;

        // Get terrain height at this sample point
        const terrainHeight = this.call.getTerrainHeightAtPositionSmooth(sampleX, sampleZ);
        if (terrainHeight === null || terrainHeight === undefined) continue;

        // Interpolate expected camera height at this point
        const expectedY = targetY + (desiredY - targetY) * t;

        // Check if terrain is blocking the camera ray
        const clearance = expectedY - terrainHeight;
        if (clearance < this.minHeightAboveTerrain) {
          // Found an obstruction - track closest collision point
          if (t < collisionT) {
            collisionT = t;
          }
        }
      }

      // If collision detected before reaching desired position, adjust camera
      if (collisionT < 1.0) {
        // Move camera closer to target to avoid wall
        const safeT = Math.max(0.1, collisionT - 0.1); // Back off a bit from collision
        adjustedX = targetX + dx * safeT;
        adjustedZ = targetZ + dz * safeT;

        // Also ensure height is above the obstruction
        const terrainAtAdjusted = this.call.getTerrainHeightAtPositionSmooth(adjustedX, adjustedZ);
        if (terrainAtAdjusted !== null && terrainAtAdjusted !== undefined) {
          adjustedY = Math.max(adjustedY, terrainAtAdjusted + this.minHeightAboveTerrain);
        }
      }
    }

    // Final check: ensure camera is above terrain at its final position
    const finalTerrainHeight = this.call.getTerrainHeightAtPositionSmooth(adjustedX, adjustedZ);
    if (finalTerrainHeight !== null && finalTerrainHeight !== undefined) {
      const minAllowedY = finalTerrainHeight + this.minHeightAboveTerrain;
      if (adjustedY < minAllowedY) {
        adjustedY = minAllowedY;
      }
    }

    return { x: adjustedX, y: adjustedY, z: adjustedZ };
  }

  onSceneLoad(sceneData) {
    console.log('[ThirdPersonCameraSystem] onSceneLoad called');

    // Reset camera state for fresh scene
    this.followTargetId = null;
    this.initialized = false;
    this.isPointerLocked = false;

    // Check if this is an indoor level
    this._detectIndoorLevel();

    // Try to attach canvas listener (may not be available yet)
    this._attachCanvasListener();

    // Camera setup happens after player spawns via onPlayerSpawned event
  }

  _detectIndoorLevel() {
    this.isIndoorLevel = false;

    // Get current level ID and check its indoor property
    const levelId = this.call.getCurrentLevelId?.();
    if (!levelId) return;

    const collections = this.game.getCollections();
    const levelData = collections.levels?.[levelId];

    if (levelData?.indoor) {
      this.isIndoorLevel = true;
      // If already zoomed out past the limit, snap back
      if (this.zoomLevel > this.firstPersonSnapThreshold) {
        this.zoomLevel = this.firstPersonSnapThreshold;
      }
      console.log('[ThirdPersonCameraSystem] Indoor level detected, limiting zoom');
    }
  }

  postSceneLoad(sceneData) {
    console.log('[ThirdPersonCameraSystem] postSceneLoad called');

    // Canvas should definitely be available now - attach listener if not already done
    this._attachCanvasListener();
  }

  _attachCanvasListener() {
    const canvas = document.getElementById('gameCanvas');
    console.log('[ThirdPersonCameraSystem] _attachCanvasListener - Canvas element:', !!canvas);
    if (canvas) {
      // Remove any existing listener first to avoid duplicates
      canvas.removeEventListener('click', this._onClick);
      canvas.addEventListener('click', this._onClick);
      console.log('[ThirdPersonCameraSystem] Click listener attached to canvas');
    }
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

    let desiredX = target.x - Math.cos(cameraAngle) * horizontalDist;
    let desiredY = target.y + verticalDist;
    let desiredZ = target.z - Math.sin(cameraAngle) * horizontalDist;

    // Adjust camera position to avoid terrain collision
    const adjusted = this._adjustForTerrainCollision(
      target.x, target.y, target.z,
      desiredX, desiredY, desiredZ
    );
    desiredX = adjusted.x;
    desiredY = adjusted.y;
    desiredZ = adjusted.z;

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
      // In third-person, look at the orbit point (target.y includes targetHeightOffset)
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
