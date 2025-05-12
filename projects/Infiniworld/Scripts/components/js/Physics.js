class Physics extends engine.Component {
    init() {
        const workerCode = this.getWorkerCode();
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.workerBlobURL = URL.createObjectURL(blob);
        this.worker = new Worker(this.workerBlobURL);
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
        this.worker.postMessage({ hostname: location.host });
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


    setStaticAABBs(aabbs){
        this.staticAABBs = aabbs;
    }

    setStaticAABBsToRemove(aabbs){
        this.collidersToRemove = [...this.collidersToRemove, ...aabbs];
    }

    registerCollider(collider) {
        let entity = collider.parent;
        if (!collider.id || !entity.transform.position) {
            if (this.debugPhysics) console.warn("Failed to register collider: missing ID or position", collider);
            return;
        }

        const aabb = collider.getAABB(entity.transform.position);
        this.colliders.set(collider.id, {
            entity: entity,
            position: { ...entity.transform.position },
            quaternion: { ...entity.transform.quaternion },
            velocity: { ...entity.transform.velocity },
            aabb,
            collider: {
                type: collider.type,
                size: collider.size,
                gravity: collider.gravity,
                offset: collider.offset,
                mass: collider.mass,
                restitution: collider.restitution,
                reflected : 0
            },
            grounded: false
        });

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
        this.deltaTime = deltaTime || 1 / 60;
        this.physicsDataBuffer = [];
        this.shouldUpdate = true;
    }

    sendToWorker() {
        if (this.physicsDataBuffer.length === 0 && !this.collidersToRemove) return;

        const gravityValue = -9.8 * 2.5;
        this.worker.postMessage({
            entities: this.physicsDataBuffer,
            removeColliders: this.collidersToRemove || [],
            deltaTime: this.deltaTime,
            staticAABBs: this.staticAABBs,
            gravity: gravityValue
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
        let grounded = true;
        if(data.collider.reflected <= 0 && entity.transform.physicsPosition.y - data.collider.size + data.collider.offset.y + v.y*this.game.deltaTime <= entity.transform.groundHeight) {                  
            reflected = true; 
            data.collider.reflected = 0;
            // Smoothly reduce restitution based on velocity
            const velocityMagnitude = v.length();
            const minVelocity = 10;  // Below this speed, no bounce
            const maxVelocity = 20; // Above this speed, full bounce
            const baseRestitution = data.collider.restitution;
            if(entity.type == 'projectile'){
                console.log(velocityMagnitude);
            }
            // Calculate smoothed restitution factor
            let r = baseRestitution;
            if (velocityMagnitude < maxVelocity) {
                // Smooth interpolation between 0 and full restitution
                const t = Math.max(0, (velocityMagnitude - minVelocity) / (maxVelocity - minVelocity));
                r = baseRestitution * (t); // Square for more gradual initial reduction
            }
            
            v.copy(this.game.gameEntity.getComponent("game").world.getReflectionAt(entity.transform.position, v, r));
            entity.transform.velocity.copy(v);
            if(entity.transform.velocity.length() < 1) entity.transform.velocity.multiplyScalar(0);
            entity.transform.physicsPosition.y = entity.transform.groundHeight + data.collider.size - data.collider.offset.y + 1;  
        } else {
            data.collider.reflected--;
        }

    
       
        this.physicsDataBuffer.push({
            id: collider.id,
            position: entity.transform.physicsPosition.clone(),
            velocity: v,
            quaternion: entity.transform.quaternion.clone(),
            groundHeight: entity.transform.groundHeight,
            aabb: data.aabb,
            collider: data.collider,
            reflected: reflected,
            grounded: grounded
        });
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

            // Update grounded state based on terrain collision
            if(entity.transform.physicsPosition.y - data.collider.size + data.collider.offset.y + updated.velocity.y/30 <= entity.transform.groundHeight){                  
            //    updated.position.y = entity.transform.groundHeight + data.collider.size - data.collider.offset.y + 1;   
            }

            if(new THREE.Vector3(updated.velocity).length() < 10){
                updated.velocity.x = 0;
                updated.velocity.y = 0;
                updated.velocity.z = 0;
            }
       
            entity.transform.physicsPosition.set(
                updated.position.x,
                updated.position.y,
                updated.position.z
            );

            entity.transform.velocity.set(
                updated.velocity.x,
                updated.velocity.y,
                updated.velocity.z
            );

            entity.transform.quaternion.set(
                updated.quaternion.x,
                updated.quaternion.y,
                updated.quaternion.z,
                updated.quaternion.w
            );

            data.position = { ...updated.position };
            data.velocity = { ...updated.velocity };
            data.quaternion = { ...updated.quaternion };
            data.aabb = entity.getAABB ? entity.getAABB(data.position) : data.aabb;

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

        if (e.data.perf && this.debugPhysics) {
            console.log("Physics FPS:", e.data.perf);
        }
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