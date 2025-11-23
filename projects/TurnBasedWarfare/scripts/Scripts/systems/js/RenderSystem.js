class RenderSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.renderSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // EntityRenderer handles ALL rendering
        this.entityRenderer = null;

        // Track which entities have been spawned
        this.spawnedEntities = new Set();

        // Debug stats
        this._frame = 0;
        this._stats = {
            entitiesProcessed: 0,
            entitiesSpawned: 0,
            entitiesUpdated: 0
        };

        this._bindDebugHelpers();
    }

    init() {
        // Register gameManager methods that delegate to EntityRenderer
        this.game.gameManager.register('setInstanceClip', this.setInstanceClip.bind(this));
        this.game.gameManager.register('setInstanceSpeed', this.setInstanceSpeed.bind(this));
        this.game.gameManager.register('isInstanced', this.isInstanced.bind(this));
        this.game.gameManager.register('getEntityAnimationState', this.getEntityAnimationState.bind(this));
        this.game.gameManager.register('setInstanceAnimationTime', this.setInstanceAnimationTime.bind(this));
        this.game.gameManager.register('getBatchInfo', this.getBatchInfo.bind(this));
        this.game.gameManager.register('removeInstance', this.removeInstance.bind(this));

        // Initialize EntityRenderer with game context
        const collections = this.game.getCollections?.();
        const projectName = collections?.configs?.game?.projectName || 'TurnBasedWarfare';

        // Count instances needed for each entity type from level data
        const capacitiesByType = this.calculateInstanceCapacities();

        this.entityRenderer = new GUTS.EntityRenderer({
            scene: this.game.scene,
            collections: collections,
            projectName: projectName,
            modelManager: this.game.modelManager,
            getPalette: () => collections?.palette || {},
            modelScale: 32,
            defaultCapacity: 1024,
            capacitiesByType: capacitiesByType,
            minMovementThreshold: 0.1
        });

        // Register EntityRenderer for other systems to use (e.g., WorldSystem for cliff spawning)
        this.game.gameManager.register('getEntityRenderer', () => this.entityRenderer);

        // Register method to update capacities after terrain loads
        this.game.gameManager.register('updateInstanceCapacities', this.updateInstanceCapacities.bind(this));

        console.log('[RenderSystem] Initialized with EntityRenderer');
    }

    /**
     * Calculate instance capacities needed for each entity type
     * by counting them in the level data
     */
    calculateInstanceCapacities() {
        const capacities = {};

        // Get tile map from TerrainSystem via gameManager
        const tileMap = this.game.gameManager.call('getTileMap');
        if (!tileMap?.worldObjects) {
            console.log('[RenderSystem] No world objects in level, using default capacities');
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
            console.log(`[RenderSystem] Calculated capacity for ${key}: ${capacities[key]} (${count} in level)`);
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
                console.log(`[RenderSystem] Calculated capacity for ${key}: ${capacities[key]} (${count} in level)`);
            }
        }

        return capacities;
    }

    /**
     * Update instance capacities after terrain has loaded
     * Called by WorldSystem when terrain data is available
     */
    updateInstanceCapacities() {
        console.log('[RenderSystem] updateInstanceCapacities() called');

        if (!this.entityRenderer) {
            console.warn('[RenderSystem] Cannot update capacities - EntityRenderer not initialized');
            return;
        }

        const capacities = this.calculateInstanceCapacities();

        console.log('[RenderSystem] Calculated capacities:', capacities);

        // Update EntityRenderer's capacity map
        this.entityRenderer.capacitiesByType = capacities;

        console.log('[RenderSystem] Updated EntityRenderer.capacitiesByType:', this.entityRenderer.capacitiesByType);
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

        console.log(`[RenderSystem] Removed instance ${entityId} for re-spawn`);
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

    _bindDebugHelpers() {
        if (typeof window !== "undefined") {
            window.RenderSystemDebug = {
                getStats: () => this._stats,
                getEntityRenderer: () => this.entityRenderer,
                getRendererStats: () => this.entityRenderer?.stats
            };
        }
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
        const CT = this.componentTypes;
        const entities = this.game.getEntitiesWith(CT.POSITION, CT.RENDERABLE);
        this._stats.entitiesProcessed = entities.length;

        for (const entityId of entities) {
            const pos = this.game.getComponent(entityId, CT.POSITION);
            const renderable = this.game.getComponent(entityId, CT.RENDERABLE);
            const velocity = this.game.getComponent(entityId, CT.VELOCITY);
            const facing = this.game.getComponent(entityId, CT.FACING);
            const unitType = this.game.getComponent(entityId, CT.UNIT_TYPE);

            if (!unitType) continue;

            // Check fog of war visibility (cliffs and worldObjects always visible)
            const fow = this.game.fogOfWarSystem;
            const isVisible = fow ? fow.isVisibleAt(pos.x, pos.z) : true;
            const isAlwaysVisible = unitType.collection === "worldObjects" || unitType.collection === "cliffs";

            if (!isAlwaysVisible && !isVisible) {
                // Entity not visible, skip rendering
                continue;
            }

            // Validate renderable data
            if (typeof renderable.objectType !== 'string' || typeof renderable.spawnType !== 'string') {
                console.error(`[RenderSystem] Invalid renderable for ${entityId}:`, renderable);
                continue;
            }

            // Check if entity already spawned
            if (!this.spawnedEntities.has(entityId)) {
                // Spawn new entity
                await this.spawnEntity(entityId, {
                    collection: renderable.objectType,
                    type: renderable.spawnType,
                    position: { x: pos.x, y: pos.y, z: pos.z },
                    rotation: facing?.angle,
                    facing: facing,
                    velocity: velocity
                });
            } else {
                // Update existing entity
                this.updateEntity(entityId, {
                    position: { x: pos.x, y: pos.y, z: pos.z },
                    rotation: facing?.angle,
                    facing: facing,
                    velocity: velocity
                });
            }
        }

        // Cleanup removed entities
        this.cleanupRemovedEntities(new Set(entities));
    }

    async spawnEntity(entityId, data) {
        const spawned = await this.entityRenderer.spawnEntity(entityId, data);
        if (spawned) {
            this.spawnedEntities.add(entityId);
            this._stats.entitiesSpawned++;
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

    hideEntityInstance(entityId) {
        // For now, we just don't update hidden entities
        // Could implement visibility toggle in EntityRenderer if needed
        console.warn('[RenderSystem] hideEntityInstance not fully implemented');
    }

    showEntityInstance(entityId) {
        // For now, entities are always visible when spawned
        console.warn('[RenderSystem] showEntityInstance not fully implemented');
    }

    // ============ DEBUG HELPERS ============

    dumpBatches() {
        if (!this.entityRenderer) return;

        console.log('[RenderSystem] VAT Batches:');
        for (const [batchKey, batch] of this.entityRenderer.vatBatches) {
            console.log(`  ${batchKey}:`, {
                capacity: batch.capacity,
                count: batch.count,
                entities: batch.entityMap.size,
                meta: batch.meta ? {
                    clips: batch.meta.clips?.map(c => c.name),
                    baseScale: batch.meta.baseScale
                } : 'none'
            });
        }
    }

    dumpInstances() {
        if (!this.entityRenderer) return;

        console.log('[RenderSystem] Spawned Entities:');
        for (const [entityId, entity] of this.entityRenderer.entities) {
            console.log(`  ${entityId}:`, {
                type: entity.type,
                collection: entity.collection,
                entityType: entity.entityType,
                batchKey: entity.batchKey,
                instanceIndex: entity.instanceIndex
            });
        }
    }
}
