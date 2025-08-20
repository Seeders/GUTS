class RenderSystem {
    constructor(game) {
        this.game = game;
        this.game.renderSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Track entities with 3D models
        this.entityModels = new Map();
        this.modelScale = 32;
        // Configuration for facing direction
        this.MIN_MOVEMENT_THRESHOLD = 0.1;
    }
    
    update(deltaTime) {
        // Only update if we have access to Three.js scene from WorldRenderSystem
        if (!this.game.scene || !this.game.camera || !this.game.renderer) {
            return;
        }

        this.game.deltaTime = deltaTime;
        
        // Update 3D models
        this.update3DModels(deltaTime);
    }
            
    update3DModels(deltaTime) {
        // Get entities that should have 3D models
        const entities = this.game.getEntitiesWith(
            this.componentTypes.POSITION, 
            this.componentTypes.UNIT_TYPE
        );
        entities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const renderable = this.game.getComponent(entityId, this.componentTypes.RENDERABLE);
            const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
            const velocity = this.game.getComponent(entityId, this.componentTypes.VELOCITY);
            const facing = this.game.getComponent(entityId, this.componentTypes.FACING);
            
            // Check if entity needs a model
            if (!this.entityModels.has(entityId)) {
                this.createModelForEntity(entityId, renderable.objectType, renderable.spawnType, team);
            }
            
            const modelGroup = this.entityModels.get(entityId);
            if (modelGroup) {
                // Use full 3D coordinates directly
                const worldX = pos.x;
                const worldY = pos.y; // Use actual Y coordinate from position
                const worldZ = pos.z; // Use actual Z coordinate from position
                
                // Update position with proper 3D coordinates
                modelGroup.position.set(worldX, worldY, worldZ);              
               // modelGroup.updateMatrix();
                // Update facing direction
                this.updateFacingDirection(entityId, modelGroup, velocity, facing);
                
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

    updateFacingDirection(entityId, modelGroup, velocity, facing) {
        const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
        const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
        
        let facingAngle = null;
        
        // Priority 1: Face movement direction if moving (unless attacking)
        if (velocity && (Math.abs(velocity.vx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(velocity.vz) > this.MIN_MOVEMENT_THRESHOLD)) {
            // Only face movement direction if NOT actively attacking
            if (!aiState || aiState.state !== 'attacking') {
                // Calculate facing angle from movement direction (X and Z)
                facingAngle = Math.atan2(velocity.vz, velocity.vx);
            }
        }
        
        // Priority 2: If actively attacking, face the target
        if (facingAngle === null && aiState && aiState.state === 'attacking' && aiState.aiBehavior && aiState.aiBehavior.currentTarget && pos) {
            // Get the current position of the target (fresh every frame)
            const targetPos = this.game.getComponent(aiState.aiBehavior.currentTarget, this.componentTypes.POSITION);
            
            if (targetPos) {
                const dx = targetPos.x - pos.x;
                const dz = targetPos.z - pos.z; // Use Z for forward/backward in 3D
                
                // Only update if we have a meaningful direction
                if (Math.abs(dx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(dz) > this.MIN_MOVEMENT_THRESHOLD) {
                    // Calculate facing angle using X and Z coordinates
                    facingAngle = Math.atan2(dz, dx);
                }
            }
        }
        
        // Priority 3: Use initial facing direction if no movement and not attacking
        if (facingAngle === null && facing && facing.angle !== undefined) {
            facingAngle = facing.angle;
        }
        
        // Apply rotation if we have a valid angle
        if (facingAngle !== null) {
            // Convert from 2D angle to 3D Y-axis rotation
            // Adjust the angle offset as needed for your model orientation
            // Most models face forward along negative Z, so we need to adjust
            modelGroup.rotation.y = -facingAngle + Math.PI / 2;
        }
    }
    
    async createModelForEntity(entityId, objectType, spawnType, team) {
        // Get unit definition from game data        
        try {
            // Get model from ModelManager
            const modelGroup = this.game.modelManager.getModel(objectType, spawnType);
            if (modelGroup) {
                // Add to scene
                modelGroup.scale.set(
                    modelGroup.scale.x * this.modelScale,
                    modelGroup.scale.y * this.modelScale,
                    modelGroup.scale.z * this.modelScale
                );
                this.game.scene.add(modelGroup);
                this.entityModels.set(entityId, modelGroup);
                
                // Set up animations through AnimationSystem
                if (this.game.animationSystem) {
                    await this.game.animationSystem.setupEntityAnimations(entityId, objectType, spawnType, modelGroup);
                }
                
                // Apply team-based styling
                if (team) {
                   // this.applyTeamStyling(modelGroup, team.team);
                }
                
                // Apply initial facing direction
                const facing = this.game.getComponent(entityId, this.componentTypes.FACING);
                if (facing && facing.angle !== undefined) {
                    modelGroup.rotation.y = -facing.angle + Math.PI / 2;
                }
            } else {
                console.error("no model group found", objectType, spawnType);
            }
        } catch (error) {
            console.error(error);
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
        if (modelGroup && this.game.scene) {
            this.game.scene.remove(modelGroup);
            
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
        
        // Clean up animations through AnimationSystem
        if (this.game.animationSystem) {
            this.game.animationSystem.removeEntityAnimations(entityId);
        }
        // Remove from maps
        this.entityModels.delete(entityId);
    }
    
    destroy() {
        // Clean up all entity models
        for (const [entityId] of this.entityModels.entries()) {
            this.removeEntityModel(entityId);
        }
        
        // Clear all maps
        this.entityModels.clear();
    }
}