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
        this.shouldUpdate = false;
    }

    registerCollider(collider) {
        let entity = collider.parent;
        if (!collider.id || !entity.transform.position) return;
        const aabb = collider.getAABB(entity.transform.position);        
        this.colliders.set(collider.id, {
            entity: entity,
            position: { ...entity.transform.position },
            velocity: { ...entity.transform.velocity },
            aabb,
            collider: {
                type: collider.type,
                size: collider.size,                
                gravity: collider.gravity,
                offset: collider.offset,
                mass: collider.mass,
                restitution: collider.restitution
            },
            grounded: false
        });
    }

    unregisterCollider(colliderId) {
        this.colliders.delete(colliderId);
    }

    startPhysicsUpdate(deltaTime) {
        const currentTime = Date.now() / 1000;
        this.lastUpdate = currentTime;
        this.deltaTime = deltaTime || 1 / 60;
        this.physicsDataBuffer = [];
        this.collisionDataBuffer = [];
        this.shouldUpdate = true;
    }

    collectPhysicsData(collider) {
        if(!this.shouldUpdate) return;
        const entity = collider.parent;
        const data = this.colliders.get(collider.id);
        if (!data) return;
        this.physicsDataBuffer.push({
            id: collider.id,
            position: entity.transform.physicsPosition.clone(),
            velocity: entity.transform.velocity.clone(),
            aabb: data.aabb,
            collider: data.collider
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
            deltaTime: this.game.deltaTime,
            gravity: -9.86,
            biomeConfig: biomeConfig,
            chunkSize: terrainComponent.chunkSize,
            chunkResolution: terrainComponent.chunkResolution
        });
        this.shouldUpdate = false;
    }

    handleWorkerMessage(e) {
        const { entities } = e.data;
        entities.forEach((updated) => {
            const data = this.colliders.get(updated.id);
            if (!data) return;
            data.entity.transform.physicsPosition.x = updated.position.x;
            data.entity.transform.physicsPosition.y = updated.position.y;
            data.entity.transform.physicsPosition.z = updated.position.z;
            data.entity.transform.velocity.x = updated.velocity.x;
            data.entity.transform.velocity.y = updated.velocity.y;
            data.entity.transform.velocity.z = updated.velocity.z;            
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
            if(updated.grounded){
                data.entity.OnGrounded();
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
                physicsEngine.init({gravity: gravity, handleTerrainCollision: terrainGenerator.getReflectionAt.bind(terrainGenerator), getTerrainHeight: terrainGenerator.getHeight.bind(terrainGenerator)});
                
                // Update physics
                const updatedEntities = physicsEngine.update(entities, collisionData, deltaTime);
                
                // Return updated entities
                self.postMessage({ entities: updatedEntities });
            };

        `;
    }
}