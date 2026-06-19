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

        // Display-rate pan loop (see _startPanLoop)
        this._panLoopActive = false;
        this._panRafId = null;
        this._lastPanTime = 0;

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
        this._stopPanLoop();
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

        // Keyboard panning (WASD) is driven by a requestAnimationFrame loop instead of
        // this fixed-timestep tick (see _startPanLoop). The sim ticks at ~20 TPS, so
        // panning here would only move/redraw the camera 20x/sec and look choppy. The
        // rAF loop moves + redraws at display rate while keys are held. As a fallback
        // (e.g. should the loop ever not be running), still apply it on the tick.
        if (this.config.movement.keyboard?.enabled && !this._panLoopActive) {
            this._applyKeyboardPan(dt);
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

        // Kick off the smooth (display-rate) pan loop when a WASD key is pressed.
        // The loop self-stops once no pan keys remain held.
        if (this.config.movement.keyboard?.enabled && this._isPanKey(e.code)) {
            this._startPanLoop();
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

    _calculateKeyboardPan(dt) {
        // Don't pan while the user is typing in an input/textarea (e.g. chat)
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
            return { x: 0, z: 0 };
        }

        const config = this.config.movement.keyboard;
        const keys = this.state.keysPressed;

        // f = forward/back (W/S), r = right/left (D/A), in screen-relative terms
        let f = 0, r = 0;
        if (keys.has('KeyW')) f += 1;
        if (keys.has('KeyS')) f -= 1;
        if (keys.has('KeyD')) r += 1;
        if (keys.has('KeyA')) r -= 1;

        if (f === 0 && r === 0) return { x: 0, z: 0 };

        // Normalize so diagonal movement isn't faster than cardinal
        const len = Math.hypot(f, r);
        f /= len;
        r /= len;

        // Ground-projected camera basis derived from yaw, so movement always tracks
        // what's on screen no matter how the camera is rotated (Q/E):
        //   forward = direction the camera looks (into the screen) = (sin yaw, cos yaw)
        //   right   = camera's screen-right = cross(forward, up)    = (-cos yaw, sin yaw)
        const yaw = this.state.yaw;
        const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
        const rightX = -Math.cos(yaw), rightZ = Math.sin(yaw);

        return {
            x: (f * fwdX + r * rightX) * config.speed * dt,
            z: (f * fwdZ + r * rightZ) * config.speed * dt
        };
    }

    /**
     * Apply one step of WASD panning for the given (real) delta time.
     * Returns true if the camera actually moved.
     */
    _applyKeyboardPan(dt) {
        const delta = this._calculateKeyboardPan(dt);
        if (delta.x === 0 && delta.z === 0) return false;

        // Manual panning takes over from any entity follow
        this.state.followingEntityId = null;
        this._applyMovement(delta);

        if (this.config.bounds.clampToWorld && this.state.worldBounds) {
            this._clampToWorldBounds(this.config.bounds.margin);
        }
        this.activeCamera?.updateMatrixWorld(true);
        return true;
    }

    // ==================== SMOOTH (DISPLAY-RATE) PAN LOOP ====================
    // The simulation ticks at a fixed rate (~20 TPS) and the scene is only drawn on
    // those ticks, so panning the camera on the tick looks choppy. While WASD is held
    // we instead move the camera and redraw the scene once per animation frame, which
    // is purely a client-side visual concern (camera isn't part of the simulation).

    _isPanKey(code) {
        return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD';
    }

    _anyPanKeyHeld() {
        const keys = this.state.keysPressed;
        return keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD');
    }

    _now() {
        return (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : new Date().getTime();
    }

    _startPanLoop() {
        if (this._panLoopActive) return;
        if (typeof requestAnimationFrame !== 'function') return; // no display loop available
        this._panLoopActive = true;
        this._lastPanTime = this._now();

        const step = () => {
            if (!this._panLoopActive) return;

            // Stop once the keys are released (or input focus stole them)
            if (!this._anyPanKeyHeld()) {
                this._stopPanLoop();
                return;
            }

            const now = this._now();
            let dt = (now - this._lastPanTime) / 1000;
            this._lastPanTime = now;
            if (dt > 0.05) dt = 0.05; // clamp after a stall/tab-switch

            const moved = this._applyKeyboardPan(dt);
            if (moved) this._renderFrameNow();

            this._panRafId = requestAnimationFrame(step);
        };
        this._panRafId = requestAnimationFrame(step);
    }

    _stopPanLoop() {
        this._panLoopActive = false;
        if (this._panRafId && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this._panRafId);
        }
        this._panRafId = null;
    }

    /**
     * Redraw the scene immediately using the current camera position. Reuses the
     * normal frame path (post-processing composer + UI overlay) so what we draw here
     * is identical to a tick-driven frame, just at display rate.
     */
    _renderFrameNow() {
        const byName = this.game.systemsByName;
        const pp = byName?.get?.('PostProcessingSystem');
        if (pp?.composer && pp.render) {
            pp.render();
            return;
        }
        byName?.get?.('WorldSystem')?.render?.();
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
