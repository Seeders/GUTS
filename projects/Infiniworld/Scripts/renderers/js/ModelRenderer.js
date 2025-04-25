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
        
        // Load animation and model data
        this.animationData = this.game.config[objectType]?.[spawnType]?.render?.animations;
        this.modelData = this.game.config[objectType]?.[spawnType]?.render?.model;
        this.clock = new THREE.Clock();
        this.clock.start(); 
        // Get the model
        this.model = this.game.modelManager.getModel(objectType, spawnType);

        if (!this.model || !this.animationData || !this.modelData) {
            console.error(`No model or data found for ${objectType}_${spawnType}`);
            return;
        }
        
        // Create the initial model instance
        if(spawnType == "knightWalk"){
            this.modelGroup = this.model;
        } else {
            this.modelGroup = this.game.skeletonUtils.clone(this.model);  
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
        
        if (this.animationState !== animationName) {
            this.animationState = animationName;
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
        
        // Update all mixers with the same delta
        this.modelGroup.traverse(object => {
            if (object.userData.mixer) {
                object.userData.mixer.update(delta);
            }
            if (object.isSkinnedMesh) {
                object.skeleton.update();
            }
        });
        // Update animation frames
        this.frameTime += this.game.deltaTime;
        if (this.frameTime >= this.frameDuration) {
            this.frameTime -= this.frameDuration;
            this.advanceFrame();
        }
        // Update position of model to match entity position
        if (this.parent && this.parent.position) {
            this.modelGroup.position.set(
                this.parent.position.x,
                this.parent.position.y,
                this.parent.position.z
            );
            
            // Handle rotation based on movement direction
            this.updateDirection();
        }
        
   
    }
    
    updateDirection() {
        // Calculate direction based on movement
        if (this.parent && this.parent.lastPosition) {
            const dx = this.parent.position.x - this.parent.lastPosition.x;
            const dy = this.parent.position.z - this.parent.lastPosition.z;
            this.modelGroup.quaternion.copy(this.parent.quaternion);

            // Only update direction if there's significant movement
            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
    
                // Set walking animation when moving
                if (this.animationData['walk']) {
                    this.setAnimation('walk');
                    return;
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