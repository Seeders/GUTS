class ModelRenderer extends engine.Component {
    init({ objectType, spawnType, frameDuration }) {
        if (!this.game.config.configs.game.is3D) {
            return;
        }
        
        this.animationState = 'idle';
        this.frameDuration = frameDuration || 0.17;
        this.lastDirection = -1;
        this.crossFadeDuration = 0.3; // Duration for blending between animations
        
        // Load animation and model data
        this.objectType = objectType;
        this.spawnType = spawnType;
        this.animationData = this.game.config[objectType]?.[spawnType]?.render?.animations;
        this.modelData = this.game.config[objectType]?.[spawnType]?.render?.model;
        this.isGLTF = this.modelData[Object.keys(this.modelData)[0]].shapes[0].type == "gltf";
        
        // Animation tracking
        this.clock = new THREE.Clock();
        this.clock.start();
        this.mixer = null;
        this.activeAction = null;
        this.previousAction = null;
        this.actionMap = {};
        
        // Get the model and set up animations
        this.setupModel();
    }
    
    setupModel() {
        // Load the base model
        this.model = this.game.modelManager.getModel(this.objectType, this.spawnType);
        
        if (this.isGLTF) {
            // For GLTF models, we keep a single model instance and use the animation mixer
            this.modelGroup = this.model;
            this.game.scene.add(this.modelGroup);
            
            // Create animation mixer for this model instance
            this.mixer = new THREE.AnimationMixer(this.modelGroup);
            
            // Load all available animations into our action map
            const animationNames = Object.keys(this.animationData);
            animationNames.forEach(animName => {
                const clip = this.game.modelManager.getAnimation(this.objectType, this.spawnType, animName);
                if (clip) {
                    const action = this.mixer.clipAction(clip);
                    this.actionMap[animName] = action;
                }
            });
        } else {
            // For custom models, continue with your frame-based animation approach
            this.modelGroup = this.game.skeletonUtils.clone(this.model);
            this.game.scene.add(this.modelGroup);
            
            this.currentFrameIndex = 0;
            this.frameTime = 0;
        }
        
        // Initialize position off-screen
        this.modelGroup.position.set(0, -10000, 0);
        
        // Set initial animation
        this.setAnimation('idle');
    }
    
    setAnimation(animationName) {
        // Validate animation exists
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
        
        // Don't change if it's already the active animation
        if (this.animationState === animationName) {
            return;
        }
        
        // Handle animation transition
        if (this.isGLTF) {
            this.blendToAnimation(animationName);
        } else {
            // For non-GLTF, use the frame-based approach
            this.animationState = animationName;
            this.currentFrameIndex = 0;
            this.frameTime = 0;
            this.updateModelFrame();
        }
    }
    
    blendToAnimation(animationName) {
        // Store previous action
        this.previousAction = this.activeAction;
        
        // Get the new action
        const newAction = this.actionMap[animationName];
        if (!newAction) {
            console.error(`Animation action '${animationName}' not available`);
            return;
        }
        
        // Update state
        this.animationState = animationName;
        this.activeAction = newAction;
        
        // Configure the new action
        newAction.reset();
        newAction.setLoop(THREE.LoopRepeat);
        newAction.clampWhenFinished = false;
        
        // Cross fade from previous to new animation if previous exists
        if (this.previousAction) {
            newAction.crossFadeFrom(this.previousAction, this.crossFadeDuration, true);
        }
        
        // Play the new animation
        newAction.play();
    }
    
    draw() {
        if (!this.game.config.configs.game.is3D || !this.modelGroup) {
            return;
        }
        
        const delta = this.clock ? this.clock.getDelta() : 0;
        
        if (this.isGLTF) {
            // Update animation mixer
            if (this.mixer) {
                this.mixer.update(delta);
            }
        } else {
            // Update frame-based animations
            this.frameTime += this.game.deltaTime;
            if (this.frameTime >= this.frameDuration) {
                this.frameTime -= this.frameDuration;
                this.advanceFrame();
            }
        }
        
        // Update position to match entity position
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
            
            // Apply entity's quaternion to the model
            this.modelGroup.quaternion.copy(this.parent.transform.quaternion);
            
            // Only update direction if there's significant movement
            const isMoving = Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001;
            
            // Switch between idle and walk animations based on movement
            if (isMoving && this.animationData['walk']) {
                this.setAnimation('walk');
            } else if (!isMoving) {
                this.setAnimation('idle');
            }
        }
    }

    // For non-GLTF frame-based animation
    advanceFrame() {
        const frames = this.animationData[this.animationState];
        if (!frames || frames.length === 0) return;
        
        this.currentFrameIndex = (this.currentFrameIndex + 1) % frames.length;
        this.updateModelFrame();
    }
    
    updateModelFrame() {
        // Only used for non-GLTF animations
        if (this.isGLTF) return;
        
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
                // Find shape in animationData by id
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
        // Clean up animations
        if (this.mixer) {
            // Stop all animations
            Object.values(this.actionMap).forEach(action => {
                action.stop();
            });
            this.actionMap = {};
            this.mixer = null;
        }
        
        // Remove model from scene
        if (this.modelGroup && this.game.scene) {
            this.game.scene.remove(this.modelGroup);
            
            // Clear all children
            while (this.modelGroup.children.length > 0) {
                const child = this.modelGroup.children[0];
                this.modelGroup.remove(child);
            }
            
            this.modelGroup = null;
        }
    }
}