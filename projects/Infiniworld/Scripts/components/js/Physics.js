class Physics extends engine.Component {
    init() {
        const workerCode = this.getWorkerCode();
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.workerBlobURL = URL.createObjectURL(blob);
        this.worker = new Worker(this.workerBlobURL);
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
        this.colliders = new Map();
        this.physicsDataBuffer = [];
        this.collisionDataBuffer = [];
        this.lastUpdate = 0;
        this.updateInterval = 1 / 60; // 60 Hz
        this.deltaTime = 0;
        this.game.physics = this;
    }

    registerCollider(collider) {
        let entity = collider.parent;
        if (!collider.id || !entity.transform.position) return;

        const aabb = collider.getAABB(entity.transform.position);
        this.colliders.set(collider.id, {
            entity: entity,
            position: { ...entity.transform.position },
            velocity: { ...entity.velocity },
            aabb,
            collider: {
                type: collider.type || "sphere",
                size: collider.size || 1,
                offset: collider.offset
            },
            mass: collider.mass || 1,
            restitution: collider.restitution || 1,
            grounded: false
        });
    }

    unregisterCollider(colliderId) {
        this.colliders.delete(colliderId);
    }

    startPhysicsUpdate(deltaTime) {
        const currentTime = Date.now() / 1000;
        if (currentTime - this.lastUpdate < this.updateInterval) return false;
        this.lastUpdate = currentTime;
        this.deltaTime = deltaTime || 1 / 60;
        this.physicsDataBuffer = [];
        this.collisionDataBuffer = [];
        return true;
    }

    collectPhysicsData(collider) {
        const data = this.colliders.get(collider.id);
        if (!data) return;
        this.physicsDataBuffer.push({
            id: collider.id,
            position: data.position,
            velocity: data.velocity,
            aabb: data.aabb,
            collider: data.collider,
            mass: data.mass,
            restitution: data.restitution
        });

        const entityAABB = data.aabb;
        const collisions = this.game.gameEntity.getComponent('game').infiniWorld.checkTreeCollisions(entityAABB);
        this.collisionDataBuffer.push({ colliderId: collider.id, collisions });
    }

    sendToWorker(terrainComponent) {
        if (this.physicsDataBuffer.length === 0) return;

        // Extract biome configuration to send to worker
        let biomeConfig = {};
        if (terrainComponent && terrainComponent.biomes) {
            // Deep copy the biome configuration
            biomeConfig = terrainComponent.biomes;
        }

        this.worker.postMessage({
            entities: this.physicsDataBuffer,
            collisionData: this.collisionDataBuffer,
            deltaTime: this.deltaTime,
            gravity: -9.86,
            biomeConfig: biomeConfig,
            chunkSize: terrainComponent.chunkSize,
            chunkResolution: terrainComponent.chunkResolution
        });
    }

    handleWorkerMessage(e) {
        const { entities } = e.data;
        entities.forEach((updated) => {
            const data = this.colliders.get(updated.id);
            if (!data) return;
            data.entity.transform.physicsPosition.x = updated.position.x;
            data.entity.transform.physicsPosition.y = updated.position.y;
            data.entity.transform.physicsPosition.z = updated.position.z;
            data.entity.velocity.x = updated.velocity.x;
            data.entity.velocity.y = updated.velocity.y;
            data.entity.velocity.z = updated.velocity.z;            
            data.position = { ...updated.position };
            data.velocity = { ...updated.velocity };
            data.grounded = updated.grounded;
            data.entity.grounded = updated.grounded;
            // Update AABB if position changed
            data.aabb = data.entity.getAABB(data.position);
            if(updated.collidedWithEntity){
                data.entity.OnCollision(this.colliders.get(updated.collidedWith));   
            }
            if(updated.collidedWithStatic){
                data.entity.OnStaticCollision();
            }
        });
    }

    onDestroy() {
        if (this.worker) {
            this.worker.terminate();
            URL.revokeObjectURL(this.workerBlobURL);
            this.worker = null;
            this.workerBlobURL = null;
        }
        this.colliders.clear();
    }

    getWorkerCode() {
        return `
            ${this.game.config.libraries["SimplexNoise"].script}

            ${this.game.config.libraries["TerrainGenerator"].script}
           
            ${this.game.config.libraries["PhysicsEngine"].script}

            const noise = new SimplexNoise();
            const physicsEngine = new PhysicsEngine();
            const terrainGenerator = new TerrainGenerator();
            
            // Handle worker messages
            self.onmessage = function(e) {
                const { entities, collisionData, deltaTime, gravity, biomeConfig, chunkSize, chunkResolution } = e.data;
                
                terrainGenerator.init(
                    biomeConfig, 
                    chunkSize, 
                    chunkResolution,
                    noise
                );
                physicsEngine.init({gravity: gravity, getTerrainHeight: terrainGenerator.getHeight.bind(terrainGenerator)});
                
                // Update physics
                const updatedEntities = physicsEngine.update(entities, collisionData, deltaTime);
                
                // Return updated entities
                self.postMessage({ entities: updatedEntities });
            };

        `;
    }
}