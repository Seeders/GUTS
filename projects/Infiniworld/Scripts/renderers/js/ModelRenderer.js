class ModelRenderer extends engine.Component {
    init({ objectType, spawnType, frameDuration }) {
        if(!this.game.config.configs.game.is3D) {
            return;
        }
        this.animationState = 'idle';
        this.currentFrameIndex = 0;
        this.frameTime = 0;
        this.frameDuration = frameDuration || 0.17;
        this.lastDirection = -1;
        this.blendDuration = 0.5; // Duration for blending between animations (in seconds)
        this.currentBlendTime = 0; // Current time in the blending process
        this.previousAnimationState = null; // Store the previous animation state for blending
        
        // Load animation and model data
        this.animationData = this.game.config[objectType]?.[spawnType]?.render?.animations;
        this.modelData = this.game.config[objectType]?.[spawnType]?.render?.model;
        this.isGLTF = this.modelData[Object.keys(this.modelData)[0]].shapes[0].type == "gltf";
        this.clock = new THREE.Clock();
        this.clock.start(); 
        
        // Get the model
        this.model = this.game.modelManager.getModel(objectType, spawnType);
        this.skeletonUtils = THREE_.SkeletonUtils; // Use updated THREE.SkeletonUtils if available
        
        // Animation mixer and clips for GLTF models
        this.mixer = null;
        this.animations = {};
        this.activeActions = {}; // Track currently active animation actions
        
        // Create the initial model instance
        if(this.isGLTF){
            // Clone the model once for GLTF
            this.modelGroup = this.skeletonUtils.clone(this.model);
            
            // Create animation mixer
            this.mixer = new THREE.AnimationMixer(this.modelGroup);
            
            // Load all available animations for the model
            Object.keys(this.animationData).forEach(animName => {
                const clip = this.game.modelManager.getAnimation(objectType, spawnType, animName);
                if (clip) {
                    // Store the clip
                    this.animations[animName] = clip;
                    
                    // Create an action for this animation
                    const action = this.mixer.clipAction(clip);
                    action.clampWhenFinished = true;
                    action.weight = 0; // Initialize with weight 0 (not active)
                    this.activeActions[animName] = action;
                }
            });
        } else {
            this.modelGroup = this.skeletonUtils.clone(this.model);              
        }

        // Add the model group to the scene
        this.game.scene.add(this.modelGroup);
        this.modelGroup.position.set(0, -10000, 0);
        
        // Set initial animation
        this.setAnimation('idle');
    }
    
    setAnimation(animationName) {
        if (!this.animationData[animationName]) {
            console.warn(`Animation '${animationName}' not found, defaulting to 'idle'`);
            animationName = 'idle';
            
            if (!this.animationData[animationName]) {
                const availableAnims = Object.keys(this.animationData);
                animationName = availableAnims.length > 0 ? availableAnims[0] : null;
                
                if (!animationName) {
                    console.error('No animations available for this model');
                    return;
                }
            }
        }    

        // Don't do anything if we're already in this animation state
        if (this.animationState === animationName) {
            return;
        }
        
        // Store the previous animation state for blending
        this.previousAnimationState = this.animationState;
        this.animationState = animationName;
        
        if(this.isGLTF) {
            // Reset blend timer
            this.currentBlendTime = 0;
            
            // For GLTF models, use the animation mixer for blending
            if (this.activeActions[this.previousAnimationState] && this.activeActions[animationName]) {
                const prevAction = this.activeActions[this.previousAnimationState];
                const nextAction = this.activeActions[animationName];
                
                // Enable both animations during the transition
                nextAction.reset();
                nextAction.play();
                nextAction.crossFadeFrom(prevAction, this.blendDuration, true);
            } else if (this.activeActions[animationName]) {
                // Just start the new animation if there's no previous action
                const action = this.activeActions[animationName];
                action.reset();
                action.play();
                action.setEffectiveWeight(1);
            }
        } else {
            // For non-GLTF models, reset frame counters
            this.currentFrameIndex = 0;
            this.frameTime = 0;
            this.updateModelFrame();
        }
    }
    
    draw() {
        if(!this.game.config.configs.game.is3D) {
            return;
        }
        
        const delta = this.clock ? this.clock.getDelta() : 0;
        
        // Handle animation blending for GLTF models
        if (this.isGLTF && this.mixer) {
            // Update the animation mixer
            this.mixer.update(delta);
            
            // Update blending if in transition
            if (this.previousAnimationState && this.currentBlendTime < this.blendDuration) {
                this.currentBlendTime += delta;
                
                // Calculate blend factor (0 to 1)
                const blendFactor = Math.min(this.currentBlendTime / this.blendDuration, 1);
                
                // When blending is complete, finalize the transition
                if (blendFactor >= 1) {
                    this.previousAnimationState = null;
                }
            }
        } else {
            // For custom animations, update as before
            this.frameTime += this.game.deltaTime;
            if (this.frameTime >= this.frameDuration) {
                this.frameTime -= this.frameDuration;
                this.advanceFrame();
            }
            
            // Also update any skinned meshes
            this.modelGroup.traverse(object => {
                if (object.userData.mixer) {
                    object.userData.mixer.update(delta);
                }
                if (object.isSkinnedMesh) {
                    object.skeleton.update();
                }
            });
        }
        
        // Update position of model to match entity position
        if (this.parent && this.parent.transform.position) {
            this.modelGroup.position.set(
                this.parent.transform.position.x,
                this.parent.transform.position.y,
                this.parent.transform.position.z
            );
            
            // Handle rotation based on movement direction
            this.updateDirection();
        }
    }
    
    updateDirection() {
        // Calculate direction based on movement
        if (this.parent && this.parent.transform.lastPosition) {
            const dx = this.parent.transform.position.x - this.parent.transform.lastPosition.x;
            const dz = this.parent.transform.position.z - this.parent.transform.lastPosition.z;
            this.modelGroup.quaternion.copy(this.parent.transform.quaternion);

            // Only update direction if there's significant movement
            const isMoving = Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001;
            
            // Set animation based on movement state
            if (isMoving) {
                if (this.animationData['walk']) {
                    this.setAnimation('walk');
                }
            } else {
                // Entity is stationary, use idle animation
                this.setAnimation('idle');
            }
        }
    }
    
    advanceFrame() {
        const frames = this.animationData[this.animationState];
        if (!frames || frames.length === 0) return;
        
        this.currentFrameIndex = (this.currentFrameIndex + 1) % frames.length;
        this.updateModelFrame();
    }
    
    updateModelFrame() {
        // Get current animation and frame
        const frames = this.animationData[this.animationState];
        if (!frames?.length) return;
        
        const frameData = frames[this.currentFrameIndex] || {};
        
        // Traverse the modelGroup to apply transformations
        this.modelGroup.traverse((obj) => {
            // Handle group-level transformations (apply to group objects)
            if (!obj.isMesh && obj.name && this.modelData[obj.name]) {
                const groupName = obj.name;
                const groupData = frameData[groupName];
                const modelGroupData = this.modelData[groupName];
                this.updateObjectTransforms(obj, groupData, modelGroupData);
            }
            
            // Handle shape-level transformations (apply to meshes)
            if (obj.isMesh && obj.userData?.index >= 0 && obj.parent?.name) {
                const groupName = obj.parent.name;
                const index = obj.userData.index;
                const groupData = frameData[groupName];
                const modelGroupData = this.modelData[groupName];
                // Find shape in animationData by id (id: 1 maps to index 0)
                let shape;
                if (groupData?.shapes) {
                    shape = groupData.shapes.find(s => s.id === index);
                }
                const modelShape = modelGroupData?.shapes?.[index];
                
                if (shape || modelShape) {
                    this.updateShapeTransforms(obj, shape, modelShape);
                }
            }
        });
    }
    
    updateObjectTransforms(obj, groupData, modelGroupData) {
        if (!modelGroupData) return;
        
        // Position
        const pos = groupData?.position || modelGroupData.position || { x: 0, y: 0, z: 0 };
        obj.position.set(
            pos.x ?? modelGroupData.position?.x ?? 0,
            pos.y ?? modelGroupData.position?.y ?? 0,
            pos.z ?? modelGroupData.position?.z ?? 0
        );
        
        // Rotation
        const rot = groupData?.rotation || modelGroupData.rotation || { x: 0, y: 0, z: 0 };
        obj.rotation.set(
            rot.x ?? modelGroupData.rotation?.x ?? 0,
            rot.y ?? modelGroupData.rotation?.y ?? 0,
            rot.z ?? modelGroupData.rotation?.z ?? 0
        );
        
        // Scale
        const scale = groupData?.scale || modelGroupData.scale || { x: 1, y: 1, z: 1 };
        obj.scale.set(
            scale.x ?? modelGroupData.scale?.x ?? 1,
            scale.y ?? modelGroupData.scale?.y ?? 1,
            scale.z ?? modelGroupData.scale?.z ?? 1
        );
    }

    updateShapeTransforms(obj, shape, modelShape) {
        if (!modelShape) return;

        // Position (local to group)
        obj.position.set(
            shape?.x ?? modelShape.x ?? 0,
            shape?.y ?? modelShape.y ?? 0,
            shape?.z ?? modelShape.z ?? 0
        );
        
        // Rotation (local to group, convert degrees to radians)
        obj.rotation.set(
            ((shape?.rotationX ?? modelShape.rotationX) || 0) * Math.PI / 180,
            ((shape?.rotationY ?? modelShape.rotationY) || 0) * Math.PI / 180,
            ((shape?.rotationZ ?? modelShape.rotationZ) || 0) * Math.PI / 180
        );
        
        // Scale (local to group)
        obj.scale.set(
            shape?.scaleX ?? modelShape.scaleX ?? 1,
            shape?.scaleY ?? modelShape.scaleY ?? 1,
            shape?.scaleZ ?? modelShape.scaleZ ?? 1
        );
    }
    
    destroy() {
        if(this.modelGroup){
            // Stop all animations
            if (this.mixer) {
                this.mixer.stopAllAction();
                this.mixer = null;
            }
            
            // Clear all action references
            this.activeActions = {};
            
            // Remove model from scene
            if (this.modelGroup && this.game.scene) {
                this.game.scene.remove(this.modelGroup);
            }
            
            // Clear all children
            while (this.modelGroup.children.length > 0) {
                const child = this.modelGroup.children[0];
                this.modelGroup.remove(child);
            }
            
            this.modelGroup = null;
        }
    }
}