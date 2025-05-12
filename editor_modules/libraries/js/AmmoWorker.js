// Debug flag for worker
const debugWorker = false;

// Initialize Ammo.js
let AmmoLib;
let physicsWorld, collisionConfiguration, dispatcher, broadphase, solver;

const gravity = -9.8*10;
// Colliders and state
const colliders = new Map();
const collisionsThisFrame = new Map();
const minfo = new Map();
let fps = 0;
const f = [0, 0, 0];

// Entity data for ground collision
const entityData = new Map();

// Temporary objects pool to avoid creating/destroying every frame
let tempTransform = null;
let tempVec3 = null;
let tempQuat = null;
let physicsInterval = null;

function initLib(data){
    var config = {
        locateFile: () => `http://${data.hostname || "localhost:5000"}/library/ammo.wasm.wasm`
    }
    // Wait for Ammo to load
    Ammo(config).then((AmmoInstance) => {
        AmmoLib = AmmoInstance;
        collisionConfiguration = new AmmoLib.btDefaultCollisionConfiguration();
        dispatcher = new AmmoLib.btCollisionDispatcher(collisionConfiguration);
        broadphase = new AmmoLib.btDbvtBroadphase();
        solver = new AmmoLib.btSequentialImpulseConstraintSolver();
        physicsWorld = new AmmoLib.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfiguration);
        physicsWorld.setGravity(new AmmoLib.btVector3(0, gravity, 0));

        // Initialize temp objects
        tempTransform = new AmmoLib.btTransform();
        tempVec3 = new AmmoLib.btVector3(0, 0, 0);
        tempQuat = new AmmoLib.btQuaternion(0, 0, 0, 1);

        if (debugWorker) console.log("Physics initialized");
    });
    
}

self.onmessage = function(e) {

    const messageType = e.data.messageType;
    const data = e.data;

    if (messageType == 'setHostname') {                 
        initLib(data);
    } else if(AmmoLib && messageType == "staticAABBs"){
        processStaticAABBs(data);
    } else if(AmmoLib && messageType == "updateEntities"){
        updateEntities(data);
        update();
    }
};

function processStaticAABBs(data){
    const staticAABBs = data.staticAABBs;
    // Process entities
    if (staticAABBs && staticAABBs.length > 0) {

        staticAABBs.forEach(aabb => {
            if (!aabb.id || !aabb.min || !aabb.max) {
                if (debugWorker) console.warn("Skipping invalid static AABB:", aabb);
                return;
            }

            // Validate AABB dimensions
            if (aabb.max.x <= aabb.min.x || aabb.max.y <= aabb.min.y || aabb.max.z <= aabb.min.z) {
                if (debugWorker) console.warn("Invalid AABB dimensions:", aabb);
                return;
            }

            // Skip if already created
            if (colliders.has(aabb.id)) {
                if (debugWorker) console.log("Static AABB already exists:", aabb.id);
                return;
            }

            // Calculate capsule dimensions
            const height = aabb.max.y - aabb.min.y; // Full height of the trunk
            // Use a provided radius or estimate from AABB (e.g., smaller of x/z dimensions)
            const radius = aabb.radius || Math.min((aabb.max.x - aabb.min.x), (aabb.max.z - aabb.min.z)) / 2;
            if (radius <= 0 || height <= 0) {
                if (debugWorker) console.warn("Invalid capsule dimensions: radius=", radius, "height=", height, aabb);
                return;
            }

            // Create capsule shape
            const shape = new AmmoLib.btCapsuleShape(radius, height);

            // Set position (align bottom of capsule with aabb.min.y)
            const centerX = (aabb.min.x + aabb.max.x) / 2;
            const centerZ = (aabb.min.z + aabb.max.z) / 2;
            const centerY = aabb.min.y + (height / 2 + radius); // Capsule center: bottom + height/2 + radius
            tempTransform.setIdentity();
            tempVec3.setValue(centerX, centerY, centerZ);
            tempTransform.setOrigin(tempVec3);

            // Static body (mass = 0)
            const mass = 0;
            tempVec3.setValue(0, 0, 0); // No inertia for static bodies
            const motionState = new AmmoLib.btDefaultMotionState(tempTransform);
            const bodyInfo = new AmmoLib.btRigidBodyConstructionInfo(mass, motionState, shape, tempVec3);
            const body = new AmmoLib.btRigidBody(bodyInfo);

            // Set as static object
            body.setCollisionFlags(body.getCollisionFlags() | AmmoLib.btCollisionObject.CF_STATIC_OBJECT);

            // Configure body
            body.setRestitution(aabb.restitution || 0.5);
            body.setFriction(aabb.friction || 0.5);
            body.userData = { id: aabb.id, collider: { type: 'capsule', static: true }, reflected: false };

            // Add to physics world
            physicsWorld.addRigidBody(body);
            colliders.set(aabb.id, body);
            minfo.set(aabb.id, new Float32Array(8));

            AmmoLib.destroy(bodyInfo);

            if (debugWorker) console.log("Created static capsule collider:", aabb.id, "center:", { x: centerX, y: centerY, z: centerZ }, "radius:", radius, "height:", height);
        });
    }
}

function updateEntities(data){
    collisionsThisFrame.clear();
    if (data.entities && data.entities.length > 0) {
        data.entities.forEach(entity => {
            if (!entity.id) {
                if (debugWorker) console.warn("Skipping entity with missing ID or collider:", entity);
                return;
            }
            
            // Store ground height for the entity
            if (entity.groundHeight !== undefined) {
                entityData.set(entity.id, {
                    groundHeight: entity.groundHeight
                });
            }

            if (!colliders.has(entity.id)) {
                // Create new rigid body
                let shape;
                if (entity.type === 'sphere') {
                    const radius = Array.isArray(entity.size) ? entity.size[0] || 0.5 : entity.size || 0.5;
                    shape = new AmmoLib.btSphereShape(radius);
                } else if (entity.type === 'box') {
                    const size = Array.isArray(entity.size) ? entity.size : [1, 1, 1];
                    tempVec3.setValue(size[0] || 1, size[1] || 1, size[2] || 1);
                    shape = new AmmoLib.btBoxShape(tempVec3);
                } else {
                    if (debugWorker) console.warn("Unsupported collider type:", entity.type);
                    return;
                }

                tempTransform.setIdentity();
                tempVec3.setValue(
                    entity.positionX || 0,
                    entity.positionY || 0,
                    entity.positionZ || 0
                );
                tempTransform.setOrigin(tempVec3);
                
                if (entity.quaternion) {
                    tempQuat.setValue(
                        entity.quaternionX || 0,
                        entity.quaternionY || 0,
                        entity.quaternionZ || 0,
                        entity.quaternionW || 1
                    );
                    tempTransform.setRotation(tempQuat);
                }

                const mass = entity.mass || 1;
                tempVec3.setValue(0, 0, 0); // Reuse for inertia
                if (mass > 0) {
                    shape.calculateLocalInertia(mass, tempVec3);
                }

                const motionState = new AmmoLib.btDefaultMotionState(tempTransform);
                const bodyInfo = new AmmoLib.btRigidBodyConstructionInfo(mass, motionState, shape, tempVec3);
                const body = new AmmoLib.btRigidBody(bodyInfo);
                body.setCcdMotionThreshold(1); // Trigger CCD at small motion
                body.setCcdSweptSphereRadius(entity.size / 2); // Sphere radius for CCD
          
                body.setRestitution(entity.restitution || 0.5);
                body.setFriction(0.5);
                tempVec3.setValue(
                    entity.velocityX,
                    entity.velocityY,
                    entity.velocityZ
                );
                body.setLinearVelocity(tempVec3);
                
                body.setCollisionFlags(0);
                physicsWorld.addRigidBody(body);
                body.userData = { id: entity.id, collider: entity, reflected: false };

                colliders.set(entity.id, body);
                minfo.set(entity.id, new Float32Array(8));

                AmmoLib.destroy(bodyInfo);

                if (debugWorker) console.log("Created collider:", entity.id, entity.type);
            } else {
                // Update existing rigid body
                const body = colliders.get(entity.id);
                body.userData.reflected = entity.reflected;


                if (entity.reflected) {

                        // Set the body collision flag to kinematic
             //       body.setCollisionFlags(2); // 2 is kinematic


                                       // Teleport the body to the new position
                    // tempTransform.setIdentity();
                    // tempVec3.setValue(
                    //     entity.positionX,
                    //     entity.positionY,
                    //     entity.positionZ
                    // );
                    // tempTransform.setOrigin(tempVec3);

                    // Set the velocity (optional: you can keep the existing velocity or set a new one)
                    tempVec3.setValue(
                        entity.velocityX,
                        entity.velocityY,
                        entity.velocityZ
                    );
                    body.setLinearVelocity(tempVec3);
                    //body.setCollisionFlags(0);
                

                    // // Update motion state to teleport the body
                    // const motionState = body.getMotionState();
                    // motionState.setWorldTransform(tempTransform);
                    // body.setMotionState(motionState);
                }           
            }
        });
    }

    if (data.removeColliders && data.removeColliders.length > 0) {
        data.removeColliders.forEach(id => {
            const body = colliders.get(id);
            if (body) {
                physicsWorld.removeRigidBody(body);
                AmmoLib.destroy(body.getCollisionShape());
                AmmoLib.destroy(body.getMotionState());
                AmmoLib.destroy(body);
                colliders.delete(id);
                minfo.delete(id);
                entityData.delete(id); // Also remove entity data
                if (debugWorker) console.log("Removed collider:", id);
            }
        });
    }


  
}


function update() {
    if(physicsWorld){
        physicsWorld.stepSimulation(1/60, 5);

        const numManifolds = dispatcher.getNumManifolds();
        for (let i = 0; i < numManifolds; i++) {
            const manifold = dispatcher.getManifoldByIndexInternal(i);
            const body0 = manifold.getBody0();
            const body1 = manifold.getBody1();
            const numContacts = manifold.getNumContacts();
            if (numContacts > 0) {
                const id0 = body0.userData?.id;
                const id1 = body1.userData?.id;

                if (id0 && id1) {
                    if (!collisionsThisFrame.has(id0)) collisionsThisFrame.set(id0, []);
                    if (!collisionsThisFrame.has(id1)) collisionsThisFrame.set(id1, []);
                    collisionsThisFrame.get(id0).push(id1);
                    collisionsThisFrame.get(id1).push(id0);
                }
            }
        }
    }
    const updatedEntities = [];
    const tempTransform = new AmmoLib.btTransform(); // Temp transform for getting world transforms

    colliders.forEach((body, id) => {
        if(body.userData.collider.static) return;
        const info = minfo.get(id);
        body.getMotionState().getWorldTransform(tempTransform);
        const origin = tempTransform.getOrigin();
        const rotation = tempTransform.getRotation();

        info[0] = origin.x();
        info[1] = origin.y();
        info[2] = origin.z();
        info[3] = rotation.x();
        info[4] = rotation.y();
        info[5] = rotation.z();
        info[6] = rotation.w();
        info[7] = body.isActive() ? 0 : 1;

        const velocity = body.getLinearVelocity();
        const collisions = collisionsThisFrame.get(id) || [];
        const collidedWithTerrain = collisions.includes('terrain');
        const entityCollisions = collisions.filter(cid => cid !== 'terrain');
        if(!isNaN(info[0])){
          updatedEntities.push({
              id,
              positionX: info[0], 
              positionY: info[1], 
              positionZ: info[2],
              quaternionX: info[3], 
              quaternionY: info[4], 
              quaternionZ: info[5], 
              quaternionW: info[6],
              velocityX: velocity.x(),
              velocityY: velocity.y(),
              velocityZ: velocity.z(),
              sleeping: info[7] === 1,
              collisions: entityCollisions,
              collidedWithTerrain: collidedWithTerrain
          });
        }
    });

    // Clean up temporary transform
    AmmoLib.destroy(tempTransform);

    // Calculate FPS
    f[1] = Date.now();
    if (f[1] - 1000 > f[0]) {
        f[0] = f[1];
        fps = f[2];
        f[2] = 0;
    }
    f[2]++;

    self.postMessage({
        perf: fps,
        entities: updatedEntities
    });
}

// Clean up function - call this when terminating the worker
function cleanup() {
    if (!AmmoLib) return;
    
    // Clean up all colliders
    colliders.forEach((body, id) => {
        physicsWorld.removeRigidBody(body);
        AmmoLib.destroy(body.getCollisionShape());
        AmmoLib.destroy(body.getMotionState());
        AmmoLib.destroy(body);
    });
    colliders.clear();
    entityData.clear();
    
    // Clean up temporary objects
    AmmoLib.destroy(tempTransform);
    AmmoLib.destroy(tempVec3);
    AmmoLib.destroy(tempQuat);
    
    // Clean up physics world
    AmmoLib.destroy(physicsWorld);
    AmmoLib.destroy(solver);
    AmmoLib.destroy(broadphase);
    AmmoLib.destroy(dispatcher);
    AmmoLib.destroy(collisionConfiguration);
}

// Handle worker termination
self.addEventListener('close', () => {
    cleanup();
});