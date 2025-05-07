class AircraftController extends engine.Component {
    init({
        maxThrust = 4000,
        acceleration = 700,
        strafeAcceleration = 15,
        verticalAcceleration = 15,
        pitchSpeed = 1.5, // Reduced for consistent control
        yawSpeed = 1, // Reduced for consistency
        rollSpeed = 2,
        mouseSensitivity = 0.001, // Further lowered for precision
        dampingFactor = 0.15, // Increased for smoother inputs
        maxSpeed = 4000,
        cameraSmoothing = .4, // Increased for smoother camera
        colliderSize = 5, // Size of aircraft collider
        collisionRecoveryTime = 3 // Time in seconds before regaining control
    }) {
        this.infiniWorld = this.game.gameEntity.getComponent("InfiniWorld");
        this.scene = this.infiniWorld.scene;
        this.camera = this.game.camera;
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
        this.parent.transform.quaternion = new THREE.Quaternion();

        // Initialize physics properties
        this.physics = this.game.gameEntity.getComponent("Physics");
        this.collisionRecoveryTime = collisionRecoveryTime;
        this.hasCollided = false;
        this.collisionImpulse = new THREE.Vector3();
        
        // Initialize transform properties needed for physics
        this.parent.transform.physicsPosition = new THREE.Vector3().copy(this.parent.transform.position);
        this.parent.velocity = new THREE.Vector3();
        this.parent.grounded = false;
        this.parent.transform.lerpFactor = 0.5; // Smoothing between visual and physics positions

        this.controls = new THREE_.PointerLockControls(this.camera, this.infiniWorld.renderer.domElement);
        this.controls.pointerSpeed = 0;
        this.scene.add(this.controls.object);

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
        this.initialPosition = new THREE.Vector3();
        this.initialPosition.copy(this.parent.transform.position);
        // Camera settings
        this.isThirdPerson = true;
        this.thirdPersonDistance = 50;
        this.thirdPersonHeight = 15;
        this.cameraLookAhead = 5;
        this.lastCameraPosition = new THREE.Vector3();
        this.lastCameraLookAt = new THREE.Vector3();
        this.smoothedAircraftPosition = new THREE.Vector3().copy(this.parent.transform.position);
        this.smoothedAircraftQuaternion = new THREE.Quaternion().copy(this.parent.transform.quaternion);
        this.collider = this.parent.getComponent('collider');
        // Bind event handlers
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onWheel = this.onWheel.bind(this);
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mousedown', this.onMouseDown);
        document.addEventListener('wheel', this.onWheel);

        // Initialize camera
        this.updateCameraPosition();
    }

    OnCollision(otherEntity) {
        this.velocity.copy(this.parent.velocity);

        console.log("Aircraft collision with entity:", otherEntity);
    }

    OnStaticCollision() {
        if (this.hasCollided) return;
        this.velocity.copy(this.parent.velocity);
        this.hasCollided = true;
        this.collisionTimer = 0;
        
        console.log("Aircraft collision with static object");
    }

    OnGrounded() {
        if (this.hasCollided) return;
        this.velocity.copy(this.parent.velocity);
        this.hasCollided = true;
        this.collisionTimer = 0;
        // Calculate collision response based on current velocity
        const currentVelocity = this.velocity.clone();

        // Reverse the velocity with some randomness for realistic bounce
        this.collisionImpulse.copy(currentVelocity).multiplyScalar(0.8);
        this.collisionImpulse.y = -this.collisionImpulse.y;
        this.collider.gravity = true;
        // Add some chaotic rotation on impact
        this.parent.transform.quaternion.multiply(
            new THREE.Quaternion().setFromEuler(
                new THREE.Euler(
                    Math.random() * Math.PI - Math.PI/2,
                    Math.random() * Math.PI - Math.PI/2,
                    Math.random() * Math.PI - Math.PI/2
                )
            )
        );
        console.log("Aircraft collision with terrain object");
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
            // Reset aircraft orientation and clear collision state
            this.parent.transform.quaternion.set(0, 0, 0, 1);
            this.smoothedAircraftQuaternion.copy(this.parent.transform.quaternion);
            this.hasCollided = false;
            this.collisionTimer = 0;
            this.velocity.set(0, 0, 0);
            this.parent.velocity.set(0, 0, 0);
            this.parent.transform.position.set(this.initialPosition);
        }
    }

    onKeyUp(event) {
        if (event.code in this.keys) {
            this.keys[event.code] = false;
        }
    }

    onMouseMove(event) {
        if (this.controls.isLocked && !this.hasCollided) {
            this.mouseXInput = -(event.movementX || 0) * this.mouseSensitivity;
            this.mouseYInput = -(event.movementY || 0) * this.mouseSensitivity;
        } else {
            this.mouseXInput = 0;
            this.mouseYInput = 0;
        }
    }
    
    onMouseDown(event) {
        if (!this.controls.isLocked && this.game.deltaTime > 0) {
            this.controls.lock();
            if(!event.bubbles){
                event.bubbles = true;
            }
        }
    }

    onWheel(event) {
        if (this.hasCollided) return;
        
        const delta = event.deltaY * 0.01;
        this.thrust -= delta * this.acceleration * 0.5;
        this.thrust = Math.max(0, Math.min(this.thrust, this.maxThrust));
    }

    updateAxes() {
        this.forward.set(0, 0, 1).applyQuaternion(this.parent.transform.quaternion).normalize();
        this.up.set(0, 1, 0).applyQuaternion(this.parent.transform.quaternion).normalize();
        this.right.set(1, 0, 0).applyQuaternion(this.parent.transform.quaternion).normalize();
    }

    updateCameraPosition() {
        const dt = this.game.deltaTime;
        const smoothingAlpha = this.cameraSmoothing * dt * 60; // Linear interpolation
    
        // Smooth aircraft position and quaternion
        this.smoothedAircraftPosition.lerp(this.parent.transform.position, smoothingAlpha);
        this.smoothedAircraftQuaternion.slerp(this.parent.transform.quaternion, smoothingAlpha);
    
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
    
            // Extract roll from smoothedAircraftQuaternion
            const forward = smoothedForward.clone();
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.smoothedAircraftQuaternion);
            const right = new THREE.Vector3().crossVectors(forward, up).normalize();
            up.crossVectors(right, forward).normalize(); // Recompute up to ensure orthogonality
    
            // Compute quaternion to look at target while preserving roll
            const lookAtMatrix = new THREE.Matrix4().lookAt(
                this.camera.position,
                lookTarget,
                up // Use aircraft's up vector to preserve roll
            );
            this.camera.quaternion.setFromRotationMatrix(lookAtMatrix);
    
            this.lastCameraLookAt.lerp(lookTarget, smoothingAlpha);
        } else {
            this.camera.position.copy(this.smoothedAircraftPosition);
            this.camera.quaternion.copy(this.smoothedAircraftQuaternion);
        }
    }

    updateCollisionState(dt) {
        if (this.hasCollided) {
            this.collisionTimer += dt;

            const fadeRate = Math.max(0, 1 - (this.collisionTimer / this.collisionRecoveryTime));
            const impulseForce = this.collisionImpulse.clone().multiplyScalar(fadeRate * dt);
            
            // Transfer impulse to physics velocity
            this.parent.velocity.add(impulseForce);
            
            // Add gradual stabilization as recovery progresses
            if (this.collisionTimer > this.collisionRecoveryTime * 0.5) {
                // Start adding some auto-stabilization
                const stabilizationForce = 0.1 * (1 - fadeRate);
                
                // Stabilize roll
                const worldUp = new THREE.Vector3(0, 1, 0);
                const currentUp = this.up.clone();
                const correction = new THREE.Vector3().crossVectors(currentUp, worldUp).multiplyScalar(stabilizationForce);
                
                // Apply gentle correction forces
                this.parent.velocity.add(correction);
                
                // Gradually level out
                if (this.collisionTimer > this.collisionRecoveryTime * 0.8) {
                    const levelingQuat = new THREE.Quaternion().setFromUnitVectors(this.up, worldUp);
                    this.parent.transform.quaternion.slerp(levelingQuat, stabilizationForce * dt * 5);
                }
            }
            
            // Check if recovery time has elapsed
            if (this.collisionTimer >= this.collisionRecoveryTime) {
                this.hasCollided = false;
                this.collisionTimer = 0;
                this.collider.gravity = false;
                console.log("Aircraft control restored after collision");
            }
        }
    }

    updatePhysics(dt) {
 
        // Update the physics velocity
        this.parent.velocity.copy(this.velocity);
 
    }
    
    update() {
        const dt = this.game.deltaTime;

        // Update local axes
        this.updateAxes();

        if (!this.hasCollided) {
            // Normal flight controls when not in collision state
            
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
                this.parent.transform.quaternion.premultiply(rollQuat);
            }

            if (this.pitchInput !== 0) {
                // Apply pitch without scaling to ensure consistent rate
                const pitchQuat = new THREE.Quaternion().setFromAxisAngle(this.right, this.pitchInput * dt);
                this.parent.transform.quaternion.premultiply(pitchQuat);
            }

            if (this.yawInput !== 0) {
                const yawQuat = new THREE.Quaternion().setFromAxisAngle(this.worldUp, this.yawInput * dt);
                this.parent.transform.quaternion.premultiply(yawQuat);
            }

            // Normalize quaternion
            this.parent.transform.quaternion.normalize();

            // Update velocity
            this.velocity.copy(this.forward).multiplyScalar(currentSpeed);

            // Apply vertical thrust
            if (this.keys.Space) {
                const verticalVelocity = this.up.clone().multiplyScalar(this.verticalAcceleration * dt);
                this.velocity.add(verticalVelocity);
            }
            console.log(this.parent.velocity);
                
            // Update physics system with latest position and velocity
            this.updatePhysics(dt);
            
        } else {
            // Handle collision state and recovery
            this.updateCollisionState(dt);
        }

        // Update camera position
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
        document.removeEventListener('mousedown', this.onMouseDown);
        this.scene.remove(this.parent);
        if (this.parent.geometry) this.parent.geometry.dispose();
        if (this.parent.material) this.parent.material.dispose();
        
        // Unregister collider
        if (this.collider && this.physics) {
            this.physics.unregisterCollider(this.collider.id);
        }
    }
}