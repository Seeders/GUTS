class PlayerController extends engine.Component {
    init({
        walkSpeed = 50,
        runSpeed = 100,
        jumpForce = 200,
        gravity = 980,
        mouseSensitivity = 0.02,
        characterHeight = 1.8,
        cameraHeight = 20,
        stepHeight = 0.3,
        cameraSmoothing = 0.2
    }) {
        this.infiniWorld = this.game.gameEntity.getComponent("InfiniWorld");
        this.scene = this.infiniWorld.scene;
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
        this.cameraHeight = cameraHeight;
        this.stepHeight = stepHeight;
        
        // Initialize character position and rotation
        this.parent.transform.position.y = 50; // Start above ground level to let gravity place the character
        
        this.controls = { isLocked: false };

        // Add these event listeners:
        document.addEventListener('click', () => {
            if (!this.controls.isLocked) {
                this.infiniWorld.renderer.domElement.requestPointerLock();
            }
        });
        
        document.addEventListener('pointerlockchange', () => {
            this.controls.isLocked = document.pointerLockElement === this.infiniWorld.renderer.domElement;
        });
        // Movement state
        this.velocity = new THREE.Vector3();
        this.isGrounded = false;
        this.isJumping = false;
        this.isRunning = false;
        // Add a flag to track if jump was requested and can be executed
        this.jumpRequested = false;
        this.canJump = true;
        this.collisions = {
            down: false,
            forward: false,
            backward: false,
            left: false,
            right: false
        };
        
        // Camera properties
        this.isFirstPerson = false;
        this.thirdPersonDistance = 25;
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
        this.moveUp = 0;
        
        // Input state
        this.keys = {
            KeyW: false,
            KeyS: false,
            KeyA: false,
            KeyD: false,
            ShiftLeft: false,
            Space: false
        };
        
        // Bind event handlers
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
        document.addEventListener('mousemove', this.onMouseMove);
        
        // Debug helpers
        this.debug = {
            showRaycasts: false,
            raycastHelpers: []
        };
        
        // Initialize camera
        this.updateCameraPosition();
    }
    
    onKeyDown(event) {
        if (event.code in this.keys) {
            this.keys[event.code] = true;
            
            // Set jump request only when first pressed (not held)
            if (event.code === 'Space' && !event.repeat && this.isGrounded && this.canJump) {
                this.jumpRequested = true;
            }
        }
        
        // Toggle camera view
        if (event.code === 'KeyV') {
            this.isFirstPerson = !this.isFirstPerson;
            // When switching to third person, position the camera smoothly
            if (!this.isFirstPerson) {
                const offset = new THREE.Vector3(0, this.thirdPersonHeight, this.thirdPersonDistance)
                    .applyQuaternion(this.parent.transform.quaternion);
                this.cameraTargetPosition.copy(this.parent.transform.position).add(offset);
                this.cameraLookAt.copy(this.parent.transform.position);
            }
        }
        
        // Toggle debug visualization
        if (event.code === 'KeyB') {
            this.debug.showRaycasts = !this.debug.showRaycasts;
            // Clear existing helpers when toggled off
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
        if (event.code in this.keys) {
            this.keys[event.code] = false;
            
            // Reset canJump when space is released
            if (event.code === 'Space') {
                this.canJump = true;
            }
        }
    }
    
    onMouseMove(event) {
        if (this.controls.isLocked) {
            // Adjust sensitivity to a more reasonable value
            const sensitivity = 0.002;
            
            // Update rotation angles based on mouse movement
            this.cameraYaw -= event.movementX * sensitivity;
            this.cameraPitch += event.movementY * sensitivity;
            
            // Clamp pitch to prevent camera flipping
            this.cameraPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.cameraPitch));
            
            // Set parent rotation from yaw (character rotates horizontally with camera)
            this.parent.transform.quaternion.setFromEuler(new THREE.Euler(0, this.cameraYaw, 0));

            // Don't update camera immediately - let updateCameraPosition handle it
        }
    }
    
    updateAxes() {
        // Update local coordinate axes
        const rotation = new THREE.Euler(0, this.cameraYaw, 0, 'YXZ');
        const quaternion = new THREE.Quaternion().setFromEuler(rotation);
        
        this.forward.set(0, 0, 1).applyQuaternion(quaternion).normalize();
        this.forward.y = 0; // Project onto XZ plane for movement
        this.forward.normalize();
        
        this.right.set(-1, 0, 0).applyQuaternion(quaternion).normalize();
        this.right.y = 0; // Project onto XZ plane for movement
        this.right.normalize();
        
        this.up.set(0, 1, 0);
    }
    
    updateCameraPosition() {
        const dt = Math.min(this.game.deltaTime, 0.033);
        const smoothingAlpha = this.cameraSmoothing * dt * 60;
        
        // Create consistent rotation quaternions
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.cameraPitch);
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraYaw);
        const combinedQuat = new THREE.Quaternion().multiplyQuaternions(yawQuat, pitchQuat);
        
        if (this.isFirstPerson) {
            // Position camera at character's eye level
            const eyePosition = this.parent.transform.position.clone().add(new THREE.Vector3(0, this.cameraHeight - 10, 0));
            
            // Apply forward offset along character's forward direction
            const forwardDir = new THREE.Vector3(0, 0, 1).applyQuaternion(combinedQuat); // Character's forward
            const forwardOffset = 5; // Adjust this value (e.g., 0.1 to 0.5) to move camera in front of head
            eyePosition.add(forwardDir.multiplyScalar(forwardOffset));
            
            this.camera.position.copy(eyePosition);
            
            // Apply camera rotation with 180-degree yaw offset and inverted pitch
            const yawOffsetQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // 180 degrees
            const invertedPitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.cameraPitch); // Invert pitch
            const finalQuat = new THREE.Quaternion().multiplyQuaternions(yawQuat, yawOffsetQuat).multiply(invertedPitchQuat);
            this.camera.quaternion.copy(finalQuat);
        } else {
            // Third person: camera behind character
            const forwardDir = new THREE.Vector3(0, 0, 1).applyQuaternion(combinedQuat);
            const upDir = new THREE.Vector3(0, 1, 0);
            
            // Calculate camera position behind the character
            const offsetDistance = this.thirdPersonDistance;
            const offsetHeight = this.thirdPersonHeight;
            const targetPosition = this.parent.transform.position.clone()
                .add(new THREE.Vector3(0, offsetHeight, 0))
                .sub(forwardDir.clone().multiplyScalar(offsetDistance));
                
            // Check for obstacles between character and camera
            const raycaster = new THREE.Raycaster();
            raycaster.set(
                this.parent.transform.position.clone().add(new THREE.Vector3(0, this.cameraHeight, 0)),
                forwardDir.clone().negate().normalize(),
                0,
                offsetDistance + this.parent.collisionRadius
            );
            
            // Smoothly move camera to target position
            this.camera.position.lerp(targetPosition, smoothingAlpha);
            
            // Look at character's head position
            const lookAtPos = this.parent.transform.position.clone().add(new THREE.Vector3(0, this.cameraHeight, 0));
            this.cameraLookAt.lerp(lookAtPos, smoothingAlpha);
            this.camera.lookAt(this.cameraLookAt);
        }
    }
    
    checkGrounded() {
        // Use raycasting to detect ground beneath the character
        const origin = this.parent.transform.position.clone().add(new THREE.Vector3(0, this.characterHeight * 0.5, 0));
        const direction = new THREE.Vector3(0, -1, 0);
        const maxDistance = this.characterHeight * 0.5 + 0.1; // Slightly more than half height
        
        // Visualization helper for debug
        if (this.debug.showRaycasts) {
            const arrowHelper = new THREE.ArrowHelper(
                direction,
                origin,
                maxDistance,
                this.isGrounded ? 0x00ff00 : 0xff0000,
                0.2,
                0.1
            );
            this.scene.add(arrowHelper);
            this.debug.raycastHelpers.push(arrowHelper);
        }
        
        // Get height from terrain
        const worldX = this.parent.transform.position.x;
        const worldZ = this.parent.transform.position.z;
        const groundHeight = this.infiniWorld.getTerrainHeight(worldX, worldZ);
        
        const characterBottom = this.parent.transform.position.y;
        const distanceToGround = characterBottom - groundHeight;
        
        // Check if we're on or near the ground
        if (distanceToGround <= 0.1) {
            this.isGrounded = true;
            this.isJumping = false;
            // Snap to ground
            this.parent.transform.position.y = groundHeight;
            return true;
        } else if (distanceToGround < maxDistance) {
            // Close to ground but not exactly on it
            this.isGrounded = false;
            return false;
        } else {
            this.isGrounded = false;
            return false;
        }
    }
    
    handleStepClimbing() {
        if (!this.isGrounded) return;
        
        // Calculate move direction in world space
        const moveDir = new THREE.Vector3();
        if (this.moveForward !== 0) moveDir.add(this.forward.clone().multiplyScalar(this.moveForward));
        if (this.moveRight !== 0) moveDir.add(this.right.clone().multiplyScalar(this.moveRight));
        
        if (moveDir.lengthSq() === 0) return; // Not moving
        moveDir.normalize();
        
        // Cast ray forward at step height to detect steps
        const origin = this.parent.transform.position.clone().add(new THREE.Vector3(0, this.stepHeight, 0));
        const maxStepDistance = this.parent.collisionRadius + 0.1;
        
        if (this.debug.showRaycasts) {
            const arrowHelper = new THREE.ArrowHelper(
                moveDir,
                origin,
                maxStepDistance,
                0x0000ff,
                0.2,
                0.1
            );
            this.scene.add(arrowHelper);
            this.debug.raycastHelpers.push(arrowHelper);
        }
        
        // Check terrain height slightly ahead in movement direction
        const stepCheckDistance = this.parent.collisionRadius + 0.2;
        const checkPoint = this.parent.transform.position.clone().add(
            moveDir.clone().multiplyScalar(stepCheckDistance)
        );
        
        const forwardHeight = this.infiniWorld.getTerrainHeight(checkPoint.x, checkPoint.z);
        const heightDifference = forwardHeight - this.parent.transform.position.y;
        
        // If there's a small step up ahead, climb it
        if (heightDifference > 0 && heightDifference <= this.stepHeight) {
            this.parent.transform.position.y = forwardHeight;
        }
    }
    
    update() {
        if (!this.controls.isLocked) return;
        const dt = Math.min(this.game.deltaTime, 0.1);
        
        // Check if we're on the ground
        this.checkGrounded();
        
        // Update local axes for movement direction
        this.updateAxes();
        
        // Process inputs
        this.moveForward = 0;
        this.moveRight = 0;
        
        if (this.keys.KeyW) this.moveForward += 1;
        if (this.keys.KeyS) this.moveForward -= 1;
        if (this.keys.KeyA) this.moveRight -= 1;
        if (this.keys.KeyD) this.moveRight += 1;
        
        // Check if running
        this.isRunning = this.keys.ShiftLeft;
        
        // Calculate velocity from input
        const speed = this.isRunning ? this.runSpeed : this.walkSpeed;
        
        // Handle jumping - only jump if explicitly requested and on ground
        if (this.isGrounded && this.jumpRequested) {
            this.velocity.y = this.jumpForce;
            this.isGrounded = false;
            this.isJumping = true;
            this.jumpRequested = false; // Reset jump request
            this.canJump = false; // Prevent repeated jumps until key is released
        }
        
        if (this.isGrounded) {
            // On ground, set vertical velocity to zero
            this.velocity.y = 0;
            
            // Check for step climbing
            this.handleStepClimbing();
            
            // Apply movement based on inputs
            const moveDir = new THREE.Vector3();
            if (this.moveForward !== 0) moveDir.add(this.forward.clone().multiplyScalar(this.moveForward));
            if (this.moveRight !== 0) moveDir.add(this.right.clone().multiplyScalar(this.moveRight));
            
            if (moveDir.lengthSq() > 0) {
                moveDir.normalize();
                this.velocity.x = moveDir.x * speed;
                this.velocity.z = moveDir.z * speed;
            } else {
                // Apply friction when not actively moving
                this.velocity.x *= 0.8;
                this.velocity.z *= 0.8;
                
                // Prevent tiny sliding
                if (Math.abs(this.velocity.x) < 0.1) this.velocity.x = 0;
                if (Math.abs(this.velocity.z) < 0.1) this.velocity.z = 0;
            }
        } else {
            // In air, apply gravity
            this.velocity.y -= this.gravity * dt;
            
            // Reduced air control
            const airControl = 0.3;
            const moveDir = new THREE.Vector3();
            if (this.moveForward !== 0) moveDir.add(this.forward.clone().multiplyScalar(this.moveForward));
            if (this.moveRight !== 0) moveDir.add(this.right.clone().multiplyScalar(this.moveRight));
            
            if (moveDir.lengthSq() > 0) {
                moveDir.normalize();
                this.velocity.x += moveDir.x * speed * airControl * dt;
                this.velocity.z += moveDir.z * speed * airControl * dt;
                
                // Cap horizontal air velocity
                const horizontalVelocity = new THREE.Vector2(this.velocity.x, this.velocity.z);
                const maxAirSpeed = speed * 0.8;
                if (horizontalVelocity.length() > maxAirSpeed) {
                    horizontalVelocity.normalize().multiplyScalar(maxAirSpeed);
                    this.velocity.x = horizontalVelocity.x;
                    this.velocity.z = horizontalVelocity.y;
                }
            }
        }
        
        // Apply velocity to position
        const movement = this.velocity.clone().multiplyScalar(dt);
        this.applyMovementWithCollisions(movement, dt);
        
        // Check terrain collision and adjust height
        if (!this.isGrounded) {
            const terrainHeight = this.infiniWorld.getTerrainHeight(this.parent.transform.position.x, this.parent.transform.position.z);
            if (this.parent.transform.position.y < terrainHeight) {
                this.parent.transform.position.y = terrainHeight;
                this.isGrounded = true;
                this.isJumping = false;
                this.velocity.y = 0;
            }
        }
        
        // Update camera
        this.updateCameraPosition();
        
        // Clean up debug visuals after each frame
        if (this.debug.showRaycasts) {
            this.debug.raycastHelpers.forEach(helper => {
                if (helper && this.scene.children.includes(helper)) {
                    this.scene.remove(helper);
                }
            });
            this.debug.raycastHelpers = [];
        }
    }

    applyMovementWithCollisions(movement, dt) {
        const currentPosition = this.parent.transform.position.clone();
        let remainingMovement = movement.clone();
        const maxSteps = 3; // Limit steps to prevent infinite loops
        let stepCount = 0;
    
        while (remainingMovement.length() > 0.001 && stepCount < maxSteps) {
            stepCount++;
            
            // Calculate new position for this step
            const stepMovement = remainingMovement.clone().multiplyScalar(1 / (maxSteps - stepCount + 1));
            const newPosition = this.parent.transform.position.clone().add(stepMovement);
            const playerAABB = this.getAABB(newPosition);
    
            // Check for tree collisions
            const collisions = this.infiniWorld.checkTreeCollisions(playerAABB);
    
            if (collisions.length === 0) {
                // No collisions, apply this step's movement
                this.parent.transform.position.copy(newPosition);
                remainingMovement.sub(stepMovement);
                continue;
            }
    
            // Handle collisions
            let resolved = false;
    
            // Try moving in X direction
            const tryX = this.parent.transform.position.clone().add(new THREE.Vector3(stepMovement.x, stepMovement.y, 0));
            const tryXAABB = this.getAABB(tryX);
            const xCollisions = this.infiniWorld.checkTreeCollisions(tryXAABB);
    
            if (xCollisions.length === 0) {
                this.parent.transform.position.copy(tryX);
                this.velocity.z = 0; // Stop Z movement
                remainingMovement.z = 0;
                resolved = true;
            } else {
                // Try moving in Z direction
                const tryZ = this.parent.transform.position.clone().add(new THREE.Vector3(0, stepMovement.y, stepMovement.z));
                const tryZAABB = this.getAABB(tryZ);
                const zCollisions = this.infiniWorld.checkTreeCollisions(tryZAABB);
    
                if (zCollisions.length === 0) {
                    this.parent.transform.position.copy(tryZ);
                    this.velocity.x = 0; // Stop X movement
                    remainingMovement.x = 0;
                    resolved = true;
                }
            }
    
            if (!resolved) {
                // No valid movement in X or Z, stop horizontal movement
                this.velocity.x = 0;
                this.velocity.z = 0;
                remainingMovement.x = 0;
                remainingMovement.z = 0;
    
                // Allow vertical movement (e.g., gravity or jumping)
                this.parent.transform.position.y += stepMovement.y;
                remainingMovement.y = 0;
            }
    
            // Push out if still colliding
            const finalAABB = this.getAABB(this.parent.transform.position);
            const finalCollisions = this.infiniWorld.checkTreeCollisions(finalAABB);
            if (finalCollisions.length > 0) {
                // Calculate push-out vector (simplified example)
                for (const treeAABB of finalCollisions) {
                    const pushOut = this.calculatePushOut(finalAABB, treeAABB);
                    this.parent.transform.position.add(pushOut);
                    this.velocity.set(0, this.velocity.y, 0); // Stop horizontal velocity
                }
            }
        }
    
        // Return true if any movement was applied
        return !this.parent.transform.position.equals(currentPosition);
    }
    
    // Helper function to calculate push-out vector
    calculatePushOut(playerAABB, treeAABB) {
        const pushOut = new THREE.Vector3();
        const overlapX = Math.min(playerAABB.max.x - treeAABB.min.x, treeAABB.max.x - playerAABB.min.x);
        const overlapZ = Math.min(playerAABB.max.z - treeAABB.min.z, treeAABB.max.z - playerAABB.min.z);
    
        if (overlapX < overlapZ) {
            // Push out in X direction
            if (playerAABB.min.x < treeAABB.min.x) {
                pushOut.x = -(overlapX + 0.001); // Small epsilon to avoid re-collision
            } else {
                pushOut.x = overlapX + 0.001;
            }
        } else {
            // Push out in Z direction
            if (playerAABB.min.z < treeAABB.min.z) {
                pushOut.z = -(overlapZ + 0.001);
            } else {
                pushOut.z = overlapZ + 0.001;
            }
        }
    
        return pushOut;
    }

    getAABB(position = this.parent.transform.position) {
        return {
            min: {
                x: position.x - this.parent.collisionRadius,
                y: position.y,
                z: position.z - this.parent.collisionRadius
            },
            max: {
                x: position.x + this.parent.collisionRadius,
                y: position.y + this.characterHeight,
                z: position.z + this.parent.collisionRadius
            }
        };
    }

    onDestroy() {
        if (this.controls) this.controls.dispose();
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        document.removeEventListener('mousemove', this.onMouseMove);
        
        // Clean up debug helpers
        this.debug.raycastHelpers.forEach(helper => {
            if (helper && this.scene.children.includes(helper)) {
                this.scene.remove(helper);
            }
        });
    }
}