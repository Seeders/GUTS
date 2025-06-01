class ModelRenderer extends engine.Component {
    async init({ objectType, spawnType, frameDuration }) {
        if (!this.game.getCollections().configs.game.is3D) {
            return;
        }
        this.objectType = objectType;
        this.spawnType = spawnType;
        this.animationState = 'idle';
        this.currentFrameIndex = 0;
        this.frameTime = 0;
        this.frameDuration = frameDuration || 0.17;
        this.lastDirection = -1;
        this.currentAnimationTime = 0;
        
        this.fadeTime = 0.3;
        this.minAnimationTime = 0;//this.fadeTime * 2;
        // Load animation and model data
        this.animationData = this.game.getCollections()[objectType]?.[spawnType]?.render?.animations;
        this.modelData = this.game.getCollections()[objectType]?.[spawnType]?.render?.model;
        this.isGLTF = this.modelData[Object.keys(this.modelData)[0]].shapes[0].type === "gltf";
        this.clock = new THREE.Clock();
        this.clock.start();

        // Get the model
        this.model = await this.game.modelManager.getModel(objectType, spawnType);
        this.skeletonUtils = THREE_.SkeletonUtils;
        this.throwTimer = -1;
        this.leapTimer = -1;
        this.leapTime = 1;
        this.throwTime = 2;
        // Clone the model once
        this.modelGroup = !this.isGLTF ? this.skeletonUtils.clone(this.model) : this.model;
        this.game.scene.add(this.modelGroup);
        this.modelGroup.position.set(0, -10000, 0);
        this.isRunning = false;
        // Initialize AnimationMixer and actions if GLTF
        if (this.isGLTF) {
            await this.setupAnimationMixer();
        }
        this.jump();
    }

    setFrustumCulled(culled){
        this.frustumCulled = culled;      
        if(this.modelGroup){
            this.modelGroup.frustumCulled = this.frustumCulled;
        }
    }

    async setupAnimationMixer() {
        this.modelGroup.frustumCulled = this.frustumCulled;
        // Find the mixer and animations from userData
        let mixer, animations;
        this.modelGroup.traverse(object => {
            if (object.userData.mixer) {
                mixer = object.userData.mixer;
                animations = object.userData.animations;
            }
        });

        this.mixer = mixer;
        this.animationActions = {};

        // Create AnimationActions for each animation - wait for all to load
        const animationNames = Object.keys(this.animationData);
        const animationPromises = animationNames.map(async (name) => {
            const animModel = await this.game.modelManager.getAnimation(this.objectType, this.spawnType, name);
            
            if (!animModel) return;
            
            let animModelAnimations, animAction;
            animModel.traverse(object => {
                if (object.userData.mixer) {
                    animModelAnimations = object.userData.animations;
                    animAction = object.userData.action;
                }
            });
            
            if (animModelAnimations?.length > 0) {
                const clip = animModelAnimations[0];
                if (clip) {
                    const action = this.mixer.clipAction(clip);
                    action.setLoop(THREE.LoopRepeat);
                    action.enabled = true; 
                    this.animationActions[name] = action;
                }
            }
        });

        // Wait for all animations to load
        await Promise.all(animationPromises);
        
        // Store the current action
        this.currentAction = null;
    }

    setAnimation(animationName, speed = 1, minAnimationTime = 0) {
     
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

        if (this.animationState !== animationName && 
            (this.currentAnimationTime >= this.minAnimationTime)) {
            this.animationState = animationName;
            this.currentAnimationTime = 0;
            this.minAnimationTime = minAnimationTime;
            if (this.isGLTF && this.mixer) {
                const newAction = this.animationActions[animationName];
                if (!newAction) {
                    console.error(`No AnimationAction for ${animationName}`, this.animationActions);
                    return;
                }
                if(newAction != this.currentAction){
                    this.crossfadeTo(newAction, speed);
                    this.currentAction.setEffectiveTimeScale(speed);
                } else {
                    this.currentAction.play();
                }


            } else {
                this.currentFrameIndex = 0;
                this.frameTime = 0;
                this.updateModelFrame();
            }
        }
    }

    crossfadeTo(newAction, speed) {
        if(!newAction) return;
        const previousAction = this.currentAction;
        this.currentAction = newAction;
        if (previousAction && previousAction !== newAction) {
          //  previousAction.setEffectiveWeight(1);

           // newAction.setEffectiveWeight(1);

           // previousAction.play();
            newAction.play();            
            previousAction.stop();
        } else {
            newAction.enabled = true;
            newAction.play();
        }
    }

    draw() {
        if(!this.modelGroup) return;
        if (!this.game.getCollections().configs.game.is3D) {
            return;
        }

        let dt = this.clock.getDelta();
        this.currentAnimationTime += dt;
        // Update AnimationMixer for GLTF models
        if (this.isGLTF && this.mixer) {
            this.mixer.update(dt);
        }

        this.updateDirection();
        if (this.throwTimer >= 0) {
            this.throwTimer += dt;
            if (this.throwTimer > this.throwTime) {
                this.throwTimer = -1;
            } else if (this.animationState !== 'throw') {
                this.setAnimation('throw', this.throwSpeed);
            }
        }

        if (this.leapTimer >= 0) {
            this.leapTimer += dt;
            if (this.leapTimer > this.leapTime) {
                this.leapTimer = -1;
            } else if (this.animationState !== 'leap') {
                this.setAnimation('leap', this.leapSpeed);
            }
        }
        // Update skeleton for skinned meshes
        this.modelGroup.traverse(object => {
            if (object.isSkinnedMesh && object.skeleton) {
                object.skeleton.update();
            }
        });
        // Update frame-based animations for non-GLTF models
        if (!this.isGLTF) {
            this.frameTime += dt;
            const effectiveFrameDuration = this.frameDuration; // Scale frame duration
            if (this.frameTime >= effectiveFrameDuration) {
                this.frameTime -= effectiveFrameDuration;
                this.advanceFrame();
            }
        }
        this.modelGroup.scale.set(
            this.parent.transform.scale.x,
            this.parent.transform.scale.y,
            this.parent.transform.scale.z
        );
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

    jump(speed = 1) {
        if(this.leapTimer > 0) {
            return;
        }
        if(this.animationActions && this.animationActions['leap']) {
            this.leapSpeed = speed;
            this.leapTimer = 0;
            this.leapTime = (this.animationActions['leap'].getClip().duration / speed);; // Scale leap time inversely with speed        
            this.setAnimation('leap', speed,  this.leapTime);
        }
    }
    throw(speed = 1) {        
        if(this.throwTimer > 0){
            return;
        }
        if(this.animationActions && this.animationActions['throw']){
                
            this.throwSpeed = speed;
            this.throwTimer = 0;
            this.throwTime = (this.animationActions['throw'].getClip().duration / speed);            
            this.setAnimation('throw', speed, this.throwTime);
        }
    
    }
    updateDirection() {
        if (this.parent && this.parent.transform.lastPosition) {
            this.modelGroup.quaternion.copy(this.parent.transform.quaternion);
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
        if (this.modelGroup) {
            // Stop and clean up all animation actions
            if (this.mixer) {
                Object.values(this.animationActions).forEach(action => {
                    action.stop();
                });
                this.mixer.uncacheRoot(this.modelGroup);
                this.mixer = null;
            }

            // Remove model from scene
            if (this.game.scene) {
                this.game.scene.remove(this.modelGroup);
            }

            // Dispose of geometries and materials
            this.modelGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });

            // Clear children
            while (this.modelGroup.children.length > 0) {
                this.modelGroup.remove(this.modelGroup.children[0]);
            }

            this.modelGroup = null;
        }
    }
}