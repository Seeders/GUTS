class RenderSystem {
    constructor(game) {
        this.game = game;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Initialize Three.js scene, camera, and renderer
        this.initializeThreeJS();
        
        // Track entities with 3D models
        this.entityModels = new Map();
        this.entityAnimations = new Map(); // For GLTF animations
        this.entityMixers = new Map(); // For GLTF mixers
        this.entityProprietaryAnimations = new Map(); // For proprietary frame-based animations
        
        // Animation state tracking
        this.entityAnimationStates = new Map();
        this.clock = new THREE.Clock();
    }
    
    initializeThreeJS() {
        // Get the existing game canvas for Three.js
        const gameCanvas = document.getElementById('gameCanvas');
        if (!gameCanvas) {
            console.error('gameCanvas not found!');
            return;
        }
        
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111111);
        
        // Create camera - positioned further back for larger game board
        this.camera = new THREE.PerspectiveCamera(
            75, 
            window.innerWidth / window.innerHeight, 
            0.1, 
            2000
        );
        
        // Position camera much further back to accommodate larger game board
        this.camera.position.set(0, 150, 120);
        this.camera.lookAt(0, 0, 0);
        
        console.log('Camera positioned for larger game board view');
        
        // Create renderer using the existing canvas
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: gameCanvas,
            antialias: true,
            alpha: false
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Add lighting
        this.setupLighting();
        
        // Add ground plane for visual reference
        this.createGroundPlane();
        
        // Store reference in game for ModelManager access
        this.game.scene = this.scene;
        this.game.camera = this.camera;
        this.game.renderer = this.renderer;
        
        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());
        
        console.log('Three.js initialized with gameCanvas:', gameCanvas);
        console.log('Scene:', this.scene);
        console.log('Renderer:', this.renderer);
    }
    
    setupLighting() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
        this.scene.add(ambientLight);
        
        // Directional light (main light)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 50;
        directionalLight.shadow.camera.left = -20;
        directionalLight.shadow.camera.right = 20;
        directionalLight.shadow.camera.top = 20;
        directionalLight.shadow.camera.bottom = -20;
        this.scene.add(directionalLight);
        
        // Additional fill light
        const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
        fillLight.position.set(-5, 5, -5);
        this.scene.add(fillLight);
    }
    
    createGroundPlane() {
        // Create a much larger ground plane to accommodate full-sized models
        const groundGeometry = new THREE.PlaneGeometry(500, 500);
        const groundMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x336633,
            transparent: true,
            opacity: 0.8
        });
        
        const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
        groundPlane.rotation.x = -Math.PI / 2; // Rotate to be horizontal
        groundPlane.position.y = -0.5; // Position slightly below units
        groundPlane.receiveShadow = true;
        
        this.scene.add(groundPlane);
        
        // Add a larger grid helper for the game board
        const gridHelper = new THREE.GridHelper(500, 50, 0x444444, 0x444444);
        gridHelper.position.y = -0.4;
        this.scene.add(gridHelper);
        
        // Add battlefield divider line at center
        const dividerGeometry = new THREE.BoxGeometry(2, 10, 500);
        const dividerMaterial = new THREE.MeshBasicMaterial({ color: 0xff4444 });
        const divider = new THREE.Mesh(dividerGeometry, dividerMaterial);
        divider.position.set(0, 5, 0);
        this.scene.add(divider);
        
        console.log('Large game board created (500x500) for full-sized models');
    }
    
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    update(deltaTime) {
        this.game.deltaTime = deltaTime;
        
        // Update 3D models
        this.update3DModels(deltaTime);
        
        // Render 3D scene
        this.renderer.render(this.scene, this.camera);
    }
    
    update3DModels(deltaTime) {
        // Get entities that should have 3D models
        const entities = this.game.getEntitiesWith(
            this.componentTypes.POSITION, 
            this.componentTypes.UNIT_TYPE
        );
        
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
            const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            const velocity = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            
            // Check if entity needs a model
            if (!this.entityModels.has(entityId)) {
                this.createModelForEntity(entityId, "units", unitType.id, team);
            }
            
            const modelGroup = this.entityModels.get(entityId);
            if (modelGroup) {
                // Convert canvas coordinates to larger 3D world coordinates
                const worldX = (pos.x / window.innerWidth) * 500 - 250;
                const worldZ = (pos.y / window.innerHeight) * 500 - 250;
                
                // Update position
                modelGroup.position.set(worldX, 0, worldZ);
                
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
                
                // Update skeleton for skinned meshes
                modelGroup.traverse(object => {
                    if (object.isSkinnedMesh && object.skeleton) {
                        object.skeleton.update();
                    }
                });
            }
        });
        
        // Clean up removed entities
        this.cleanupRemovedEntities(entities);
    }
    
    async createModelForEntity(entityId, objectType, spawnType, team) {
        // Check if ModelManager exists
        if (!this.game.modelManager) {
            console.error('ModelManager not found on game object!');
            this.createFallbackModel(entityId, team);
            return;
        }
        
        // Get unit definition from game data
        const unitDefinition = this.getUnitDefinition(spawnType);
        
        // Create fallback model if no proper definition
        if (!unitDefinition || !unitDefinition.render) {
            console.warn(`No unit definition or render data for ${spawnType}, creating fallback cube`);
            this.createFallbackModel(entityId, team);
            return;
        }
        
        try {
            // Get model from ModelManager
            const modelGroup = this.game.modelManager.getModel(objectType, spawnType);
            
            if (modelGroup) {
                // Add to scene
                this.scene.add(modelGroup);
                this.entityModels.set(entityId, modelGroup);
                
                // Set up animations if this is a GLTF model
                await this.setupEntityAnimations(entityId, objectType, spawnType, modelGroup);
                
                // Apply team-based styling
                if (team) {
                    this.applyTeamStyling(modelGroup, team.team);
                }
                
                // Initialize animation state
                this.entityAnimationStates.set(entityId, {
                    currentAnimation: 'idle',
                    animationTime: 0,
                    minAnimationTime: 0,
                    currentAction: null
                });
            } else {
                console.warn(`No model returned from ModelManager for ${objectType}/${spawnType}, creating fallback`);
                this.createFallbackModel(entityId, team);
            }
        } catch (error) {
            console.error(`Failed to create model for entity ${entityId}:`, error);
            this.createFallbackModel(entityId, team);
        }
    }
    
    createFallbackModel(entityId, team) {
        console.log(`Creating fallback cube for entity ${entityId}`);
        
        // Create a simple colored cube as fallback
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const color = team?.team === 'player' ? 0x00ff00 : 
                     team?.team === 'enemy' ? 0xff0000 : 0xffffff;
        const material = new THREE.MeshLambertMaterial({ color });
        
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(0, 0.5, 0); // Lift it above ground
        cube.castShadow = true;
        
        // Create a group to match the expected structure
        const modelGroup = new THREE.Group();
        modelGroup.add(cube);
        
        this.scene.add(modelGroup);
        this.entityModels.set(entityId, modelGroup);
        
        console.log(`Fallback cube created for entity ${entityId}`);
    }
    
    async setupEntityAnimations(entityId, objectType, spawnType, modelGroup) {
        console.log(`ANIMATION DEBUG: Setting up animations for entity ${entityId}, type: ${objectType}/${spawnType}`);
        
        // Get unit definition to check animation type
        const unitDefinition = this.getUnitDefinition(spawnType);
        const animationData = unitDefinition?.render?.animations;
        const modelData = unitDefinition?.render?.model;
        
        if (!animationData || !modelData) {
            console.log(`ANIMATION DEBUG: No animation or model data found for ${spawnType}`);
            return;
        }
        
        // Determine if this is GLTF or proprietary animation system
        const firstGroupName = Object.keys(modelData)[0];
        const firstShape = modelData[firstGroupName]?.shapes?.[0];
        const isGLTF = firstShape?.type === "gltf";
        
        console.log(`ANIMATION DEBUG: Animation type for ${spawnType}: ${isGLTF ? 'GLTF' : 'Proprietary'}`);
        
        if (isGLTF) {
            // Handle GLTF animations
            await this.setupGLTFAnimations(entityId, objectType, spawnType, modelGroup, animationData);
        } else {
            // Handle proprietary frame-based animations
            this.setupProprietaryAnimations(entityId, objectType, spawnType, modelGroup, animationData, modelData);
        }
    }
    
    async setupGLTFAnimations(entityId, objectType, spawnType, modelGroup, animationData) {
        console.log(`ANIMATION DEBUG: Setting up GLTF animations for entity ${entityId}`);
        
        // Check if this is a GLTF model with animations
        let mixer, animations;
        modelGroup.traverse(object => {
            if (object.userData.mixer) {
                mixer = object.userData.mixer;
                animations = object.userData.animations;
                console.log(`ANIMATION DEBUG: Found mixer and ${animations?.length || 0} animations in model`);
            }
        });
        
        // If no mixer found, check for raw animation clips
        if (!mixer) {
            console.log(`ANIMATION DEBUG: No mixer found, checking for raw animation clips...`);
            modelGroup.traverse(object => {
                if (object.animations && object.animations.length > 0) {
                    console.log(`ANIMATION DEBUG: Found ${object.animations.length} raw animation clips on object "${object.name}"`);
                    mixer = new THREE.AnimationMixer(object);
                    animations = object.animations;
                    console.log(`ANIMATION DEBUG: Created manual mixer for entity ${entityId}`);
                }
            });
        }
        
        if (mixer && animations && animations.length > 0) {
            this.entityMixers.set(entityId, mixer);
            console.log(`ANIMATION DEBUG: GLTF mixer set for entity ${entityId}`);
            
            const animationActions = {};
            
            // Create animation actions for each animation type
            for (const animName of Object.keys(animationData)) {
                console.log(`ANIMATION DEBUG: Loading GLTF animation '${animName}' for ${objectType}/${spawnType}`);
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
                            console.log(`ANIMATION DEBUG: Successfully created GLTF action for '${animName}', duration: ${clip.duration}s`);
                        }
                    }
                } catch (error) {
                    console.error(`ANIMATION DEBUG: Failed to load GLTF animation ${animName}:`, error);
                }
            }
            
            console.log(`ANIMATION DEBUG: Final GLTF animation actions for entity ${entityId}:`, Object.keys(animationActions));
            this.entityAnimations.set(entityId, animationActions);
            
            // Start with idle animation
            if (animationActions.idle) {
                console.log(`ANIMATION DEBUG: Starting GLTF idle animation for entity ${entityId}`);
                animationActions.idle.play();
                const animState = this.entityAnimationStates.get(entityId);
                if (animState) {
                    animState.currentAction = animationActions.idle;
                }
            }
        } else {
            console.log(`ANIMATION DEBUG: No GLTF animations found for entity ${entityId}`);
        }
    }
    
    setupProprietaryAnimations(entityId, objectType, spawnType, modelGroup, animationData, modelData) {
        console.log(`ANIMATION DEBUG: Setting up proprietary animations for entity ${entityId}`);
        console.log(`ANIMATION DEBUG: Available proprietary animations:`, Object.keys(animationData));
        
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
        if (!this.entityProprietaryAnimations) {
            this.entityProprietaryAnimations = new Map();
        }
        this.entityProprietaryAnimations.set(entityId, animationInfo);
        
        console.log(`ANIMATION DEBUG: Proprietary animation system set up for entity ${entityId}`);
        
        // Set initial animation
        this.setProprietaryAnimation(entityId, 'idle');
    }
    
    updateEntityAnimation(entityId, velocity, health, deltaTime) {
        const animState = this.entityAnimationStates.get(entityId);
        const modelGroup = this.entityModels.get(entityId);
        
        if (!animState || !modelGroup) return;
        
        animState.animationTime += deltaTime;
        
        // Get additional components to determine animation state
        const combat = this.game.getComponent(entityId, this.componentTypes.COMBAT);
        const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
        
        // Determine desired animation based on AI state and movement
        let desiredAnimation = 'idle';
        let animationSpeed = 1;
        
        // Check AI state first for combat animations
        if (aiState) {
            if (aiState.state === 'attacking' || aiState.state === 'combat') {
                desiredAnimation = 'attack';
                animationSpeed = combat ? (combat.attackSpeed || 1) : 1;
            } else if (aiState.state === 'chasing' || aiState.state === 'moving') {
                desiredAnimation = 'walk';
                // Calculate speed based on velocity if available
                if (velocity && (Math.abs(velocity.vx) > 0.1 || Math.abs(velocity.vy) > 0.1)) {
                    const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
                    animationSpeed = Math.min(speed / 30, 2); // Adjust speed scaling
                }
            }
        }
        
        // Fallback to velocity-based animation if no AI state
        if (desiredAnimation === 'idle' && velocity && (Math.abs(velocity.vx) > 0.1 || Math.abs(velocity.vy) > 0.1)) {
            desiredAnimation = 'walk';
            const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
            animationSpeed = Math.min(speed / 30, 2);
        }
        
        // Update rotation to face movement direction
        if (velocity && (Math.abs(velocity.vx) > 0.1 || Math.abs(velocity.vy) > 0.1)) {
            const angle = Math.atan2(velocity.vy, velocity.vx);
            modelGroup.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle + Math.PI / 2);
        }
        
        // Check for damaged state (low health animation)
        if (health && health.current < health.max * 0.3 && desiredAnimation === 'idle') {
            desiredAnimation = 'hurt';
        }
        
        // Change animation if needed
        if (animState.currentAnimation !== desiredAnimation && 
            animState.animationTime >= animState.minAnimationTime) {
            
            // Check if this entity uses GLTF or proprietary animations
            const hasGLTFAnimations = this.entityAnimations.has(entityId);
            const hasProprietaryAnimations = this.entityProprietaryAnimations?.has(entityId);
            
            if (hasGLTFAnimations) {
                this.setEntityAnimation(entityId, desiredAnimation, animationSpeed);
            } else if (hasProprietaryAnimations) {
                this.setProprietaryAnimation(entityId, desiredAnimation);
                // Update animation state
                animState.currentAnimation = desiredAnimation;
                animState.animationTime = 0;
            }
        }
        
        // Update current action speed if it's GLTF and same animation but speed changed
        if (animState.currentAnimation === desiredAnimation && animState.currentAction) {
            animState.currentAction.setEffectiveTimeScale(animationSpeed);
        }
    }
    
    setEntityAnimation(entityId, animationName, speed = 1, minAnimationTime = 0) {
        const animState = this.entityAnimationStates.get(entityId);
        const animationActions = this.entityAnimations.get(entityId);
        
        if (!animState || !animationActions) return;
        
        // Default to idle if animation doesn't exist
        if (!animationActions[animationName]) {
            console.warn(`Animation '${animationName}' not found for entity ${entityId}, trying fallbacks`);
            
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
                        console.log(`Using fallback animation '${fallback}' for '${animationName}'`);
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
        
        // Update animation state
        animState.currentAnimation = animationName;
        animState.animationTime = 0;
        animState.minAnimationTime = minAnimationTime;
        
        // Crossfade to new animation
        if (animState.currentAction && animState.currentAction !== newAction) {
            const fadeTime = 0.3;
            
            animState.currentAction.setEffectiveWeight(1);
            newAction.setEffectiveWeight(1);
            newAction.setEffectiveTimeScale(speed);
            
            animState.currentAction.play();
            newAction.play();
            
            animState.currentAction.crossFadeTo(newAction, fadeTime / speed, true);
            
            setTimeout(() => {
                if (animState.currentAction && animState.currentAction !== newAction) {
                    animState.currentAction.stop();
                }
            }, fadeTime * 1000 / speed);
        } else {
            newAction.enabled = true;
            newAction.time = 0;
            newAction.setEffectiveTimeScale(speed);
            newAction.setEffectiveWeight(1);
            newAction.play();
        }
        
        animState.currentAction = newAction;
    }
    
    setProprietaryAnimation(entityId, animationName) {
        const proprietaryAnim = this.entityProprietaryAnimations?.get(entityId);
        if (!proprietaryAnim) return;
        
        if (proprietaryAnim.animationData[animationName]) {
            console.log(`ANIMATION DEBUG: Setting proprietary animation '${animationName}' for entity ${entityId}`);
            proprietaryAnim.animationState = animationName;
            proprietaryAnim.currentFrameIndex = 0;
            proprietaryAnim.frameTime = 0;
            
            // Apply first frame immediately
            this.applyProprietaryFrame(entityId, proprietaryAnim);
        } else {
            console.log(`ANIMATION DEBUG: Proprietary animation '${animationName}' not found for entity ${entityId}`);
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
        const modelGroup = this.entityModels.get(entityId);
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
    
    applyTeamStyling(modelGroup, team) {
        const teamColors = {
            'player': 0x00ff00,
            'enemy': 0xff0000,
            'neutral': 0xffffff
        };
        
        const teamColor = teamColors[team] || teamColors.neutral;
        
        modelGroup.traverse(child => {
            if (child.isMesh && child.material) {
                if (child.material.emissive) {
                    child.material.emissive.setHex(teamColor);
                    child.material.emissiveIntensity = 0.01;
                }
            }
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
        
        for (const [entityId] of this.entityModels.entries()) {
            if (!currentEntitySet.has(entityId)) {
                this.removeEntityModel(entityId);
            }
        }
    }
    
    removeEntityModel(entityId) {
        // Clean up model
        const modelGroup = this.entityModels.get(entityId);
        if (modelGroup) {
            this.scene.remove(modelGroup);
            
            // Dispose of geometries and materials
            modelGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }
        
        // Clean up animation mixer
        const mixer = this.entityMixers.get(entityId);
        if (mixer) {
            const animationActions = this.entityAnimations.get(entityId);
            if (animationActions) {
                Object.values(animationActions).forEach(action => action.stop());
            }
            mixer.uncacheRoot(modelGroup);
        }
        
        // Remove from maps
        this.entityModels.delete(entityId);
        this.entityAnimations.delete(entityId);
        this.entityMixers.delete(entityId);
        this.entityAnimationStates.delete(entityId);
    }
    
    destroy() {
        // Clean up all entity models
        for (const [entityId] of this.entityModels.entries()) {
            this.removeEntityModel(entityId);
        }
        
        // Clean up Three.js resources
        if (this.renderer) {
            this.renderer.dispose();
        }
        
        // Remove event listeners
        window.removeEventListener('resize', this.onWindowResize);
    }
}