class AircraftController extends engine.Component {
    init({
        acceleration = 1000,
        strafeAcceleration = 15,
        verticalAcceleration = 15,
        pitchSpeed = 1.5,
        yawSpeed = 1,
        rollSpeed = 1,
        mouseSensitivity = 0.00005,
        dampingFactor = 0.15,
        maxSpeed = 6000,
        cameraSmoothing = 0.4,
        collisionRecoveryTime = 2,
        
        isRemote = false,
        // New parameters for stability
        physicsUpdateRate = 60,      // Hz for physics updates
        positionSmoothingFactor = 0.1, // Reduced from 0.5 for smoother transitions
        velocityThreshold = 0.01     // Minimum velocity threshold to reduce jitter
    }) {
        this.world = this.game.gameEntity.getComponent("InfiniWorld");
        this.scene = this.world.scene;
        this.camera = this.game.camera;
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
        this.isRemote = isRemote;
        // New stability parameters
        this.physicsUpdateRate = physicsUpdateRate;
        this.physicsUpdateInterval = 1 / physicsUpdateRate;
        this.physicsAccumulator = 0;
        this.positionSmoothingFactor = positionSmoothingFactor;
        this.velocityThreshold = velocityThreshold;
        this.previousPositions = []; // Store previous positions for smoothing
        this.previousPositionMaxLength = 5; // Number of positions to average

        // Initialize physics properties
        this.physics = this.game.gameEntity.getComponent("Physics");
        this.collisionRecoveryTime = collisionRecoveryTime;
        this.hasCollided = false;
        this.collisionImpulse = new THREE.Vector3();
        
        // Initialize transform properties needed for physics
        this.parent.transform.physicsPosition = new THREE.Vector3().copy(this.parent.transform.position);
        this.parent.grounded = false;
 
        // Store last stable position/rotation for recovery
        this.lastStablePosition = new THREE.Vector3().copy(this.parent.transform.position);
        this.lastStableQuaternion = new THREE.Quaternion().copy(this.parent.transform.quaternion);
        this.lastStableUpdateTime = 0;
        this.stableUpdateInterval = 0.5; // Save stable state every 0.5 seconds

        this.controls = new THREE_.PointerLockControls(this.camera, this.world.renderer.domElement);
        this.controls.pointerSpeed = 0;

        // Movement properties
        this.thrust = 0;
        this.strafeInput = 0;
        this.verticalInput = 0;
        this.pitchInput = 0;
        this.yawInput = 0;
        this.rollInput = 0;
        this.velocity = new THREE.Vector3();
        this.targetVelocity = new THREE.Vector3(); // New target velocity for smoothing
        this.collisionTimer = 0;
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
            Space: false,
            mouseX: 0,
            mouseY: 0
        };
        this.mouse = {
            x: 0,
            y: 0
        }
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
     
        if(!this.isRemote) { 
            this.scene.add(this.controls.object);
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
        // Debug mode for development
        this.debugMode = false;
        this.debugInfo = { jitterCount: 0, maxJitter: 0 };
    }
    getNetworkData(){     
        let data = {
            keys: this.keys,
            mouse: this.mouse,
            direction: {
                forward: {
                    x: this.forward.x,
                    y: this.forward.y,
                    z: this.forward.z
                },
                right:{
                    x: this.right.x,
                    y: this.right.y,
                    z: this.right.z
                },
                up: {
                    x: this.up.x,
                    y: this.up.y,
                    z: this.up.z
                }
            }
        } 
        
        return data;       
    }
    
    setNetworkData(data){

        if(this.game.isServer){
    
            this.mouse = data.mouse;
            this.keys = data.keys;
            this.forward.set(data.direction.forward.x, data.direction.forward.y, data.direction.forward.z);
            this.right.set(data.direction.right.x, data.direction.right.y, data.direction.right.z);
            this.up.set(data.direction.up.x, data.direction.up.y, data.direction.up.z);
        
        }
    }

    OnGrounded() {
        if (this.hasCollided) return;
        this.hasCollided = true;
        const restitution = .5;
        this.thrust *= restitution;
        this.parent.transform.position.y += 5;
        
        let reflection = new THREE.Vector3().copy(this.world.getReflectionAt(this.game.deltaTime, this.parent.transform.position, this.velocity, restitution));
        // Add energy loss on bounce (70% energy conservation)
    
        reflection.multiplyScalar(restitution);
        reflection.y *= 2;
        if(reflection.y < 5) reflection.y = 5;

        reflection.y = Math.min(reflection.y, 10);
        // Apply reflected velocity
        this.velocity.copy(reflection);
        this.parent.transform.velocity.copy(reflection);
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
            this.targetVelocity.set(0, 0, 0);
            this.parent.transform.velocity.set(0, 0, 0);
            this.parent.transform.position.copy(this.initialPosition);
            this.previousPositions = [];
            
            // Reset stable state
            this.lastStablePosition.copy(this.initialPosition);
            this.lastStableQuaternion.copy(this.parent.transform.quaternion);
        }
        
        // Toggle debug mode with F1
        if (event.code === 'F1') {
            this.debugMode = !this.debugMode;
            console.log("Debug mode:", this.debugMode);
        }
    }

    onKeyUp(event) {
        if (event.code in this.keys) {
            this.keys[event.code] = false;
        }
    }

    onMouseMove(event) {
        if (this.controls.isLocked && !this.hasCollided) {
            // Apply more aggressive smoothing to mouse input
            const smoothingFactor = 0.6; // Higher smoothing for mouse movements
            
            // Get new input values
            const newMouseXInput = -(event.movementX || 0) * this.mouseSensitivity;
            const newMouseYInput = -(event.movementY || 0) * this.mouseSensitivity;
            
            // Apply smoothing between old and new values
            this.mouse.x = this.mouse.x + newMouseXInput;
            this.mouse.y = this.mouse.y + newMouseYInput;
        } else {
            this.mouse.x = 0;
            this.mouse.y = 0;
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
        // Apply smoother thrust changes
        const thrustDelta = this.acceleration * 0.5 * delta;
        this.thrust = Math.max(0, Math.min(this.thrust - thrustDelta, this.maxSpeed));
    }

    updateAxes() {
        this.forward.set(0, 0, 1).applyQuaternion(this.parent.transform.quaternion).normalize();
        this.up.set(0, 1, 0).applyQuaternion(this.parent.transform.quaternion).normalize();
        this.right.set(1, 0, 0).applyQuaternion(this.parent.transform.quaternion).normalize();
    }

    updateCameraPosition() {
        const dt = this.game.deltaTime;
        const smoothingAlpha = 0.9; 
    
    
        // Calculate forward vector from smoothed quaternion
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.parent.transform.quaternion);
    
        // Calculate look-at target
        const lookTarget = this.parent.transform.position.clone().add(
            forward.clone().multiplyScalar(this.cameraLookAhead)
        );
    
        if (this.isThirdPerson) {
            const offsetDistance = Math.max(1, this.parent.transform.velocity.length() * .001);
            const offset = new THREE.Vector3(0, this.thirdPersonHeight, -this.thirdPersonDistance).applyQuaternion(this.parent.transform.quaternion);
            offset.multiplyScalar(offsetDistance);
            offset.y /= offsetDistance;
            const targetPos = this.parent.transform.position.clone().add(offset);
              
    
            // Add additional camera smoothing to reduce jitter
            this.camera.position.copy(targetPos);
    
            // Extract roll from smoothedAircraftQuaternion
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.parent.transform.quaternion);
            const right = new THREE.Vector3().crossVectors(forward, up).normalize();
            up.crossVectors(right, forward).normalize(); // Recompute up to ensure orthogonality
    
            // Compute quaternion to look at target while preserving roll
            const lookAtMatrix = new THREE.Matrix4().lookAt(
                this.camera.position,
                lookTarget,
                up // Use aircraft's up vector to preserve roll
            );
            
            // Apply additional rotation smoothing
            const newQuaternion = new THREE.Quaternion().setFromRotationMatrix(lookAtMatrix);
            this.camera.quaternion.slerp(newQuaternion, smoothingAlpha);
    
        } else {
            this.camera.position.copy(this.parent.transform.position);
            this.camera.quaternion.copy(this.parent.transform.quaternion);
        }
    }

    updateCollisionState(dt) {
        if (this.hasCollided) {
            this.collisionTimer += dt;

            const fadeRate = Math.max(0, 1 - (this.collisionTimer / this.collisionRecoveryTime));
        
            // Add gradual stabilization as recovery progresses
                // Start adding some auto-stabilization
            const stabilizationForce = 0.3 * (1 - fadeRate);
            
            // Gradually level out

            const levelingQuat = new THREE.Quaternion().setFromUnitVectors(this.up, this.worldUp);
            this.parent.transform.quaternion.slerp(levelingQuat, stabilizationForce * dt * 5);
        
            if(this.parent.transform.position.y < this.parent.transform.groundHeight) this.parent.transform.position.y += 5;
            // Check if recovery time has elapsed
            if (this.collisionTimer >= this.collisionRecoveryTime) {
                this.hasCollided = false;
                this.collisionTimer = 0;
                this.previousPositions = []; // Reset position history
                console.log("Aircraft control restored after collision");
            }
        }
    }

    updatePhysics(dt) {

        // Apply velocity smoothing
        this.targetVelocity.copy(this.velocity);
        
        // If velocity is very small, zero it out to prevent micro-jitters
        if (this.targetVelocity.lengthSq() < this.velocityThreshold * this.velocityThreshold) {
            this.targetVelocity.set(0, 0, 0);
        }
        
        // Smooth velocity transition
        this.parent.transform.velocity.copy(this.targetVelocity); // Smooth velocity transitions
    
        this.parent.transform.position.add(this.targetVelocity.clone().multiplyScalar(this.game.deltaTime)); 
    }
    
    // New method to save stable state
    updateStableState(dt) {
        if (!this.hasCollided) {
            this.lastStableUpdateTime += dt;
            if (this.lastStableUpdateTime >= this.stableUpdateInterval) {
                this.lastStableUpdateTime = 0;
                this.lastStablePosition.copy(this.parent.transform.position);
                this.lastStableQuaternion.copy(this.parent.transform.quaternion);
            }
        }
    }
    
    update() {
        const dt = this.game.deltaTime;
        
        const groundHeight = this.game.gameEntity.getComponent('game').getTerrainHeight(this.parent.transform.position);

        if(this.parent.transform.position.y <= groundHeight) this.OnGrounded();
        // Update stable state tracking
        this.updateStableState(dt);
        if(!this.isRemote){
            // Update local axes
            this.updateAxes();
        }

        if (!this.hasCollided) {
            // Normal flight controls when not in collision state
            
            // Smooth inputs
            const inputDamping = 1 - (this.dampingFactor * dt);
            // Cap pitch/yaw inputs to ensure consistent rotation rate
            const maxInput = 1.0; // Maximum input value for pitch/yaw
            this.pitchInput = (this.pitchInput * inputDamping) + Math.max(-maxInput, Math.min(maxInput, this.mouse.y * this.pitchSpeed));
            this.yawInput = (this.yawInput * inputDamping) + Math.max(-maxInput, Math.min(maxInput, this.mouse.x * this.yawSpeed));
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
            this.thrust = Math.max(0, Math.min(this.thrust, this.maxSpeed));

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
                
            
        } else {
            // Handle collision state and recovery
            this.updateCollisionState(dt);
        }       

        if(this.game.isServer){
        // Update physics system with latest position and velocity
            this.updatePhysics(dt);
        }
        
        if(!this.isRemote){
            // Update camera position
            this.updateCameraPosition();
        }

        // Reset mouse input
        this.mouse.x *= 0.8; // Gradual decay instead of immediate reset
        this.mouse.y *= 0.8;
        
        // Show debug info if enabled
        if (this.debugMode) {
            const speed = this.parent.transform.velocity.length().toFixed(2);
            const physPos = this.parent.transform.physicsPosition;
            const visualPos = this.parent.transform.position;
            const posDiff = visualPos.distanceTo(physPos).toFixed(4);
            
            console.log(`Speed: ${speed}, Pos diff: ${posDiff}, Jitters: ${this.debugInfo.jitterCount}`);
        }
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
    }
}