class PlayerController extends engine.Component {
    init({
        walkSpeed = 100, // Adjusted for Rapier (meters/second)
        runSpeed = 200,
        jumpForce = 350, // Adjusted for Rapier (meters/second)
        gravity = 981, // Standard gravity (m/s²)
        mouseSensitivity = 0.002,
        characterHeight = 18,
        characterRadius = 3,
        cameraHeight = 16,
        cameraSmoothing = 0.2,
        isRemote = false
    }) {
        let gameComponent = this.game.gameEntity.getComponent('game');
        
        this.modelRenderer = this.parent.getComponent('ModelRenderer');
        this.world = gameComponent.world;
        this.physics = gameComponent.physics;
        this.scene = this.world.scene;
        this.camera = this.game.camera;

        // Movement parameters
        this.walkSpeed = walkSpeed;
        this.runSpeed = runSpeed;
        this.jumpForce = jumpForce;
        this.gravity = gravity;
        this.mouseSensitivity = mouseSensitivity;
        this.cameraSmoothing = cameraSmoothing;

        // Character dimensions
        this.characterHeight = characterHeight;
        this.characterRadius = characterRadius;
        this.cameraHeight = cameraHeight;


        // Initialize movement state
        this.velocity = new THREE.Vector3(); // For tracking vertical velocity (e.g., jumping, gravity)
        this.isGrounded = false;
        this.jumpRequested = false;
        this.isRunning = false;

        // Camera properties
        this.isFirstPerson = false; // Default to first-person
        this.thirdPersonDistance = 50;
        this.thirdPersonHeight = 25;
        this.cameraTargetPosition = new THREE.Vector3();
        this.cameraLookAt = new THREE.Vector3();
        this.cameraPitch = 0;
        this.cameraYaw = 0;

        // Local axes
        this.forward = new THREE.Vector3(0, 0, 1);
        this.up = new THREE.Vector3(0, 1, 0);
        this.right = new THREE.Vector3(1, 0, 0);

        // Movement inputs
        this.moveForward = 0;
        this.moveRight = 0;

        //this is just a ghost instance of a remote player
        this.isRemote = isRemote;
        // Input state
        this.keys = {
            KeyW: false,
            KeyS: false,
            KeyA: false,
            KeyD: false,
            ShiftLeft: false,
            Space: false
        };
        this.lastKeys = {...this.keys};
        // Pointer lock controls
        this.controls = { isLocked: false };


        if(!this.isRemote) { 
            document.addEventListener('click', () => {            
                if (!this.controls.isLocked) {
                    this.world.renderer.domElement.requestPointerLock();
                }
            });
            document.addEventListener('pointerlockchange', () => {
                this.controls.isLocked = document.pointerLockElement === this.world.renderer.domElement;
            });
        // Bind event handlers
            this.onKeyDown = this.onKeyDown.bind(this);
            this.onKeyUp = this.onKeyUp.bind(this);
            this.onMouseMove = this.onMouseMove.bind(this);
            document.addEventListener('keydown', this.onKeyDown);
            document.addEventListener('keyup', this.onKeyUp);
            document.addEventListener('mousemove', this.onMouseMove);
        }
        // Debug helpers
        this.debug = {
            showRaycasts: false,
            raycastHelpers: []
        };
    }
    getNetworkData(){     
        let data = {
            keys: this.keys,
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
        
        if(JSON.stringify(this.lastKeys) != JSON.stringify(this.keys)){
            console.log('get', data);
        }   
        this.lastKeys = {...this.keys};
        return data;       
    }
    
    setNetworkData(data){

        if(this.game.isServer){
    
            if(data.keys){
                if(JSON.stringify(data.keys) != JSON.stringify(this.keys)){
                    console.log('set', data);
                }
                this.keys = data.keys;
                this.forward.set(data.direction.forward.x, data.direction.forward.y, data.direction.forward.z);
                this.right.set(data.direction.right.x, data.direction.right.y, data.direction.right.z);
                this.up.set(data.direction.up.x, data.direction.up.y, data.direction.up.z);
            }
        }
    }

    setupPhysics(simulation) {
        
        // Initialize Rapier physics
        this.rapierWorld = simulation; // Assume InfiniWorld initializes a Rapier World
        this.characterController = this.rapierWorld.createCharacterController(0.01); // Offset of 0.01m
        this.setupCharacterController();

        // Create player rigid-body and collider
        this.setupPlayerBody();
    }

    setupCharacterController() {
        // Configure Rapier character controller
        this.characterController.enableAutostep(0.3, 0.2, true); // Auto-step for stairs/obstacles
        this.characterController.enableSnapToGround(0.5); // Stick to ground when going downhill
        this.characterController.setMaxSlopeClimbAngle(45 * Math.PI / 180); // Max 45° climb
        this.characterController.setMinSlopeSlideAngle(30 * Math.PI / 180); // Slide on steep slopes
        this.characterController.setApplyImpulsesToDynamicBodies(true); // Push dynamic objects
        this.characterController.setUp({ x: 0, y: 1, z: 0 }); // Up vector is +Y
    }

    setupPlayerBody() {
        // Create a kinematic position-based rigid-body
        let rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(0, 50, 0); // Start above ground
        this.rigidBody = this.rapierWorld.createRigidBody(rigidBodyDesc);

        // Create a capsule collider for the player
        let colliderDesc = RAPIER.ColliderDesc.capsule(
            this.characterHeight / 2 - this.characterRadius, // Half-height (excluding caps)
            this.characterRadius
        )
            .setTranslation(0, this.characterHeight / 2, 0) // Center capsule vertically
            .setCollisionGroups(0x0001) // Optional: set collision groups
            .setSolverGroups(0x0001); // Optional: set solver groups
        this.collider = this.rapierWorld.createCollider(colliderDesc, this.rigidBody);

        // Store collision radius for camera calculations
        this.parent.collisionRadius = this.characterRadius;

        const pos = this.parent.transform.position;
        this.rigidBody.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    }


    onKeyDown(event) {
            if(this.isRemote) {
            return;
        }
        if (event.code in this.keys) {
            this.keys[event.code] = true;
            if (event.code === 'Space' && !event.repeat && this.isGrounded) {
                this.jumpRequested = true;
                this.parent.getComponent("modelRenderer").jump(500 / this.jumpForce);
            }
        }
        if (event.code === 'KeyV') {
            this.isFirstPerson = !this.isFirstPerson;
            if (!this.isFirstPerson) {
                const offset = new THREE.Vector3(0, this.thirdPersonHeight, this.thirdPersonDistance)
                    .applyQuaternion(this.parent.transform.quaternion);
                this.cameraTargetPosition.copy(this.parent.transform.position).add(offset);
                this.cameraLookAt.copy(this.parent.transform.position);
            }
        }
        if (event.code === 'KeyB') {
            this.debug.showRaycasts = !this.debug.showRaycasts;
            if (!this.debug.showRaycasts) {
                this.debug.raycastHelpers.forEach(helper => {
                    if (helper && this.scene.children.includes(helper)) {
                        this.scene.remove(helper);
                    }
                });
                this.debug.raycastHelpers = [];
            }
        }
    }

    onKeyUp(event) {
            if(this.isRemote) {
            return;
        }
        if (event.code in this.keys) {
            this.keys[event.code] = false;
        }
    }

    onMouseMove(event) {
            if(this.isRemote) {
            return;
        }
        if (this.controls.isLocked) {
            this.cameraYaw -= event.movementX * this.mouseSensitivity;
            this.cameraPitch += event.movementY * this.mouseSensitivity;
            this.cameraPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.cameraPitch));
            this.parent.transform.quaternion.setFromEuler(new THREE.Euler(0, this.cameraYaw, 0));
        }
    }

    updateAxes() {
        const rotation = new THREE.Euler(0, this.cameraYaw, 0, 'YXZ');
        const quaternion = new THREE.Quaternion().setFromEuler(rotation);
        this.forward.set(0, 0, 1).applyQuaternion(quaternion).normalize();
        this.forward.y = 0;
        this.forward.normalize();
        this.right.set(-1, 0, 0).applyQuaternion(quaternion).normalize();
        this.right.y = 0;
        this.right.normalize();
        this.up.set(0, 1, 0);
    }

    updateCameraPosition() {
        if(this.isRemote) {
            return;
        }
        const dt = Math.min(this.game.deltaTime, 0.033);
        const smoothingAlpha = this.cameraSmoothing * dt * 60;

        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.cameraPitch);
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraYaw);
        const combinedQuat = new THREE.Quaternion().multiplyQuaternions(yawQuat, pitchQuat);

        if (this.isFirstPerson) {
            const eyePosition = this.parent.transform.position.clone().add(new THREE.Vector3(0, this.cameraHeight, 0));
            const forwardDir = new THREE.Vector3(0, 0, 1).applyQuaternion(combinedQuat);
            const forwardOffset = 0.2; // Small offset to avoid clipping
            eyePosition.add(forwardDir.multiplyScalar(forwardOffset));
            this.camera.position.copy(eyePosition);
            const yawOffsetQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
            const invertedPitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.cameraPitch);
            const finalQuat = new THREE.Quaternion().multiplyQuaternions(yawQuat, yawOffsetQuat).multiply(invertedPitchQuat);
            this.camera.quaternion.copy(finalQuat);
        } else {
            const forwardDir = new THREE.Vector3(0, 0, 1).applyQuaternion(combinedQuat);
            const offsetDistance = this.thirdPersonDistance;
            const offsetHeight = this.thirdPersonHeight;
            const targetPosition = this.parent.transform.position.clone()
                .add(new THREE.Vector3(0, offsetHeight, 0))
                .sub(forwardDir.clone().multiplyScalar(offsetDistance));
            this.camera.position.lerp(targetPosition, smoothingAlpha);
            const lookAtPos = this.parent.transform.position.clone().add(new THREE.Vector3(0, this.cameraHeight, 0));
            this.cameraLookAt.lerp(lookAtPos, smoothingAlpha);
            this.camera.lookAt(this.cameraLookAt);
        }
    }

    update() {
        if ((!this.controls.isLocked || this.isRemote) && !this.game.isServer) return;
        const dt = Math.min(this.game.deltaTime, 0.1);

        if(!this.isRemote){            
            // Update camera
            this.updateCameraPosition();  
            this.updateAxes();     
        }

        if(this.modelRenderer){
            this.isRunning = this.keys.ShiftLeft;
            let moveForward = 0;
            let moveRight = 0;
            if (this.keys.KeyW) moveForward += 1;
            if (this.keys.KeyS) moveForward -= 1;
            if (this.keys.KeyA) moveRight -= 1;
            if (this.keys.KeyD) moveRight += 1;

            if(moveForward != 0 || moveRight != 0) {
                if(this.isRunning){
                    this.modelRenderer.setAnimation('run');
                } else {
                    this.modelRenderer.setAnimation('walk');
                }
            } else {
                this.modelRenderer.setAnimation('idle');
            }
        }

        if(!this.game.isServer && !this.game.isSinglePlayer) return;
        // Check if grounded

        this.isGrounded = this.characterController.computedGrounded();
        // Process inputs
        if(this.isGrounded){
            // Update local axes
            this.moveForward = 0;
            this.moveRight = 0;
            if (this.keys.KeyW) this.moveForward += 1;
            if (this.keys.KeyS) this.moveForward -= 1;
            if (this.keys.KeyA) this.moveRight -= 1;
            if (this.keys.KeyD) this.moveRight += 1;

        }

        // Compute desired movement
        const speed = this.isRunning ? this.runSpeed : this.walkSpeed;
        const moveDir = new THREE.Vector3();
        if (this.moveForward !== 0) moveDir.add(this.forward.clone().multiplyScalar(this.moveForward));
        if (this.moveRight !== 0) moveDir.add(this.right.clone().multiplyScalar(this.moveRight));
        moveDir.normalize();

        // Apply gravity and jumping
        this.velocity.y -= this.gravity * dt;
        if (this.jumpRequested && this.isGrounded) {
            this.velocity.y = this.jumpForce;
            this.jumpRequested = false;
            this.isGrounded = false;
        }

        // Compute desired translation
        const desiredTranslation = {
            x: moveDir.x * speed * dt,
            y: this.velocity.y * dt,
            z: moveDir.z * speed * dt
        };

        // Use Rapier character controller to compute corrected movement
        this.characterController.computeColliderMovement(this.collider, desiredTranslation);


        // Apply corrected movement
        const correctedMovement = this.characterController.computedMovement();
        const currentPos = this.rigidBody.translation();
        const newPos = {
            x: currentPos.x + correctedMovement.x,
            y: currentPos.y + correctedMovement.y,
            z: currentPos.z + correctedMovement.z
        };
        this.rigidBody.setNextKinematicTranslation(newPos);

        const pos = this.rigidBody.translation();
        const smoothingFactor = 0.5;
        this.parent.transform.position.lerp(
            new THREE.Vector3(pos.x, pos.y, pos.z),
            Math.min(1, this.game.deltaTime * 60 * smoothingFactor)
        );

        // // Handle collision events (e.g., for sound effects or pushing objects)
        // for (let i = 0; i < this.characterController.numComputedCollisions(); i++) {
        //     const collision = this.characterController.computedCollision(i);
        //     // Example: Log collision or trigger effects
        // }

        // Reset vertical velocity if grounded
        if (this.isGrounded) {
            this.velocity.y = 0;
        }

        // Clean up debug visuals
        if (this.debug.showRaycasts) {
            this.debug.raycastHelpers.forEach(helper => {
                if (helper && this.scene.children.includes(helper)) {
                    this.scene.remove(helper);
                }
            });
            this.debug.raycastHelpers = [];
        }
    }

    onDestroy() {
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        document.removeEventListener('mousemove', this.onMouseMove);

        // Clean up Rapier objects
        this.rapierWorld.removeCollider(this.collider);
        this.rapierWorld.removeRigidBody(this.rigidBody);
        this.rapierWorld.removeCharacterController(this.characterController);

        // Clean up debug helpers
        this.debug.raycastHelpers.forEach(helper => {
            if (helper && this.scene.children.includes(helper)) {
                this.scene.remove(helper);
            }
        });
    }
}