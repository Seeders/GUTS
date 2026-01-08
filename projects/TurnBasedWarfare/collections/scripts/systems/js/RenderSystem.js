class RenderSystem extends GUTS.BaseSystem {
    static services = [
        'setInstanceClip',
        'setInstanceSpeed',
        'isInstanced',
        'getEntityAnimationState',
        'setInstanceAnimationTime',
        'getBatchInfo',
        'removeInstance',
        'isBillboardWithAnimations',
        'getEntityRenderer',
        'updateInstanceCapacities'
    ];

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

        // Reusable objects for spawn/update to avoid per-frame allocations
        this._spawnData = {
            objectType: 0,
            spawnType: 0,
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            transform: null,
            velocity: null
        };
        this._updateData = {
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            transform: null,
            velocity: null
        };

        // Pre-allocate Color objects for applySpriteLighting to avoid per-frame allocations
        this._combinedColor = null; // Created lazily when THREE is available
        this._ambientContrib = null;
        this._skyContrib = null;
        this._directionalContrib = null;
        this._lightDir = null;

        // Reusable array for cleanup to avoid per-frame allocations
        this._toRemove = [];
    }

    init() {
    }

    // Service getter
    getEntityRenderer() {
        return this.entityRenderer;
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
        if (!tileMap) {
            return capacities;
        }

        // Build prefab to collection mapping from objectTypeDefinitions
        const objectTypeDefinitions = this.collections.objectTypeDefinitions || {};
        const prefabToCollection = {};
        for (const [collectionId, typeDef] of Object.entries(objectTypeDefinitions)) {
            if (typeDef.singular) {
                prefabToCollection[typeDef.singular] = collectionId;
            }
        }

        // Count each type of entity from levelEntities
        const levelEntities = tileMap.levelEntities || [];
        const counts = {};
        for (const entityDef of levelEntities) {
            const collectionId = prefabToCollection[entityDef.prefab];
            if (!collectionId) continue;
            const key = `${collectionId}_${entityDef.type}`;
            counts[key] = (counts[key] || 0) + 1;
        }

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

        // Track which entities should be visible this frame (for cleanup of invisible entities)
        this._currentEntitiesSet.clear();

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
            const isVisible = this.game.call('isVisibleAt', pos.x, pos.z);
            const unitTypeCollection = unitTypeComp?.collection;
            const isAlwaysVisible = unitTypeCollection === this.enums.objectTypeDefinitions?.worldObjects ||
                                    unitTypeCollection === this.enums.objectTypeDefinitions?.cliffs;

            if (!isAlwaysVisible && !isVisible) {
                // Entity not currently visible in fog of war - skip entirely (don't spawn or update)
                continue;
            }

            // Check stealth visibility - enemy units with stealth should not render if not detected
            // Skip this check for always-visible entities (worldObjects, cliffs)
            // Get local player's team from player entity stats
            if (!isAlwaysVisible && this.game.hasService('getLocalPlayerStats') && this.game.hasService('isEntityVisibleToTeam')) {
                const localPlayerStats = this.game.call('getLocalPlayerStats');
                const myTeam = localPlayerStats?.team;
                if (myTeam !== undefined) {
                    const entityTeam = this.game.getComponent(entityId, 'team');
                    // Only check stealth for enemy units (not buildings/decorations without teams)
                    if (entityTeam && entityTeam.team !== myTeam) {
                        const isVisibleToMyTeam = this.game.call('isEntityVisibleToTeam', entityId, myTeam);
                        if (!isVisibleToMyTeam) {
                            // Enemy unit is stealthed and we can't see it - skip rendering
                            continue;
                        }
                    }
                }
            }

            // Entity passed visibility checks - mark it as visible for cleanup tracking
            this._currentEntitiesSet.add(entityId);

            // Pass numeric indices directly to EntityRenderer (O(1) lookup)
            const objectType = renderable.objectType;
            const spawnType = renderable.spawnType;

            if (objectType == null || spawnType == null) {
                console.error(`[RenderSystem] Invalid renderable for ${entityId}: objectType=${objectType}, spawnType=${spawnType}`);
                continue;
            }

            // Check if entity already spawned or currently spawning
            if (!this.spawnedEntities.has(entityId)) {
                // DEBUG: Log when spawning new entity

                // Mark as spawned immediately to prevent race condition with async spawn
                this.spawnedEntities.add(entityId);

                // Spawn new entity using numeric indices (reuse object to avoid allocation)
                this._spawnData.objectType = objectType;
                this._spawnData.spawnType = spawnType;
                this._spawnData.position.x = pos.x;
                this._spawnData.position.y = pos.y;
                this._spawnData.position.z = pos.z;
                this._spawnData.rotation = angle;
                this._spawnData.transform = transform;
                this._spawnData.velocity = velocity;
                await this.spawnEntity(entityId, this._spawnData);
                // Cache initial position - reuse existing cache object if available
                let posCache = this._entityPositionCache.get(entityId);
                if (!posCache) {
                    posCache = { x: 0, y: 0, z: 0, angle: 0, scaleX: 1 };
                    this._entityPositionCache.set(entityId, posCache);
                }
                posCache.x = pos.x;
                posCache.y = pos.y;
                posCache.z = pos.z;
                posCache.angle = angle;
            } else {
                // Check if position/rotation/scale/renderOffset has actually changed
                const cached = this._entityPositionCache.get(entityId);
                const scale = transform.scale;
                const scaleX = scale?.x ?? 1;

                if (cached) {
                    const dx = pos.x - cached.x;
                    const dy = pos.y - cached.y;
                    const dz = pos.z - cached.z;
                    const distSq = dx*dx + dy*dy + dz*dz;
                    const angleDiff = Math.abs(angle - cached.angle);
                    const scaleChanged = (cached.scaleX ?? 1) !== scaleX;

                    // Check if renderOffset or spriteCameraAngle changed
                    const animState = this.game.getComponent(entityId, 'animationState');
                    const renderOffsetY = animState?.renderOffset?.y ?? 0;
                    const renderOffsetChanged = Math.abs((cached.renderOffsetY ?? 0) - renderOffsetY) > 0.001;
                    // spriteCameraAngle affects sprite offset (ground-level vs isometric)
                    const spriteCameraAngle = animState?.spriteCameraAngle ?? 0;
                    const cameraAngleChanged = (cached.spriteCameraAngle ?? 0) !== spriteCameraAngle;

                    // Skip update if position/rotation/scale/renderOffset/cameraAngle hasn't changed significantly
                    if (distSq < this._positionThreshold && angleDiff < 0.01 && !scaleChanged && !renderOffsetChanged && !cameraAngleChanged) {
                        continue;
                    }

                    // Update cache
                    cached.x = pos.x;
                    cached.y = pos.y;
                    cached.z = pos.z;
                    cached.angle = angle;
                    cached.scaleX = scaleX;
                    cached.renderOffsetY = renderOffsetY;
                    cached.spriteCameraAngle = spriteCameraAngle;
                }

                // Update existing entity (reuse object to avoid allocation)
                this._updateData.position.x = pos.x;
                this._updateData.position.y = pos.y;
                this._updateData.position.z = pos.z;
                this._updateData.rotation = angle;
                this._updateData.transform = transform;
                this._updateData.velocity = velocity;
                this.updateEntity(entityId, this._updateData);
            }
        }

        // Cleanup entities that are no longer visible (removed, stealthed, or in fog of war)
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
        // Reuse array to avoid per-frame allocations
        this._toRemove.length = 0;

        for (const entityId of this.spawnedEntities) {
            if (!currentEntities.has(entityId)) {
                this._toRemove.push(entityId);
            }
        }

        for (let i = 0; i < this._toRemove.length; i++) {
            this.removeEntity(this._toRemove[i]);
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
     * Matches MeshLambertMaterial lighting for an upward-facing surface
     * so sprites appear consistent with terrain/cliffs
     * @param {WorldRenderer} worldRenderer - The world renderer with lighting
     */
    applySpriteLighting(worldRenderer) {
        if (!this.entityRenderer) return;

        // Lazily create reusable Color objects
        if (!this._combinedColor) {
            this._combinedColor = new THREE.Color();
            this._ambientContrib = new THREE.Color();
            this._skyContrib = new THREE.Color();
            this._directionalContrib = new THREE.Color();
            this._lightDir = new THREE.Vector3();
        }

        // Start with ambient light as base (same as MeshLambertMaterial)
        this._combinedColor.setHex(0x000000);

        // Add ambient light contribution (full, same as Lambert)
        if (worldRenderer.ambientLight) {
            this._ambientContrib.copy(worldRenderer.ambientLight.color);
            this._ambientContrib.multiplyScalar(worldRenderer.ambientLight.intensity);
            this._combinedColor.add(this._ambientContrib);
        }

        // Add hemisphere light contribution
        // For an upward-facing normal (0,1,0), MeshLambertMaterial uses 100% sky color
        if (worldRenderer.hemisphereLight) {
            this._skyContrib.copy(worldRenderer.hemisphereLight.color);
            this._skyContrib.multiplyScalar(worldRenderer.hemisphereLight.intensity);
            this._combinedColor.add(this._skyContrib);
        }

        // Add directional light contribution using N·L for upward-facing surface
        // This matches what MeshLambertMaterial computes for the terrain
        if (worldRenderer.directionalLight) {
            const light = worldRenderer.directionalLight;

            // Get normalized light direction (from light position to origin)
            this._lightDir.copy(light.position).normalize();

            // For upward-facing surface, normal is (0, 1, 0)
            // N·L = lightDir.y (the Y component of the normalized direction)
            const NdotL = Math.max(0, this._lightDir.y);

            this._directionalContrib.copy(light.color);
            this._directionalContrib.multiplyScalar(light.intensity * NdotL);
            this._combinedColor.add(this._directionalContrib);
        }

        // Clamp to valid range and apply
        this._combinedColor.r = Math.min(1.0, this._combinedColor.r);
        this._combinedColor.g = Math.min(1.0, this._combinedColor.g);
        this._combinedColor.b = Math.min(1.0, this._combinedColor.b);

        // Apply combined lighting (intensity 1.0 since we pre-multiplied)
        this.entityRenderer.setAmbientLightColor(this._combinedColor, 1.0);

        // Also apply to TerrainDetailSystem (static terrain sprites like grass/trees)
        this.game.call('setTerrainDetailLighting', this._combinedColor);

        // Apply to liquid surfaces (water, lava) in WorldRenderer
        worldRenderer.setAmbientLightColor(this._combinedColor, 1.0);
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
