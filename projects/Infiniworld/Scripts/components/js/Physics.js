class Physics extends engine.Component {
    async init() {
        this.colliders = new Map();
        this.rigidbodies = new Map();
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
        this.preloaded.forEach((c) => {
            if (c.heights) {
                this.createHeightmapCollider(c); // Handle heightmap colliders
            } else {
                this.registerCollider(c); // Handle other colliders
            }
        });        
    }

    setStaticAABBs(aabbs, aabbsToRemove) {
        // Handle static collider removal
        for (const aabbId of aabbsToRemove) {
            this.removeStaticCollider(aabbId);
        }
        
        // Update static colliders if changed
        if (JSON.stringify(this.staticAABBs) !== JSON.stringify(aabbs)) {
            this.updateStaticColliders(aabbs);
            this.staticAABBs = aabbs;
        }
    }
    
    updateStaticColliders(aabbs) {
        // Remove old static colliders
        this.removeAllStaticColliders();
        
        // Create new static colliders
        for (const aabb of aabbs) {
            this.createStaticCollider(aabb);
        }
    }
    
    createStaticCollider(aabb) {
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
        const colliderDesc = r.ColliderDesc.capsule(halfHeight, halfWidth);
        const collider = this.simulation.createCollider(colliderDesc, rigidBody);
        
        // Store reference to the static collider with a unique ID
        const staticId = `static_${centerX}_${centerY}_${centerZ}`;
        this.rigidbodies.set(staticId, { rigidBody, collider });
        
        return staticId;
    }
    
    removeStaticCollider(staticId) {
        if (this.rigidbodies.has(staticId)) {
            const { rigidBody, collider } = this.rigidbodies.get(staticId);
            this.simulation.removeCollider(collider, true);
            this.simulation.removeRigidBody(rigidBody);
            this.rigidbodies.delete(staticId);
            
  
        }
    }
    
    removeAllStaticColliders() {
        for (const [staticId, data] of this.rigidbodies.entries()) {
            if (staticId.startsWith('static_')) {
                this.removeStaticCollider(staticId);
            }
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
    
    handleGroundCollision(entity, data) {
        if(entity.transform.physicsPosition.y - data.size + data.offset.y - entity.transform.velocity.y*this.game.deltaTime > entity.transform.groundHeight - data.size * 8){
            return;
        }
        const rigidBody = data.rigidBody;
        const r = this.RAPIER;
        const reflection = this.game.gameEntity.getComponent('game').world.getReflectionAt(entity.transform.physicsPosition, entity.transform.velocity, data.restitution);
        if(reflection){
            rigidBody.setLinvel(reflection);
            if(reflection.multiplyScalar){
                rigidBody.setTranslation(
                    {
                        x: entity.transform.physicsPosition.x + reflection.x * this.game.deltaTime*5,
                        y: entity.transform.groundHeight + reflection.y * this.game.deltaTime*10,
                        z: entity.transform.physicsPosition.z + reflection.z * this.game.deltaTime*5
                    }
                );
            }
        }
        data.reflected = 5; // Skip a few frames before checking for ground again            
    
 
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
        if (!this.simulation) {
            this.preloaded.push(chunkData);
            return;
        }
        this.createHeightmapCollider(chunkData);
    }

    removeChunkCollider(cx, cz) {
        const chunkId = `heightmap_${cx}_${cz}`;
        if (this.rigidbodies.has(chunkId)) {
            const { rigidBody, collider } = this.rigidbodies.get(chunkId);
            this.simulation.removeCollider(collider, true);
            this.simulation.removeRigidBody(rigidBody);
            this.rigidbodies.delete(chunkId);        
        }
    }

    createHeightmapCollider(chunkData) {
        const r = this.RAPIER;
        const { cx, cz, heightmap } = chunkData;
        const { heights, nx, ny, scale } = heightmap;
      
        // Validate inputs
        if (!heights || heights.length !== nx * ny) {
            console.error('Invalid heightmap data:', { heightsLength: heights.length, expected: nx * ny });
            return;
        }
        if (!scale || !scale.x || !scale.y || !scale.z) {
            console.error('Invalid scale:', scale);
            return;
        }

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
        const heightfield = new Float32Array(heights);
        // const colliderDesc = r.ColliderDesc.heightfield(nx - 1, ny - 1, heightfield, scale)
        //     .setSensor(false);
        const colliderDesc = r.ColliderDesc.trimesh(chunkData.positions, chunkData.indices);
        const collider = this.simulation.createCollider(colliderDesc, rigidBody);

        // Store collider with a unique ID
        const chunkId = `heightmap_${cx}_${cz}`;
        this.rigidbodies.set(chunkId, { rigidBody, collider });
        return chunkId;
    }
    createHeightmapMesh(chunkData) {
        const { cx, cz, heightmap } = chunkData;
        const { heights, nx, ny, scale } = heightmap;

        // Validate inputs (same as collider function)
        if (!heights || heights.length !== nx * ny) {
            console.error('Invalid heightmap data:', { heightsLength: heights.length, expected: nx * ny });
            return;
        }
        if (!scale || !scale.x || !scale.y || !scale.z) {
            console.error('Invalid scale:', scale);
            return;
        }

        // Create geometry for the heightmap
        const geometry = new THREE.PlaneGeometry(
            scale.x, // Width of the plane
            scale.z, // Height (depth) of the plane
            nx - 1,             // Width segments
            ny - 1              // Height segments
        );

        // Update vertex positions to match heightmap
        const vertices = geometry.attributes.position.array;
        for (let i = 0; i < heights.length; i++) {
            const vertexIndex = i * 3; // Each vertex has x, y, z
            vertices[vertexIndex + 2] = heights[i] * scale.y; // Set y-coordinate (height) scaled by scale.y
        }
        geometry.attributes.position.needsUpdate = true; // Mark for update
        geometry.computeVertexNormals(); // Recalculate normals for lighting

        // Create material
        const material = new THREE.MeshStandardMaterial({
            color: 0x00ff00, // Green for visibility, adjust as needed
            wireframe: true   // Wireframe to visualize mesh structure
        });

        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);

        // Position mesh to match collider
        mesh.position.set(
            cx * this.game.terrain.chunkSize, // Center x
            1,                                                           // y (heights are in geometry)
            cz * this.game.terrain.chunkSize  // Center z
        );

        // Rotate plane to lie flat (x, z plane), as PlaneGeometry is initially in x, y plane
        mesh.rotation.x = -Math.PI / 2;

        // Add to scene
        this.game.scene.add(mesh);

        // Store mesh for debugging (optional)
        const chunkId = `heightmap_${cx}_${cz}`;
        this.meshes = this.meshes || new Map(); // Assuming a meshes Map to store
        this.meshes.set(chunkId, mesh);

        return chunkId;
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