/**
 * PlayerControllerSystem - First-person movement and input handling
 * Ports player physics from player.rs
 */
class PlayerControllerSystem extends GUTS.BaseSystem {
    static services = [
        'getPlayerPosition',
        'getPlayerRotation'
    ];

    static serviceDependencies = [];

    constructor(game) {
        super(game);
        this.game.playerControllerSystem = this;

        // Input state
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false
        };
        this.jumpWasPressed = false;  // Track for edge detection (double jump)

        this.mouseDelta = { x: 0, y: 0 };
        this.mouseSensitivity = 0.002;
        this.isPointerLocked = false;

        // Cached references
        this.worldSystem = null;
        this.collisionSystem = null;
    }

    init() {
        console.log('PlayerControllerSystem initializing...');
        this.worldSystem = this.game.voxelWorldSystem;
        this.setupInputListeners();
        console.log('PlayerControllerSystem initialized');
    }

    postAllInit() {
        this.collisionSystem = this.game.collisionSystem;
    }

    setupInputListeners() {
        // Keyboard input
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));

        // Mouse input
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('click', () => this.requestPointerLock());

        // Pointer lock change
        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement !== null;
        });
    }

    requestPointerLock() {
        const canvas = document.getElementById('gameCanvas');
        if (canvas && !this.isPointerLocked) {
            canvas.requestPointerLock();
        }
    }

    onKeyDown(e) {
        switch (e.code) {
            case 'KeyW': this.keys.forward = true; break;
            case 'KeyS': this.keys.backward = true; break;
            case 'KeyA': this.keys.left = true; break;
            case 'KeyD': this.keys.right = true; break;
            case 'Space': this.keys.jump = true; break;
            case 'Escape':
                if (this.isPointerLocked) {
                    document.exitPointerLock();
                }
                break;
        }
    }

    onKeyUp(e) {
        switch (e.code) {
            case 'KeyW': this.keys.forward = false; break;
            case 'KeyS': this.keys.backward = false; break;
            case 'KeyA': this.keys.left = false; break;
            case 'KeyD': this.keys.right = false; break;
            case 'Space': this.keys.jump = false; break;
        }
    }

    onMouseMove(e) {
        if (this.isPointerLocked) {
            this.mouseDelta.x += e.movementX;
            this.mouseDelta.y += e.movementY;
        }
    }

    update() {
        const dt = this.game.deltaTime || 1/60;

        if (!this.worldSystem || !this.worldSystem.playerEntityId) return;

        const playerId = this.worldSystem.playerEntityId;
        const pos = this.game.getComponent(playerId, 'position');
        const ctrl = this.game.getComponent(playerId, 'playerController');

        if (!pos || !ctrl) return;

        // Update rotation from mouse
        this.updateRotation(ctrl, dt);

        // Update movement
        this.updateMovement(pos, ctrl, dt);

        // Update debug display
        this.updateDebugInfo(pos, ctrl);
    }

    updateRotation(ctrl, dt) {
        // Apply mouse movement to yaw and pitch
        ctrl.yaw -= this.mouseDelta.x * this.mouseSensitivity;
        ctrl.pitch -= this.mouseDelta.y * this.mouseSensitivity;

        // Clamp pitch to prevent flipping
        ctrl.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, ctrl.pitch));

        // Reset mouse delta
        this.mouseDelta.x = 0;
        this.mouseDelta.y = 0;
    }

    updateMovement(pos, ctrl, dt) {
        // Calculate movement direction from input
        let moveX = 0;
        let moveZ = 0;

        if (this.keys.forward) moveZ -= 1;
        if (this.keys.backward) moveZ += 1;
        if (this.keys.left) moveX -= 1;
        if (this.keys.right) moveX += 1;

        // Normalize diagonal movement
        const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (moveLen > 0) {
            moveX /= moveLen;
            moveZ /= moveLen;
        }

        // Transform movement by yaw (matching Rust: forward=(-sinYaw,-cosYaw), right=(cosYaw,-sinYaw))
        const sinYaw = Math.sin(ctrl.yaw);
        const cosYaw = Math.cos(ctrl.yaw);
        const worldMoveX = moveX * cosYaw + moveZ * sinYaw;
        const worldMoveZ = moveZ * cosYaw - moveX * sinYaw;

        // Check if grounded (using coyote time)
        const isGrounded = ctrl.groundedTimer > 0;
        const accel = isGrounded ? ctrl.groundAccel : ctrl.airAccel;
        const friction = isGrounded ? ctrl.groundFriction : ctrl.airFriction;

        // Match Rust physics: Apply friction FIRST
        ctrl.velocityX *= friction;
        ctrl.velocityZ *= friction;

        // Then accelerate toward target velocity (Rust-style clamped acceleration)
        const targetVelX = worldMoveX * ctrl.walkSpeed;
        const targetVelZ = worldMoveZ * ctrl.walkSpeed;

        const diffX = targetVelX - ctrl.velocityX;
        const diffZ = targetVelZ - ctrl.velocityZ;
        const diffLen = Math.sqrt(diffX * diffX + diffZ * diffZ);
        const maxAccel = accel * dt;

        if (diffLen > 0.0001) {
            const accelAmount = Math.min(diffLen, maxAccel);
            ctrl.velocityX += (diffX / diffLen) * accelAmount;
            ctrl.velocityZ += (diffZ / diffLen) * accelAmount;
        }

        // Only apply gravity when NOT grounded (matching Rust behavior)
        if (ctrl.groundedTimer === 0) {
            ctrl.velocityY += ctrl.gravity * dt;
            // Clamp terminal velocity
            ctrl.velocityY = Math.max(ctrl.velocityY, -50);
        }

        // Reset jumps when grounded
        if (isGrounded) {
            ctrl.jumpsRemaining = ctrl.maxJumps;
        }

        // Jump (edge detection - only trigger on key press, not hold)
        const jumpJustPressed = this.keys.jump && !this.jumpWasPressed;
        if (jumpJustPressed && ctrl.jumpsRemaining > 0) {
            ctrl.velocityY = ctrl.jumpVelocity;
            ctrl.jumpsRemaining--;
            ctrl.groundedTimer = 0;  // Clear coyote time on jump
        }
        this.jumpWasPressed = this.keys.jump;

        // Decrease grounded timer
        ctrl.groundedTimer = Math.max(0, ctrl.groundedTimer - dt);

        // Apply collision and movement
        if (this.collisionSystem) {
            const result = this.collisionSystem.moveWithCollision(
                [pos.x, pos.y, pos.z],
                [ctrl.sizeX, ctrl.sizeY, ctrl.sizeZ],
                [ctrl.velocityX, ctrl.velocityY, ctrl.velocityZ],
                dt
            );

            pos.x = result.position[0];
            pos.y = result.position[1];
            pos.z = result.position[2];

            // Update velocity after collision
            ctrl.velocityX = result.velocity[0];
            ctrl.velocityY = result.velocity[1];
            ctrl.velocityZ = result.velocity[2];

            // Check if landed on ground
            if (result.groundedThisFrame) {
                ctrl.groundedTimer = ctrl.coyoteTime;
            }
        } else {
            // No collision system, just move directly
            pos.x += ctrl.velocityX * dt;
            pos.y += ctrl.velocityY * dt;
            pos.z += ctrl.velocityZ * dt;
        }
    }

    updateDebugInfo(pos, ctrl) {
        const posEl = document.getElementById('position');

        if (posEl) {
            const grounded = ctrl.groundedTimer > 0 ? 'yes' : 'no';
            const keys = (this.keys.forward ? 'W' : '') + (this.keys.backward ? 'S' : '') +
                        (this.keys.left ? 'A' : '') + (this.keys.right ? 'D' : '') +
                        (this.keys.jump ? ' Jump' : '');
            posEl.textContent = `Pos: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)} | Vel: ${ctrl.velocityX.toFixed(2)}, ${ctrl.velocityY.toFixed(2)}, ${ctrl.velocityZ.toFixed(2)} | Grounded: ${grounded} | Keys: [${keys || 'none'}]`;
        }
    }

    getPlayerPosition() {
        if (!this.worldSystem || !this.worldSystem.playerEntityId) return null;
        return this.game.getComponent(this.worldSystem.playerEntityId, 'position');
    }

    getPlayerRotation() {
        if (!this.worldSystem || !this.worldSystem.playerEntityId) return null;
        const ctrl = this.game.getComponent(this.worldSystem.playerEntityId, 'playerController');
        return ctrl ? { pitch: ctrl.pitch, yaw: ctrl.yaw } : null;
    }
}

GUTS.PlayerControllerSystem = PlayerControllerSystem;
