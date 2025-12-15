class RenderSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.renderSystem = this;

        // EntityRenderer handles ALL rendering
        this.entityRenderer = null;

        // Track which entities have been spawned
        this.spawnedEntities = new Set();

        // Reusable set for cleanup to avoid per-frame allocation
        this._currentEntitiesSet = new Set();

        // Position cache to skip unchanged entity transforms
        this._entityPositionCache = new Map();  // entityId -> {x, y, z, angle}
        this._positionThreshold = 0.01;  // Minimum movement to trigger transform update

        // Debug stats
        this._frame = 0;
        this._stats = {
            entitiesProcessed: 0,
            entitiesSpawned: 0,
            entitiesUpdated: 0
        };

    }

    init() {
        // Register gameManager methods that delegate to EntityRenderer
        this.game.register('setInstanceClip', this.setInstanceClip.bind(this));
        this.game.register('setInstanceSpeed', this.setInstanceSpeed.bind(this));
        this.game.register('isInstanced', this.isInstanced.bind(this));
        this.game.register('getEntityAnimationState', this.getEntityAnimationState.bind(this));
        this.game.register('setInstanceAnimationTime', this.setInstanceAnimationTime.bind(this));
        this.game.register('getBatchInfo', this.getBatchInfo.bind(this));
        this.game.register('removeInstance', this.removeInstance.bind(this));

        // Billboard/sprite low-level rendering methods (EntityRenderer)
        this.game.register('isBillboardWithAnimations', this.isBillboardWithAnimations.bind(this));

        // EntityRenderer will be created in onSceneLoad when scene is available
        // Register getter that returns current entityRenderer (may be null initially)
        this.game.register('getEntityRenderer', () => this.entityRenderer);

        // Register method to update capacities after terrain loads
        this.game.register('updateInstanceCapacities', this.updateInstanceCapacities.bind(this));
    }

    /**
     * Called after all systems have completed onSceneLoad - initialize EntityRenderer with scene
     * Uses postSceneLoad to ensure WorldSystem has created the Three.js scene first
     */
    postSceneLoad(sceneData) {

        // Scene should be available now from WorldSystem
        if (!this.game.scene) {
            console.error('[RenderSystem] Scene not available in postSceneLoad - WorldSystem may have failed');
            return;
        }

        const collections = this.game.getCollections?.();
        const projectName = collections?.configs?.game?.projectName || 'TurnBasedWarfare';

        // Count instances needed for each entity type from level data
        const capacitiesByType = this.calculateInstanceCapacities();

        this.entityRenderer = new GUTS.EntityRenderer({
            scene: this.game.scene,
            collections: collections,
            projectName: projectName,
            modelManager: this.game.modelManager,
            game: this.game,
            getPalette: () => collections?.palette || {},
            modelScale: 32,
            defaultCapacity: 2056,
            capacitiesByType: capacitiesByType,
            minMovementThreshold: 0.1
        });

        // Set initial ambient light color for sprite/billboard rendering
        // Combine ambient light with hemisphere light for overall scene illumination
        // Note: Lighting may not be set up yet since WorldSystem.setupWorldRendering is async
        // We'll apply lighting after WorldSystem finishes (see waitForLightingAndApply below)
        this.waitForLightingAndApply();

    }

    /**
     * Calculate instance capacities needed for each entity type
     * by counting them in the level data
     */
    calculateInstanceCapacities() {
        const capacities = {};

        // Get tile map from TerrainSystem via gameManager
        const tileMap = this.game.call('getTileMap');
        if (!tileMap?.worldObjects) {
            return capacities;
        }

        // Count each type of worldObject object
        const counts = {};
        tileMap.worldObjects.forEach(obj => {
            const key = `worldObjects_${obj.type}`;
            counts[key] = (counts[key] || 0) + 1;
        });

        // Set capacity with some buffer (20% extra for dynamic spawning)
        for (const [key, count] of Object.entries(counts)) {
            capacities[key] = Math.ceil(count * 1.2);
        }

        // Also count cliffs if present
        if (tileMap.cliffs) {
            const cliffCounts = {};
            tileMap.cliffs.forEach(cliff => {
                const key = `cliffs_${cliff.type}`;
                cliffCounts[key] = (cliffCounts[key] || 0) + 1;
            });

            for (const [key, count] of Object.entries(cliffCounts)) {
                capacities[key] = Math.ceil(count * 1.2);
            }
        }

        return capacities;
    }

    /**
     * Update instance capacities after terrain has loaded
     * Called by WorldSystem when terrain data is available
     */
    updateInstanceCapacities() {

        if (!this.entityRenderer) {
            console.warn('[RenderSystem] Cannot update capacities - EntityRenderer not initialized');
            return;
        }

        const capacities = this.calculateInstanceCapacities();


        // Update EntityRenderer's capacity map
        this.entityRenderer.capacitiesByType = capacities;

    }

    /**
     * Remove entity instance and mark for re-spawn
     * Used when RENDERABLE component changes (e.g., construction completion)
     */
    removeInstance(entityId) {
        // Remove from renderer
        this.entityRenderer.removeEntity(entityId);

        // Mark as not spawned so it will be re-spawned with new model on next update
        this.spawnedEntities.delete(entityId);

        // Clear position cache
        if (this._entityPositionCache) {
            this._entityPositionCache.delete(entityId);
        }
    }

    /**
     * Called when an entity is destroyed - clean up visual representation
     */
    entityDestroyed(entityId) {
        if (this.spawnedEntities.has(entityId)) {
            this.removeInstance(entityId);
        }
    }
    /**
     * Get batch information for animation system
     * Returns available clips and other batch metadata
     */
    getBatchInfo(objectType, spawnType) {
        if (!this.entityRenderer) {
            return null;
        }

        const batchKey = `${objectType}_${spawnType}`;
        const batch = this.entityRenderer.vatBatches.get(batchKey);

        if (!batch || !batch.meta) {
            return null;
        }

        // Extract available clips from meta
        const availableClips = batch.meta.clips ? batch.meta.clips.map(clip => clip.name) : [];

        return {
            availableClips,
            clipIndexByName: batch.meta.clipIndexByName,
            meta: batch.meta
        };
    }


    async update() {
        if (!this.game.scene || !this.game.camera || !this.game.renderer) return;
        if (!this.entityRenderer) return;

        this._frame++;
        await this.updateEntities();
        this.updateAnimations();
        this.finalizeUpdates();
    }

    async updateEntities() {
        const entities = this.game.getEntitiesWith("transform", "renderable");
        this._stats.entitiesProcessed = entities.length;

        for (const entityId of entities) {
            const transform = this.game.getComponent(entityId, "transform");
            const renderable = this.game.getComponent(entityId, "renderable");
            const velocity = this.game.getComponent(entityId, "velocity");
            const unitTypeComp = this.game.getComponent(entityId, "unitType");
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

            if (!unitType || !transform?.position) {
                continue;
            }

            const pos = transform.position;
            const angle = transform.rotation?.y || 0;

            // Check fog of war visibility (cliffs and worldObjects always visible)
            const fow = this.game.fogOfWarSystem;
            const isVisible = fow ? fow.isVisibleAt(pos.x, pos.z) : true;
            const isAlwaysVisible = unitType.collection === "worldObjects" || unitType.collection === "cliffs";

            if (!isAlwaysVisible && !isVisible) {
                // Entity not currently visible - skip entirely (don't spawn or update)
                continue;
            }

            // Pass numeric indices directly to EntityRenderer (O(1) lookup)
            const objectType = renderable.objectType;
            const spawnType = renderable.spawnType;

            if (objectType == null || spawnType == null) {
                console.error(`[RenderSystem] Invalid renderable for ${entityId}: objectType=${objectType}, spawnType=${spawnType}`);
                continue;
            }

            // Check if entity already spawned or currently spawning
            if (!this.spawnedEntities.has(entityId)) {
                // Mark as spawned immediately to prevent race condition with async spawn
                this.spawnedEntities.add(entityId);

                // Spawn new entity using numeric indices
                await this.spawnEntity(entityId, {
                    objectType: objectType,
                    spawnType: spawnType,
                    position: { x: pos.x, y: pos.y, z: pos.z },
                    rotation: angle,
                    transform: transform,
                    velocity: velocity
                });
                // Cache initial position
                this._entityPositionCache.set(entityId, {
                    x: pos.x, y: pos.y, z: pos.z,
                    angle: angle
                });
            } else {
                // Check if position/rotation has actually changed
                const cached = this._entityPositionCache.get(entityId);

                if (cached) {
                    const dx = pos.x - cached.x;
                    const dy = pos.y - cached.y;
                    const dz = pos.z - cached.z;
                    const distSq = dx*dx + dy*dy + dz*dz;
                    const angleDiff = Math.abs(angle - cached.angle);

                    // Skip update if position hasn't changed significantly
                    if (distSq < this._positionThreshold && angleDiff < 0.01) {
                        continue;
                    }

                    // Update cache
                    cached.x = pos.x;
                    cached.y = pos.y;
                    cached.z = pos.z;
                    cached.angle = angle;
                }

                // Update existing entity
                this.updateEntity(entityId, {
                    position: { x: pos.x, y: pos.y, z: pos.z },
                    rotation: angle,
                    transform: transform,
                    velocity: velocity
                });
            }
        }

        // Cleanup removed entities - reuse set to avoid per-frame allocation
        this._currentEntitiesSet.clear();
        for (const entityId of entities) {
            this._currentEntitiesSet.add(entityId);
        }
        this.cleanupRemovedEntities(this._currentEntitiesSet);
    }

    async spawnEntity(entityId, data) {
        const spawned = await this.entityRenderer.spawnEntity(entityId, data);
        if (spawned) {
            // Note: spawnedEntities is already updated by caller to prevent race conditions
            this._stats.entitiesSpawned++;

            // Trigger billboard spawn event for AnimationSystem
            // Use EntityRenderer's indexed lookup (data.collection/type are resolved by EntityRenderer)
            const entityDef = this.entityRenderer.getEntityDefByIndex(data.objectType, data.spawnType);
            if (entityDef?.spriteAnimationSet) {
                const collections = this.collections;
                const animSetData = collections?.spriteAnimationSets?.[entityDef.spriteAnimationSet];
                const spriteAnimationCollection = animSetData?.animationCollection || 'peasantSpritesAnimations';
                this.game.triggerEvent('billboardSpawned', {
                    entityId,
                    spriteAnimationSet: entityDef.spriteAnimationSet,
                    spriteAnimationCollection
                });
            }
        }
        return spawned;
    }

    updateEntity(entityId, data) {
        const updated = this.entityRenderer.updateEntityTransform(entityId, data);
        if (updated) {
            this._stats.entitiesUpdated++;
        }
        return updated;
    }

    updateAnimations() {
        const deltaTime = this.game.state?.deltaTime;
        if (!deltaTime) return;

        this.entityRenderer.updateAnimations(deltaTime);
    }

    finalizeUpdates() {
        this.entityRenderer.finalizeUpdates();
    }

    cleanupRemovedEntities(currentEntities) {
        const toRemove = [];

        for (const entityId of this.spawnedEntities) {
            if (!currentEntities.has(entityId)) {
                toRemove.push(entityId);
            }
        }

        for (const entityId of toRemove) {
            this.removeEntity(entityId);
        }
    }

    removeEntity(entityId) {
        const removed = this.entityRenderer.removeEntity(entityId);
        if (removed) {
            this.spawnedEntities.delete(entityId);
            this._entityPositionCache.delete(entityId);
        }
        return removed;
    }

    // ============ DELEGATED API METHODS ============
    // These delegate to EntityRenderer for backward compatibility

    setInstanceClip(entityId, clipName, resetTime = true) {
        if (!this.entityRenderer) return false;
        return this.entityRenderer.setAnimationClip(entityId, clipName, resetTime);
    }

    setInstanceSpeed(entityId, speed) {
        if (!this.entityRenderer) return false;
        return this.entityRenderer.setAnimationSpeed(entityId, speed);
    }

    setInstanceAnimationTime(entityId, time) {
        if (!this.entityRenderer) return false;
        const entity = this.entityRenderer.entities.get(entityId);
        if (!entity || entity.type !== 'vat') return false;

        const batch = entity.batch;
        batch.attributes.animTime.setX(entity.instanceIndex, time);
        batch.attributes.animTime.array[entity.instanceIndex] = time;
        batch.dirty.animation = true;

        return true;
    }

    isInstanced(entityId) {
        if (!this.entityRenderer) return false;
        return this.entityRenderer.hasEntity(entityId);
    }

    // ============ BILLBOARD/SPRITE ANIMATION METHODS ============

    isBillboardWithAnimations(entityId) {
        if (!this.entityRenderer) return false;
        return this.entityRenderer.isBillboardWithAnimations(entityId);
    }

    /**
     * Wait for WorldSystem to finish setting up lighting, then apply to sprites
     */
    async waitForLightingAndApply() {
        // Wait for WorldSystem's async setup to complete
        const worldSystem = this.game.worldSystem;
        if (worldSystem?.setupWorldRenderingPromise) {
            await worldSystem.setupWorldRenderingPromise;
        }

        const worldRenderer = worldSystem?.worldRenderer;
        if (worldRenderer) {
            this.applySpriteLighting(worldRenderer);
        }
    }

    /**
     * Apply lighting settings to sprites/billboards
     * Combines ambient, hemisphere sky, and a portion of directional light
     * for overall scene illumination on flat billboards
     * @param {WorldRenderer} worldRenderer - The world renderer with lighting
     */
    applySpriteLighting(worldRenderer) {
        if (!this.entityRenderer) return;

        // Start with ambient light as base
        const combinedColor = new THREE.Color(0x000000);

        // Add ambient light contribution
        if (worldRenderer.ambientLight) {
            const ambientContrib = worldRenderer.ambientLight.color.clone();
            ambientContrib.multiplyScalar(worldRenderer.ambientLight.intensity);
            combinedColor.add(ambientContrib);
        }

        // Add hemisphere light sky color contribution (top-down illumination)
        // Use a blend of sky and ground colors weighted towards sky since sprites face camera
        if (worldRenderer.hemisphereLight) {
            const skyContrib = worldRenderer.hemisphereLight.color.clone();
            const groundContrib = worldRenderer.hemisphereLight.groundColor.clone();

            // Blend 70% sky, 30% ground for sprites that mostly face up/camera
            skyContrib.multiplyScalar(0.7 * worldRenderer.hemisphereLight.intensity);
            groundContrib.multiplyScalar(0.3 * worldRenderer.hemisphereLight.intensity);

            combinedColor.add(skyContrib);
            combinedColor.add(groundContrib);
        }

        // Add a portion of directional light (simulating average illumination)
        // Billboards don't have proper normals so we use a fixed factor
        if (worldRenderer.directionalLight) {
            const directionalContrib = worldRenderer.directionalLight.color.clone();
            // Use 50% of directional intensity as average illumination on a flat surface
            directionalContrib.multiplyScalar(0.5 * worldRenderer.directionalLight.intensity);
            combinedColor.add(directionalContrib);
        }

        // Clamp to valid range and apply
        combinedColor.r = Math.min(1.0, combinedColor.r);
        combinedColor.g = Math.min(1.0, combinedColor.g);
        combinedColor.b = Math.min(1.0, combinedColor.b);


        // Apply combined lighting (intensity 1.0 since we pre-multiplied)
        this.entityRenderer.setAmbientLightColor(combinedColor, 1.0);

        // Also apply to TerrainDetailSystem (static terrain sprites like grass/trees)
        this.game.call('setTerrainDetailLighting', combinedColor);

        // Trigger event for terrain ground shader (WorldRenderer listens)
        this.game.triggerEvent('ambientLightChanged', { color: combinedColor, intensity: 1.0 });
    }

    getEntityAnimationState(entityId) {
        if (!this.entityRenderer) return null;

        const entity = this.entityRenderer.entities.get(entityId);
        if (!entity || entity.type !== 'vat') return null;

        try {
            const batch = entity.batch;
            const clipIndex = batch.attributes.clipIndex.array[entity.instanceIndex];
            const animTime = batch.attributes.animTime.array[entity.instanceIndex];
            const animSpeed = batch.attributes.animSpeed.array[entity.instanceIndex];

            if (clipIndex === undefined || clipIndex === null) return null;

            const clipName = Object.keys(batch.meta.clipIndexByName).find(
                name => batch.meta.clipIndexByName[name] === clipIndex
            );

            return {
                clipName,
                clipIndex,
                animTime,
                animSpeed,
                clipDuration: batch.meta.clips[clipIndex]?.duration || 1.0
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Called when scene is unloaded - cleanup all Three.js resources
     */
    onSceneUnload() {
        // Cleanup EntityRenderer and all its batches/meshes
        if (this.entityRenderer) {
            this.entityRenderer.dispose();
            this.entityRenderer = null;
        }

        // Clear tracking data
        this.spawnedEntities.clear();
        this._currentEntitiesSet.clear();
        this._entityPositionCache.clear();

        // Reset stats
        this._stats = {
            entitiesProcessed: 0,
            entitiesSpawned: 0,
            entitiesUpdated: 0
        };

    }

}
