/**
 * CameraCoordinatorSystem - Coordinates between multiple camera systems
 *
 * Manages switching between:
 * - OrthographicCameraSystem (isometric top-down view)
 * - FreeCameraSystem (perspective WASD flight)
 * - ThirdPersonCameraSystem (follow camera)
 *
 * Usage:
 * - Projects that need multiple camera modes extend this system
 * - Add the required camera systems to game.json
 * - Use setCameraMode('orthographic'|'free'|'thirdPerson') to switch
 */
class CameraCoordinatorSystem extends GUTS.BaseSystem {
    static services = [
        'getCamera',
        'setCamera',
        'getCameraMode',
        'setCameraMode',
        'toggleCameraMode',
        'getZoomLevel',
        'positionCameraAtStart',
        'cameraLookAt',
        'rotateCamera',
        'toggleCameraFollow',
        'getCameraFollowTarget',
        'startThirdPersonCamera',
        'stopThirdPersonCamera',
        'getThirdPersonTarget',
        'setFollowTarget',
        'getFollowTarget',
        'getFacingAngle',
        'getPitchAngle'
    ];

    static serviceDependencies = [
        'getActivePlayerTeam',
        'getCameraPositionForTeam'
    ];

    constructor(game) {
        super(game);
        this.game.cameraControlSystem = this;

        // Camera system references (resolved in init)
        this.orthographicSystem = null;
        this.freeSystem = null;
        this.thirdPersonSystem = null;

        // Track which system is currently active
        this.activeMode = 'orthographic'; // 'orthographic', 'free', 'thirdPerson'

        // Saved state for mode transitions
        this.savedOrthographicState = null;
        this.savedFreeState = null;
    }

    init() {
        // Get references to camera systems
        this.orthographicSystem = this.game.systemsByName.get('OrthographicCameraSystem');
        this.freeSystem = this.game.systemsByName.get('FreeCameraSystem');
        this.thirdPersonSystem = this.game.systemsByName.get('ThirdPersonCameraSystem');

        // Disable non-default systems initially
        if (this.freeSystem) {
            this.freeSystem.enabled = false;
        }
        if (this.thirdPersonSystem) {
            this.thirdPersonSystem.enabled = false;
        }

        // Ensure orthographic system is enabled
        if (this.orthographicSystem) {
            this.orthographicSystem.enabled = true;
        }
    }

    /**
     * Get the currently active camera system
     */
    getActiveCameraSystem() {
        switch (this.activeMode) {
            case 'orthographic':
                return this.orthographicSystem;
            case 'free':
                return this.freeSystem;
            case 'thirdPerson':
                return this.thirdPersonSystem;
            default:
                return this.orthographicSystem;
        }
    }

    // ==================== MODE SWITCHING ====================

    setCameraMode(mode) {
        if (mode === this.activeMode) return;

        const validModes = ['orthographic', 'free', 'thirdPerson'];
        if (!validModes.includes(mode)) {
            console.warn(`[CameraCoordinatorSystem] Invalid camera mode: ${mode}`);
            return;
        }

        // Check if target system exists
        const targetSystem = this._getSystemForMode(mode);
        if (!targetSystem) {
            console.warn(`[CameraCoordinatorSystem] Camera system for mode '${mode}' not available`);
            return;
        }

        const prevMode = this.activeMode;

        // Save current state
        this._saveCurrentState();

        // Disable current system
        const currentSystem = this.getActiveCameraSystem();
        if (currentSystem) {
            currentSystem.enabled = false;
        }

        // Enable new system
        targetSystem.enabled = true;

        // Transition camera position/orientation
        this._transitionToMode(mode, prevMode);

        this.activeMode = mode;

        this.game.triggerEvent('onCameraModeChange', { mode, prevMode });
    }

    toggleCameraMode() {
        // Cycle through available modes
        const modes = [];
        if (this.orthographicSystem) modes.push('orthographic');
        if (this.freeSystem) modes.push('free');
        // Don't include thirdPerson in toggle - it requires an entity

        if (modes.length === 0) return;

        const currentIndex = modes.indexOf(this.activeMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        this.setCameraMode(modes[nextIndex]);
    }

    _getSystemForMode(mode) {
        switch (mode) {
            case 'orthographic': return this.orthographicSystem;
            case 'free': return this.freeSystem;
            case 'thirdPerson': return this.thirdPersonSystem;
            default: return null;
        }
    }

    _saveCurrentState() {
        if (this.activeMode === 'orthographic' && this.orthographicSystem) {
            const camera = this.orthographicSystem.getCamera();
            if (camera) {
                this.savedOrthographicState = {
                    position: camera.position.clone(),
                    zoom: camera.zoom,
                    yaw: this.orthographicSystem.getYaw?.() || 0,
                    lookAt: this.orthographicSystem.getLookAtPoint?.()
                };
            }
        } else if (this.activeMode === 'free' && this.freeSystem) {
            const camera = this.freeSystem.getCamera();
            if (camera) {
                this.savedFreeState = {
                    position: camera.position.clone(),
                    yaw: this.freeSystem.getYaw?.() || 0,
                    pitch: this.freeSystem.getPitch?.() || 0
                };
            }
        }
    }

    _transitionToMode(newMode, prevMode) {
        if (newMode === 'free' && this.freeSystem) {
            // Transitioning to free camera
            if (this.savedFreeState) {
                // Restore saved state
                this.freeSystem.setInitialPosition({
                    position: this.savedFreeState.position,
                    yaw: this.savedFreeState.yaw,
                    pitch: this.savedFreeState.pitch
                });
            } else if (prevMode === 'orthographic' && this.savedOrthographicState) {
                // Initialize from orthographic camera position
                // Coordinate system: +Y up, +Z south, +X east
                // Orthographic with yaw=135° is positioned southwest, looking northeast
                const lookAt = this.savedOrthographicState.lookAt || new THREE.Vector3(0, 0, 0);
                const viewDistance = 400;
                const orthoYaw = this.savedOrthographicState.yaw;

                // Position camera same as ortho: southwest of lookAt
                const position = new THREE.Vector3(
                    lookAt.x - Math.sin(orthoYaw) * viewDistance,
                    lookAt.y + viewDistance,
                    lookAt.z - Math.cos(orthoYaw) * viewDistance
                );

                // Calculate yaw for THREE.js Euler 'YXZ' convention
                // Default camera looks at -Z, yaw rotates counter-clockwise from above
                // Direction from camera to lookAt:
                const dx = lookAt.x - position.x;
                const dz = lookAt.z - position.z;
                // For Euler yaw with default -Z look direction
                const freeYaw = Math.atan2(-dx, -dz);

                // Pitch: -45° to look down at 45 degree angle
                const freePitch = -Math.PI / 4;

                this.freeSystem.setInitialPosition({
                    position,
                    yaw: freeYaw,
                    pitch: freePitch
                });
            }
        } else if (newMode === 'orthographic' && this.orthographicSystem) {
            // Transitioning to orthographic camera
            if (this.savedOrthographicState) {
                const camera = this.orthographicSystem.getCamera();
                if (camera) {
                    camera.position.copy(this.savedOrthographicState.position);
                    camera.zoom = this.savedOrthographicState.zoom;
                    camera.updateProjectionMatrix();
                }
            }
        }
    }

    // ==================== DELEGATED SERVICE METHODS ====================

    getCamera() {
        return this.getActiveCameraSystem()?.getCamera?.() || null;
    }

    setCamera(camera) {
        // Set on orthographic system (it manages the orthographic camera)
        this.orthographicSystem?.setCamera?.(camera);
    }

    getCameraMode() {
        return this.activeMode;
    }

    getZoomLevel() {
        return this.getActiveCameraSystem()?.getZoomLevel?.() || 1.0;
    }

    positionCameraAtStart() {
        this.orthographicSystem?.positionCameraAtStart?.();
    }

    cameraLookAt(worldX, worldZ) {
        if (this.activeMode !== 'orthographic') {
            this.setCameraMode('orthographic');
        }
        this.orthographicSystem?.cameraLookAt?.(worldX, worldZ);
    }

    rotateCamera(direction) {
        if (this.activeMode === 'orthographic') {
            this.orthographicSystem?.rotateCamera?.(direction);
        }
    }

    toggleCameraFollow(entityId) {
        if (this.activeMode === 'thirdPerson') {
            this.stopThirdPersonCamera();
            return false;
        }
        if (this.activeMode === 'orthographic') {
            return this.orthographicSystem?.toggleCameraFollow?.(entityId) || false;
        }
        return false;
    }

    getCameraFollowTarget() {
        if (this.activeMode === 'thirdPerson') {
            return this.thirdPersonSystem?.getFollowTarget?.() || null;
        }
        if (this.activeMode === 'orthographic') {
            return this.orthographicSystem?.getCameraFollowTarget?.() || null;
        }
        return null;
    }

    // ==================== THIRD-PERSON CAMERA CONTROL ====================

    /**
     * Start third-person camera following an entity
     * @param {number} entityId - Entity to follow
     */
    startThirdPersonCamera(entityId) {
        if (!this.thirdPersonSystem) {
            console.warn('[CameraCoordinatorSystem] ThirdPersonCameraSystem not available');
            return;
        }

        if (!entityId) {
            console.warn('[CameraCoordinatorSystem] No entity ID provided for third-person camera');
            return;
        }

        // Save current state before switching
        this._saveCurrentState();

        const prevMode = this.activeMode;

        // Disable current system
        const currentSystem = this.getActiveCameraSystem();
        if (currentSystem) {
            currentSystem.enabled = false;
        }

        // Enable and configure third-person system
        this.thirdPersonSystem.enabled = true;
        this.thirdPersonSystem.setFollowTarget(entityId);

        this.activeMode = 'thirdPerson';

        this.game.triggerEvent('onThirdPersonCameraStart', { entityId });
        this.game.triggerEvent('onCameraModeChange', {
            mode: 'thirdPerson',
            prevMode
        });
    }

    /**
     * Stop third-person camera and return to orthographic view
     */
    stopThirdPersonCamera() {
        if (this.activeMode !== 'thirdPerson') return;

        const entityId = this.thirdPersonSystem?.getFollowTarget?.();

        // Disable third-person system
        if (this.thirdPersonSystem) {
            this.thirdPersonSystem.setFollowTarget(null);
            this.thirdPersonSystem.enabled = false;
        }

        // Re-enable orthographic system
        if (this.orthographicSystem) {
            this.orthographicSystem.enabled = true;

            // Restore saved state
            if (this.savedOrthographicState) {
                const camera = this.orthographicSystem.getCamera();
                if (camera) {
                    camera.position.copy(this.savedOrthographicState.position);
                    camera.zoom = this.savedOrthographicState.zoom;
                    camera.updateProjectionMatrix();
                }
            }
        }

        this.activeMode = 'orthographic';

        this.game.triggerEvent('onThirdPersonCameraStop', { entityId });
        this.game.triggerEvent('onCameraModeChange', {
            mode: 'orthographic',
            prevMode: 'thirdPerson'
        });
    }

    /**
     * Get the entity being followed in third-person mode
     */
    getThirdPersonTarget() {
        if (this.activeMode === 'thirdPerson') {
            return this.thirdPersonSystem?.getFollowTarget?.() || null;
        }
        return null;
    }

    // ==================== THIRD-PERSON DELEGATED METHODS ====================

    setFollowTarget(entityId) {
        if (this.activeMode === 'thirdPerson') {
            this.thirdPersonSystem?.setFollowTarget?.(entityId);
        }
    }

    getFollowTarget() {
        if (this.activeMode === 'thirdPerson') {
            return this.thirdPersonSystem?.getFollowTarget?.() || null;
        }
        return null;
    }

    getFacingAngle() {
        if (this.activeMode === 'thirdPerson') {
            return this.thirdPersonSystem?.getFacingAngle?.() || 0;
        }
        return 0;
    }

    getPitchAngle() {
        if (this.activeMode === 'thirdPerson') {
            return this.thirdPersonSystem?.getPitchAngle?.() || 0;
        }
        return 0;
    }

    // ==================== LIFECYCLE ====================

    onSceneUnload() {
        // Return to orthographic mode on scene change
        if (this.activeMode === 'thirdPerson') {
            this.stopThirdPersonCamera();
        } else if (this.activeMode === 'free') {
            this.setCameraMode('orthographic');
        }

        // Clear saved states
        this.savedOrthographicState = null;
        this.savedFreeState = null;
    }
}

// Register on GUTS namespace
if (typeof GUTS !== 'undefined') {
    GUTS.CameraCoordinatorSystem = CameraCoordinatorSystem;
}

export default CameraCoordinatorSystem;
export { CameraCoordinatorSystem };
