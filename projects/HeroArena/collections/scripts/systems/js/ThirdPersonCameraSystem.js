import BaseCameraSystem from './BaseCameraSystem.js';

/**
 * ThirdPersonCameraSystem - Follow camera with mouse look and zoom
 *
 * Features:
 * - Perspective camera following a target entity
 * - Mouse look (requires pointer lock)
 * - Two zoom modes: first-person and third-person
 * - Terrain collision avoidance
 * - Smooth interpolation
 */
class ThirdPersonCameraSystem extends BaseCameraSystem {
    static services = [
        ...BaseCameraSystem.services,
        'setFollowTarget',
        'getFollowTarget',
        'getFacingAngle',
        'getPitchAngle'
    ];

    constructor(game) {
        super(game);

        // Third-person specific state
        this.state.followTarget = null;
        this.state.currentPosition = new THREE.Vector3();
        this.state.initialized = false;
        this.state.facingAngle = 0;
        this.state.pitchAngle = 0;
        this.state.zoomLevel = 0.08;

        // Config
        this.config = this._getDefaultConfig();
    }

    // ==================== CONFIG ====================

    _getDefaultConfig() {
        const configs = this.collections?.cameraConfigs || {};
        return configs.thirdPerson || {
            mode: 'thirdPerson',
            projection: 'perspective',
            fov: 60,
            follow: {
                smoothing: 8,
                heightOffset: { min: 25, max: 35 }
            },
            distance: { min: 5, max: 800, default: 150 },
            pitch: { min: -89, max: 89, default: 0 },
            mouse: { sensitivity: 0.003, invertY: false },
            zoom: { firstPersonThreshold: 0.08, twoModeOnly: true },
            collision: {
                enabled: true,
                minHeightAboveTerrain: 20,
                wallSamples: 10,
                wallHeightThreshold: 32
            }
        };
    }

    // ==================== OVERRIDES ====================

    getDefaultMode() {
        return 'thirdPerson';
    }

    getAvailableModes() {
        return ['thirdPerson'];
    }

    /**
     * Return zoom constraints - override to restrict for indoor levels, etc.
     */
    getZoomConstraints() {
        return { min: 0, max: 1 };
    }

    /**
     * Called each frame when following target - override to sync player rotation
     */
    onFollowTargetMoved(entityId, position) {
        // Override in subclass to sync player rotation, etc.
    }

    init() {
        super.init();
        this.config = this._getDefaultConfig();

        // Create perspective camera immediately
        this._createPerspectiveCamera(this.config.fov);
        this.activeCamera = this.perspectiveCamera;
    }

    onSceneLoad(sceneData) {
        super.onSceneLoad(sceneData);
        // Reset state for new scene
        this.state.initialized = false;
    }

    onSceneUnload() {
        this.state.followTarget = null;
        this.state.initialized = false;
    }

    positionCameraAtStart() {
        // Third-person camera positions based on follow target, not fixed start
    }

    // ==================== UPDATE ====================

    updateCamera(dt) {
        const camera = this.perspectiveCamera;
        if (!camera || !this.state.followTarget) return;

        const targetPos = this.state.followTarget.getPosition();
        if (!targetPos) return;

        // Apply zoom constraints
        const constraints = this.getZoomConstraints();
        this.state.zoomLevel = Math.max(constraints.min, Math.min(constraints.max, this.state.zoomLevel));

        const isFirstPerson = this.state.zoomLevel < this.config.zoom.firstPersonThreshold;
        const heightOffset = isFirstPerson
            ? this.config.follow.heightOffset.min
            : this.config.follow.heightOffset.max;
        const distance = this.config.distance.min +
            (this.config.distance.max - this.config.distance.min) * this.state.zoomLevel;

        // Calculate camera position
        const pitchRad = isFirstPerson ? this.state.pitchAngle : -Math.PI / 2 * this.state.zoomLevel;
        const horizontalDist = distance * Math.cos(-pitchRad);
        const verticalDist = distance * Math.sin(-pitchRad);

        let desiredX = targetPos.x - Math.cos(this.state.facingAngle) * horizontalDist;
        let desiredY = (targetPos.y || 0) + heightOffset + verticalDist;
        let desiredZ = targetPos.z - Math.sin(this.state.facingAngle) * horizontalDist;

        // Terrain collision avoidance
        if (this.config.collision.enabled && this.state.getTerrainHeight) {
            const adjusted = this._adjustForTerrainCollision(
                targetPos,
                { x: desiredX, y: desiredY, z: desiredZ },
                heightOffset
            );
            desiredX = adjusted.x;
            desiredY = adjusted.y;
            desiredZ = adjusted.z;
        }

        // Smooth interpolation
        const t = 1 - Math.exp(-this.config.follow.smoothing * dt);
        if (!this.state.initialized) {
            this.state.currentPosition.set(desiredX, desiredY, desiredZ);
            this.state.initialized = true;
        } else {
            this.state.currentPosition.x += (desiredX - this.state.currentPosition.x) * t;
            this.state.currentPosition.y += (desiredY - this.state.currentPosition.y) * t;
            this.state.currentPosition.z += (desiredZ - this.state.currentPosition.z) * t;
        }

        camera.position.copy(this.state.currentPosition);

        // Look at target or forward direction
        if (isFirstPerson) {
            const lookDist = 100;
            const hLook = lookDist * Math.cos(this.state.pitchAngle);
            const vLook = lookDist * Math.sin(this.state.pitchAngle);
            this._lookAtTarget.set(
                this.state.currentPosition.x + Math.cos(this.state.facingAngle) * hLook,
                this.state.currentPosition.y + vLook,
                this.state.currentPosition.z + Math.sin(this.state.facingAngle) * hLook
            );
            camera.lookAt(this._lookAtTarget);
        } else {
            this._lookAtTarget.set(targetPos.x, targetPos.y + heightOffset, targetPos.z);
            camera.up.set(0, 1, 0);
            camera.lookAt(this._lookAtTarget);
        }

        camera.updateMatrixWorld(true);

        // Hook for player rotation sync
        this.onFollowTargetMoved(this.state.followTarget.entityId, targetPos);
    }

    _adjustForTerrainCollision(targetPos, desired, heightOffset) {
        const config = this.config.collision;
        const dx = desired.x - targetPos.x;
        const dz = desired.z - targetPos.z;
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);

        if (horizontalDist <= 1) {
            return desired;
        }

        let adjustedX = desired.x;
        let adjustedY = desired.y;
        let adjustedZ = desired.z;
        let collisionT = 1.0;

        // Sample points along camera ray to detect terrain collision
        for (let i = 1; i <= config.wallSamples; i++) {
            const t = i / config.wallSamples;
            const sampleX = targetPos.x + dx * t;
            const sampleZ = targetPos.z + dz * t;
            const terrainHeight = this.state.getTerrainHeight(sampleX, sampleZ);

            if (terrainHeight === null) continue;

            const expectedY = (targetPos.y || 0) + heightOffset +
                (desired.y - (targetPos.y || 0) - heightOffset) * t;

            if (expectedY - terrainHeight < config.minHeightAboveTerrain) {
                if (t < collisionT) collisionT = t;
            }
        }

        if (collisionT < 1.0) {
            const safeT = Math.max(0.1, collisionT - 0.1);
            adjustedX = targetPos.x + dx * safeT;
            adjustedZ = targetPos.z + dz * safeT;
            const terrainAtAdjusted = this.state.getTerrainHeight(adjustedX, adjustedZ);
            if (terrainAtAdjusted !== null) {
                adjustedY = Math.max(adjustedY, terrainAtAdjusted + config.minHeightAboveTerrain);
            }
        }

        return { x: adjustedX, y: adjustedY, z: adjustedZ };
    }

    // ==================== INPUT HANDLING ====================

    handleMouseMove(e) {
        if (!this.state.isPointerLocked) return;

        const sensitivity = this.config.mouse.sensitivity;
        const invertY = this.config.mouse.invertY ? -1 : 1;

        this.state.facingAngle += (e.movementX || 0) * sensitivity;

        // Normalize facing angle
        while (this.state.facingAngle > Math.PI) this.state.facingAngle -= Math.PI * 2;
        while (this.state.facingAngle < -Math.PI) this.state.facingAngle += Math.PI * 2;

        this.state.pitchAngle -= (e.movementY || 0) * sensitivity * invertY;
        const minPitch = (this.config.pitch.min + 0.1) * Math.PI / 180;
        const maxPitch = (this.config.pitch.max - 0.1) * Math.PI / 180;
        this.state.pitchAngle = Math.max(minPitch, Math.min(maxPitch, this.state.pitchAngle));
    }

    handleWheel(e) {
        if (this.config.zoom.twoModeOnly) {
            // Toggle between first-person and third-person
            this.state.zoomLevel = e.deltaY > 0
                ? this.config.zoom.firstPersonThreshold
                : 0;
        } else {
            this.state.zoomLevel += (e.deltaY > 0 ? 0.05 : -0.05);
            this.state.zoomLevel = Math.max(0, Math.min(1, this.state.zoomLevel));
        }
    }

    handleKeyDown(e) {
        // Third-person doesn't have rotation keys
    }

    // ==================== SERVICE METHODS ====================

    setFollowTarget(entityId) {
        if (!entityId) {
            this.state.followTarget = null;
            return;
        }

        const game = this.game;
        this.state.followTarget = {
            entityId,
            getPosition: () => {
                const transform = game.getComponent(entityId, 'transform');
                return transform?.position || null;
            },
            getRotation: () => {
                const transform = game.getComponent(entityId, 'transform');
                return transform?.rotation?.y || 0;
            }
        };
        this.state.initialized = false;

        // Initialize facing angle from entity rotation
        const transform = this.game.getComponent(entityId, 'transform');
        if (transform?.rotation) {
            this.state.facingAngle = transform.rotation.y || 0;
        }
    }

    getFollowTarget() {
        return this.state.followTarget?.entityId || null;
    }

    getFacingAngle() {
        return this.state.facingAngle;
    }

    getPitchAngle() {
        return this.state.pitchAngle;
    }

    getZoomLevel() {
        return this.state.zoomLevel;
    }
}

// Register on GUTS namespace
if (typeof GUTS !== 'undefined') {
    GUTS.ThirdPersonCameraSystem = ThirdPersonCameraSystem;
}

export default ThirdPersonCameraSystem;
export { ThirdPersonCameraSystem };
