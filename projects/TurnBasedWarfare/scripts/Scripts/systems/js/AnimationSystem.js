class AnimationSystem {
    constructor(game) {
        this.game = game;
        this.game.animationSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Track entities with animations
        this.entityAnimations = new Map(); // For GLTF animations
        this.entityMixers = new Map(); // For GLTF mixers
        this.entityProprietaryAnimations = new Map(); // For proprietary frame-based animations
        
        // Animation state tracking
        this.entityAnimationStates = new Map();
        this.clock = new THREE.Clock();

        // Configuration for facing direction
        this.MIN_MOVEMENT_THRESHOLD = 0.1;
        
        // Animation coordination
        this.MIN_ATTACK_ANIMATION_TIME = 0.4; // Minimum time to play attack animation
        this.STATE_CHANGE_COOLDOWN = 0.1; // Prevent rapid state changes
    }
    
    update(deltaTime) {
        // Only update if we have access to Three.js scene from WorldRenderSystem
        if (!this.game.scene || !this.game.camera || !this.game.renderer) {
            return;
        }

        this.game.deltaTime = deltaTime;
        
        // Update animations for all entities with models
        this.updateEntityAnimations(deltaTime);
    }
    
    updateEntityAnimations(deltaTime) {
        // Get entities that should have animations
        const entities = this.game.getEntitiesWith(
            this.componentTypes.POSITION, 
            this.componentTypes.UNIT_TYPE
        );
        
        entities.forEach(entityId => {
            const velocity = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            
            // Update animations and mixers
            this.updateEntityAnimation(entityId, velocity, health, deltaTime);
            
            // Update animation mixer if it exists (GLTF)
            const mixer = this.entityMixers.get(entityId);
            if (mixer) {
                mixer.update(deltaTime);
            }
            
            // Update proprietary frame-based animations
            const proprietaryAnim = this.entityProprietaryAnimations?.get(entityId);
            if (proprietaryAnim) {
                this.updateProprietaryAnimation(entityId, proprietaryAnim, deltaTime);
            }
        });

        // Clean up removed entities
        this.cleanupRemovedEntities(entities);
    }
    playDeathAnimation(entityId) {
        const animState = this.entityAnimationStates.get(entityId);
        const animationActions = this.entityAnimations.get(entityId);
        
        if (!animState) return;
        // Force death animation regardless of current state
        if (animationActions && animationActions.death) {
            this.setDeathAnimation(entityId, 'death');
        } 
    }

    setDeathAnimation(entityId, animationName) {
        const animState = this.entityAnimationStates.get(entityId);
        const animationActions = this.entityAnimations.get(entityId);
        
        if (!animState || !animationActions || !animationActions[animationName]) return;
        
        const newAction = animationActions[animationName];
        
        // Stop all other animations
        Object.values(animationActions).forEach(action => {
            if (action !== newAction) {
                action.stop();
                action.setEffectiveWeight(0);
                action.enabled = false;
            }
        });
        
        // Set up death animation (do not loop)
        newAction.enabled = true;
        newAction.setLoop(THREE.LoopOnce); // Play only once
        newAction.setEffectiveTimeScale(1);
        newAction.setEffectiveWeight(1);
        newAction.clampWhenFinished = true; // Stay at last frame when finished
        newAction.play();
        
        // Update animation state
        animState.currentAnimation = animationName;
        animState.currentAction = newAction;
        animState.animationTime = 0;
        animState.isDying = true;
        
        console.log(`Playing death animation '${animationName}' for entity ${entityId}`);
    }

    setCorpseAnimation(entityId) {
        // Keep the last frame of death animation or set to a corpse pose
        const animState = this.entityAnimationStates.get(entityId);
        if (animState && animState.currentAction) {
            // Ensure animation stays at final frame
            animState.currentAction.paused = true;
            animState.isDying = false;
            animState.isCorpse = true;
        }
    }
    async setupEntityAnimations(entityId, objectType, spawnType, modelGroup) {
        // Get unit definition to check animation type
        const unitDefinition = this.getUnitDefinition(spawnType);
        const animationData = unitDefinition?.render?.animations;
        const modelData = unitDefinition?.render?.model;
        
        if (!animationData || !modelData) {
            return;
        }
        
        // Determine if this is GLTF or proprietary animation system
        const firstGroupName = Object.keys(modelData)[0];
        const firstShape = modelData[firstGroupName]?.shapes?.[0];
        const isGLTF = firstShape?.type === "gltf";
        
        if (isGLTF) {
            // Handle GLTF animations
            await this.setupGLTFAnimations(entityId, objectType, spawnType, modelGroup, animationData);
        } else {
            // Handle proprietary frame-based animations
            this.setupProprietaryAnimations(entityId, objectType, spawnType, modelGroup, animationData, modelData);
        }
        
        // Initialize animation state
        this.entityAnimationStates.set(entityId, {
            currentAnimation: 'idle',
            animationTime: 0,
            minAnimationTime: 0,
            currentAction: null
        });
    }
    
    async setupGLTFAnimations(entityId, objectType, spawnType, modelGroup, animationData) {
        // Check if this is a GLTF model with animations
        let mixer, animations;
        modelGroup.traverse(object => {
            if (object.userData.mixer) {
                mixer = object.userData.mixer;
                animations = object.userData.animations;
            }
        });
        
        // If no mixer found, check for raw animation clips
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
            
            // Create animation actions for each animation type
            for (const animName of Object.keys(animationData)) {
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
                            action.setLoop(THREE.LoopRepeat);
                            action.enabled = true;
                            animationActions[animName] = action;
                        }
                    }
                } catch (error) {
                    // Animation not found, continue
                }
            }
            
            this.entityAnimations.set(entityId, animationActions);
            
            // Start with idle animation
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
        // Store animation data for frame-based animation
        const animationInfo = {
            animationData: animationData,
            modelData: modelData,
            currentFrameIndex: 0,
            frameTime: 0,
            frameDuration: 0.17, // Default frame duration
            animationState: 'idle'
        };
        
        // Store in a separate map for proprietary animations
        this.entityProprietaryAnimations.set(entityId, animationInfo);
                
        // Set initial animation
        this.setProprietaryAnimation(entityId, 'idle');
    }
    
    updateEntityAnimation(entityId, velocity, health, deltaTime) {
        const animState = this.entityAnimationStates.get(entityId);
        
        if (!animState) return;
        
        // Skip animation updates for dying entities (let death animation play)
        if (animState.isDying || animState.isCorpse) {
            // Still update mixer for death animation
            const mixer = this.entityMixers.get(entityId);
            if (mixer) {
                mixer.update(deltaTime);
            }
            return;
        }
        
        animState.animationTime += deltaTime;
        
        // Get additional components to determine animation state
        const combat = this.game.getComponent(entityId, this.componentTypes.COMBAT);
        const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
        
        // Determine desired animation based on AI state and movement
        let desiredAnimation = 'idle';
        let animationSpeed = 1;
        let minAnimationTime = 0;
        
        // Check AI state first for combat animations
        if (aiState) {
            if (aiState.state === 'attacking' || aiState.state === 'combat') {
                desiredAnimation = 'attack';
                
                if (combat && combat.attackSpeed) {
                    // Calculate the actual attack interval (time between attacks)
                    const attackInterval = 1 / combat.attackSpeed;
                    
                    // Get the base duration of the attack animation
                    const animationActions = this.entityAnimations.get(entityId);
                    let baseAnimationDuration = 0.8; // Default fallback
                    
                    if (animationActions && animationActions.attack) {
                        const attackAction = animationActions.attack;
                        if (attackAction.getClip) {
                            baseAnimationDuration = attackAction.getClip().duration;
                        }
                    }
                    
                    // Calculate speed to make animation duration match attack interval
                    // We want the animation to complete slightly before the next attack
                    const targetAnimationDuration = Math.max(attackInterval * 0.9, 0.2); // 90% of attack interval, minimum 0.2s
                    animationSpeed = baseAnimationDuration / targetAnimationDuration;
                    
                    // Clamp animation speed to reasonable bounds
                    animationSpeed = Math.max(0.5, Math.min(animationSpeed, 4.0));
                    
                    // Set minimum time to slightly less than attack interval
                    minAnimationTime = Math.max(targetAnimationDuration * 0.8, 0.2);
                } else {
                    animationSpeed = 1;
                    minAnimationTime = 0.3;
                }
                
            } else if (aiState.state === 'chasing' || aiState.state === 'moving') {
                desiredAnimation = 'walk';
                // Calculate speed based on velocity if available
                if (velocity && (Math.abs(velocity.vx) > 0.1 || Math.abs(velocity.vz) > 0.1)) {
                    const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vz * velocity.vz);
                    animationSpeed = Math.min(speed / 30, 2); // Adjust speed scaling
                }
            }
        }
        
        // Fallback to velocity-based animation if no AI state
        if (desiredAnimation === 'idle' && velocity && (Math.abs(velocity.vx) > 0.1 || Math.abs(velocity.vz) > 0.1)) {
            desiredAnimation = 'walk';
            const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vz * velocity.vz);
            animationSpeed = Math.min(speed / 30, 2);
        }
        
        // Check for damaged state (low health animation)
        if (health && health.current < health.max * 0.3 && desiredAnimation === 'idle') {
            desiredAnimation = 'hurt';
        }
        
        // More conservative animation changing - respect minimum animation times
        const shouldChangeAnimation = animState.currentAnimation !== desiredAnimation && 
                                     animState.animationTime >= Math.max(animState.minAnimationTime, 0.1);
        
        // Additional check: don't interrupt attack animations too early unless switching to another attack
        if (animState.currentAnimation === 'attack' && desiredAnimation !== 'attack') {
            // For attack animations, use the calculated minimum time, not a fixed value
            const requiredAttackTime = minAnimationTime || 0.4;
            if (animState.animationTime < requiredAttackTime) {
                return; // Keep playing attack animation
            }
        }
        
        if (shouldChangeAnimation) {
            // Check if this entity uses GLTF or proprietary animations
            const hasGLTFAnimations = this.entityAnimations.has(entityId);
            const hasProprietaryAnimations = this.entityProprietaryAnimations?.has(entityId);
            
            if (hasGLTFAnimations) {
                this.setEntityAnimation(entityId, desiredAnimation, animationSpeed, minAnimationTime);
            } else if (hasProprietaryAnimations) {
                this.setProprietaryAnimation(entityId, desiredAnimation);
                // For proprietary animations, adjust frame duration based on speed
                const proprietaryAnim = this.entityProprietaryAnimations.get(entityId);
                if (proprietaryAnim && desiredAnimation === 'attack' && combat && combat.attackSpeed) {
                    const attackInterval = 1 / combat.attackSpeed;
                    const frames = proprietaryAnim.animationData[desiredAnimation];
                    if (frames && frames.length > 0) {
                        // Distribute the attack interval across all frames
                        proprietaryAnim.frameDuration = (attackInterval * 0.9) / frames.length;
                        // Clamp frame duration to reasonable bounds
                        proprietaryAnim.frameDuration = Math.max(0.05, Math.min(proprietaryAnim.frameDuration, 0.3));
                    }
                }
                
                // Update animation state
                animState.currentAnimation = desiredAnimation;
                animState.animationTime = 0;
                animState.minAnimationTime = minAnimationTime;
            }
        }
        
        // Update current action speed if it's GLTF and same animation but speed changed
        if (animState.currentAnimation === desiredAnimation && animState.currentAction) {
            // Only update speed if the change is significant to avoid micro-adjustments
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
        
        // Default to idle if animation doesn't exist
        if (!animationActions[animationName]) {
            
            // Try common fallback animations
            const fallbacks = {
                'attack': ['combat', 'fight', 'swing', 'strike'],
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
            
            // If no fallback found, try idle
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
        
        // Don't change if it's the same animation and it's playing properly
        if (animState.currentAnimation === animationName && 
            animState.currentAction === newAction && 
            newAction.isRunning() && 
            newAction.getEffectiveWeight() > 0) {
            // Just update speed if needed
            newAction.setEffectiveTimeScale(speed);
            return;
        }
        
        // Update animation state
        animState.currentAnimation = animationName;
        animState.animationTime = 0;
        animState.minAnimationTime = minAnimationTime;
        
        // Handle animation transition with ZERO gap coverage
        if (animState.currentAction && animState.currentAction !== newAction) {
            const oldAction = animState.currentAction;
            
            // STEP 1: Ensure old action is at full weight and playing
            oldAction.enabled = true;
            oldAction.setEffectiveWeight(1);
            if (!oldAction.isRunning()) {
                oldAction.play();
            }
            
            // STEP 2: Prepare new action but don't start it yet
            newAction.enabled = true;
            newAction.setEffectiveTimeScale(speed);
            newAction.setEffectiveWeight(0);
            
            // STEP 3: Start new action from current time (no reset!)
            if (!newAction.isRunning()) {
                newAction.play();
            }
            
            // STEP 4: Stop all other interfering actions
            Object.values(animationActions).forEach(action => {
                if (action !== newAction && action !== oldAction) {
                    action.stop();
                    action.setEffectiveWeight(0);
                    action.enabled = false;
                }
            });
            
            // STEP 5: Use manual weight transition instead of crossFadeTo
            this.performManualCrossfade(oldAction, newAction, 0.1); // Very fast transition
            
        } else {
            // First animation setup - still be careful
            if (animState.currentAction) {
                // Same animation, just update speed
                newAction.setEffectiveTimeScale(speed);
                return;
            }
            
            // True first time setup
            Object.values(animationActions).forEach(action => {
                if (action !== newAction) {
                    action.stop();
                    action.setEffectiveWeight(0);
                    action.enabled = false;
                }
            });
            
            // Start new action without reset
            newAction.enabled = true;
            newAction.setEffectiveTimeScale(speed);
            newAction.setEffectiveWeight(1);
            newAction.play();
        }
        
        animState.currentAction = newAction;
    }
    
    // New method for manual crossfade to avoid T-pose
    performManualCrossfade(fromAction, toAction, duration) {
        const steps = 10; // Number of interpolation steps
        const stepDuration = (duration * 1000) / steps; // Convert to milliseconds
        let currentStep = 0;
        
        const interval = setInterval(() => {
            currentStep++;
            const progress = currentStep / steps;
            
            // Interpolate weights (ensure they always add up to 1)
            const fromWeight = 1 - progress;
            const toWeight = progress;
            
            fromAction.setEffectiveWeight(fromWeight);
            toAction.setEffectiveWeight(toWeight);
            
            if (currentStep >= steps) {
                clearInterval(interval);
                // Final cleanup
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
            
            // Apply first frame immediately
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
        // Get the model from RenderSystem
        const modelGroup = this.game.renderSystem?.entityModels?.get(entityId);
        if (!modelGroup) return;
        
        const frames = proprietaryAnim.animationData[proprietaryAnim.animationState];
        const frameData = frames[proprietaryAnim.currentFrameIndex] || {};
        
        // Apply frame transformations to the model
        modelGroup.traverse((obj) => {
            // Handle group-level transformations
            if (!obj.isMesh && obj.name && proprietaryAnim.modelData[obj.name]) {
                const groupName = obj.name;
                const groupData = frameData[groupName];
                const modelGroupData = proprietaryAnim.modelData[groupName];
                this.updateObjectTransforms(obj, groupData, modelGroupData);
            }
            
            // Handle shape-level transformations
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
        // Get from game collections
        const collections = this.game.getCollections && this.game.getCollections();
        if (collections && collections.units && collections.units[unitType]) {
            return collections.units[unitType];
        }
        
        // Fallback
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
        // Clean up animation mixer
        const mixer = this.entityMixers.get(entityId);
        if (mixer) {
            const animationActions = this.entityAnimations.get(entityId);
            if (animationActions) {
                Object.values(animationActions).forEach(action => action.stop());
            }
            
            // Get model from RenderSystem to uncache
            const modelGroup = this.game.renderSystem?.entityModels?.get(entityId);
            if (modelGroup) {
                mixer.uncacheRoot(modelGroup);
            }
        }
        
        // Clean up pending damage events when entity is removed
        if (this.game.combatAISystems && this.game.combatAISystems.cleanupPendingEventsForEntity) {
            this.game.combatAISystems.cleanupPendingEventsForEntity(entityId);
        }
        
        // Remove from maps
        this.entityAnimations.delete(entityId);
        this.entityMixers.delete(entityId);
        this.entityAnimationStates.delete(entityId);
        this.entityProprietaryAnimations?.delete(entityId);
    }
    
    destroy() {
        // Clean up all entity animations
        for (const [entityId] of this.entityAnimationStates.entries()) {
            this.removeEntityAnimations(entityId);
        }
        
        // Clear all maps
        this.entityAnimations.clear();
        this.entityMixers.clear();
        this.entityAnimationStates.clear();
        this.entityProprietaryAnimations?.clear();
    }
}