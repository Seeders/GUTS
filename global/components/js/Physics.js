class Physics extends engine.Component {
    async init() {
        this.colliders = new Map();
        this.rigidbodies = new Map();
        this.staticColliderIds = new Set(); // Track which ids in rigidbodies are static
        this.staticAABBs = [];  // Store AABB references, not physics objects
        this.collidersToRemove = [];
        this.lastUpdate = 0;
        this.deltaTime = 0;
        this.game.physics = this;
        this.staticAABBs = [];
        this.preloaded = [];
        await RAPIER.init();
        this.RAPIER = RAPIER; // Store reference for easier access
        this.startSimulation(RAPIER);        
        this.eventQueue = new RAPIER.EventQueue(true); // Enable contact events
    }
    
    async startSimulation(r) {
        // Create world with gravity
        let gravity = new r.Vector3(0.0, -98.1, 0.0);
        this.simulation = new r.World(gravity);
        this.simulation.timestep = 1/60;
        if(this.playerCallback){
            this.playerCallback(this.simulation);
        }
        this.preloaded.forEach((c) => {
            if (c.heights) {
                this.createHeightmapCollider(c); // Handle heightmap colliders
            } else {
                this.registerCollider(c); // Handle other colliders
            }
        });        
    }

    createChunkStaticColliders(chunkId, chunkData) {
        chunkData.collisionAABBs.keys().forEach((worldObjectType) => {
            chunkData.collisionAABBs.get(worldObjectType).forEach((aabb) => {
                this.createStaticCollider(chunkId, worldObjectType, aabb);
            });            
        });
        // this.rigidbodies.get(chunkId).push({ type: 'heightmap', rigidBody, collider });
    }

    registerPlayer(callback){
        if(this.simulation) {
            callback(this.simulation);
        } else {
            this.playerCallback = callback;
        }
    }

    removeStaticCollider(staticId) {
        if (!staticId) {
            return false;
        }
        
        if (this.rigidbodies.has(staticId)) {
            const { rigidBody, collider } = this.rigidbodies.get(staticId);
            
            try {
                if (collider) {
                    this.simulation.removeCollider(collider, true);
                }
                
                if (rigidBody) {
                    this.simulation.removeRigidBody(rigidBody);
                }
                
                this.rigidbodies.delete(staticId);  
                this.staticColliderIds.delete(staticId);
                
                return true;
            } catch (error) {
                console.error(`Error removing static collider ${staticId}:`, error);
                // Still remove from our maps even if physics removal failed
                this.rigidbodies.delete(staticId);
                this.staticColliderIds.delete(staticId);
                return false;
            }
        } else {
            return false;
        }
    }
    registerCollider(collider) {
        const r = this.RAPIER;
        if(!r){
            this.preloaded.push(collider);
            return;
        }
        let entity = collider.parent;
        
        if (!collider.id || !entity.transform.position) {
            return;
        }
        
        // Create rigid body
        let rigidBodyDesc;
        if (collider.mass <= 0) {
            rigidBodyDesc = r.RigidBodyDesc.fixed();
        } else {
            rigidBodyDesc = r.RigidBodyDesc.dynamic()
                .setLinearDamping(0.2)
                .setAngularDamping(0.4)
                .setCcdEnabled(true);
        }
        
        // Set initial position
        rigidBodyDesc.setTranslation(
            entity.transform.position.x + collider.offset.x,
            entity.transform.position.y + collider.offset.y,
            entity.transform.position.z + collider.offset.z
        );
        
        // Set initial velocity if available
        if (entity.transform.velocity) {
            rigidBodyDesc.setLinvel(
                entity.transform.velocity.x,
                entity.transform.velocity.y,
                entity.transform.velocity.z
            );
        }
        
        // Create the rigid body
        const rigidBody = this.simulation.createRigidBody(rigidBodyDesc);
        rigidBody.ccd = true;
        // Create collider shape based on type
        let colliderDesc;
        switch (collider.type) {
            case 'sphere':
                colliderDesc = r.ColliderDesc.ball(collider.size);
                break;
            case 'box':
                colliderDesc = r.ColliderDesc.cuboid(
                    collider.size, collider.size, collider.size
                );
                break;
            case 'capsule':
                colliderDesc = r.ColliderDesc.capsule(
                    collider.size, collider.size / 2
                );
                break;
            default:
                colliderDesc = r.ColliderDesc.ball(collider.size);
                break;
        }
        
        // Set restitution (bounciness)
        colliderDesc.setRestitution(collider.restitution).setMass(collider.mass);
        // Create the collider
        const rapierCollider = this.simulation.createCollider(colliderDesc, rigidBody);
        
        // Store data for tracking
        const data = {
            entity: entity,
            type: collider.type,
            size: collider.size,
            gravity: collider.gravity,
            offset: collider.offset,
            mass: collider.mass,
            restitution: collider.restitution,
            rigidBody: rigidBody,
            rapierCollider: rapierCollider,
            reflected: 0,
            wasGrounded: false
        };
        
        this.colliders.set(collider.id, data);
        
        
        return rigidBody;
    }

    unregisterCollider(colliderId) {
        if (this.colliders.has(colliderId)) {
            const data = this.colliders.get(colliderId);
            
            // Remove the Rapier collider and rigid body
            if (data.rapierCollider) {
                this.simulation.removeCollider(data.rapierCollider, true);
            }
            
            if (data.rigidBody) {
                this.simulation.removeRigidBody(data.rigidBody);
            }
            
            this.colliders.delete(colliderId);
            
           
        }
    }


    sendToWorker() {
        // Since we're not using a worker anymore, this method now runs the simulation step
        // and updates all entity positions directly
        
        
        // Step the physics simulation
        this.simulation.step();
        
        // Update all entity positions based on the simulation results
        for (const [colliderId, data] of this.colliders.entries()) {
            const entity = data.entity;
            const rigidBody = data.rigidBody;
            
            if (!rigidBody || !entity) continue;
            
            // Get position from physics
            const position = rigidBody.translation();
            entity.transform.physicsPosition.set(
                position.x,
                position.y,
                position.z
            );
            
            // Get velocity from physics
            const velocity = rigidBody.linvel();
            entity.transform.velocity.set(
                velocity.x,
                velocity.y,
                velocity.z
            );
            
            // Get rotation from physics (quaternion)
            const rotation = rigidBody.rotation();
            entity.transform.quaternion.set(
                rotation.x,
                rotation.y,
                rotation.z,
                rotation.w
            );
            
            // Handle ground detection
               // Update AABB if the method exists
            if (entity.getAABB) {
                data.aabb = entity.getAABB(entity.transform.physicsPosition);
            }
           
            // Handle collision detection
            this.detectCollisions(colliderId, data);
        }
        // Process colliders to remove
        for (const colliderId of this.collidersToRemove) {
            this.unregisterCollider(colliderId);
        }
        this.collidersToRemove = [];
    }
        
    detectCollisions(data) {

        
        // this.eventQueue.drainContactEvents((handle1, handle2, started) => {
        //     const collider1 = this.simulation.getCollider(handle1);
        //     const collider2 = this.simulation.getCollider(handle2);
        //     const data1 = [...this.colliders.entries()].find(([id, data]) => data.rapierCollider === collider1);
        //     const data2 = [...this.colliders.entries()].find(([id, data]) => data.rapierCollider === collider2);

        //     if (data1 && data2 && started && data1[1].entity.OnCollision) {
        //         data1[1].entity.OnCollision(data2[1]);
        //     }
        // });
    }
    addChunkCollider(chunkData) {
        const { cx, cz } = chunkData;
        if (!this.simulation) {
            this.preloaded.push(chunkData);
            return;
        }
        const chunkId = `${cx},${cz}`;
        if(!this.rigidbodies.has(chunkId)){
            this.rigidbodies.set(chunkId, []);            
        }
        this.createHeightmapCollider(chunkId, chunkData);
        this.createChunkStaticColliders(chunkId, chunkData);
    }

    removeChunkColliders(cx, cz) {
        const chunkId = `${cx},${cz}`;
        
        if (this.rigidbodies.has(`${chunkId}`)) {
            let c = 0;
            this.rigidbodies.get(chunkId).forEach((body) => {                
                const { rigidBody, collider } = body;
                if (collider) {
                    this.simulation.removeCollider(collider, true);
                    c++;
                }
                if (rigidBody) {
                    this.simulation.removeRigidBody(rigidBody);
                }
            });
            this.rigidbodies.delete(chunkId);
        }
    }
    createStaticCollider(chunkId, worldObjectType, aabb) {
        if (!aabb || !aabb.id) {
            console.warn("Invalid AABB provided to createStaticCollider");
            return null;
        }

        if (this.rigidbodies.has(aabb.id)) {
            return;
        }
        
        const r = this.RAPIER;
        const halfWidth = (aabb.max.x - aabb.min.x) / 2;
        const halfHeight = (aabb.max.y - aabb.min.y) / 2;
        const halfDepth = (aabb.max.z - aabb.min.z) / 2;
        
        const centerX = (aabb.max.x + aabb.min.x) / 2;
        const centerY = (aabb.max.y + aabb.min.y) / 2;
        const centerZ = (aabb.max.z + aabb.min.z) / 2;
        
        // Create a static rigid body
        const rigidBodyDesc = r.RigidBodyDesc.fixed()
            .setTranslation(centerX, centerY, centerZ);
        const rigidBody = this.simulation.createRigidBody(rigidBodyDesc);
        
        // Create a cuboid collider
        const colliderDesc = r.ColliderDesc.capsule(halfHeight, halfWidth)
                .setCollisionGroups(0x00020004) // Belongs to group 0x0002, interacts with group 0x0004 (dynamic)
                .setSolverGroups(0x00020004); // Same for solver groups
        const collider = this.simulation.createCollider(colliderDesc, rigidBody);
        
        // Store reference to the static collider with a unique ID
        this.rigidbodies.get(chunkId).push({ type: worldObjectType, rigidBody, collider });
        this.staticColliderIds.add(aabb.id); // Mark this as a static collider

    }
    createHeightmapCollider(chunkId, chunkData) {
        const r = this.RAPIER;
        const { cx, cz } = chunkData;
       // const { heights, nx, ny, scale } = heightmap;
        // Validate inputs

        // Create a static rigid body for the terrain chunk
        const rigidBodyDesc = r.RigidBodyDesc.fixed()
                .setSoftCcdPrediction(5)
                .setTranslation(
                    cx * this.game.terrain.chunkSize,
                    0,
                    cz * this.game.terrain.chunkSize
                );
        const rigidBody = this.simulation.createRigidBody(rigidBodyDesc);
        // Create heightfield collider
       // const heightfield = new Float32Array(heights);
        // const colliderDesc = r.ColliderDesc.heightfield(nx - 1, ny - 1, heightfield, scale)
        //     .setSensor(false);
        const colliderDesc = r.ColliderDesc.trimesh(chunkData.geometry.positions, chunkData.geometry.indices)    
            .setCollisionGroups(0x00010004) // Belongs to group 0x0001, interacts with group 0x0004 (dynamic)
            .setSolverGroups(0x00010004)
            .setRestitution(chunkData.restitution)
            .setFriction(chunkData.friction); // Same for solver groups;
        const collider = this.simulation.createCollider(colliderDesc, rigidBody);    
        // Store collider with a unique ID
      //  this.createHeightmapMesh(cx, cz, chunkData);
        this.rigidbodies.get(chunkId).push({ type: 'heightmap', rigidBody, collider });
    }
    createHeightmapMesh(cx, cz, chunkData) {
        const { geometry } = chunkData;       

        // Create geometry for the heightmap
        const plane = new THREE.BufferGeometry();
        plane.setAttribute('position', new THREE.Float32BufferAttribute(geometry.positions, 3));
        plane.setAttribute('normal', new THREE.Float32BufferAttribute(geometry.normals, 3));
        plane.setIndex(geometry.indices);
        plane.attributes.position.needsUpdate = true; // Mark for update
        plane.attributes.normal.needsUpdate = true; // Mark for update
        plane.computeVertexNormals(); // Recalculate normals for lighting

        // Create material
        const material = new THREE.MeshStandardMaterial({
            color: 0x00ff00, // Green for visibility, adjust as needed
            wireframe: true   // Wireframe to visualize mesh structure
        });

        // Create mesh
        const mesh = new THREE.Mesh(plane, material);

        // Position mesh to match collider
        mesh.position.set(
            cx * this.game.terrain.chunkSize, // Center x
            1,                                                           // y (heights are in geometry)
            cz * this.game.terrain.chunkSize  // Center z
        );

        // // Rotate plane to lie flat (x, z plane), as PlaneGeometry is initially in x, y plane
        // mesh.rotation.x = -Math.PI / 2;
        // Add to scene
        this.game.scene.add(mesh);

        // Store mesh for debugging (optional)
        const chunkId = `heightmap_${cx}_${cz}`;
        this.meshes = this.meshes || new Map(); // Assuming a meshes Map to store
        this.meshes.set(chunkId, mesh);

    }
    onDestroy() {
        // Clean up Rapier resources
        for (const [colliderId, data] of this.colliders.entries()) {
            if (data.rapierCollider) {
                this.simulation.removeCollider(data.rapierCollider, true);
            }
            if (data.rigidBody) {
                this.simulation.removeRigidBody(data.rigidBody);
            }
        }
        
        this.colliders.clear();
        this.rigidbodies.clear();
        this.simulation = null;
    }
    
}