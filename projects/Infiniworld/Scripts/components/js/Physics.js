class Physics extends engine.Component {
    init() {
        const workerCode = this.getWorkerCode();
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.workerBlobURL = URL.createObjectURL(blob);
        this.worker = new Worker(this.workerBlobURL);
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
        this.worker.postMessage({ messageType: 'setHostname', hostname: location.host });
        this.colliders = new Map();
        this.collidersToRemove = [];
        this.physicsDataBuffer = [];
        this.groundHeightBuffer = [];
        this.lastUpdate = 0;
        this.updateInterval = 1 / 60; // 60 Hz
        this.deltaTime = 0;
        this.game.physics = this;
        this.shouldUpdate = false;
        this.debugPhysics = false;
        this.staticAABBs = [];
    }


    setStaticAABBs(aabbs, aabbsToRemove){
        this.collidersToRemove = [...this.collidersToRemove, ...aabbsToRemove];
        
        if(this.staticAABBs != aabbs){
            this.staticAABBs = aabbs;

            this.worker.postMessage({
                messageType: 'staticAABBs',
                staticAABBs: this.staticAABBs
            });
        }
    }

    registerCollider(collider) {
        let entity = collider.parent;
        if (!collider.id || !entity.transform.position) {
            if (this.debugPhysics) console.warn("Failed to register collider: missing ID or position", collider);
            return;
        }
        let data = {
            entity: entity,
            type: collider.type,
            size: collider.size,
            gravity: collider.gravity,
            offset: collider.offset,
            mass: collider.mass,
            restitution: collider.restitution,
            reflected : 0       
        }
        this.colliders.set(collider.id, data);
        this.physicsDataBuffer.push(this.getPhysicsDataBuffer(entity, data, entity.transform.velocity));
        if (this.debugPhysics) console.log("Registered collider:", collider.id, collider.type);
    }

    unregisterCollider(colliderId) {
        if (this.colliders.has(colliderId)) {
            this.colliders.delete(colliderId);
            this.collidersToRemove.push(colliderId);
            if (this.debugPhysics) console.log("Unregistered collider:", colliderId);
        }
    }

    startPhysicsUpdate(deltaTime) {
        const currentTime = Date.now() / 1000;
        this.lastUpdate = currentTime;
        this.deltaTime = deltaTime;
        this.shouldUpdate = true;
    }

    sendToWorker() {
        this.worker.postMessage({
            messageType: 'updateEntities',
            entities: this.physicsDataBuffer,
            removeColliders: this.collidersToRemove,
            deltaTime: this.deltaTime,
        });
        if (this.debugPhysics) {
            console.log("Physics update sent to worker:", {
                entities: this.physicsDataBuffer.length,
                removeColliders: (this.collidersToRemove || []).length
            });
        }

        this.physicsDataBuffer = [];
        this.collidersToRemove = [];
        this.shouldUpdate = false;
    }

    collectPhysicsData(collider) {
        if (!this.shouldUpdate) return;

        const entity = collider.parent;
        const data = this.colliders.get(collider.id);

        if (!data) {
            if (this.debugPhysics) console.warn("No collider data found for:", collider.id);
            return;
        }
        let v = new THREE.Vector3().copy(entity.transform.velocity);
        let reflected = false;
        if(data.reflected <= 0 && entity.transform.physicsPosition.y - data.size + data.offset.y + v.y*this.game.deltaTime <= entity.transform.groundHeight) {                  
            reflected = true; 
            data.reflected = 0;
            // Smoothly reduce restitution based on velocity
            const velocityMagnitude = v.length() * this.deltaTime;
            const minVelocity = 10;  // Below this speed, no bounce
            const maxVelocity = 20; // Above this speed, full bounce
            const baseRestitution = data.restitution;  
            // Calculate smoothed restitution factor
            let r = baseRestitution;
            if (velocityMagnitude < maxVelocity) {
                // Smooth interpolation between 0 and full restitution
                const t = Math.max(0, (velocityMagnitude - minVelocity) / (maxVelocity - minVelocity));
                r = baseRestitution * (t); // Square for more gradual initial reduction
            }
            v.copy(this.game.gameEntity.getComponent("game").world.getReflectionAt(entity.transform.position, v, baseRestitution));
       
            entity.transform.physicsPosition.y = entity.transform.groundHeight + data.size - data.offset.y + .01;   
            
            this.physicsDataBuffer.push(this.getPhysicsDataBuffer(entity, data, v));
        } else {
            data.reflected--;
        }    
    }
    getPhysicsDataBuffer(entity, collider, velocity){
        return {       
            id: entity.id,
            positionX: entity.transform.physicsPosition.x, 
            positionY: entity.transform.physicsPosition.y, 
            positionZ: entity.transform.physicsPosition.z,
            velocityX: velocity.x,
            velocityY: velocity.y,
            velocityZ: velocity.z,
            quaternionW: entity.transform.quaternion.w,
            quaternionX: entity.transform.quaternion.x,
            quaternionY: entity.transform.quaternion.y,
            quaternionZ: entity.transform.quaternion.z,
            groundHeight: entity.transform.groundHeight,
            aabb: collider.aabb,
            type: collider.type,
            size: collider.size,
            gravity: collider.gravity,
            offsetX: collider.offset.z,
            offsetY: collider.offset.y,
            offsetZ: collider.offset.z,
            mass: collider.mass,
            restitution: collider.restitution,
            reflected: true
        }
    }

    handleWorkerMessage(e) {
        const { entities } = e.data;
        if (!entities) {
            if (this.debugPhysics) console.warn("No entities in physics worker response");
            return;
        }
        entities.forEach(updated => {
            const data = this.colliders.get(updated.id);
            if (!data) {
                if (this.debugPhysics) console.warn("No collider data found for updated entity:", updated.id);
                return;
            }
            const entity = data.entity;
    
            entity.transform.physicsPosition.set(
                updated.positionX,
                updated.positionY,
                updated.positionZ
            );
            entity.transform.velocity.set(
                updated.velocityX,
                updated.velocityY,
                updated.velocityZ
            );

            entity.transform.quaternion.set(
                updated.quaternionX,
                updated.quaternionY,
                updated.quaternionZ,
                updated.quaternionW
            );

            data.positionX = updated.positionX;
            data.positionY = updated.positionY;
            data.positionZ = updated.positionZ;
            
            data.velocityX = updated.velocityX;
            data.velocityY = updated.velocityY;
            data.velocityZ = updated.velocityZ;

            data.quaternionW = updated.quaternionW;
            data.quaternionX = updated.quaternionX;
            data.quaternionY = updated.quaternionY;
            data.quaternionZ = updated.quaternionZ;

            data.aabb = entity.getAABB ? entity.getAABB(entity.transform.physicsPosition) : data.aabb;

            // Handle entity-entity collisions
            if (updated.collisions && updated.collisions.length > 0) {
                updated.collisions.forEach(collidedId => {
                    const collidedData = this.colliders.get(collidedId);
                    if (collidedData && entity.OnCollision) {
                        entity.OnCollision(collidedData);
                    }
                });
            }

            // Handle entity-terrain collisions
            if (updated.collidedWithTerrain) {
                if (entity.OnStaticCollision) {
                    entity.OnStaticCollision();
                }
            }

            // Handle just-grounded events
            if (data.grounded && !data.wasGrounded) {
                if (entity.OnGrounded) {
                    entity.OnGrounded();
                }
                data.wasGrounded = true;
            } else if (!data.grounded) {
                data.wasGrounded = false;
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
    ${this.game.config.libraries["AmmoWasm"].script}    
    ${this.game.config.libraries["AmmoWorker"].script}    
`;
    }
}