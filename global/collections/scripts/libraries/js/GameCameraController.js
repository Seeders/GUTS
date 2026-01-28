/**
 * GameCameraController - Reusable camera controls for game and editors
 *
 * Provides two camera modes:
 * - Game mode: Orthographic camera with isometric view, edge-pan, zoom, and Q/E rotation
 * - Free mode: Perspective camera with WASD movement, mouse look, and free flight
 *
 * Usage:
 *   const cameraController = new GameCameraController(options);
 *   cameraController.initialize();
 *   cameraController.setCameraMode('free'); // or 'game'
 *   cameraController.update(deltaTime); // call each frame
 */
class GameCameraController {
    constructor(options = {}) {
        // Required: THREE.js camera reference getter
        this.getCamera = options.getCamera || (() => null);

        // Required: callback to set the active camera
        this.setCamera = options.setCamera || null;

        // Required: canvas/container element for mouse events
        this.container = options.container || document.body;

        // Optional: ground mesh getter for raycasting (rotation pivot)
        this.getGroundMesh = options.getGroundMesh || (() => null);

        // Optional: world bounds for camera clamping
        this.getWorldBounds = options.getWorldBounds || (() => ({ min: -1000, max: 1000 }));

        // Optional: camera height from settings
        this.getCameraHeight = options.getCameraHeight || (() => 512);

        // Optional: callback to get the player's starting position for free camera initialization
        this.getPlayerStartPosition = options.getPlayerStartPosition || (() => null);

        // Optional: callback when mode changes
        this.onModeChange = options.onModeChange || null;

        // Camera mode: 'game' (orthographic isometric), 'free' (perspective free-fly), or 'thirdPerson' (follow unit)
        this.cameraMode = 'game';

        // Saved camera states for mode switching
        this.gameCameraState = null;
        this.freeCameraState = null;

        // Perspective camera for free mode (created on first use)
        this.perspectiveCamera = null;

        // Reference to the original orthographic camera
        this.orthographicCamera = null;

        // Top-down camera state
        this.thirdPersonTarget = null; // { getPosition: () => {x, y, z}, getRotation: () => y }
        this.thirdPersonDistance = 150; // Starting height above character
        this.thirdPersonMinDistance = 50; // Minimum height (zoomed in)
        this.thirdPersonMaxDistance = 500; // Maximum height (zoomed out)
        this.thirdPersonSmoothSpeed = 8; // Higher = faster/snappier, lower = smoother
        this.thirdPersonCurrentPos = new THREE.Vector3();
        this.thirdPersonInitialized = false;

        // Game mode state
        this.cameraYaw = 135 * Math.PI / 180; // Default isometric angle
        this.edgePanSpeed = 900;
        this.edgePanThreshold = 10;
        this.mouseX = -1;
        this.mouseY = -1;
        this.isMouseInWindow = false;
        this.holdDirX = 0;
        this.holdDirZ = 0;

        // Free mode state
        this.freeCameraSpeed = 500;
        this.freeCameraFastMultiplier = 2.5;
        this.freeCameraSlowMultiplier = 0.3;
        this.mouseSensitivity = 0.002;
        this.pitch = 0;
        this.yaw = Math.PI; // Start facing -Z
        this.keysPressed = new Set();
        this.isMouseLocked = false;
        this.isRightMouseDown = false;

        // Reusable vectors
        this._right = new THREE.Vector3();
        this._forward = new THREE.Vector3();
        this._up = new THREE.Vector3(0, 1, 0);
        this._delta = new THREE.Vector3();
        this._lookAtTarget = new THREE.Vector3();

        // Event handlers (stored for cleanup)
        this._handlers = {};

        // Minimum camera height in free mode
        this.minCameraHeight = 10;
    }

    /**
     * Initialize the camera controller
     */
    initialize() {
        this._setupEventHandlers();
        console.log('[GameCameraController] Initialized');
    }

    /**
     * Update camera each frame (call from game loop)
     * @param {number} deltaTime - Time since last frame in seconds
     */
    update(deltaTime) {
        if (this.cameraMode === 'game') {
            this._updateGameCamera(deltaTime);
        } else if (this.cameraMode === 'thirdPerson') {
            this._updateThirdPersonCamera(deltaTime);
        } else {
            this._updateFreeCamera(deltaTime);
        }
    }

    /**
     * Set the camera mode
     * @param {string} mode - 'game' or 'free'
     */
    setCameraMode(mode) {
        console.log(`[GameCameraController] setCameraMode called: ${this.cameraMode} -> ${mode}`);
        if (mode === this.cameraMode) {
            console.log('[GameCameraController] Already in mode:', mode);
            return;
        }

        // Save current camera state
        this._saveCameraState();

        const prevMode = this.cameraMode;
        this.cameraMode = mode;
        console.log(`[GameCameraController] Mode changed to: ${this.cameraMode}`);

        const currentCamera = this.getCamera();
        if (!currentCamera) return;

        if (mode === 'free' || mode === 'thirdPerson') {
            // Store reference to orthographic camera if not already stored
            if (!this.orthographicCamera) {
                this.orthographicCamera = currentCamera;
            }

            // Create perspective camera if needed
            if (!this.perspectiveCamera) {
                this._createPerspectiveCamera();
            }

            // Clear edge panning state when entering free/thirdPerson mode
            this.holdDirX = 0;
            this.holdDirZ = 0;

            if (mode === 'free') {
                // Setup and switch to perspective camera for free mode
                this._setupFreeCamera();
            } else {
                // Setup third-person camera (will be positioned in _updateThirdPersonCamera)
                this._setupThirdPersonCamera();
            }

            if (this.setCamera) {
                this.setCamera(this.perspectiveCamera);
                console.log('[GameCameraController] Switched to perspective camera', {
                    position: this.perspectiveCamera.position.toArray(),
                    quaternion: this.perspectiveCamera.quaternion.toArray(),
                    fov: this.perspectiveCamera.fov,
                    near: this.perspectiveCamera.near,
                    far: this.perspectiveCamera.far
                });
            }
        } else {
            // Switch back to orthographic camera (game mode)
            this.thirdPersonTarget = null;
            if (this.orthographicCamera) {
                this._setupGameCamera(this.orthographicCamera);

                if (this.setCamera) {
                    this.setCamera(this.orthographicCamera);
                }
            }
        }

        if (this.onModeChange) {
            this.onModeChange(mode, prevMode);
        }

        console.log(`[GameCameraController] Camera mode switched to: ${mode}`);
    }

    /**
     * Get current camera mode
     */
    getCameraMode() {
        return this.cameraMode;
    }

    /**
     * Toggle between game and free camera modes
     */
    toggleCameraMode() {
        this.setCameraMode(this.cameraMode === 'game' ? 'free' : 'game');
    }

    /**
     * Rotate the game camera by 45 degrees (Q/E rotation)
     * @param {string} direction - 'left' or 'right'
     */
    rotateGameCamera(direction) {
        if (this.cameraMode !== 'game') return;

        const camera = this.getCamera();
        if (!camera) return;

        // Try to find ground point at screen center for rotation pivot
        const raycaster = new THREE.Raycaster();
        const centerScreen = new THREE.Vector2(0, 0);
        raycaster.setFromCamera(centerScreen, camera);

        const ground = this.getGroundMesh();
        let pivotPoint = camera.userData?.lookAt?.clone();

        if (ground) {
            const intersects = raycaster.intersectObject(ground, true);
            if (intersects.length > 0) {
                pivotPoint = intersects[0].point;
            }
        }

        if (!pivotPoint) {
            // Fallback to world center
            const bounds = this.getWorldBounds();
            pivotPoint = new THREE.Vector3((bounds.min + bounds.max) / 2, 0, (bounds.min + bounds.max) / 2);
        }

        // Update yaw and reposition camera
        const rotationAngle = direction === 'left' ? -Math.PI / 4 : Math.PI / 4;
        this.cameraYaw += rotationAngle;

        this._lookAtPoint(pivotPoint.x, pivotPoint.z);
    }

    /**
     * Look at a world position (game mode)
     */
    lookAt(worldX, worldZ) {
        if (this.cameraMode !== 'game') return;
        this._lookAtPoint(worldX, worldZ);
    }

    /**
     * Dispose and clean up all event handlers
     */
    destroy() {
        this._cleanupEventHandlers();

        // Clean up perspective camera resize handler
        if (this._perspectiveResizeHandler) {
            window.removeEventListener('resize', this._perspectiveResizeHandler);
            this._perspectiveResizeHandler = null;
        }

        // Clean up perspective camera
        this.perspectiveCamera = null;
        this.orthographicCamera = null;

        console.log('[GameCameraController] Destroyed');
    }

    // ==================== PRIVATE METHODS ====================

    _setupEventHandlers() {
        // Mouse movement
        this._handlers.mouseMove = (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
            this.isMouseInWindow = true;

            if (this.cameraMode === 'free' && this.isRightMouseDown) {
                this._handleFreeCameraMouseMove(e);
            }
        };

        // Mouse enter/leave for edge panning
        this._handlers.mouseEnter = () => {
            this.isMouseInWindow = true;
            this.holdDirX = 0;
            this.holdDirZ = 0;
        };

        this._handlers.mouseLeave = () => {
            this._handleMouseLeave();
        };

        // Mouse buttons
        this._handlers.mouseDown = (e) => {
            if (e.button === 2) {
                this.isRightMouseDown = true;
                if (this.cameraMode === 'free') {
                    this.container.requestPointerLock?.();
                }
            }
        };

        this._handlers.mouseUp = (e) => {
            if (e.button === 2) {
                this.isRightMouseDown = false;
                if (document.pointerLockElement) {
                    document.exitPointerLock?.();
                }
            }
        };

        // Mouse wheel zoom
        this._handlers.wheel = (e) => {
            this._handleWheel(e);
        };

        // Keyboard
        this._handlers.keyDown = (e) => {
            this.keysPressed.add(e.code);

            // Q/E rotation in game mode
            if (this.cameraMode === 'game') {
                if (e.key === 'q' || e.key === 'Q') {
                    this.rotateGameCamera('left');
                } else if (e.key === 'e' || e.key === 'E') {
                    this.rotateGameCamera('right');
                }
            }
        };

        this._handlers.keyUp = (e) => {
            this.keysPressed.delete(e.code);
        };

        // Blur (lost focus)
        this._handlers.blur = () => {
            this.isMouseInWindow = false;
            this.holdDirX = 0;
            this.holdDirZ = 0;
            this.keysPressed.clear();
            this.isRightMouseDown = false;
        };

        // Pointer lock change
        this._handlers.pointerLockChange = () => {
            this.isMouseLocked = !!document.pointerLockElement;
        };

        // Context menu prevention
        this._handlers.contextMenu = (e) => {
            if (this.cameraMode === 'free') {
                e.preventDefault();
            }
        };

        // Add listeners
        window.addEventListener('mousemove', this._handlers.mouseMove, { passive: true });
        window.addEventListener('mouseenter', this._handlers.mouseEnter);
        window.addEventListener('mouseleave', this._handlers.mouseLeave);
        window.addEventListener('mousedown', this._handlers.mouseDown);
        window.addEventListener('mouseup', this._handlers.mouseUp);
        window.addEventListener('wheel', this._handlers.wheel, { passive: false });
        window.addEventListener('keydown', this._handlers.keyDown);
        window.addEventListener('keyup', this._handlers.keyUp);
        window.addEventListener('blur', this._handlers.blur);
        document.addEventListener('pointerlockchange', this._handlers.pointerLockChange);
        this.container.addEventListener('contextmenu', this._handlers.contextMenu);
    }

    _cleanupEventHandlers() {
        window.removeEventListener('mousemove', this._handlers.mouseMove);
        window.removeEventListener('mouseenter', this._handlers.mouseEnter);
        window.removeEventListener('mouseleave', this._handlers.mouseLeave);
        window.removeEventListener('mousedown', this._handlers.mouseDown);
        window.removeEventListener('mouseup', this._handlers.mouseUp);
        window.removeEventListener('wheel', this._handlers.wheel);
        window.removeEventListener('keydown', this._handlers.keyDown);
        window.removeEventListener('keyup', this._handlers.keyUp);
        window.removeEventListener('blur', this._handlers.blur);
        document.removeEventListener('pointerlockchange', this._handlers.pointerLockChange);
        this.container.removeEventListener('contextmenu', this._handlers.contextMenu);
    }

    _saveCameraState() {
        if (this.cameraMode === 'game') {
            const camera = this.orthographicCamera || this.getCamera();
            if (!camera) return;

            this.gameCameraState = {
                position: camera.position.clone(),
                quaternion: camera.quaternion.clone(),
                zoom: camera.zoom,
                lookAt: camera.userData?.lookAt?.clone(),
                yaw: this.cameraYaw
            };
        } else {
            const camera = this.perspectiveCamera;
            if (!camera) return;

            this.freeCameraState = {
                position: camera.position.clone(),
                pitch: this.pitch,
                yaw: this.yaw
            };
        }
    }

    _setupGameCamera(camera) {
        // Restore saved state if available
        if (this.gameCameraState) {
            camera.position.copy(this.gameCameraState.position);
            camera.quaternion.copy(this.gameCameraState.quaternion);
            camera.zoom = this.gameCameraState.zoom;
            this.cameraYaw = this.gameCameraState.yaw;
            if (this.gameCameraState.lookAt) {
                camera.userData.lookAt = this.gameCameraState.lookAt.clone();
            }
            camera.updateProjectionMatrix();
        }
    }

    _createPerspectiveCamera() {
        const aspect = window.innerWidth / window.innerHeight;
        this.perspectiveCamera = new THREE.PerspectiveCamera(60, aspect, 1, 10000);

        // Initialize projection matrix
        this.perspectiveCamera.updateProjectionMatrix();

        // Handle window resize
        this._perspectiveResizeHandler = () => {
            if (this.perspectiveCamera) {
                this.perspectiveCamera.aspect = window.innerWidth / window.innerHeight;
                this.perspectiveCamera.updateProjectionMatrix();
            }
        };
        window.addEventListener('resize', this._perspectiveResizeHandler);
    }

    _setupFreeCamera() {
        const camera = this.perspectiveCamera;
        if (!camera) return;

        // Restore saved state or initialize from a good viewing position
        if (this.freeCameraState) {
            camera.position.copy(this.freeCameraState.position);
            this.pitch = this.freeCameraState.pitch;
            this.yaw = this.freeCameraState.yaw;
        } else {
            // First time switching to free mode - position camera to view the player's starting location
            // Try to get from the service callback first, fall back to orthographic camera userData
            const startPos = this.getPlayerStartPosition();
            const lookAtPoint = startPos
                ? new THREE.Vector3(startPos.x, startPos.y || 0, startPos.z)
                : (this.orthographicCamera?.userData?.lookAt?.clone() || new THREE.Vector3(0, 0, 0));

            console.log('[GameCameraController] Free camera lookAt point:', lookAtPoint.toArray(), 'from service:', !!startPos);

            // Position camera behind and above the target point
            const viewDistance = 350;  // Horizontal distance from target
            const viewHeight = 400;    // Height above ground

            // Use the current game camera yaw to position camera behind the view direction
            const offsetX = Math.sin(this.cameraYaw) * viewDistance;
            const offsetZ = Math.cos(this.cameraYaw) * viewDistance;

            camera.position.set(
                lookAtPoint.x + offsetX,
                viewHeight,
                lookAtPoint.z + offsetZ
            );

            // Calculate pitch and yaw to look at the target
            const dx = lookAtPoint.x - camera.position.x;
            const dy = lookAtPoint.y - camera.position.y;
            const dz = lookAtPoint.z - camera.position.z;
            const horizontalDist = Math.sqrt(dx * dx + dz * dz);

            this.yaw = Math.atan2(dx, dz);
            this.pitch = Math.atan2(dy, horizontalDist);
        }

        this._updateFreeCameraRotation(camera);

        // Ensure camera matrices are fully updated
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        console.log('[GameCameraController] Free camera setup complete', {
            position: camera.position.toArray(),
            pitch: this.pitch * 180 / Math.PI,
            yaw: this.yaw * 180 / Math.PI,
            fov: camera.fov,
            aspect: camera.aspect,
            near: camera.near,
            far: camera.far
        });
    }

    _updateGameCamera(deltaTime) {
        // Double-check we're in game mode (safety guard)
        if (this.cameraMode !== 'game') return;

        const camera = this.getCamera();
        if (!camera) return;

        // Camera is controlled by WASD keys only (no edge panning)
        // Just ensure matrices are updated
        camera.updateMatrixWorld(true);
    }

    _updateFreeCamera(deltaTime) {
        const camera = this.perspectiveCamera;
        if (!camera) return;

        // WASD + Space/Shift movement
        let speed = this.freeCameraSpeed;
        if (this.keysPressed.has('ShiftLeft') || this.keysPressed.has('ShiftRight')) {
            speed *= this.freeCameraFastMultiplier;
        }
        if (this.keysPressed.has('ControlLeft') || this.keysPressed.has('ControlRight')) {
            speed *= this.freeCameraSlowMultiplier;
        }

        // Calculate forward and right vectors from yaw (ignore pitch for movement)
        this._forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
        this._right.set(Math.sin(this.yaw + Math.PI / 2), 0, Math.cos(this.yaw + Math.PI / 2)).normalize();

        this._delta.set(0, 0, 0);

        // Forward/backward
        if (this.keysPressed.has('KeyW')) {
            this._delta.addScaledVector(this._forward, -speed * deltaTime);
        }
        if (this.keysPressed.has('KeyS')) {
            this._delta.addScaledVector(this._forward, speed * deltaTime);
        }

        // Left/right strafe
        if (this.keysPressed.has('KeyA')) {
            this._delta.addScaledVector(this._right, -speed * deltaTime);
        }
        if (this.keysPressed.has('KeyD')) {
            this._delta.addScaledVector(this._right, speed * deltaTime);
        }

        // Up/down
        if (this.keysPressed.has('Space')) {
            this._delta.y += speed * deltaTime;
        }
        if (this.keysPressed.has('KeyQ')) {
            this._delta.y -= speed * deltaTime;
        }

        if (this._delta.lengthSq() > 0) {
            camera.position.add(this._delta);

            // Enforce minimum height
            if (camera.position.y < this.minCameraHeight) {
                camera.position.y = this.minCameraHeight;
            }
        }

        // Always update camera matrices for rendering (even when not moving)
        camera.updateMatrixWorld(true);
    }

    _setupThirdPersonCamera() {
        const camera = this.perspectiveCamera;
        if (!camera) return;

        // Reset initialization flag so camera snaps to initial position
        this.thirdPersonInitialized = false;

        // Reset distance to default starting value (height for top-down)
        this.thirdPersonDistance = 150;

        // Initial setup - actual positioning happens in _updateThirdPersonCamera
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        console.log('[GameCameraController] Top-down camera setup complete, height:', this.thirdPersonDistance);
    }

    _updateThirdPersonCamera(deltaTime) {
        const camera = this.perspectiveCamera;
        if (!camera || !this.thirdPersonTarget) return;

        // Get target position
        const targetPos = this.thirdPersonTarget.getPosition();
        if (!targetPos) {
            // Target lost, switch back to game mode
            console.warn('[TopDownCamera] Target position is null, switching to game mode');
            this.setCameraMode('game');
            return;
        }

        // Simple top-down camera: position directly above the character
        const desiredX = targetPos.x;
        const desiredY = targetPos.y + this.thirdPersonDistance; // Height above character
        const desiredZ = targetPos.z;

        // On first frame, snap to position; otherwise smooth
        if (!this.thirdPersonInitialized) {
            this.thirdPersonCurrentPos.set(desiredX, desiredY, desiredZ);
            this.thirdPersonInitialized = true;
            console.log('[TopDownCamera] Initialized at:', desiredX, desiredY, desiredZ, 'target:', targetPos.x, targetPos.y, targetPos.z);
        } else {
            // Smooth interpolation (lerp)
            const t = 1 - Math.exp(-this.thirdPersonSmoothSpeed * deltaTime);
            this.thirdPersonCurrentPos.x += (desiredX - this.thirdPersonCurrentPos.x) * t;
            this.thirdPersonCurrentPos.y += (desiredY - this.thirdPersonCurrentPos.y) * t;
            this.thirdPersonCurrentPos.z += (desiredZ - this.thirdPersonCurrentPos.z) * t;
        }

        camera.position.copy(this.thirdPersonCurrentPos);

        // Look straight down at the character
        // Set camera up vector to -Z so it doesn't flip when looking straight down
        camera.up.set(0, 0, -1);
        this._lookAtTarget.set(targetPos.x, targetPos.y, targetPos.z);
        camera.lookAt(this._lookAtTarget);
        camera.updateMatrixWorld(true);
    }

    /**
     * Set third-person camera target
     * @param {Object} target - Object with getPosition() and optionally getRotation() methods
     */
    setThirdPersonTarget(target) {
        this.thirdPersonTarget = target;
    }

    /**
     * Get current third-person target
     */
    getThirdPersonTarget() {
        return this.thirdPersonTarget;
    }

    _handleFreeCameraMouseMove(e) {
        const camera = this.perspectiveCamera;
        if (!camera) return;

        const movementX = e.movementX || 0;
        const movementY = e.movementY || 0;

        this.yaw -= movementX * this.mouseSensitivity;
        this.pitch -= movementY * this.mouseSensitivity;

        // Clamp pitch to prevent flipping
        this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));

        this._updateFreeCameraRotation(camera);
    }

    _updateFreeCameraRotation(camera) {
        // Build rotation from pitch and yaw
        const quaternion = new THREE.Quaternion();
        const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
        quaternion.setFromEuler(euler);
        camera.quaternion.copy(quaternion);

        // Update world matrix after rotation change
        camera.updateMatrixWorld(true);
    }

    _handleWheel(e) {
        const camera = this.getCamera();
        if (!camera) return;

        if (this.cameraMode === 'game') {
            // Orthographic zoom
            if (e.deltaY > 0) {
                camera.zoom *= 0.9;
            } else {
                camera.zoom *= 1.1;
            }
            camera.zoom = Math.max(0.1, Math.min(5, camera.zoom));
            camera.updateProjectionMatrix();
        } else if (this.cameraMode === 'thirdPerson') {
            // Top-down camera: adjust height above character
            const zoomAmount = e.deltaY > 0 ? 50 : -50;
            this.thirdPersonDistance = Math.max(
                this.thirdPersonMinDistance,
                Math.min(this.thirdPersonMaxDistance, this.thirdPersonDistance + zoomAmount)
            );
        } else {
            // Free camera: move forward/backward
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            const zoomSpeed = e.deltaY > 0 ? -50 : 50;
            camera.position.addScaledVector(forward, zoomSpeed);

            // Enforce minimum height
            if (camera.position.y < this.minCameraHeight) {
                camera.position.y = this.minCameraHeight;
            }
        }
    }

    _handleMouseLeave() {
        // Only track edge pan hold state in game mode
        if (this.cameraMode !== 'game') {
            this.isMouseInWindow = false;
            return;
        }

        const w = window.innerWidth;
        const h = window.innerHeight;

        if (this.mouseX <= 0) this.holdDirX = -1;
        else if (this.mouseX >= w - 1) this.holdDirX = 1;
        else this.holdDirX = 0;

        if (this.mouseY <= this.edgePanThreshold) this.holdDirZ = 1;
        else if (this.mouseY >= h - this.edgePanThreshold) this.holdDirZ = -1;
        else this.holdDirZ = 0;

        this.isMouseInWindow = false;
    }

    _updateGroundBasis(camera) {
        this._right.set(1, 0, 0).applyQuaternion(camera.quaternion);
        this._forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
        this._right.y = 0;
        this._forward.y = 0;
        if (this._right.lengthSq() > 0) this._right.normalize();
        if (this._forward.lengthSq() > 0) this._forward.normalize();
    }

    _lookAtPoint(worldX, worldZ) {
        const camera = this.getCamera();
        if (!camera) return;

        const pitch = 35.264 * Math.PI / 180;
        const distance = this.getCameraHeight();

        const cdx = Math.sin(this.cameraYaw) * Math.cos(pitch);
        const cdz = Math.cos(this.cameraYaw) * Math.cos(pitch);

        camera.position.set(
            worldX - cdx * distance,
            distance,
            worldZ - cdz * distance
        );

        camera.lookAt(worldX, 0, worldZ);

        this._lookAtTarget.set(worldX, 0, worldZ);
        // Clone the target so each camera gets its own copy (not a shared reference)
        camera.userData.lookAt = this._lookAtTarget.clone();
    }

    _clampCamera(camera) {
        const bounds = this.getWorldBounds();
        const half = (bounds.max - bounds.min) / 2;
        const center = (bounds.max + bounds.min) / 2;

        camera.position.x = Math.max(center - half, Math.min(center + half, camera.position.x));
        camera.position.z = Math.max(center - half, Math.min(center + half, camera.position.z));

        if (camera.userData?.lookAt instanceof THREE.Vector3) {
            camera.userData.lookAt.x = Math.max(center - half, Math.min(center + half, camera.userData.lookAt.x));
            camera.userData.lookAt.z = Math.max(center - half, Math.min(center + half, camera.userData.lookAt.z));
        }
    }
}

// Assign to global.GUTS for both browser and server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.GameCameraController = GameCameraController;
}
if (typeof window !== 'undefined' && window.GUTS) {
    window.GUTS.GameCameraController = GameCameraController;
}

// ES6 exports for webpack bundling
export default GameCameraController;
export { GameCameraController };
