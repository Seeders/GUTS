class AircraftController extends engine.Component {
    init({
        acceleration = 1200,
        strafeAcceleration = 20,
        verticalAcceleration = 20,
        pitchSpeed = 1.5,
        yawSpeed = 1.2,
        rollSpeed = 1.5,
        mouseSensitivity = 0.000004,
        dampingFactor = 0.12,
        maxSpeed = 8000,
        cameraSmoothing = 0.3,
        collisionRecoveryTime = 2,
        
        isRemote = false,
        // Enhanced stability parameters
        positionSmoothingFactor = 0.08,
        velocityThreshold = 0.005,
        // New flight dynamics parameters
        liftCoefficient = 0.8,
        dragCoefficient = 0.02,
        stallSpeed = 500,
        optimalSpeed = 2000,
        bankTurnRate = 0.7,
        autoLevelStrength = 0.3,
        turbulenceStrength = 0.1
    }) {
        this.world = this.game.gameEntity.getComponent("InfiniWorld");
        this.scene = this.world.scene;
        this.camera = this.game.camera;
        
        // Base parameters
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
        
        // Enhanced flight dynamics
        this.liftCoefficient = liftCoefficient;
        this.dragCoefficient = dragCoefficient;
        this.stallSpeed = stallSpeed;
        this.optimalSpeed = optimalSpeed;
        this.bankTurnRate = bankTurnRate;
        this.autoLevelStrength = autoLevelStrength;
        this.turbulenceStrength = turbulenceStrength;
        
        this.parent.transform.quaternion = new THREE.Quaternion();
        this.isRemote = isRemote;
        
        this.positionSmoothingFactor = positionSmoothingFactor;
        this.velocityThreshold = velocityThreshold;
        
        // Enhanced position smoothing
        this.previousPositions = [];
        this.previousPositionMaxLength = 8;
        this.smoothingBuffer = {
            position: new THREE.Vector3(),
            quaternion: new THREE.Quaternion(),
            velocity: new THREE.Vector3()
        };

        // Initialize physics properties
        this.physics = this.game.gameEntity.getComponent("Physics");
        this.collisionRecoveryTime = collisionRecoveryTime;
        this.hasCollided = false;
        this.collisionImpulse = new THREE.Vector3();
        
        // Enhanced transform properties
        this.parent.transform.physicsPosition = new THREE.Vector3().copy(this.parent.transform.position);
        this.parent.grounded = false;
 
        // Store last stable position/rotation for recovery
        this.lastStablePosition = new THREE.Vector3().copy(this.parent.transform.position);
        this.lastStableQuaternion = new THREE.Quaternion().copy(this.parent.transform.quaternion);
        this.lastStableUpdateTime = 0;
        this.stableUpdateInterval = 0.3;

        this.controls = new THREE_.PointerLockControls(this.camera, this.world.renderer.domElement);
        this.controls.pointerSpeed = 0;

        // Enhanced movement properties
        this.thrust = 0;
        this.targetThrust = 0; // For smoother thrust transitions
        this.strafeInput = 0;
        this.verticalInput = 0;
        this.pitchInput = 0;
        this.yawInput = 0;
        this.rollInput = 0;
        this.velocity = new THREE.Vector3();
        this.targetVelocity = new THREE.Vector3();
        this.aerodynamicForces = new THREE.Vector3(); // New aerodynamic forces
        this.collisionTimer = 0;
        this.lookTarget = new THREE.Vector3();
        // Enhanced local axes with smoothing
        this.forward = new THREE.Vector3(0, 0, 1);
        this.up = new THREE.Vector3(0, 1, 0);
        this.right = new THREE.Vector3(1, 0, 0);
        this.smoothedForward = new THREE.Vector3(0, 0, 1);
        this.smoothedUp = new THREE.Vector3(0, 1, 0);
        this.smoothedRight = new THREE.Vector3(1, 0, 0);

        // World reference vectors
        this.worldUp = new THREE.Vector3(0, 1, 0);
        this.worldForward = new THREE.Vector3(0, 0, 1);

        // Enhanced input state with smoothing
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
            y: 0,
            smoothX: 0,
            smoothY: 0
        };
        
        // Input smoothing buffers
        this.inputBuffers = {
            pitch: [],
            yaw: [],
            roll: [],
            thrust: [],
            bufferSize: 5
        };
        
        this.initialPosition = new THREE.Vector3();
        this.initialPosition.copy(this.parent.transform.position);
        
        // Enhanced camera settings
        this.isThirdPerson = true;
        this.thirdPersonDistance = 120;
        this.thirdPersonHeight = 40;
        this.cameraLookAhead = 8;
        this.lastCameraPosition = new THREE.Vector3();
        this.lastCameraLookAt = new THREE.Vector3();
        this.smoothedAircraftPosition = new THREE.Vector3().copy(this.parent.transform.position);
        this.smoothedAircraftQuaternion = new THREE.Quaternion().copy(this.parent.transform.quaternion);
        
        // Flight state tracking
        this.flightState = {
            airspeed: 0,
            groundSpeed: 0,
            verticalSpeed: 0,
            angleOfAttack: 0,
            bankAngle: 0,
            gForce: 1.0,
            isStalled: false
        };
        
        // Turbulence system
        this.turbulence = {
            time: 0,
            seed: Math.random() * 1000,
            intensity: 0
        };
     
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
        
        // Enhanced debug mode
        this.debugMode = false;
        this.debugInfo = { 
            jitterCount: 0, 
            maxJitter: 0,
            frameTime: 0,
            avgFrameTime: 0
        };

        this.networkDt = 0;
        this.lastNetworkUpdate = Date.now();
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
            },
            flightState: this.flightState
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
            if(data.flightState) this.flightState = data.flightState;
        }
       
    }

    OnGrounded() {
        if (this.hasCollided) return;
        this.hasCollided = true;
        const restitution = 0.4;
        
        // More realistic ground collision
        this.targetThrust *= restitution * 0.7;
        this.thrust *= restitution * 0.7;
        this.parent.transform.position.y += 8;
        
        let reflection = new THREE.Vector3().copy(
            this.world.getReflectionAt(this.game.deltaTime, this.parent.transform.position, this.velocity, restitution)
        );
        
        // Enhanced bounce with energy loss
        reflection.multiplyScalar(restitution);
        reflection.y = Math.max(reflection.y * 1.5, 8);
        reflection.y = Math.min(reflection.y, 15);
        
        // Add some randomness to make crashes feel more dynamic
        const randomFactor = 0.1;
        reflection.x += (Math.random() - 0.5) * this.velocity.length() * randomFactor;
        reflection.z += (Math.random() - 0.5) * this.velocity.length() * randomFactor;
        
        this.velocity.copy(reflection);
        this.parent.transform.velocity.copy(reflection);
        
        // Add some spin on crash
        const spinIntensity = 0.3;
        const randomSpin = new THREE.Quaternion().setFromEuler(new THREE.Euler(
            (Math.random() - 0.5) * spinIntensity,
            (Math.random() - 0.5) * spinIntensity,
            (Math.random() - 0.5) * spinIntensity
        ));
        this.parent.transform.quaternion.multiply(randomSpin);
    }

    // Enhanced input smoothing
    smoothInput(value, buffer, strength = 0.7) {
        buffer.push(value);
        if (buffer.length > this.inputBuffers.bufferSize) {
            buffer.shift();
        }
        
        // Calculate weighted average with recent values having more weight
        let weightedSum = 0;
        let totalWeight = 0;
        for (let i = 0; i < buffer.length; i++) {
            const weight = (i + 1) / buffer.length;
            weightedSum += buffer[i] * weight;
            totalWeight += weight;
        }
        
        return totalWeight > 0 ? (weightedSum / totalWeight) * strength : 0;
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
            // Enhanced reset with smooth transition
            this.parent.transform.quaternion.set(0, 0, 0, 1);
            this.smoothedAircraftQuaternion.copy(this.parent.transform.quaternion);
            this.hasCollided = false;
            this.collisionTimer = 0;
            this.velocity.set(0, 0, 0);
            this.targetVelocity.set(0, 0, 0);
            this.thrust = 0;
            this.targetThrust = 0;
            this.parent.transform.velocity.set(0, 0, 0);
            this.parent.transform.position.copy(this.initialPosition);
            this.previousPositions = [];
            
            // Reset all input buffers
            Object.keys(this.inputBuffers).forEach(key => {
                if (Array.isArray(this.inputBuffers[key])) {
                    this.inputBuffers[key] = [];
                }
            });
            
            // Reset flight state
            this.flightState = {
                airspeed: 0,
                groundSpeed: 0,
                verticalSpeed: 0,
                angleOfAttack: 0,
                bankAngle: 0,
                gForce: 1.0,
                isStalled: false
            };
            
            this.lastStablePosition.copy(this.initialPosition);
            this.lastStableQuaternion.copy(this.parent.transform.quaternion);
        }
        
        if (event.code === 'F1') {
            this.debugMode = !this.debugMode;
            console.log("Enhanced debug mode:", this.debugMode);
        }
    }

    onKeyUp(event) {
        if (event.code in this.keys) {
            this.keys[event.code] = false;
        }
    }

    onMouseMove(event) {
        if (this.controls.isLocked && !this.hasCollided) {
            // Direct, responsive mouse input
            const sensitivity = this.mouseSensitivity * 100; // Increased sensitivity
            this.mouse.x += -(event.movementX || 0) * sensitivity;
            this.mouse.y += -(event.movementY || 0) * sensitivity;
            
            // Cap maximum input to prevent over-rotation
            const maxInput = 2.0;
            this.mouse.x = Math.max(-maxInput, Math.min(maxInput, this.mouse.x));
            this.mouse.y = Math.max(-maxInput, Math.min(maxInput, this.mouse.y));
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
        
        const delta = event.deltaY * 0.008;
        const thrustDelta = this.acceleration * 0.7 * delta;
        this.targetThrust = Math.max(0, Math.min(this.targetThrust - thrustDelta, this.maxSpeed));
    }

    updateAxes() {
        // Update actual axes
        this.forward.set(0, 0, 1).applyQuaternion(this.parent.transform.quaternion).normalize();
        this.up.set(0, 1, 0).applyQuaternion(this.parent.transform.quaternion).normalize();
        this.right.set(1, 0, 0).applyQuaternion(this.parent.transform.quaternion).normalize();
        
        // Update smoothed axes for camera
        const axisSmoothing = 0.12;
        this.smoothedForward.lerp(this.forward, axisSmoothing);
        this.smoothedUp.lerp(this.up, axisSmoothing);
        this.smoothedRight.lerp(this.right, axisSmoothing);
        
        // Normalize smoothed axes
        this.smoothedForward.normalize();
        this.smoothedUp.normalize();
        this.smoothedRight.normalize();
    }

    // New aerodynamics calculation
    calculateAerodynamics(dt) {
        const speed = this.velocity.length();
        this.flightState.airspeed = speed;
        this.flightState.groundSpeed = new THREE.Vector3(this.velocity.x, 0, this.velocity.z).length();
        this.flightState.verticalSpeed = this.velocity.y;
        
        // Calculate angle of attack
        const velocityDirection = this.velocity.clone().normalize();
        this.flightState.angleOfAttack = Math.acos(Math.max(-1, Math.min(1, velocityDirection.dot(this.forward))));
        
        // Calculate bank angle
        this.flightState.bankAngle = Math.acos(Math.max(-1, Math.min(1, this.up.dot(this.worldUp))));
        
        // Check stall condition
        this.flightState.isStalled = speed < this.stallSpeed && this.flightState.angleOfAttack > Math.PI * 0.25;
        
        // Calculate lift
        let liftMagnitude = 0;
        if (speed > 0) {
            const speedRatio = Math.min(speed / this.optimalSpeed, 2.0);
            const liftEfficiency = Math.max(0, 1 - Math.abs(this.flightState.angleOfAttack) / (Math.PI * 0.5));
            liftMagnitude = this.liftCoefficient * speedRatio * speedRatio * liftEfficiency;
            
            if (this.flightState.isStalled) {
                liftMagnitude *= 0.3; // Significant lift loss in stall
            }
        }
        
        // Apply lift force perpendicular to velocity and forward direction
        const liftDirection = new THREE.Vector3().crossVectors(velocityDirection, this.right).normalize();
        const liftForce = liftDirection.multiplyScalar(liftMagnitude);
        
        // Calculate drag
        const dragMagnitude = this.dragCoefficient * speed * speed;
        const dragForce = velocityDirection.clone().multiplyScalar(-dragMagnitude);
        
        // Combine aerodynamic forces
        this.aerodynamicForces.copy(liftForce).add(dragForce);
        
        // Add gravity
        this.aerodynamicForces.add(new THREE.Vector3(0, -9.81 * 0.1, 0));
        
        return this.aerodynamicForces;
    }

    // Enhanced turbulence system
    calculateTurbulence(dt) {
        
        return new THREE.Vector3();
        this.turbulence.time += dt;
        
        // Turbulence intensity based on speed and altitude
        const speed = this.velocity.length();
        const altitude = Math.max(0, this.parent.transform.position.y - this.parent.transform.groundHeight);
        
        // More turbulence at higher speeds and lower altitudes
        this.turbulence.intensity = this.turbulenceStrength * (speed / 1000) * Math.max(0.1, 1 - altitude / 1000);
        
        if (this.turbulence.intensity > 0) {
            const turbulence = new THREE.Vector3(
                (Math.sin(this.turbulence.time * 3.7 + this.turbulence.seed) + 
                 Math.sin(this.turbulence.time * 7.3 + this.turbulence.seed * 2)) * 0.5,
                (Math.sin(this.turbulence.time * 2.1 + this.turbulence.seed * 3) + 
                 Math.sin(this.turbulence.time * 5.7 + this.turbulence.seed * 4)) * 0.5,
                (Math.sin(this.turbulence.time * 4.3 + this.turbulence.seed * 5) + 
                 Math.sin(this.turbulence.time * 6.1 + this.turbulence.seed * 6)) * 0.5
            );
            
            turbulence.multiplyScalar(this.turbulence.intensity);
            return turbulence;
        }
        
        return new THREE.Vector3();
    }

    updateCameraPosition() {
        const dt = this.game.deltaTime;
        const dynamicSmoothing = Math.max(0.1, this.cameraSmoothing - (this.velocity.length() / 10000));
    
        // Enhanced forward vector calculation
        const forward = this.smoothedForward.clone();
        const lookAheadDistance = this.cameraLookAhead + (this.velocity.length() * 0.001);
        this.lookTarget.lerp(this.parent.transform.position.clone().add(
            forward.multiplyScalar(lookAheadDistance)
        ), 1);
    
        if (this.isThirdPerson) {
            // Dynamic camera distance based on speed
            const speedFactor = Math.max(0.7, Math.min(1.3, 1 + (this.velocity.length() - 2000) / 4000));
            const dynamicDistance = this.thirdPersonDistance;
            const dynamicHeight = this.thirdPersonHeight;
            
            const offset = new THREE.Vector3(0, dynamicHeight, -dynamicDistance)
                .applyQuaternion(this.parent.transform.quaternion);
            
            // Add slight banking effect to camera
            const bankEffect = Math.sin(this.flightState.bankAngle) * 5;
            offset.x += bankEffect;
            
            const targetPos = this.parent.transform.position.clone().add(offset);
            
            this.camera.position.copy(targetPos);
            // Enhanced camera orientation with roll preservation
            const up = this.smoothedUp.clone();
            const right = new THREE.Vector3().crossVectors(forward, up).normalize();
            up.crossVectors(right, forward).normalize();
    
            const lookAtMatrix = new THREE.Matrix4().lookAt(
                this.camera.position,
                this.lookTarget,
                up
            );
            
            const newQuaternion = new THREE.Quaternion().setFromRotationMatrix(lookAtMatrix);
            this.camera.quaternion.slerp(newQuaternion, dynamicSmoothing * 1.5);
    
        } else {
            this.camera.position.copy(this.parent.transform.position);
            this.camera.quaternion.copy(this.parent.transform.quaternion);
        }
    }

    updateCollisionState(dt) {
        if (this.hasCollided) {
            this.collisionTimer += dt;

            // Faster recovery with stronger stabilization
            const recoveryProgress = this.collisionTimer / this.collisionRecoveryTime;
            
            if (recoveryProgress > 0.3) { // Start recovery after 30% of time
                const stabilizationForce = 0.8 * (recoveryProgress - 0.3);
                
                // Strong auto-leveling
                const currentUp = this.up.clone();
                const targetUp = this.worldUp.clone();
                const levelingAxis = new THREE.Vector3().crossVectors(currentUp, targetUp).normalize();
                const levelingAngle = Math.acos(Math.max(-1, Math.min(1, currentUp.dot(targetUp)))) * stabilizationForce;
                
                if (levelingAxis.length() > 0 && levelingAngle > 0.001) {
                    const levelingQuat = new THREE.Quaternion().setFromAxisAngle(levelingAxis, levelingAngle * dt * 5);
                    this.parent.transform.quaternion.premultiply(levelingQuat);
                }
            }
        
            // Ensure aircraft stays well above ground
            const minHeight = this.parent.transform.groundHeight + 20;
            if(this.parent.transform.position.y < minHeight) {
                this.parent.transform.position.y = minHeight;
                this.velocity.y = Math.max(this.velocity.y, 10); // Upward velocity
            }
            
            // Shorter recovery time and clear reset
            if (this.collisionTimer >= this.collisionRecoveryTime) {
                this.hasCollided = false;
                this.collisionTimer = 0;
                this.previousPositions = [];
                // Clear mouse input to prevent immediate re-crash
                this.mouse.x = 0;
                this.mouse.y = 0;
                console.log("Aircraft control restored - ready to fly");
            }
        }
    }

    updatePhysics(dt) {
        // Enhanced velocity smoothing with multiple stages
        const velocitySmoothing = 0.08;
        this.targetVelocity.lerp(this.velocity, velocitySmoothing);
        
        // Apply velocity threshold with hysteresis
        const currentSpeed = this.targetVelocity.length();
        if (currentSpeed < this.velocityThreshold) {
            this.targetVelocity.multiplyScalar(0.95); // Gradual decay instead of hard cutoff
        }
        
        // Enhanced position smoothing
        this.previousPositions.push(this.parent.transform.position.clone());
        if (this.previousPositions.length > this.previousPositionMaxLength) {
            this.previousPositions.shift();
        }
        
        // Calculate smoothed position
        if (this.previousPositions.length > 1) {
            const smoothedPos = new THREE.Vector3();
            let totalWeight = 0;
            
            for (let i = 0; i < this.previousPositions.length; i++) {
                const weight = (i + 1) / this.previousPositions.length;
                smoothedPos.add(this.previousPositions[i].clone().multiplyScalar(weight));
                totalWeight += weight;
            }
            
            if (totalWeight > 0) {
                smoothedPos.divideScalar(totalWeight);
                this.smoothingBuffer.position.lerp(smoothedPos, 0.3);
            }
        }
        
        // Apply smoothed velocity
        this.parent.transform.velocity.copy(this.targetVelocity);
        this.parent.transform.position.add(this.targetVelocity.clone().multiplyScalar(dt)); 
    }
    
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
        const frameStart = performance.now();
        
        const groundHeight = this.game.gameEntity.getComponent('game').getTerrainHeight(this.parent.transform.position);

        if(this.parent.transform.position.y <= groundHeight) this.OnGrounded();
        
        this.updateStableState(dt);
        
        if(!this.isRemote){
            this.updateAxes();
            this.updateCameraPosition();
        }
        if (!this.hasCollided) {
            // Simplified, direct flight controls
            
            // Direct input processing - no over-smoothing
            const inputDamping = 1 - (this.dampingFactor * dt);
            
            // Direct pitch and yaw from mouse with proper scaling
            this.pitchInput = this.mouse.y * this.pitchSpeed * dt;
            this.yawInput = this.mouse.x * this.yawSpeed * dt;
            this.rollInput = ((this.keys.KeyD ? 1 : 0) + (this.keys.KeyA ? -1 : 0)) * this.rollSpeed * dt;

            // Thrust control
            if (this.keys.KeyW) {
                this.targetThrust += this.acceleration * dt;
            } else if (this.keys.KeyS) {
                this.targetThrust -= this.acceleration * 1.5 * dt;
            }
            
            // Smooth thrust transition
            this.thrust = this.thrust * 0.95 + this.targetThrust * 0.05;
            this.targetThrust = Math.max(0, Math.min(this.targetThrust, this.maxSpeed));
            const currentSpeed = Math.min(this.thrust, this.maxSpeed);

            // Apply rotations - direct and responsive
            if (Math.abs(this.rollInput) > 0.001) {
                const rollQuat = new THREE.Quaternion().setFromAxisAngle(this.forward, this.rollInput);
                this.parent.transform.quaternion.premultiply(rollQuat);
            }

            // Direct pitch control
            if (Math.abs(this.pitchInput) > 0.001) {
                const pitchQuat = new THREE.Quaternion().setFromAxisAngle(this.right, this.pitchInput);
                this.parent.transform.quaternion.premultiply(pitchQuat);
            }

            // Direct yaw control
            if (Math.abs(this.yawInput) > 0.001) {
                const yawQuat = new THREE.Quaternion().setFromAxisAngle(this.up, this.yawInput);
                this.parent.transform.quaternion.premultiply(yawQuat);
            }

            // Normalize quaternion
            this.parent.transform.quaternion.normalize();

            // Simple velocity calculation
            this.velocity.copy(this.forward).multiplyScalar(currentSpeed);

            // Vertical controls
            if (this.keys.Space) {
                const verticalBoost = this.up.clone().multiplyScalar(this.verticalAcceleration * dt);
                this.velocity.add(verticalBoost);
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
        }

        // Simple mouse input decay
        this.mouse.x *= 0.95;
        this.mouse.y *= 0.95;
        
        // Performance tracking
        const frameEnd = performance.now();
        this.debugInfo.frameTime = frameEnd - frameStart;
        this.debugInfo.avgFrameTime = this.debugInfo.avgFrameTime * 0.95 + this.debugInfo.frameTime * 0.05;
        
        // Enhanced debug info
        if (this.debugMode) {
            const speed = this.flightState.airspeed.toFixed(0);
            const altitude = (this.parent.transform.position.y - (this.parent.transform.groundHeight || 0)).toFixed(0);
            const gForce = this.flightState.gForce.toFixed(1);
            const bankAngle = (this.flightState.bankAngle * 180 / Math.PI).toFixed(0);
            const stallStatus = this.flightState.isStalled ? "STALLED" : "Normal";
            
            console.log(`Speed: ${speed} | Alt: ${altitude} | G: ${gForce} | Bank: ${bankAngle}° | Status: ${stallStatus}`);
        }
    }

    onDestroy() {
        if (this.controls) this.controls.dispose();
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('wheel', this.onWheel);
        document.removeEventListener('mousedown', this.onMouseDown);
        if (this.scene && this.parent) this.scene.remove(this.parent);
        if (this.parent && this.parent.geometry) this.parent.geometry.dispose();
        if (this.parent && this.parent.material) this.parent.material.dispose();
    }
}