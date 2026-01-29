import BaseCameraSystem from './BaseCameraSystem.js';

/**
 * OrthographicCameraSystem - Isometric top-down camera
 *
 * Features:
 * - Orthographic isometric view (configurable pitch/yaw)
 * - Edge panning
 * - Q/E rotation in 45-degree increments
 * - Mouse wheel zoom
 * - Entity following
 * - World bounds clamping
 */
class OrthographicCameraSystem extends BaseCameraSystem {
    static services = [
        ...BaseCameraSystem.services,
        'cameraLookAt',
        'rotateCamera',
        'toggleCameraFollow',
        'getCameraFollowTarget'
    ];

    constructor(game) {
        super(game);

        // Orthographic-specific state
        this.state.yaw = 135 * Math.PI / 180;
        this.state.followingEntityId = null;

        // Config
        this.config = this._getDefaultConfig();
    }

    // ==================== CONFIG ====================

    _getDefaultConfig() {
        const configs = this.collections?.cameraConfigs || {};
        return configs.orthographic || {
            mode: 'orthographic',
            projection: 'orthographic',
            isometric: {
                pitch: 35.264,
                yaw: 135,
                rotationStep: 45
            },
            movement: {
                edgePan: { enabled: true, speed: 900, threshold: 10 },
                keyboard: { enabled: true, speed: 500 }
            },
            zoom: { min: 0.1, max: 5.0 },
            bounds: { clampToWorld: true, margin: 100 },
            follow: { smoothing: 8 }
        };
    }

    // ==================== OVERRIDES ====================

    getDefaultMode() {
        return 'orthographic';
    }

    getAvailableModes() {
        return ['orthographic'];
    }

    init() {
        super.init();
        this.config = this._getDefaultConfig();
    }

    onSceneLoad(sceneData) {
        super.onSceneLoad(sceneData);
        // Initialize yaw from config
        this.state.yaw = this.config.isometric.yaw * Math.PI / 180;
    }

    onSceneUnload() {
        this.state.followingEntityId = null;
    }

    positionCameraAtStart() {
        const team = this.call.getActivePlayerTeam?.();
        if (team === null || team === undefined) return;
        const cameraData = this.call.getCameraPositionForTeam?.(team);
        if (cameraData?.lookAt) {
            this.cameraLookAt(cameraData.lookAt.x, cameraData.lookAt.z);
        }
    }

    // ==================== UPDATE ====================

    updateCamera(dt) {
        const camera = this.activeCamera;
        if (!camera) return;

        // Edge panning
        if (this.config.movement.edgePan.enabled && this.state.isMouseInWindow) {
            const delta = this._calculateEdgePan(dt);
            if (delta.x !== 0 || delta.z !== 0) {
                this._applyMovement(delta);
            }
        }

        // Follow entity
        if (this.state.followingEntityId) {
            const transform = this.game.getComponent(this.state.followingEntityId, 'transform');
            const pos = transform?.position;
            if (pos) {
                this._lookAtPoint(pos.x, pos.z);
            } else {
                this.state.followingEntityId = null;
            }
        }

        // Bounds clamping
        if (this.config.bounds.clampToWorld && this.state.worldBounds) {
            this._clampToWorldBounds(this.config.bounds.margin);
        }

        camera.updateMatrixWorld(true);
    }

    // ==================== INPUT HANDLING ====================

    handleMouseMove(e) {
        // Orthographic camera doesn't use mouse look
    }

    handleWheel(e) {
        const camera = this.activeCamera;
        if (!camera) return;

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        camera.zoom *= zoomFactor;
        camera.zoom = Math.max(this.config.zoom.min, Math.min(this.config.zoom.max, camera.zoom));
        camera.updateProjectionMatrix();
    }

    handleKeyDown(e) {
        if (e.key === 'q' || e.key === 'Q') {
            this.rotateCamera('left');
        } else if (e.key === 'e' || e.key === 'E') {
            this.rotateCamera('right');
        }
    }

    // ==================== CAMERA METHODS ====================

    _lookAtPoint(worldX, worldZ) {
        const camera = this.activeCamera;
        if (!camera) return;

        const pitch = this.config.isometric.pitch * Math.PI / 180;
        const distance = this.state.cameraHeight;

        const cdx = Math.sin(this.state.yaw) * Math.cos(pitch);
        const cdz = Math.cos(this.state.yaw) * Math.cos(pitch);

        camera.position.set(
            worldX - cdx * distance,
            distance,
            worldZ - cdz * distance
        );

        camera.lookAt(worldX, 0, worldZ);
        camera.userData.lookAt = new THREE.Vector3(worldX, 0, worldZ);
    }

    _calculateEdgePan(dt) {
        const config = this.config.movement.edgePan;
        const w = window.innerWidth;
        const h = window.innerHeight;
        let dx = 0, dz = 0;

        if (this.state.mouseX <= config.threshold) dx = -1;
        else if (this.state.mouseX >= w - config.threshold) dx = 1;

        if (this.state.mouseY <= config.threshold) dz = 1;
        else if (this.state.mouseY >= h - config.threshold) dz = -1;

        // Rotate movement direction by camera yaw
        const cos = Math.cos(this.state.yaw - Math.PI / 4);
        const sin = Math.sin(this.state.yaw - Math.PI / 4);
        const rotatedX = dx * cos - dz * sin;
        const rotatedZ = dx * sin + dz * cos;

        return {
            x: rotatedX * config.speed * dt,
            z: rotatedZ * config.speed * dt
        };
    }

    _applyMovement(delta) {
        const camera = this.activeCamera;
        if (!camera) return;

        camera.position.x += delta.x;
        camera.position.z += delta.z;

        if (camera.userData?.lookAt) {
            camera.userData.lookAt.x += delta.x;
            camera.userData.lookAt.z += delta.z;
        }
    }

    // ==================== SERVICE METHODS ====================

    cameraLookAt(worldX, worldZ) {
        this.state.followingEntityId = null;
        this._lookAtPoint(worldX, worldZ);
    }

    rotateCamera(direction) {
        const camera = this.activeCamera;
        if (!camera) return;

        const stepAngle = this.config.isometric.rotationStep * Math.PI / 180;
        this.state.yaw += direction === 'left' ? -stepAngle : stepAngle;

        // Find pivot point via raycast or use stored lookAt
        let pivotPoint = camera.userData?.lookAt?.clone();
        if (!pivotPoint) {
            const ground = this.call.getGroundMesh?.();
            if (ground) {
                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
                const intersects = raycaster.intersectObject(ground, true);
                if (intersects.length > 0) {
                    pivotPoint = intersects[0].point;
                }
            }
        }
        if (!pivotPoint) {
            pivotPoint = new THREE.Vector3(0, 0, 0);
        }

        this._lookAtPoint(pivotPoint.x, pivotPoint.z);
    }

    toggleCameraFollow(entityId) {
        if (this.state.followingEntityId === entityId) {
            this.state.followingEntityId = null;
            this.game.triggerEvent('onUnFollowEntity');
            return false;
        } else {
            this.state.followingEntityId = entityId;
            if (entityId) {
                const transform = this.game.getComponent(entityId, 'transform');
                const pos = transform?.position;
                if (pos) {
                    this._lookAtPoint(pos.x, pos.z);
                }
            }
            return true;
        }
    }

    getCameraFollowTarget() {
        return this.state.followingEntityId;
    }

    /**
     * Get current yaw angle (for transitioning to other camera modes)
     */
    getYaw() {
        return this.state.yaw;
    }

    /**
     * Get current look-at point (for transitioning to other camera modes)
     */
    getLookAtPoint() {
        return this.activeCamera?.userData?.lookAt?.clone() || null;
    }
}

// Register on GUTS namespace
if (typeof GUTS !== 'undefined') {
    GUTS.OrthographicCameraSystem = OrthographicCameraSystem;
}

export default OrthographicCameraSystem;
export { OrthographicCameraSystem };
