class AnimationSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.animationSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        this.entityAnimations = new Map();
        this.entityMixers = new Map();
        this.entityProprietaryAnimations = new Map();
        this.entityAnimationStates = new Map();
        this.clock = new THREE.Clock();

        this.MIN_MOVEMENT_THRESHOLD = 0.1;
        this.MIN_ATTACK_ANIMATION_TIME = 0.4;
        this.STATE_CHANGE_COOLDOWN = 0.1;
        
        this.SINGLE_PLAY_ANIMATIONS = new Set([
            'attack', 'combat', 'fight', 'swing', 'strike',
            'shoot', 'bow', 'aim', 'fire', // Ranged attack animations
            'cast', 'spell', 'magic', 'throw', 'leap', 'jump',
            'hurt', 'damage', 'hit', 'pain', 'death', 'die'
        ]);
    }
    
    update(deltaTime) {
        if (!this.game.scene || !this.game.camera || !this.game.renderer) {
            return;
        }

        this.game.deltaTime = deltaTime;
        this.updateEntityAnimations(deltaTime);
    }
    
    updateEntityAnimations(deltaTime) {
        const entities = this.game.getEntitiesWith(
            this.componentTypes.POSITION, 
            this.componentTypes.UNIT_TYPE
        );
        
        entities.forEach(entityId => {
            const velocity = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            
            this.updateEntityAnimation(entityId, velocity, health, deltaTime);
            
            const mixer = this.entityMixers.get(entityId);
            if (mixer) {
                mixer.update(deltaTime);
            }
            
            const proprietaryAnim = this.entityProprietaryAnimations?.get(entityId);
            if (proprietaryAnim) {
                this.updateProprietaryAnimation(entityId, proprietaryAnim, deltaTime);
            }
        });

        this.cleanupRemovedEntities(entities);
    }

    playDeathAnimation(entityId) {
        const animState = this.entityAnimationStates.get(entityId);
        const animationActions = this.entityAnimations.get(entityId);
        
        if (!animState) return;
        if (animationActions && animationActions.death) {
            this.setDeathAnimation(entityId, 'death');
        } 
    }

    setDeathAnimation(entityId, animationName) {
        const animState = this.entityAnimationStates.get(entityId);
        const animationActions = this.entityAnimations.get(entityId);
        
        if (!animState || !animationActions || !animationActions[animationName]) return;
        
        const newAction = animationActions[animationName];
        
        Object.values(animationActions).forEach(action => {
            if (action !== newAction) {
                action.stop();
                action.setEffectiveWeight(0);
                action.enabled = false;
            }
        });
        
        newAction.enabled = true;
        newAction.setLoop(THREE.LoopOnce);
        newAction.setEffectiveTimeScale(1);
        newAction.setEffectiveWeight(1);
        newAction.clampWhenFinished = true;
        newAction.play();
        
        animState.currentAnimation = animationName;
        animState.currentAction = newAction;
        animState.animationTime = 0;
        animState.isDying = true;
    }

    setCorpseAnimation(entityId) {
        const animState = this.entityAnimationStates.get(entityId);
        if (animState && animState.currentAction) {
            animState.currentAction.paused = true;
            animState.isDying = false;
            animState.isCorpse = true;
        }
    }

    async setupEntityAnimations(entityId, objectType, spawnType, modelGroup) {
        const unitDefinition = this.getUnitDefinition(spawnType);
        const animationData = unitDefinition?.render?.animations;
        const modelData = unitDefinition?.render?.model;
        
        if (!animationData || !modelData) {
            return;
        }
        
        const firstGroupName = Object.keys(modelData)[0];
        const firstShape = modelData[firstGroupName]?.shapes?.[0];
        const isGLTF = firstShape?.type === "gltf";
        
        if (isGLTF) {
            await this.setupGLTFAnimations(entityId, objectType, spawnType, modelGroup, animationData);
        } else {
            this.setupProprietaryAnimations(entityId, objectType, spawnType, modelGroup, animationData, modelData);
        }
        
        this.entityAnimationStates.set(entityId, {
            currentAnimation: 'idle',
            animationTime: 0,
            minAnimationTime: 0,
            currentAction: null
        });
    }
    
    async setupGLTFAnimations(entityId, objectType, spawnType, modelGroup, animationData) {
        let mixer, animations;
        modelGroup.traverse(object => {
            if (object.userData.mixer) {
                mixer = object.userData.mixer;
                animations = object.userData.animations;
            }
        });
        
        if (!mixer) {
            modelGroup.traverse(object => {
                if (object.animations && object.animations.length > 0) {
                    mixer = new THREE.AnimationMixer(object);
                    animations = object.animations;
                }
            });
        }
        
        if (mixer && animations && animations.length > 0) {
            this.entityMixers.set(entityId, mixer);
            
            const animationActions = {};
            
            for (const animName of Object.keys(animationData)) {
                const animDataArray = animationData[animName];
                
                if (Array.isArray(animDataArray) && animDataArray.length > 1) {
                    for (let i = 0; i < animDataArray.length; i++) {
                        try {
                            const animModel = await this.game.modelManager.getAnimation(objectType, spawnType, animName, i);
                            if (animModel) {
                                let animModelAnimations;
                                animModel.traverse(object => {
                                    if (object.userData.animations) {
                                        animModelAnimations = object.userData.animations;
                                    } else if (object.animations && object.animations.length > 0) {
                                        animModelAnimations = object.animations;
                                    }
                                });
                                
                                if (animModelAnimations?.length > 0) {
                                    const clip = animModelAnimations[0];
                                    const action = mixer.clipAction(clip);
                                    
                                    if (this.SINGLE_PLAY_ANIMATIONS.has(animName.toLowerCase())) {
                                        action.setLoop(THREE.LoopOnce);
                                        action.clampWhenFinished = true;
                                    } else {
                                        action.setLoop(THREE.LoopRepeat);
                                    }
                                    
                                    action.enabled = true;
                                    
                                    const variantKey = i === 0 ? animName : `${animName}_${i}`;
                                    animationActions[variantKey] = action;
                                }
                            } else {
                                console.warn(`No animation model returned for ${animName} variant ${i}`);
                            }
                        } catch (error) {
                            console.warn(`Failed to load ${animName} variant ${i}:`, error);
                        }
                    }
                } else {
                    try {
                        const animModel = await this.game.modelManager.getAnimation(objectType, spawnType, animName);
                        if (animModel) {
                            let animModelAnimations;
                            animModel.traverse(object => {
                                if (object.userData.animations) {
                                    animModelAnimations = object.userData.animations;
                                } else if (object.animations && object.animations.length > 0) {
                                    animModelAnimations = object.animations;
                                }
                            });
                            
                            if (animModelAnimations?.length > 0) {
                                const clip = animModelAnimations[0];
                                const action = mixer.clipAction(clip);
                                
                                if (this.SINGLE_PLAY_ANIMATIONS.has(animName.toLowerCase())) {
                                    action.setLoop(THREE.LoopOnce);
                                    action.clampWhenFinished = true;
                                } else {
                                    action.setLoop(THREE.LoopRepeat);
                                }
                                
                                action.enabled = true;
                                animationActions[animName] = action;
                            }
                        }
                    } catch (error) {
                        // Animation not found, continue
                    }
                }
            }
            
            this.entityAnimations.set(entityId, animationActions);
          
            if (animationActions.idle) {
                animationActions.idle.play();
                const animState = this.entityAnimationStates.get(entityId);
                if (animState) {
                    animState.currentAction = animationActions.idle;
                }
            }
        } 
    }

    setupProprietaryAnimations(entityId, objectType, spawnType, modelGroup, animationData, modelData) {
        const animationInfo = {
            animationData: animationData,
            modelData: modelData,
            currentFrameIndex: 0,
            frameTime: 0,
            frameDuration: 0.17,
            animationState: 'idle'
        };
        
        this.entityProprietaryAnimations.set(entityId, animationInfo);
        this.setProprietaryAnimation(entityId, 'idle');
    }
    
    triggerSinglePlayAnimation(entityId, animationName, speed = 1, minAnimationTime = 0) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;
        
        animState.pendingAnimation = animationName;
        animState.pendingAnimationSpeed = speed;
        animState.pendingAnimationMinTime = minAnimationTime;
        animState.animationTriggered = true;
    }
    
    isAnimationFinished(entityId, animationName) {
        const animState = this.entityAnimationStates.get(entityId);
        const animationActions = this.entityAnimations.get(entityId);
        
        if (!animState || !animationActions) return true;
        
        const action = animationActions[animationName];
        if (!action) return true;
        
        const isSinglePlay = this.SINGLE_PLAY_ANIMATIONS.has(animationName.toLowerCase());
        if (!isSinglePlay) return false;
        
        return action.time >= action.getClip().duration || !action.isRunning();
    }
    
    updateEntityAnimation(entityId, velocity, health, deltaTime) {
        const animState = this.entityAnimationStates.get(entityId);
        
        if (!animState) return;
        
        if (animState.isDying || animState.isCorpse) {
            const mixer = this.entityMixers.get(entityId);
            if (mixer) {
                mixer.update(deltaTime);
            }
            return;
        }
        
        if (animState.isCelebrating) {
            return;
        }
        
        animState.animationTime += deltaTime;
        
        if (animState.animationTriggered && animState.pendingAnimation) {
            const pendingAnim = animState.pendingAnimation;
            const pendingSpeed = animState.pendingAnimationSpeed || 1;
            const pendingMinTime = animState.pendingAnimationMinTime || 0;
            
            animState.pendingAnimation = null;
            animState.animationTriggered = false;
            animState.pendingAnimationSpeed = null;
            animState.pendingAnimationMinTime = null;
            
            this.setEntityAnimation(entityId, pendingAnim, pendingSpeed, pendingMinTime);
            return;
        }
        
        const combat = this.game.getComponent(entityId, this.componentTypes.COMBAT);
        const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
        
        const currentAnimIsFinished = this.isAnimationFinished(entityId, animState.currentAnimation);
        
        let desiredAnimation = 'idle';
        let animationSpeed = 1;
        let minAnimationTime = 0;
        
        if (aiState) {
            if (aiState.state === 'attacking' || aiState.state === 'combat') {
                if (currentAnimIsFinished && !this.SINGLE_PLAY_ANIMATIONS.has(animState.currentAnimation.toLowerCase())) {
                    desiredAnimation = 'idle';
                } else {
                    desiredAnimation = animState.currentAnimation;
                }
            } else if (aiState.state === 'waiting') {
                // Units waiting for cooldowns - always show idle
                desiredAnimation = 'idle';
            } else if (aiState.state === 'chasing' || aiState.state === 'moving') {
                desiredAnimation = 'walk';
                if (velocity && (Math.abs(velocity.vx) > 0.1 || Math.abs(velocity.vz) > 0.1)) {
                    const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vz * velocity.vz);
                    animationSpeed = Math.min(speed / 30, 2);
                }
            }
        }
        
        if (desiredAnimation === 'idle' && velocity && (Math.abs(velocity.vx) > 0.1 || Math.abs(velocity.vz) > 0.1)) {
            desiredAnimation = 'walk';
            const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vz * velocity.vz);
            animationSpeed = Math.min(speed / 30, 2);
        }
        
        if (health && health.current < health.max * 0.3 && desiredAnimation === 'idle') {
            desiredAnimation = 'hurt';
        }
        
        const shouldChangeAnimation = animState.currentAnimation !== desiredAnimation && 
                                     (currentAnimIsFinished || 
                                      !this.SINGLE_PLAY_ANIMATIONS.has(animState.currentAnimation.toLowerCase()) ||
                                      animState.animationTime >= Math.max(animState.minAnimationTime, 0.1));
        
        if (shouldChangeAnimation) {
            const hasGLTFAnimations = this.entityAnimations.has(entityId);
            const hasProprietaryAnimations = this.entityProprietaryAnimations?.has(entityId);
            
            if (hasGLTFAnimations) {
                this.setEntityAnimation(entityId, desiredAnimation, animationSpeed, minAnimationTime);
            } else if (hasProprietaryAnimations) {
                this.setProprietaryAnimation(entityId, desiredAnimation);
                const proprietaryAnim = this.entityProprietaryAnimations.get(entityId);
                if (proprietaryAnim && desiredAnimation === 'attack' && combat && combat.attackSpeed) {
                    const attackInterval = 1 / combat.attackSpeed;
                    const frames = proprietaryAnim.animationData[desiredAnimation];
                    if (frames && frames.length > 0) {
                        proprietaryAnim.frameDuration = (attackInterval * 0.9) / frames.length;
                        proprietaryAnim.frameDuration = Math.max(0.05, Math.min(proprietaryAnim.frameDuration, 0.3));
                    }
                }
                
                animState.currentAnimation = desiredAnimation;
                animState.animationTime = 0;
                animState.minAnimationTime = minAnimationTime;
            }
        }
        
        if (animState.currentAnimation === desiredAnimation && animState.currentAction && 
            !this.SINGLE_PLAY_ANIMATIONS.has(animState.currentAnimation.toLowerCase())) {
            const currentSpeed = animState.currentAction.getEffectiveTimeScale();
            if (Math.abs(currentSpeed - animationSpeed) > 0.1) {
                animState.currentAction.setEffectiveTimeScale(animationSpeed);
            }
        }
    }
    
    setEntityAnimation(entityId, animationName, speed = 1, minAnimationTime = 0) {
        const animState = this.entityAnimationStates.get(entityId);
        const animationActions = this.entityAnimations.get(entityId);
        
        if (!animState || !animationActions) return;
        
        if (!animationActions[animationName]) {
            const fallbacks = {
                'attack': ['combat', 'fight', 'swing', 'strike'],
                'shoot': ['bow', 'cast', 'throw', 'attack'], // Ranged attack fallbacks
                'bow': ['shoot', 'cast', 'throw', 'attack'],
                'cast': ['shoot', 'throw', 'attack'],
                'walk': ['run', 'move', 'step'],
                'hurt': ['damage', 'hit', 'pain'],
                'idle': ['stand', 'rest', 'default']
            };
            
            let foundFallback = false;
            if (fallbacks[animationName]) {
                for (const fallback of fallbacks[animationName]) {
                    if (animationActions[fallback]) {
                        animationName = fallback;
                        foundFallback = true;
                        break;
                    }
                }
            }
            
            if (!foundFallback) {
                animationName = 'idle';
                if (!animationActions[animationName]) {
                    const availableAnims = Object.keys(animationActions);
                    animationName = availableAnims.length > 0 ? availableAnims[0] : null;
                    if (!animationName) return;
                }
            }
        }
        
        const newAction = animationActions[animationName];
        if (!newAction) return;
        
        const isSinglePlay = this.SINGLE_PLAY_ANIMATIONS.has(animationName.toLowerCase()) ||
                           this.SINGLE_PLAY_ANIMATIONS.has('shoot') && ['shoot', 'bow', 'cast', 'throw'].includes(animationName.toLowerCase());
        
        if (isSinglePlay && animState.currentAnimation === animationName && 
            animState.currentAction === newAction && newAction.isRunning() && 
            !newAction.paused && newAction.time < newAction.getClip().duration) {
            return;
        }
        
        if (isSinglePlay) {
            newAction.reset();
            newAction.setLoop(THREE.LoopOnce);
            newAction.clampWhenFinished = true;
        }
        
        animState.currentAnimation = animationName;
        animState.animationTime = 0;
        animState.minAnimationTime = minAnimationTime;
        
        if (animState.currentAction && animState.currentAction !== newAction) {
            const oldAction = animState.currentAction;
            
            if (isSinglePlay) {
                oldAction.stop();
                oldAction.setEffectiveWeight(0);
                oldAction.enabled = false;
            } else {
                oldAction.enabled = true;
                oldAction.setEffectiveWeight(1);
                if (!oldAction.isRunning()) {
                    oldAction.play();
                }
            }
            
            newAction.enabled = true;
            newAction.setEffectiveTimeScale(speed);
            
            if (isSinglePlay) {
                newAction.setEffectiveWeight(1);
                newAction.play();
                
                Object.values(animationActions).forEach(action => {
                    if (action !== newAction) {
                        action.stop();
                        action.setEffectiveWeight(0);
                        action.enabled = false;
                    }
                });
            } else {
                newAction.setEffectiveWeight(0);
                if (!newAction.isRunning()) {
                    newAction.play();
                }
                
                Object.values(animationActions).forEach(action => {
                    if (action !== newAction && action !== oldAction) {
                        action.stop();
                        action.setEffectiveWeight(0);
                        action.enabled = false;
                    }
                });
                
                this.performManualCrossfade(oldAction, newAction, 0.1);
            }
            
        } else {
            if (animState.currentAction && !isSinglePlay) {
                newAction.setEffectiveTimeScale(speed);
                return;
            }
            
            Object.values(animationActions).forEach(action => {
                if (action !== newAction) {
                    action.stop();
                    action.setEffectiveWeight(0);
                    action.enabled = false;
                }
            });
            
            newAction.enabled = true;
            newAction.setEffectiveTimeScale(speed);
            newAction.setEffectiveWeight(1);
            newAction.play();
        }
        
        animState.currentAction = newAction;
    }
    
    performManualCrossfade(fromAction, toAction, duration) {
        const steps = 10;
        const stepDuration = (duration * 1000) / steps;
        let currentStep = 0;
        
        const interval = setInterval(() => {
            currentStep++;
            const progress = currentStep / steps;
            
            const fromWeight = 1 - progress;
            const toWeight = progress;
            
            fromAction.setEffectiveWeight(fromWeight);
            toAction.setEffectiveWeight(toWeight);
            
            if (currentStep >= steps) {
                clearInterval(interval);
                fromAction.stop();
                fromAction.setEffectiveWeight(0);
                fromAction.enabled = false;
                toAction.setEffectiveWeight(1);
            }
        }, stepDuration);
    }
    
    setProprietaryAnimation(entityId, animationName) {
        const proprietaryAnim = this.entityProprietaryAnimations?.get(entityId);
        if (!proprietaryAnim) return;
        
        if (proprietaryAnim.animationData[animationName]) {
            proprietaryAnim.animationState = animationName;
            proprietaryAnim.currentFrameIndex = 0;
            proprietaryAnim.frameTime = 0;
            
            this.applyProprietaryFrame(entityId, proprietaryAnim);
        }
    }
    
    updateProprietaryAnimation(entityId, proprietaryAnim, deltaTime) {
        const frames = proprietaryAnim.animationData[proprietaryAnim.animationState];
        if (!frames || frames.length === 0) return;
        
        proprietaryAnim.frameTime += deltaTime;
        
        if (proprietaryAnim.frameTime >= proprietaryAnim.frameDuration) {
            proprietaryAnim.frameTime -= proprietaryAnim.frameDuration;
            proprietaryAnim.currentFrameIndex = (proprietaryAnim.currentFrameIndex + 1) % frames.length;
            
            this.applyProprietaryFrame(entityId, proprietaryAnim);
        }
    }
    
    applyProprietaryFrame(entityId, proprietaryAnim) {
        const modelGroup = this.game.renderSystem?.entityModels?.get(entityId);
        if (!modelGroup) return;
        
        const frames = proprietaryAnim.animationData[proprietaryAnim.animationState];
        const frameData = frames[proprietaryAnim.currentFrameIndex] || {};
        
        modelGroup.traverse((obj) => {
            if (!obj.isMesh && obj.name && proprietaryAnim.modelData[obj.name]) {
                const groupName = obj.name;
                const groupData = frameData[groupName];
                const modelGroupData = proprietaryAnim.modelData[groupName];
                this.updateObjectTransforms(obj, groupData, modelGroupData);
            }
            
            if (obj.isMesh && obj.userData?.index >= 0 && obj.parent?.name) {
                const groupName = obj.parent.name;
                const index = obj.userData.index;
                const groupData = frameData[groupName];
                const modelGroupData = proprietaryAnim.modelData[groupName];
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
        
        const pos = groupData?.position || modelGroupData.position || { x: 0, y: 0, z: 0 };
        obj.position.set(
            pos.x ?? modelGroupData.position?.x ?? 0,
            pos.y ?? modelGroupData.position?.y ?? 0,
            pos.z ?? modelGroupData.position?.z ?? 0
        );
        
        const rot = groupData?.rotation || modelGroupData.rotation || { x: 0, y: 0, z: 0 };
        obj.rotation.set(
            rot.x ?? modelGroupData.rotation?.x ?? 0,
            rot.y ?? modelGroupData.rotation?.y ?? 0,
            rot.z ?? modelGroupData.rotation?.z ?? 0
        );
        
        const scale = groupData?.scale || modelGroupData.scale || { x: 1, y: 1, z: 1 };
        obj.scale.set(
            scale.x ?? modelGroupData.scale?.x ?? 1,
            scale.y ?? modelGroupData.scale?.y ?? 1,
            scale.z ?? modelGroupData.scale?.z ?? 1
        );
    }
    
    updateShapeTransforms(obj, shape, modelShape) {
        if (!modelShape) return;
        
        obj.position.set(
            shape?.x ?? modelShape.x ?? 0,
            shape?.y ?? modelShape.y ?? 0,
            shape?.z ?? modelShape.z ?? 0
        );
        
        obj.rotation.set(
            ((shape?.rotationX ?? modelShape.rotationX) || 0) * Math.PI / 180,
            ((shape?.rotationY ?? modelShape.rotationY) || 0) * Math.PI / 180,
            ((shape?.rotationZ ?? modelShape.rotationZ) || 0) * Math.PI / 180
        );
        
        obj.scale.set(
            shape?.scaleX ?? modelShape.scaleX ?? 1,
            shape?.scaleY ?? modelShape.scaleY ?? 1,
            shape?.scaleZ ?? modelShape.scaleZ ?? 1
        );
    }
    
    startCelebration(entityId, teamType = null) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;
        
        animState.isCelebrating = true;
        
        const hasGLTFAnimations = this.entityAnimations.has(entityId);
        const hasProprietaryAnimations = this.entityProprietaryAnimations?.has(entityId);
        
        if (hasGLTFAnimations) {
            this.setCelebrationAnimation(entityId, teamType);
        } else if (hasProprietaryAnimations) {
            this.setProprietaryAnimation(entityId, 'celebrate');
        }
    }
    
    setCelebrationAnimation(entityId, teamType = null) {
        const animState = this.entityAnimationStates.get(entityId);
        const animationActions = this.entityAnimations.get(entityId);
        
        if (!animState || !animationActions) return;
        
        let celebrationAnimName = null;
        
        if (teamType) {
            const variantKey = teamType === 'player' ? 'celebrate' : 'celebrate_1';
            if (animationActions[variantKey]) {
                celebrationAnimName = variantKey;
            }
        }
        
        if (!celebrationAnimName) {
            const celebrationNames = ['celebrate', 'celebrate_1', 'victory', 'cheer', 'dance', 'happy', 'win'];
            for (const name of celebrationNames) {
                if (animationActions[name]) {
                    celebrationAnimName = name;
                    break;
                }
            }
        }
        
        if (!celebrationAnimName) {
            celebrationAnimName = 'idle';
            if (!animationActions[celebrationAnimName]) {
                const availableAnims = Object.keys(animationActions);
                celebrationAnimName = availableAnims.length > 0 ? availableAnims[0] : null;
            }
        }
        
        if (!celebrationAnimName || !animationActions[celebrationAnimName]) return;
        
        const mixer = this.entityMixers.get(entityId);
        if (!mixer) return;
        
        Object.values(animationActions).forEach(action => {
            action.stop();
            action.setEffectiveWeight(0);
            action.enabled = false;
        });
        
        const originalAction = animationActions[celebrationAnimName];
        const clip = originalAction.getClip();
        
        const newAction = mixer.clipAction(clip);
        
        const celebrationSpeed = 1.0;
        
        newAction.enabled = true;
        newAction.setLoop(THREE.LoopRepeat);
        newAction.reset();
        newAction.setEffectiveTimeScale(celebrationSpeed);
        newAction.setEffectiveWeight(1.0);
        
        const randomStartTime = Math.random() * clip.duration;
        newAction.time = randomStartTime;
        newAction.play();
        
        animationActions[celebrationAnimName] = newAction;
        
        animState.currentAnimation = celebrationAnimName;
        animState.currentAction = newAction;
        animState.animationTime = 0;
    }
    
    stopCelebration(entityId) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState) return;
        
        animState.isCelebrating = false;
        
        const hasGLTFAnimations = this.entityAnimations.has(entityId);
        const hasProprietaryAnimations = this.entityProprietaryAnimations?.has(entityId);
        
        if (hasGLTFAnimations) {
            this.setEntityAnimation(entityId, 'idle');
        } else if (hasProprietaryAnimations) {
            this.setProprietaryAnimation(entityId, 'idle');
        }
    }
    
    entityJump(entityId, speed = 1) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState || animState.currentAnimation === 'leap') return;
        
        const animationActions = this.entityAnimations.get(entityId);
        if (animationActions && animationActions.leap) {
            const leapTime = animationActions.leap.getClip().duration / speed;
            this.setEntityAnimation(entityId, 'leap', speed, leapTime);
        }
    }
    
    entityThrow(entityId, speed = 1) {
        const animState = this.entityAnimationStates.get(entityId);
        if (!animState || animState.currentAnimation === 'throw') return;
        
        const animationActions = this.entityAnimations.get(entityId);
        if (animationActions && animationActions.throw) {
            const throwTime = animationActions.throw.getClip().duration / speed;
            this.setEntityAnimation(entityId, 'throw', speed, throwTime * 0.5);
        }
    }
    
    stopAllAnimations(entityId) {
        const animationActions = this.entityAnimations.get(entityId);
        if (!animationActions) return;
        
        Object.values(animationActions).forEach(action => {
            action.stop();
            action.setEffectiveWeight(0);
            action.enabled = false;
        });
    }
    
    getUnitDefinition(unitType) {
        const collections = this.game.getCollections && this.game.getCollections();
        if (collections && collections.units && collections.units[unitType]) {
            return collections.units[unitType];
        }
        
        return {
            render: {
                spawnType: unitType,
                frameDuration: 0.17,
                animations: {
                    idle: [],
                    walk: [],
                    attack: [],
                    hurt: []
                }
            }
        };
    }
    
    cleanupRemovedEntities(currentEntities) {
        const currentEntitySet = new Set(currentEntities);
        
        for (const [entityId] of this.entityAnimationStates.entries()) {
            if (!currentEntitySet.has(entityId)) {
                this.removeEntityAnimations(entityId);
            }
        }
    }
    
    removeEntityAnimations(entityId) {
        const mixer = this.entityMixers.get(entityId);
        if (mixer) {
            const animationActions = this.entityAnimations.get(entityId);
            if (animationActions) {
                Object.values(animationActions).forEach(action => action.stop());
            }
            
            const modelGroup = this.game.renderSystem?.entityModels?.get(entityId);
            if (modelGroup) {
                mixer.uncacheRoot(modelGroup);
            }
        }
        
        if (this.game.combatAISystems && this.game.combatAISystems.cleanupPendingEventsForEntity) {
            this.game.combatAISystems.cleanupPendingEventsForEntity(entityId);
        }
        
        this.entityAnimations.delete(entityId);
        this.entityMixers.delete(entityId);
        this.entityAnimationStates.delete(entityId);
        this.entityProprietaryAnimations?.delete(entityId);
    }
    
    destroy() {
        for (const [entityId] of this.entityAnimationStates.entries()) {
            this.removeEntityAnimations(entityId);
        }
        
        this.entityAnimations.clear();
        this.entityMixers.clear();
        this.entityAnimationStates.clear();
        this.entityProprietaryAnimations?.clear();
    }
}