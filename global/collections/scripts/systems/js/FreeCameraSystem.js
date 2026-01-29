import BaseCameraSystem from './BaseCameraSystem.js';

/**
 * FreeCameraSystem - Perspective WASD flight camera
 *
 * Features:
 * - Perspective camera with free movement
 * - WASD movement with Shift/Ctrl speed modifiers
 * - Right-click drag to look around
 * - Mouse wheel to move forward/back
 * - Space/Q for vertical movement
 */
class FreeCameraSystem extends BaseCameraSystem {
    static services = [
        ...BaseCameraSystem.services,
        'setInitialPosition',
        'getYaw',
        'getPitch'
    ];

    constructor(game) {
        super(game);

        // Free camera state
        this.state.yaw = 0;
        this.state.pitch = 0;

        // Config
        this.config = this._getDefaultConfig();
    }

    // ==================== CONFIG ====================

    _getDefaultConfig() {
        const configs = this.collections?.cameraConfigs || {};
        return configs.free || {
            mode: 'free',
            projection: 'perspective',
            fov: 60,
            movement: {
                speed: 500,
                fastMultiplier: 2.5,
                slowMultiplier: 0.3,
                minHeight: 10
            },
            mouse: { sensitivity: 0.002, requireRightClick: true },
            pitch: { min: -89, max: 89 }
        };
    }

    // ==================== OVERRIDES ====================

    getDefaultMode() {
        return 'free';
    }

    getAvailableModes() {
        return ['free'];
    }

    init() {
        super.init();
        this.config = this._getDefaultConfig();

        // Create perspective camera
        this._createPerspectiveCamera(this.config.fov);
        this.activeCamera = this.perspectiveCamera;
    }

    // ==================== UPDATE ====================

    updateCamera(dt) {
        const camera = this.perspectiveCamera;
        if (!camera) return;

        const config = this.config;
        let speed = config.movement.speed;

        // Speed modifiers
        if (this.state.keysPressed.has('ShiftLeft') || this.state.keysPressed.has('ShiftRight')) {
            speed *= config.movement.fastMultiplier;
        }
        if (this.state.keysPressed.has('ControlLeft') || this.state.keysPressed.has('ControlRight')) {
            speed *= config.movement.slowMultiplier;
        }

        // Calculate movement vectors
        this._forward.set(Math.sin(this.state.yaw), 0, Math.cos(this.state.yaw)).normalize();
        this._right.set(Math.sin(this.state.yaw + Math.PI / 2), 0, Math.cos(this.state.yaw + Math.PI / 2)).normalize();
        this._delta.set(0, 0, 0);

        // WASD movement
        if (this.state.keysPressed.has('KeyW')) {
            this._delta.addScaledVector(this._forward, -speed * dt);
        }
        if (this.state.keysPressed.has('KeyS')) {
            this._delta.addScaledVector(this._forward, speed * dt);
        }
        if (this.state.keysPressed.has('KeyA')) {
            this._delta.addScaledVector(this._right, -speed * dt);
        }
        if (this.state.keysPressed.has('KeyD')) {
            this._delta.addScaledVector(this._right, speed * dt);
        }

        // Vertical movement
        if (this.state.keysPressed.has('Space')) {
            this._delta.y += speed * dt;
        }
        if (this.state.keysPressed.has('KeyQ')) {
            this._delta.y -= speed * dt;
        }

        // Apply movement
        if (this._delta.lengthSq() > 0) {
            camera.position.add(this._delta);
            camera.position.y = Math.max(config.movement.minHeight, camera.position.y);
        }

        // Apply rotation
        const euler = new THREE.Euler(this.state.pitch, this.state.yaw, 0, 'YXZ');
        camera.quaternion.setFromEuler(euler);
        camera.updateMatrixWorld(true);
    }

    // ==================== INPUT HANDLING ====================

    handleMouseMove(e) {
        if (this.state.isRightMouseDown) {
            const sensitivity = this.config.mouse.sensitivity;
            this.state.yaw -= (e.movementX || 0) * sensitivity;
            this.state.pitch -= (e.movementY || 0) * sensitivity;
            this.state.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.state.pitch));
        }
    }

    handleWheel(e) {
        const camera = this.perspectiveCamera;
        if (!camera) return;

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const zoomSpeed = e.deltaY > 0 ? -50 : 50;
        camera.position.addScaledVector(forward, zoomSpeed);
        camera.position.y = Math.max(this.config.movement.minHeight, camera.position.y);
    }

    handleKeyDown(e) {
        // Free camera uses WASD which is handled in update loop
    }

    // ==================== SERVICE METHODS ====================

    /**
     * Set initial camera position and orientation
     * @param {Object} options - { position, yaw, pitch, lookAt }
     */
    setInitialPosition(options = {}) {
        const camera = this.perspectiveCamera;
        if (!camera) return;

        if (options.position) {
            camera.position.copy(options.position);
        }

        if (options.yaw !== undefined) {
            this.state.yaw = options.yaw;
        }

        if (options.pitch !== undefined) {
            this.state.pitch = options.pitch;
        }

        if (options.lookAt) {
            // Calculate yaw and pitch to look at a point
            const dx = options.lookAt.x - camera.position.x;
            const dy = options.lookAt.y - camera.position.y;
            const dz = options.lookAt.z - camera.position.z;
            const horizontalDist = Math.sqrt(dx * dx + dz * dz);

            this.state.yaw = Math.atan2(dx, dz);
            this.state.pitch = Math.atan2(dy, horizontalDist);
        }
    }

    getYaw() {
        return this.state.yaw;
    }

    getPitch() {
        return this.state.pitch;
    }
}

// Register on GUTS namespace
if (typeof GUTS !== 'undefined') {
    GUTS.FreeCameraSystem = FreeCameraSystem;
}

export default FreeCameraSystem;
export { FreeCameraSystem };
