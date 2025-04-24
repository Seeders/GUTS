class AircraftController extends engine.Component {
    init({
        infiniWorld,
        maxThrust = 200,
        acceleration = 20,
        strafeAcceleration = 15,
        verticalAcceleration = 15,
        pitchSpeed = 1.5, // Reduced for consistent control
        yawSpeed = 1.5, // Reduced for consistency
        rollSpeed = 2,
        mouseSensitivity = 0.0015, // Further lowered for precision
        dampingFactor = 0.15, // Increased for smoother inputs
        maxSpeed = 200,
        cameraSmoothing = 0.3 // Increased for smoother camera
    }) {
        this.infiniWorld = infiniWorld;
        this.scene = infiniWorld.scene;
        this.camera = infiniWorld.camera;
        this.maxThrust = maxThrust;
        this.acceleration = acceleration;
        this.strafeAcceleration = strafeAcceleration;
        this.verticalAcceleration = verticalAcceleration;
        this.pitchSpeed = pitchSpeed;
        this.yawSpeed = yawSpeed;
        this.rollSpeed = rollSpeed;
        this.mouseSensitivity = mouseSensitivity;
        this.dampingFactor = dampingFactor;
        this.maxSpeed = maxSpeed;
        this.cameraSmoothing = cameraSmoothing;
        this.parent.quaternion = new THREE.Quaternion();

        // Initialize PointerLockControls
        this.controls = new (this.game.libraryClasses.Three_PointerLockControls)(this.camera, this.infiniWorld.renderer.domElement);
        this.controls.pointerSpeed = 0;
        this.scene.add(this.controls.getObject());

        // Movement properties
        this.thrust = 0;
        this.strafeInput = 0;
        this.verticalInput = 0;
        this.pitchInput = 0;
        this.yawInput = 0;
        this.rollInput = 0;
        this.mouseXInput = 0;
        this.mouseYInput = 0;
        this.velocity = new THREE.Vector3();

        // Local axes
        this.forward = new THREE.Vector3(0, 0, 1);
        this.up = new THREE.Vector3(0, 1, 0);
        this.right = new THREE.Vector3(1, 0, 0);

        // World reference vectors
        this.worldUp = new THREE.Vector3(0, 1, 0);
        this.worldForward = new THREE.Vector3(0, 0, 1);

        // Input state
        this.keys = {
            KeyW: false,
            KeyS: false,
            KeyA: false,
            KeyD: false,
            KeyQ: false,
            KeyE: false,
            ShiftLeft: false,
            KeyZ: false,
            Space: false
        };

        // Camera settings
        this.isThirdPerson = true;
        this.thirdPersonDistance = 50;
        this.thirdPersonHeight = 15;
        this.cameraLookAhead = 5;
        this.lastCameraPosition = new THREE.Vector3();
        this.lastCameraLookAt = new THREE.Vector3();
        this.smoothedAircraftPosition = new THREE.Vector3().copy(this.parent.position);
        this.smoothedAircraftQuaternion = new THREE.Quaternion().copy(this.parent.quaternion);

        // Bind event handlers
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onWheel = this.onWheel.bind(this);
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('wheel', this.onWheel);

        // Initialize camera
        this.updateCameraPosition();
    }

    onKeyDown(event) {
        if (event.code in this.keys) {
            this.keys[event.code] = true;
        }

        if (event.code === 'KeyV') {
            this.isThirdPerson = !this.isThirdPerson;
            if (this.isThirdPerson) {
                const offset = new THREE.Vector3(0, this.thirdPersonHeight, -this.thirdPersonDistance)
                    .applyQuaternion(this.smoothedAircraftQuaternion);
                this.lastCameraPosition.copy(this.smoothedAircraftPosition).add(offset);
                this.lastCameraLookAt.copy(this.smoothedAircraftPosition);
            }
        }

        if (event.code === 'KeyR') {
            this.parent.quaternion.set(0, 0, 0, 1);
            this.smoothedAircraftQuaternion.copy(this.parent.quaternion);
        }
    }

    onKeyUp(event) {
        if (event.code in this.keys) {
            this.keys[event.code] = false;
        }
    }

    onMouseMove(event) {
        if (this.controls.isLocked) {
            this.mouseXInput = -(event.movementX || 0) * this.mouseSensitivity;
            this.mouseYInput = -(event.movementY || 0) * this.mouseSensitivity;
        } else {
            this.mouseXInput = 0;
            this.mouseYInput = 0;
        }
    }

    onWheel(event) {
        const delta = event.deltaY * 0.01;
        this.thrust -= delta * this.acceleration * 0.5;
        this.thrust = Math.max(0, Math.min(this.thrust, this.maxThrust));
    }

    updateAxes() {
        this.forward.set(0, 0, 1).applyQuaternion(this.parent.quaternion).normalize();
        this.up.set(0, 1, 0).applyQuaternion(this.parent.quaternion).normalize();
        this.right.set(1, 0, 0).applyQuaternion(this.parent.quaternion).normalize();
    }

    updateCameraPosition() {
        const dt = Math.min(this.game.deltaTime, 0.1);
        const smoothingAlpha = 1 - Math.pow(1 - this.cameraSmoothing, dt * 60);

        // Smooth aircraft position and quaternion
        this.smoothedAircraftPosition.lerp(this.parent.position, smoothingAlpha);
        this.smoothedAircraftQuaternion.slerp(this.parent.quaternion, smoothingAlpha);

        // Calculate forward vector from smoothed quaternion
        const smoothedForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.smoothedAircraftQuaternion);

        // Calculate look-at target
        const lookTarget = this.smoothedAircraftPosition.clone().add(
            smoothedForward.clone().multiplyScalar(this.cameraLookAhead)
        );

        if (this.isThirdPerson) {
            const offset = new THREE.Vector3(0, this.thirdPersonHeight, -this.thirdPersonDistance)
                .applyQuaternion(this.smoothedAircraftQuaternion);
            const targetPos = this.smoothedAircraftPosition.clone().add(offset);

            this.camera.position.lerp(targetPos, smoothingAlpha);
            this.lastCameraPosition.copy(this.camera.position);

            this.lastCameraLookAt.lerp(lookTarget, smoothingAlpha);
            this.camera.lookAt(this.lastCameraLookAt);
        } else {
            this.camera.position.copy(this.smoothedAircraftPosition);
            this.camera.quaternion.copy(this.smoothedAircraftQuaternion);
        }
    }

    update() {
        const dt = Math.min(this.game.deltaTime, 0.1);

        // Update local axes
        this.updateAxes();

        // Smooth inputs
        const inputDamping = 1 - (this.dampingFactor * dt);
        // Cap pitch/yaw inputs to ensure consistent rotation rate
        const maxInput = 1.0; // Maximum input value for pitch/yaw
        this.pitchInput = (this.pitchInput * inputDamping) + Math.max(-maxInput, Math.min(maxInput, this.mouseYInput * this.pitchSpeed));
        this.yawInput = (this.yawInput * inputDamping) + Math.max(-maxInput, Math.min(maxInput, this.mouseXInput * this.yawSpeed));
        this.rollInput = (this.keys.KeyD ? 1 : 0) + (this.keys.KeyA ? -1 : 0);
        this.rollInput *= this.rollSpeed * dt;

        // Thrust control
        const thrustDamping = 1 - (this.dampingFactor * dt);
        this.thrust *= thrustDamping;

        if (this.keys.KeyW) {
            this.thrust += this.acceleration * dt;
        } else if (this.keys.KeyS) {
            this.thrust -= this.acceleration * 2 * dt;
        }
        this.thrust = Math.max(0, Math.min(this.thrust, this.maxThrust));

        // Calculate speed
        const currentSpeed = Math.min(this.thrust, this.maxSpeed);

        // Apply rotations
        if (this.rollInput !== 0) {
            const rollQuat = new THREE.Quaternion().setFromAxisAngle(this.forward, this.rollInput);
            this.parent.quaternion.premultiply(rollQuat);
        }

        if (this.pitchInput !== 0) {
            // Apply pitch without scaling to ensure consistent rate
            const pitchQuat = new THREE.Quaternion().setFromAxisAngle(this.right, this.pitchInput * dt);
            this.parent.quaternion.premultiply(pitchQuat);
        }

        if (this.yawInput !== 0) {
            const yawQuat = new THREE.Quaternion().setFromAxisAngle(this.worldUp, this.yawInput * dt);
            this.parent.quaternion.premultiply(yawQuat);
        }

        // Normalize quaternion
        this.parent.quaternion.normalize();

        // Update velocity
        this.velocity.copy(this.forward).multiplyScalar(currentSpeed);

        // Apply vertical thrust
        if (this.keys.Space) {
            const verticalVelocity = this.up.clone().multiplyScalar(this.verticalAcceleration * dt);
            this.velocity.add(verticalVelocity);
        }

        // Update position
        this.parent.position.add(this.velocity.clone().multiplyScalar(dt));

        // Update camera
        this.updateCameraPosition();

        // Reset mouse input
        this.mouseXInput = 0;
        this.mouseYInput = 0;
    }

    onDestroy() {
        this.controls.dispose();
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('wheel', this.onWheel);
        this.scene.remove(this.parent);
        if (this.parent.geometry) this.parent.geometry.dispose();
        if (this.parent.material) this.parent.material.dispose();
    }
}