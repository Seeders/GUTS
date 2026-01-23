class CameraControlSystem extends GUTS.BaseSystem {
  static services = [
    'getCamera',
    'setCamera',
    'cameraLookAt',
    'toggleCameraFollow',
    'getCameraFollowTarget',
    'rotateCamera',
    'positionCameraAtStart',
    'toggleCameraMode',
    'getCameraMode',
    'startThirdPersonCamera',
    'stopThirdPersonCamera',
    'getThirdPersonTarget'
  ];

    static serviceDependencies = [
        'getGroundMesh',
        'getWorldExtendedSize',
        'getUnitTypeDef',
        'getActivePlayerTeam'
    ];

  constructor(game) {
    super(game);
    this.game.cameraControlSystem = this;

    // Camera follow mode
    this.followingEntityId = null;

    // Camera controller (initialized in init())
    this.cameraController = null;

    // Active camera reference (managed by this system)
    this.activeCamera = null;
  }

  init() {
    // Initialize the GameCameraController
    this.cameraController = new GUTS.GameCameraController({
      getCamera: () => this.activeCamera,
      setCamera: (camera) => {
        this.activeCamera = camera;
      },
      container: document.body,
      getGroundMesh: () => this.call.getGroundMesh(),
      getWorldBounds: () => {
        const extendedSize = this.call.getWorldExtendedSize();
        const half = extendedSize ? extendedSize * 0.5 : 1000;
        return { min: -half, max: half };
      },
      getCameraHeight: () => this.getCameraHeight(),
      onModeChange: (newMode, prevMode) => {
        // Stop following when switching modes
        if (this.followingEntityId) {
          this.followingEntityId = null;
          this.game.triggerEvent('onUnFollowEntity');
        }
        // Notify UI of mode change
        this.game.triggerEvent('onCameraModeChange', { mode: newMode, prevMode });
      }
    });

    this.cameraController.initialize();
  }

  /**
   * Get the current active camera (service method)
   * All systems should use this instead of this.game.camera
   */
  getCamera() {
    return this.activeCamera;
  }

  /**
   * Set the active camera (service method)
   * Called by WorldSystem when it creates the camera
   */
  setCamera(camera) {
    this.activeCamera = camera;
  }

  // ==================== SERVICE METHODS ====================

  cameraLookAt(worldX, worldZ) {
    this.followingEntityId = null;
    this.game.triggerEvent('onUnFollowEntity');

    if (this.cameraController) {
      this.cameraController.lookAt(worldX, worldZ);
    }
  }

  toggleCameraFollow(entityId) {
    if (this.followingEntityId === entityId) {
      this.followingEntityId = null;
      return false;
    } else {
      this.followingEntityId = entityId;
      if (entityId) {
        const transform = this.game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        if (pos && this.cameraController) {
          this.cameraController.lookAt(pos.x, pos.z);
        }
      }
      return true;
    }
  }

  getCameraFollowTarget() {
    return this.followingEntityId;
  }

  rotateCamera(direction) {
    if (this.cameraController) {
      this.cameraController.rotateGameCamera(direction);
    }
  }

  positionCameraAtStart() {
    const buildings = this.game.getEntitiesWith('transform', 'team', 'unitType');
    let targetPos = null;

    for (const entityId of buildings) {
      const team = this.game.getComponent(entityId, 'team');
      const unitTypeComp = this.game.getComponent(entityId, 'unitType');
      const unitType = this.call.getUnitTypeDef( unitTypeComp);

      if (team?.team === this.call.getActivePlayerTeam() && unitType?.collection === 'buildings') {
        const transform = this.game.getComponent(entityId, 'transform');
        if (transform?.position) {
          targetPos = transform.position;
          break;
        }
      }
    }

    if (!targetPos) {
      targetPos = { x: 0, z: 0 };
    }

    if (this.cameraController) {
      this.cameraController.lookAt(targetPos.x, targetPos.z);
    }
  }

  toggleCameraMode() {
    if (this.cameraController) {
      this.cameraController.toggleCameraMode();
    }
  }

  getCameraMode() {
    return this.cameraController?.getCameraMode() || 'game';
  }

  /**
   * Start third-person camera following an entity
   * @param {number} entityId - Entity to follow
   */
  startThirdPersonCamera(entityId) {
    if (!this.cameraController) return;

    // Clear any existing follow mode
    this.followingEntityId = null;

    // Create target object that provides position and rotation
    const game = this.game;
    const target = {
      entityId: entityId,
      getPosition: () => {
        const transform = game.getComponent(entityId, 'transform');
        return transform?.position || null;
      },
      getRotation: () => {
        const transform = game.getComponent(entityId, 'transform');
        return transform?.rotation?.y || 0;
      }
    };

    this.cameraController.setThirdPersonTarget(target);
    this.cameraController.setCameraMode('thirdPerson');

    // Trigger event for UI updates
    this.game.triggerEvent('onThirdPersonCameraStart', { entityId });
  }

  /**
   * Stop third-person camera and return to game mode
   */
  stopThirdPersonCamera() {
    if (!this.cameraController) return;

    const target = this.cameraController.getThirdPersonTarget();
    const entityId = target?.entityId;

    this.cameraController.setThirdPersonTarget(null);
    this.cameraController.setCameraMode('game');

    // Trigger event for UI updates
    this.game.triggerEvent('onThirdPersonCameraStop', { entityId });
  }

  /**
   * Get the entity being followed in third-person mode
   */
  getThirdPersonTarget() {
    const target = this.cameraController?.getThirdPersonTarget();
    return target?.entityId || null;
  }

  // ==================== LIFECYCLE ====================

  onSceneLoad(sceneData) {
    // Camera should be set by WorldSystem via setCamera service
    if (!this.activeCamera) {
      console.warn('[CameraControlSystem] Camera not available in onSceneLoad - WorldSystem should call setCamera');
      return;
    }
    this.positionCameraAtStart();
  }

  update() {
    const dt = this.game.state.deltaTime || 1/60;

    // Follow unit if in follow mode (only in game camera mode)
    if (this.followingEntityId && this.getCameraMode() === 'game') {
      const transform = this.game.getComponent(this.followingEntityId, 'transform');
      const pos = transform?.position;
      if (pos && this.cameraController) {
        this.cameraController.lookAt(pos.x, pos.z);
      } else {
        this.followingEntityId = null;
      }
    }

    // Update camera controller
    if (this.cameraController) {
      this.cameraController.update(dt);
    }
  }

  dispose() {
    if (this.cameraController) {
      this.cameraController.destroy();
      this.cameraController = null;
    }
  }

  onSceneUnload() {
    // Note: dispose() is called by SceneManager after onSceneUnload
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
}
