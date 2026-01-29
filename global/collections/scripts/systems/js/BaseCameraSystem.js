/**
 * BaseCameraSystem - Base class for camera systems in GUTS
 *
 * Provides common camera infrastructure:
 * - Camera management (orthographic/perspective)
 * - Input handling infrastructure
 * - Service interface
 * - Lifecycle management
 *
 * Subclasses implement specific camera modes:
 * - OrthographicCameraSystem: Isometric top-down camera
 * - FreeCameraSystem: Perspective WASD flight camera
 * - ThirdPersonCameraSystem: Follow camera with mouse look
 * - CameraCoordinatorSystem: Coordinates between multiple camera systems
 */
class BaseCameraSystem extends GUTS.BaseSystem {
    static services = [
        'getCamera',
        'setCamera',
        'getCameraMode',
        'setCameraMode',
        'toggleCameraMode',
        'getZoomLevel',
        'positionCameraAtStart'
    ];

    static serviceDependencies = [
        'getGroundMesh',
        'getWorldExtendedSize',
        'getTerrainHeightAtPositionSmooth',
        'isTerrainInitialized',
        'getActivePlayerTeam',
        'getCameraPositionForTeam'
    ];

    constructor(game) {
        super(game);
        this.game.cameraControlSystem = this;

        // Cameras
        this.orthographicCamera = null;
        this.perspectiveCamera = null;
        this.activeCamera = null;

        // Mode tracking
        this.currentMode = this.getDefaultMode();

        // Common state
        this.state = this._createInitialState();

        // Input handlers
        this._handlers = {};

        // Reusable vectors
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._delta = new THREE.Vector3();
        this._lookAtTarget = new THREE.Vector3();
    }

    // ==================== ABSTRACT METHODS (override in subclasses) ====================

    /**
     * Return default camera mode for this system
     * @returns {string} Mode name
     */
    getDefaultMode() {
        return 'default';
    }

    /**
     * Return available modes for this system
     * @returns {string[]} Array of allowed mode names
     */
    getAvailableModes() {
        return [this.getDefaultMode()];
    }

    /**
     * Update camera each frame - implement in subclass
     * @param {number} dt - Delta time in seconds
     */
    updateCamera(dt) {
        // Override in subclass
    }

    /**
     * Handle mouse movement - implement in subclass
     * @param {MouseEvent} e
     */
    handleMouseMove(e) {
        // Override in subclass
    }

    /**
     * Handle mouse wheel - implement in subclass
     * @param {WheelEvent} e
     */
    handleWheel(e) {
        // Override in subclass
    }

    /**
     * Handle key down - implement in subclass
     * @param {KeyboardEvent} e
     */
    handleKeyDown(e) {
        // Override in subclass
    }

    /**
     * Position camera at starting location
     */
    positionCameraAtStart() {
        // Override in subclass
    }

    // ==================== COMMON STATE ====================

    _createInitialState() {
        return {
            // Input state
            keysPressed: new Set(),
            mouseX: 0,
            mouseY: 0,
            isMouseInWindow: false,
            isPointerLocked: false,
            isRightMouseDown: false,

            // Camera state
            cameraHeight: 512,
            worldBounds: null,

            // Terrain callback
            getTerrainHeight: null
        };
    }

    // ==================== LIFECYCLE ====================

    init() {
        this._setupInputHandlers();
        this.currentMode = this.getDefaultMode();
    }

    update() {
        if (!this.activeCamera) return;
        const dt = this.game.state.deltaTime || 1 / 60;
        this.updateCamera(dt);
    }

    onSceneLoad(sceneData) {
        // Setup terrain height callback
        this.state.getTerrainHeight = (x, z) => {
            if (!this.call.isTerrainInitialized?.()) return null;
            return this.call.getTerrainHeightAtPositionSmooth?.(x, z);
        };

        // Get world bounds
        const extendedSize = this.call.getWorldExtendedSize?.();
        if (extendedSize) {
            this.state.worldBounds = {
                min: -extendedSize / 2,
                max: extendedSize / 2
            };
        }

        // Get camera height from collections
        const cameraSettings = this.collections?.cameras?.main;
        if (cameraSettings?.position?.y) {
            this.state.cameraHeight = cameraSettings.position.y;
        }
    }

    postSceneLoad(sceneData) {
        this.positionCameraAtStart();
    }

    dispose() {
        this._cleanupInputHandlers();

        if (this._perspectiveResizeHandler) {
            window.removeEventListener('resize', this._perspectiveResizeHandler);
            this._perspectiveResizeHandler = null;
        }

        this.perspectiveCamera = null;
        this.orthographicCamera = null;
        this.activeCamera = null;
    }

    onSceneUnload() {
        // Override in subclass if needed
    }

    // ==================== SERVICE METHODS ====================

    getCamera() {
        return this.activeCamera;
    }

    setCamera(camera) {
        this.orthographicCamera = camera;
        if (!this.activeCamera) {
            this.activeCamera = camera;
        }
        this.state.cameraHeight = camera.position.y;
    }

    getCameraMode() {
        return this.currentMode;
    }

    setCameraMode(mode) {
        if (!this.getAvailableModes().includes(mode)) return;
        if (mode === this.currentMode) return;

        const prevMode = this.currentMode;
        this.currentMode = mode;
        this.game.triggerEvent('onCameraModeChange', { mode, prevMode });
    }

    toggleCameraMode() {
        const modes = this.getAvailableModes();
        const currentIndex = modes.indexOf(this.currentMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        this.setCameraMode(modes[nextIndex]);
    }

    getZoomLevel() {
        return 1.0;
    }

    // ==================== INPUT HANDLING ====================

    _setupInputHandlers() {
        this._handlers.mouseMove = (e) => {
            this.state.mouseX = e.clientX;
            this.state.mouseY = e.clientY;
            this.state.isMouseInWindow = true;
            this.handleMouseMove(e);
        };

        this._handlers.wheel = (e) => {
            e.preventDefault();
            this.handleWheel(e);
        };

        this._handlers.keyDown = (e) => {
            this.state.keysPressed.add(e.code);
            this.handleKeyDown(e);
        };

        this._handlers.keyUp = (e) => {
            this.state.keysPressed.delete(e.code);
        };

        this._handlers.mouseDown = (e) => {
            if (e.button === 2) {
                this.state.isRightMouseDown = true;
            }
        };

        this._handlers.mouseUp = (e) => {
            if (e.button === 2) {
                this.state.isRightMouseDown = false;
                if (document.pointerLockElement) {
                    document.exitPointerLock?.();
                }
            }
        };

        this._handlers.pointerLockChange = () => {
            this.state.isPointerLocked = !!document.pointerLockElement;
        };

        this._handlers.mouseEnter = () => {
            this.state.isMouseInWindow = true;
        };

        this._handlers.mouseLeave = () => {
            this.state.isMouseInWindow = false;
        };

        this._handlers.blur = () => {
            this.state.isMouseInWindow = false;
            this.state.keysPressed.clear();
            this.state.isRightMouseDown = false;
        };

        this._handlers.contextMenu = (e) => {
            // Subclass can override to prevent context menu
        };

        window.addEventListener('mousemove', this._handlers.mouseMove, { passive: true });
        window.addEventListener('wheel', this._handlers.wheel, { passive: false });
        window.addEventListener('keydown', this._handlers.keyDown);
        window.addEventListener('keyup', this._handlers.keyUp);
        window.addEventListener('mousedown', this._handlers.mouseDown);
        window.addEventListener('mouseup', this._handlers.mouseUp);
        window.addEventListener('mouseenter', this._handlers.mouseEnter);
        window.addEventListener('mouseleave', this._handlers.mouseLeave);
        window.addEventListener('blur', this._handlers.blur);
        document.addEventListener('pointerlockchange', this._handlers.pointerLockChange);
        document.body.addEventListener('contextmenu', this._handlers.contextMenu);
    }

    _cleanupInputHandlers() {
        window.removeEventListener('mousemove', this._handlers.mouseMove);
        window.removeEventListener('wheel', this._handlers.wheel);
        window.removeEventListener('keydown', this._handlers.keyDown);
        window.removeEventListener('keyup', this._handlers.keyUp);
        window.removeEventListener('mousedown', this._handlers.mouseDown);
        window.removeEventListener('mouseup', this._handlers.mouseUp);
        window.removeEventListener('mouseenter', this._handlers.mouseEnter);
        window.removeEventListener('mouseleave', this._handlers.mouseLeave);
        window.removeEventListener('blur', this._handlers.blur);
        document.removeEventListener('pointerlockchange', this._handlers.pointerLockChange);
        document.body.removeEventListener('contextmenu', this._handlers.contextMenu);
    }

    // ==================== CAMERA UTILITIES ====================

    /**
     * Create a perspective camera
     * @param {number} fov - Field of view
     */
    _createPerspectiveCamera(fov = 60) {
        const aspect = window.innerWidth / window.innerHeight;
        this.perspectiveCamera = new THREE.PerspectiveCamera(fov, aspect, 1, 10000);
        this.perspectiveCamera.updateProjectionMatrix();

        this._perspectiveResizeHandler = () => {
            if (this.perspectiveCamera) {
                this.perspectiveCamera.aspect = window.innerWidth / window.innerHeight;
                this.perspectiveCamera.updateProjectionMatrix();
            }
        };
        window.addEventListener('resize', this._perspectiveResizeHandler);
    }

    /**
     * Clamp camera position to world bounds
     * @param {number} margin - Margin from world edge
     */
    _clampToWorldBounds(margin = 0) {
        const camera = this.activeCamera;
        const bounds = this.state.worldBounds;
        if (!camera || !bounds) return;

        const min = bounds.min + margin;
        const max = bounds.max - margin;

        camera.position.x = Math.max(min, Math.min(max, camera.position.x));
        camera.position.z = Math.max(min, Math.min(max, camera.position.z));

        if (camera.userData?.lookAt) {
            camera.userData.lookAt.x = Math.max(min, Math.min(max, camera.userData.lookAt.x));
            camera.userData.lookAt.z = Math.max(min, Math.min(max, camera.userData.lookAt.z));
        }
    }
}

// Register on GUTS namespace for subclassing
if (typeof GUTS !== 'undefined') {
    GUTS.BaseCameraSystem = BaseCameraSystem;
}

// ES6 exports for webpack bundling
export default BaseCameraSystem;
export { BaseCameraSystem };
