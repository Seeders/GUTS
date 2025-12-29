/**
 * EditorCameraController - Shared camera controls for editor modules
 *
 * Provides two camera modes:
 * - Scene mode: Perspective camera with OrbitControls for free movement
 * - Game mode: Orthographic camera with isometric view, pan, zoom, and rotation
 *
 * Usage:
 *   const cameraController = new EditorCameraController(worldRenderer, canvasEl, collections);
 *   cameraController.initialize(terrainSize);
 *   cameraController.setCameraMode('game'); // or 'scene'
 */
class EditorCameraController {
    constructor(worldRenderer, canvasEl, collections = {}) {
        this.worldRenderer = worldRenderer;
        this.canvasEl = canvasEl;
        this.collections = collections;

        // Camera mode: 'scene' (perspective) or 'game' (orthographic)
        this.cameraMode = 'game';

        // Saved camera states for mode switching
        this.sceneCameraState = null;
        this.gameCameraState = null;

        // Control flags
        this.isCameraControlActive = false;

        // Event handlers (stored for cleanup)
        this.gameCameraWheelHandler = null;
        this.gameCameraMouseDownHandler = null;
        this.gameCameraMouseMoveHandler = null;
        this.gameCameraMouseUpHandler = null;
        this.keydownHandler = null;
        this.keyupHandler = null;

        // Terrain size for camera positioning
        this.terrainSize = 1024;
    }

    /**
     * Initialize the camera controller
     * @param {number} terrainSize - Size of the terrain in world units
     */
    initialize(terrainSize = 1024) {
        this.terrainSize = terrainSize;

        // Setup keyboard handlers for camera rotation
        this.setupKeyboardHandlers();

        // Default to game camera
        this.setupGameCamera();
    }

    /**
     * Set the camera mode
     * @param {string} mode - 'scene' or 'game'
     */
    setCameraMode(mode) {
        if (mode === this.cameraMode) return;

        // Save current camera state
        this.saveCameraState();

        this.cameraMode = mode;

        const canvas = this.canvasEl;
        const width = canvas.width || 1536;
        const height = canvas.height || 768;

        if (mode === 'scene') {
            this.setupSceneCamera(width, height);
        } else {
            this.setupGameCamera(width, height);
        }

        console.log(`[EditorCameraController] Camera mode switched to: ${mode}`);
    }

    /**
     * Get current camera mode
     */
    getCameraMode() {
        return this.cameraMode;
    }

    /**
     * Toggle between scene and game camera modes
     */
    toggleCameraMode() {
        this.setCameraMode(this.cameraMode === 'scene' ? 'game' : 'scene');
    }

    /**
     * Save the current camera state based on mode
     */
    saveCameraState() {
        if (!this.worldRenderer?.camera) return;

        const camera = this.worldRenderer.camera;
        const controls = this.worldRenderer.controls;

        if (this.cameraMode === 'scene') {
            this.sceneCameraState = {
                position: camera.position.clone(),
                target: controls?.target?.clone() || new THREE.Vector3(0, 0, 0),
                rotationX: this.worldRenderer.cameraRotationX,
                rotationY: this.worldRenderer.cameraRotationY
            };
        } else {
            this.gameCameraState = {
                position: camera.position.clone(),
                quaternion: camera.quaternion.clone(),
                zoom: camera.zoom,
                lookAt: camera.userData?.lookAt?.clone()
            };
        }
    }

    /**
     * Setup perspective camera for scene editing
     */
    setupSceneCamera(width, height) {
        const halfSize = this.terrainSize / 2;

        // Create perspective camera
        const camera = new THREE.PerspectiveCamera(60, width / height, 1, 30000);

        // Restore saved state or use default position
        if (this.sceneCameraState) {
            camera.position.copy(this.sceneCameraState.position);
        } else {
            // Default: Position at reasonable distance from terrain center
            // Use a fixed reasonable distance rather than scaling with terrain size
            const cameraDistance = 800;
            camera.position.set(halfSize + cameraDistance, cameraDistance, halfSize + cameraDistance);
        }

        // Set camera in WorldRenderer
        this.worldRenderer.camera = camera;

        // Clean up game camera handlers
        this.cleanupGameCameraControls();

        // Dispose old controls and their event handlers
        this.cleanupWorldRendererControls();

        // Setup orbit controls for scene editing
        const targetPos = this.sceneCameraState?.target || { x: halfSize, y: 0, z: halfSize };
        this.worldRenderer.setupOrbitControls(targetPos);

        // Restore rotation state
        if (this.sceneCameraState) {
            this.worldRenderer.cameraRotationX = this.sceneCameraState.rotationX || 0;
            this.worldRenderer.cameraRotationY = this.sceneCameraState.rotationY || 0;
        }

        camera.lookAt(targetPos.x || 0, targetPos.y || 0, targetPos.z || 0);

        // Force initial camera rotation sync
        if (this.worldRenderer.updateCameraRotation) {
            this.worldRenderer.updateCameraRotation();
        }
    }

    /**
     * Setup orthographic camera for game-view (isometric)
     */
    setupGameCamera(width, height) {
        width = width || this.canvasEl.width || 1536;
        height = height || this.canvasEl.height || 768;

        // Create orthographic camera like the game uses
        const camera = new THREE.OrthographicCamera(
            width / -2,
            width / 2,
            height / 2,
            height / -2,
            0.1,
            50000
        );

        // Get camera height from collections
        const cameraSettings = this.collections?.cameras?.main;
        const cameraHeight = cameraSettings?.position?.y || 512;

        const halfSize = this.terrainSize / 2;

        // Restore saved state or use default
        if (this.gameCameraState) {
            camera.position.copy(this.gameCameraState.position);
            camera.zoom = this.gameCameraState.zoom || 1;
            if (this.gameCameraState.quaternion) {
                camera.quaternion.copy(this.gameCameraState.quaternion);
            } else if (this.gameCameraState.lookAt) {
                camera.lookAt(
                    this.gameCameraState.lookAt.x,
                    this.gameCameraState.lookAt.y,
                    this.gameCameraState.lookAt.z
                );
            }
            if (this.gameCameraState.lookAt) {
                camera.userData.lookAt = this.gameCameraState.lookAt.clone();
            }
        } else {
            // Default game camera position (isometric view)
            const pitch = 35.264 * Math.PI / 180;
            const yaw = 135 * Math.PI / 180;
            const distance = cameraHeight;

            const worldX = halfSize;
            const worldZ = halfSize;

            const cdx = Math.sin(yaw) * Math.cos(pitch);
            const cdz = Math.cos(yaw) * Math.cos(pitch);

            camera.position.set(
                worldX - cdx * distance,
                distance,
                worldZ - cdz * distance
            );

            const lookAtPoint = new THREE.Vector3(worldX, 0, worldZ);
            camera.lookAt(lookAtPoint);
            camera.userData.lookAt = lookAtPoint.clone();
        }

        camera.updateProjectionMatrix();

        // Set camera in WorldRenderer
        this.worldRenderer.camera = camera;

        // Dispose orbit controls (not used in game mode)
        this.cleanupWorldRendererControls();

        // Setup game camera controls (zoom + pan)
        this.setupGameCameraControls(camera);
    }

    /**
     * Setup simple controls for game camera (zoom + pan)
     */
    setupGameCameraControls(camera) {
        // Clean up any existing handlers first
        this.cleanupGameCameraControls();

        // Mouse wheel zoom
        this.gameCameraWheelHandler = (e) => {
            if (this.cameraMode !== 'game') return;
            e.preventDefault();

            if (e.deltaY > 0) {
                camera.zoom *= 0.9;
            } else {
                camera.zoom *= 1.1;
            }
            camera.zoom = Math.max(0.1, Math.min(5, camera.zoom));
            camera.updateProjectionMatrix();
        };

        // Right-click drag to pan
        let isPanning = false;
        let lastMouseX = 0;
        let lastMouseY = 0;

        this.gameCameraMouseDownHandler = (e) => {
            if (this.cameraMode !== 'game') return;
            if (e.button === 2) {
                isPanning = true;
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
                this.isCameraControlActive = true;
            }
        };

        this.gameCameraMouseMoveHandler = (e) => {
            if (!isPanning || this.cameraMode !== 'game') return;

            const deltaX = e.clientX - lastMouseX;
            const deltaY = e.clientY - lastMouseY;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;

            // Pan speed adjusted for orthographic camera
            const panSpeed = 1 / camera.zoom;

            // Get camera's right and up vectors
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

            // Move camera position
            camera.position.x -= right.x * deltaX * panSpeed;
            camera.position.y -= right.y * deltaX * panSpeed;
            camera.position.z -= right.z * deltaX * panSpeed;

            camera.position.x += up.x * deltaY * panSpeed;
            camera.position.y += up.y * deltaY * panSpeed;
            camera.position.z += up.z * deltaY * panSpeed;
        };

        this.gameCameraMouseUpHandler = (e) => {
            if (e.button === 2) {
                isPanning = false;
                this.isCameraControlActive = false;
            }
        };

        this.canvasEl.addEventListener('wheel', this.gameCameraWheelHandler, { passive: false });
        this.canvasEl.addEventListener('mousedown', this.gameCameraMouseDownHandler);
        this.canvasEl.addEventListener('mousemove', this.gameCameraMouseMoveHandler);
        this.canvasEl.addEventListener('mouseup', this.gameCameraMouseUpHandler);
        this.canvasEl.addEventListener('mouseleave', this.gameCameraMouseUpHandler);

        // Prevent context menu on canvas
        this.canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    /**
     * Setup keyboard handlers for camera rotation (Q/E keys)
     */
    setupKeyboardHandlers() {
        this.keydownHandler = (e) => {
            if (this.cameraMode !== 'game') return;

            if (e.key === 'q' || e.key === 'Q') {
                this.rotateGameCamera('left');
            } else if (e.key === 'e' || e.key === 'E') {
                this.rotateGameCamera('right');
            }
        };

        window.addEventListener('keydown', this.keydownHandler);
    }

    /**
     * Rotate the game camera by 45 degrees around the current look-at point
     * @param {string} direction - 'left' or 'right'
     */
    rotateGameCamera(direction) {
        if (this.cameraMode !== 'game') return;

        const camera = this.worldRenderer?.camera;
        if (!camera) return;

        // Raycast from center of screen to find ground point
        const raycaster = new THREE.Raycaster();
        const centerScreen = new THREE.Vector2(0, 0);
        raycaster.setFromCamera(centerScreen, camera);

        // Find the ground mesh
        const ground = this.worldRenderer.getGroundMesh();
        if (!ground) {
            // Fallback: rotate around stored lookAt or terrain center
            const lookAt = camera.userData?.lookAt || new THREE.Vector3(this.terrainSize / 2, 0, this.terrainSize / 2);
            this.rotateAroundPoint(camera, lookAt, direction);
            return;
        }

        const intersects = raycaster.intersectObject(ground, true);
        if (intersects.length === 0) {
            // Fallback
            const lookAt = camera.userData?.lookAt || new THREE.Vector3(this.terrainSize / 2, 0, this.terrainSize / 2);
            this.rotateAroundPoint(camera, lookAt, direction);
            return;
        }

        const groundPoint = intersects[0].point;
        this.rotateAroundPoint(camera, groundPoint, direction);
    }

    /**
     * Rotate camera around a point
     */
    rotateAroundPoint(camera, point, direction) {
        const rotationAngle = direction === 'left' ? Math.PI / 4 : -Math.PI / 4;

        // Calculate current offset from point
        const offset = new THREE.Vector3().subVectors(camera.position, point);

        // Rotate offset around Y axis
        const cosA = Math.cos(rotationAngle);
        const sinA = Math.sin(rotationAngle);
        const newX = offset.x * cosA - offset.z * sinA;
        const newZ = offset.x * sinA + offset.z * cosA;

        // Update camera position
        camera.position.set(
            point.x + newX,
            camera.position.y,
            point.z + newZ
        );

        // Rotate camera to face the point
        camera.lookAt(point);

        // Store look-at point for panning
        camera.userData.lookAt = point.clone();
    }

    /**
     * Clean up game camera control handlers
     */
    cleanupGameCameraControls() {
        if (this.gameCameraWheelHandler) {
            this.canvasEl.removeEventListener('wheel', this.gameCameraWheelHandler);
            this.gameCameraWheelHandler = null;
        }
        if (this.gameCameraMouseDownHandler) {
            this.canvasEl.removeEventListener('mousedown', this.gameCameraMouseDownHandler);
            this.canvasEl.removeEventListener('mousemove', this.gameCameraMouseMoveHandler);
            this.canvasEl.removeEventListener('mouseup', this.gameCameraMouseUpHandler);
            this.canvasEl.removeEventListener('mouseleave', this.gameCameraMouseUpHandler);
            this.gameCameraMouseDownHandler = null;
            this.gameCameraMouseMoveHandler = null;
            this.gameCameraMouseUpHandler = null;
        }
    }

    /**
     * Clean up WorldRenderer controls and their event handlers
     */
    cleanupWorldRendererControls() {
        if (!this.worldRenderer) return;

        // Clean up keyboard handlers
        if (this.worldRenderer.controlsKeyHandlers) {
            window.removeEventListener('keydown', this.worldRenderer.controlsKeyHandlers.handleKeyDown);
            window.removeEventListener('keyup', this.worldRenderer.controlsKeyHandlers.handleKeyUp);
            this.worldRenderer.controlsKeyHandlers = null;
        }

        // Clean up mouse handlers
        if (this.worldRenderer.controlsMouseHandlers && this.worldRenderer.renderer?.domElement) {
            const element = this.worldRenderer.renderer.domElement;
            element.removeEventListener('mousedown', this.worldRenderer.controlsMouseHandlers.handleMouseDown);
            element.removeEventListener('mousemove', this.worldRenderer.controlsMouseHandlers.handleMouseMove);
            element.removeEventListener('mouseup', this.worldRenderer.controlsMouseHandlers.handleMouseUp);
            element.removeEventListener('wheel', this.worldRenderer.controlsMouseHandlers.handleWheel);
            this.worldRenderer.controlsMouseHandlers = null;
        }

        // Dispose orbit controls
        if (this.worldRenderer.controls) {
            this.worldRenderer.controls.dispose();
            this.worldRenderer.controls = null;
        }
    }

    /**
     * Check if camera is currently being controlled (panning/rotating)
     */
    isControlActive() {
        return this.isCameraControlActive;
    }

    /**
     * Clean up all resources
     */
    destroy() {
        this.cleanupGameCameraControls();
        this.cleanupWorldRendererControls();

        if (this.keydownHandler) {
            window.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }
        if (this.keyupHandler) {
            window.removeEventListener('keyup', this.keyupHandler);
            this.keyupHandler = null;
        }
    }
}

// Register with window.GUTS for editor module system
if (typeof window !== 'undefined') {
    window.GUTS = window.GUTS || {};
    window.GUTS.EditorCameraController = EditorCameraController;
}
