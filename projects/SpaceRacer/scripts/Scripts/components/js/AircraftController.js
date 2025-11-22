class AircraftController extends GUTS.Component {
    init({
        thrustPower = 500,
        maxSpeed = 3000,
        minSpeed = 0,
        pitchSpeed = .2,
        yawSpeed = 1.5,
        rollSpeed = 1.0,
        bankingTurnMultiplier = 2.0,
        mouseSensitivity = 0.002,
        aircraftLength = 20,
        aircraftRadius = 3,
        cameraOffset = { x: 0, y: 10, z: -100 },
        cameraSmoothing = 0.1,
        isRemote = false
    }) {
        let gameComponent = this.game.gameEntity.getComponent('game');
        
        this.modelRenderer = this.parent.getComponent('ModelRenderer');
        this.world = gameComponent.world;
        this.physics = gameComponent.physics;
        this.scene = this.world.scene;
        this.camera = this.game.camera;

        // Flight parameters
        this.thrustPower = thrustPower;
        this.maxSpeed = maxSpeed;
        this.minSpeed = minSpeed;
        this.pitchSpeed = pitchSpeed;
        this.yawSpeed = yawSpeed;
        this.rollSpeed = rollSpeed;
        this.bankingTurnMultiplier = bankingTurnMultiplier;
        this.mouseSensitivity = mouseSensitivity;
        this.cameraSmoothing = cameraSmoothing;

        // Aircraft dimensions
        this.aircraftLength = aircraftLength;
        this.aircraftRadius = aircraftRadius;
        this.cameraOffset = cameraOffset;

        // Flight state
        this.velocity = new THREE.Vector3();
        this.currentSpeed = this.minSpeed;
        this.throttle = 0;
        
        // Rotation state
        this.pitch = 0;
        this.yaw = 0;
        this.roll = 0;
        
        // Angular velocities for smooth rotation
        this.pitchVelocity = 0;
        this.yawVelocity = 0;
        this.rollVelocity = 0;

       // **PHYSICS INTERPOLATION VARIABLES**
        this.previousPhysicsPosition = new THREE.Vector3();
        this.currentPhysicsPosition = new THREE.Vector3();
        this.previousPhysicsRotation = new THREE.Quaternion();
        this.currentPhysicsRotation = new THREE.Quaternion();
        this.hasValidPhysicsStates = false; // Track if we have valid states to interpolate
        
        // Smooth rendering transform (what the visual uses)
        this.renderPosition = new THREE.Vector3();
        this.renderRotation = new THREE.Quaternion();

        // Camera properties
        this.isFirstPerson = false;
        this.cameraTargetPosition = new THREE.Vector3();
        this.cameraLookAt = new THREE.Vector3();

        // Local axes (aircraft orientation)
        this.forward = new THREE.Vector3(0, 0, 1);
        this.up = new THREE.Vector3(0, 1, 0);
        this.right = new THREE.Vector3(1, 0, 0);

        // Control inputs
        this.inputPitch = 0;
        this.inputYaw = 0;
        this.inputRoll = 0;
        this.inputThrottle = 0;

        this.isRemote = isRemote;
        
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
            KeyX: false
        };
        this.lastKeys = {...this.keys};
        
        // Mouse controls
        this.controls = { isLocked: false };
        this.mouseControlEnabled = true;

        if(!this.isRemote) { 
            document.addEventListener('click', () => {            
                if (!this.controls.isLocked) {
                    this.world.renderer.domElement.requestPointerLock();
                }
            });
            document.addEventListener('pointerlockchange', () => {
                this.controls.isLocked = document.pointerLockElement === this.world.renderer.domElement;
            });
            
            this.onKeyDown = this.onKeyDown.bind(this);
            this.onKeyUp = this.onKeyUp.bind(this);
            this.onMouseMove = this.onMouseMove.bind(this);
            document.addEventListener('keydown', this.onKeyDown);
            document.addEventListener('keyup', this.onKeyUp);
            document.addEventListener('mousemove', this.onMouseMove);
        }
        
        // Debug helpers
        this.debug = {
            showVelocity: false,
            velocityHelper: null
        };
    }

    getNetworkData(){     
        let data = {} 
        
        if(this.game.isServer){
            data = {
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
                rotation: {
                    pitch: this.pitch,
                    yaw: this.yaw,
                    roll: this.roll
                },
                currentSpeed: this.currentSpeed
            };
        } else {
            data = {
                keys: this.keys
            };
        }
        this.lastKeys = {...this.keys};
        return data;       
    }
    
    setNetworkData(data){
        if(this.game.isServer){
            if(data.keys){
                this.keys = data.keys;
            }
        } else {            
            this.forward.set(data.direction.forward.x, data.direction.forward.y, data.direction.forward.z);
            this.right.set(data.direction.right.x, data.direction.right.y, data.direction.right.z);
            this.up.set(data.direction.up.x, data.direction.up.y, data.direction.up.z);
            this.pitch = data.rotation.pitch;
            this.yaw = data.rotation.yaw;
            this.roll = data.rotation.roll;
            this.currentSpeed = data.currentSpeed;            
        }
    }

    setupPhysics(simulation) {
        this.rapierWorld = simulation;
        this.setupAircraftBody();
    }

    setupAircraftBody() {
        let rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, 100, 0)
            .setLinearDamping(0.1)
            .setAngularDamping(0.3);
        this.rigidBody = this.rapierWorld.createRigidBody(rigidBodyDesc);

        let colliderDesc = RAPIER.ColliderDesc.capsule(
            this.aircraftLength / 2 - this.aircraftRadius,
            this.aircraftRadius
        )
            .setRotation({ w: 0.707, x: 0, y: 0, z: 0.707 })
            .setCollisionGroups(0x0002)
            .setSolverGroups(0x0002);
        this.collider = this.rapierWorld.createCollider(colliderDesc, this.rigidBody);

        this.parent.collisionRadius = this.aircraftRadius;

        const pos = this.parent.transform.position;
        this.rigidBody.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
   
        // Initialize physics interpolation positions
        this.updatePhysicsPositions();
    }

    onPhysicsUpdate(timestamp, physicsStepMs) {
        this.updatePhysicsPositions();
    }
    
    // **FIXED METHOD: Update physics positions for interpolation**
    updatePhysicsPositions() {
        if (!this.rigidBody) return;
        
        // Store previous state (only if we have a current state)
        if (this.hasValidPhysicsStates) {
            this.previousPhysicsPosition.copy(this.currentPhysicsPosition);
            this.previousPhysicsRotation.copy(this.currentPhysicsRotation);
        }
        
        // Get current physics state
        const pos = this.rigidBody.translation();
        const rot = this.rigidBody.rotation();
        
        this.currentPhysicsPosition.set(pos.x, pos.y, pos.z);
        this.currentPhysicsRotation.set(rot.x, rot.y, rot.z, rot.w);
        
        // If this is our first update, copy current to previous
        if (!this.hasValidPhysicsStates) {
            this.previousPhysicsPosition.copy(this.currentPhysicsPosition);
            this.previousPhysicsRotation.copy(this.currentPhysicsRotation);
            this.hasValidPhysicsStates = true;
        }
    }

    onKeyDown(event) {
        if(this.isRemote) return;
        
        if (event.code in this.keys) {
            this.keys[event.code] = true;
        }
        
        if (event.code === 'KeyV') {
            this.isFirstPerson = !this.isFirstPerson;
        }
        
        if (event.code === 'KeyM') {
            this.mouseControlEnabled = !this.mouseControlEnabled;
        }
        
        if (event.code === 'KeyB') {
            this.debug.showVelocity = !this.debug.showVelocity;
        }
    }

    onKeyUp(event) {
        if(this.isRemote) return;
        
        if (event.code in this.keys) {
            this.keys[event.code] = false;
        }
    }

    onMouseMove(event) {
        if(this.isRemote || !this.controls.isLocked || !this.mouseControlEnabled) return;
        
       // this.inputPitch += event.movementY * this.mouseSensitivity;
      //  this.inputRoll += -event.movementX * this.mouseSensitivity;
        
     //   this.inputPitch = Math.max(-1, Math.min(1, this.inputPitch));
     //   this.inputRoll = Math.max(-1, Math.min(1, this.inputRoll));
    }

    processInputs(dt) {
        this.inputPitch *= 0.9;
        this.inputYaw *= 0.9;
        this.inputRoll *= 0.9;
        this.inputThrottle = 0;
        if (this.keys.KeyW) this.inputPitch -= 1;
        if (this.keys.KeyS) this.inputPitch += 1;
        if (this.keys.KeyA) this.inputRoll += 1;
        if (this.keys.KeyD) this.inputRoll -= 1;
        if (this.keys.KeyQ) this.inputThrottle += 1;
        if (this.keys.KeyE) this.inputThrottle -= 1;

        this.inputPitch = Math.max(-1, Math.min(1, this.inputPitch));
        this.inputYaw = Math.max(-1, Math.min(1, this.inputYaw));
        this.inputRoll = Math.max(-1, Math.min(1, this.inputRoll));
        this.inputThrottle = Math.max(-1, Math.min(1, this.inputThrottle));
    }

    updateFlightDynamics(dt) {
        this.throttle += this.inputThrottle * dt * 2.0;
        this.throttle = Math.max(0, Math.min(1, this.throttle));

        const targetSpeed = this.minSpeed + (this.maxSpeed - this.minSpeed) * this.throttle;
        
        let airBrakeMultiplier = 1;
        if (this.keys.Space) {
            airBrakeMultiplier = 0.3;
        }
        
        if (this.keys.ShiftLeft) {
            airBrakeMultiplier = 1.5;
        }

        const speedDifference = (targetSpeed * airBrakeMultiplier) - this.currentSpeed;
        this.currentSpeed += speedDifference * dt * 3.0;
        this.currentSpeed = Math.max(this.minSpeed * 0.5, this.currentSpeed);
        if(this.currentSpeed < 1) this.currentSpeed = 0;
        const speedFactor = this.currentSpeed / this.maxSpeed;
        
        this.pitchVelocity += this.inputPitch * this.pitchSpeed * speedFactor * dt * 10;
        this.yawVelocity += this.inputYaw * this.yawSpeed * speedFactor * dt * 10;
        this.rollVelocity += this.inputRoll * this.rollSpeed * speedFactor * dt * 10;

        const bankingTurnInput = Math.sin(this.roll) * this.bankingTurnMultiplier;
        this.yawVelocity += bankingTurnInput * speedFactor * dt * 5;

        this.pitchVelocity *= Math.pow(0.85, dt * 60);
        this.yawVelocity *= Math.pow(0.85, dt * 60);
        this.rollVelocity *= Math.pow(0.9, dt * 60);

        this.pitch += this.pitchVelocity * dt;
        this.yaw += this.yawVelocity * dt;
        this.roll += this.rollVelocity * dt;

        this.pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.pitch));
        this.roll *= Math.pow(0.98, dt * 60);
    }

    updateTransform() {        
        // Sanitize rotation inputs
        this.pitch = isNaN(this.pitch) ? 0 : Math.max(-Math.PI/2, Math.min(Math.PI/2, this.pitch));
        this.yaw = isNaN(this.yaw) ? 0 : this.yaw;
        this.roll = isNaN(this.roll) ? 0 : this.roll;

        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), this.pitch);
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
        const rollQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), this.roll);
        
        const combinedQuat = new THREE.Quaternion()
            .multiplyQuaternions(yawQuat, pitchQuat)
            .multiply(rollQuat)
            .normalize(); // Ensure quaternion is normalized

        // Update orientation vectors
        this.forward.set(0, 0, 1).applyQuaternion(combinedQuat).normalize();
        this.right.set(1, 0, 0).applyQuaternion(combinedQuat).normalize();
        this.up.set(0, 1, 0).applyQuaternion(combinedQuat).normalize();

        // Validate forward vector
        if (isNaN(this.forward.x) || isNaN(this.forward.y) || isNaN(this.forward.z)) {
            console.error('Invalid forward vector:', this.forward);
            this.forward.set(0, 0, 1);
        }

        // Compute velocity
        this.currentSpeed = isNaN(this.currentSpeed) ? this.minSpeed : Math.max(this.minSpeed * 0.5, this.currentSpeed);
        this.velocity.copy(this.forward).multiplyScalar(this.currentSpeed);

        const liftFactor = Math.max(0, this.currentSpeed / this.maxSpeed);
        const gravity = new THREE.Vector3(0, -9.81 * (1 - liftFactor * 0.8), 0);
        // this.velocity.add(gravity); // Uncomment if needed

        // Update physics velocity
        if (this.rigidBody) {
            this.rigidBody.setRotation(combinedQuat, true);
            this.rigidBody.setLinvel({
                x: isNaN(this.velocity.x) ? 0 : this.velocity.x,
                y: isNaN(this.velocity.y) ? 0 : this.velocity.y,
                z: isNaN(this.velocity.z) ? 0 : this.velocity.z
            }, true);

            // Update position
            const pos = this.rigidBody.translation();
            const rot = this.rigidBody.rotation();
            if (pos && !isNaN(pos.x) && !isNaN(pos.y) && !isNaN(pos.z)) {
                this.parent.transform.position.set(pos.x, pos.y, pos.z);
                this.parent.transform.quaternion.set(rot.x, rot.y, rot.z, rot.w);
            } 
        }
    }

    updateCameraPosition() {
        if(this.isRemote) return;
        
        const dt = Math.min(this.game.deltaTime, 0.033);
        const smoothingAlpha = this.cameraSmoothing * dt * 60;

        if (this.isFirstPerson) {
            // Use interpolated position for smooth camera
            const cockpitOffset = new THREE.Vector3(0, 2, 5).applyQuaternion(this.parent.transform.quaternion);
            const cockpitPos = this.parent.transform.position.clone().add(cockpitOffset);
            this.camera.position.copy(cockpitPos);
            this.camera.quaternion.copy(this.parent.transform.quaternion);
        } else {
            // Use interpolated transforms for third-person camera
            const offset = new THREE.Vector3(
                this.cameraOffset.x,
                this.cameraOffset.y,
                this.cameraOffset.z
            ).applyQuaternion(this.parent.transform.quaternion);
            
            const targetPosition = this.parent.transform.position.clone().add(offset.multiplyScalar(Math.max(1, this.currentSpeed / 1000)));
            console.log(offset.multiplyScalar(2));
            this.camera.position.copy(targetPosition);
            
            const lookAtPos = this.parent.transform.position.clone();
            this.cameraLookAt.copy(lookAtPos);
            this.camera.lookAt(this.cameraLookAt);
        }
    }

    update() {
        if ((!this.controls.isLocked || this.isRemote) && !this.game.isServer) return;
        
        const dt = Math.min(this.game.deltaTime, 0.1);

        // Process inputs
        // **ALWAYS interpolate physics for smooth rendering**
       // this.interpolatePhysics();

        if(!this.isRemote){            
            // Update camera with interpolated positions
            this.updateCameraPosition();
        }

        // Update model animations
        if(this.modelRenderer){
            // if (Math.abs(this.inputThrottle) > 0.1) {
            //     this.modelRenderer.setAnimation('boost');
            // } else if (this.currentSpeed > this.maxSpeed * 0.7) {
            //     this.modelRenderer.setAnimation('cruise');
            // } else {
            //     this.modelRenderer.setAnimation('idle');
            // }
            
            //this.modelRenderer.setAnimation('idle');
        }

        if(!this.game.isServer && !this.game.isSinglePlayer) return;

        this.processInputs(dt);
        // Update flight dynamics and physics (this happens less frequently)
        this.updateFlightDynamics(dt);
        this.updateTransform();

        // Debug velocity visualization
        if (this.debug.showVelocity) {
            if (this.debug.velocityHelper) {
                this.scene.remove(this.debug.velocityHelper);
            }
            const velocityDir = this.velocity.clone().normalize();
            const velocityLength = this.velocity.length() * 0.1;
            const arrowHelper = new THREE.ArrowHelper(
                velocityDir, 
                this.parent.transform.position, // Use interpolated position
                velocityLength, 
                0x00ff00
            );
            this.scene.add(arrowHelper);
            this.debug.velocityHelper = arrowHelper;
        }
    }

    onDestroy() {
        if(!this.isRemote) {
            document.removeEventListener('keydown', this.onKeyDown);
            document.removeEventListener('keyup', this.onKeyUp);
            document.removeEventListener('mousemove', this.onMouseMove);
        }

        if (this.rapierWorld && this.collider) {
            this.rapierWorld.removeCollider(this.collider);
        }
        if (this.rapierWorld && this.rigidBody) {
            this.rapierWorld.removeRigidBody(this.rigidBody);
        }

        if (this.debug.velocityHelper && this.scene.children.includes(this.debug.velocityHelper)) {
            this.scene.remove(this.debug.velocityHelper);
        }
    }
}