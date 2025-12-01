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
        const entities = this.game.getEntitiesWith("position", "renderable");
        this._stats.entitiesProcessed = entities.length;

        for (const entityId of entities) {
            const pos = this.game.getComponent(entityId, "position");
            const renderable = this.game.getComponent(entityId, "renderable");
            const velocity = this.game.getComponent(entityId, "velocity");
            const facing = this.game.getComponent(entityId, "facing");
            const unitType = this.game.getComponent(entityId, "unitType");

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

}
