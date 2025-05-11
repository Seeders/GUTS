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

// Initialize Ammo.js physics world
function initPhysics() {
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
}

// Wait for Ammo to load
Ammo().then(function(AmmoInstance) {
    AmmoLib = AmmoInstance;
    initPhysics();
    if (debugWorker) console.log("Physics initialized");
});

self.onmessage = function(e) {
    if (!AmmoLib) {
        if (debugWorker) console.warn("Ammo.js not yet initialized");
        return;
    }

    const data = e.data;

    // Process entities
    collisionsThisFrame.clear();

    if (data.entities && data.entities.length > 0) {
        data.entities.forEach(entity => {
            if (!entity.id || !entity.collider) {
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
                if (entity.collider.type === 'sphere') {
                    const radius = Array.isArray(entity.collider.size) ? entity.collider.size[0] || 0.5 : entity.collider.size || 0.5;
                    shape = new AmmoLib.btSphereShape(radius);
                } else if (entity.collider.type === 'box') {
                    const size = Array.isArray(entity.collider.size) ? entity.collider.size : [1, 1, 1];
                    tempVec3.setValue(size[0] || 1, size[1] || 1, size[2] || 1);
                    shape = new AmmoLib.btBoxShape(tempVec3);
                } else {
                    if (debugWorker) console.warn("Unsupported collider type:", entity.collider.type);
                    return;
                }

                tempTransform.setIdentity();
                tempVec3.setValue(
                    entity.position.x || 0,
                    entity.position.y || 0,
                    entity.position.z || 0
                );
                tempTransform.setOrigin(tempVec3);
                
                if (entity.quaternion) {
                    tempQuat.setValue(
                        entity.quaternion.x || 0,
                        entity.quaternion.y || 0,
                        entity.quaternion.z || 0,
                        entity.quaternion.w || 1
                    );
                    tempTransform.setRotation(tempQuat);
                }

                const mass = entity.collider.mass || 1;
                tempVec3.setValue(0, 0, 0); // Reuse for inertia
                if (mass > 0) {
                    shape.calculateLocalInertia(mass, tempVec3);
                }

                const motionState = new AmmoLib.btDefaultMotionState(tempTransform);
                const bodyInfo = new AmmoLib.btRigidBodyConstructionInfo(mass, motionState, shape, tempVec3);
                const body = new AmmoLib.btRigidBody(bodyInfo);
                body.setCcdMotionThreshold(1); // Trigger CCD at small motion
                body.setCcdSweptSphereRadius(entity.collider.size / 2); // Sphere radius for CCD
          
                body.setRestitution(entity.collider.restitution || 0.5);
                body.setFriction(0.5);
                
                tempVec3.setValue(
                    entity.velocity.x || 0,
                    entity.velocity.y || 0,
                    entity.velocity.z || 0
                );
                body.setLinearVelocity(tempVec3);
                
                physicsWorld.addRigidBody(body);
                body.userData = { id: entity.id, collider: entity.collider, reflected: false };

                colliders.set(entity.id, body);
                minfo.set(entity.id, new Float32Array(8));

                AmmoLib.destroy(bodyInfo);

                if (debugWorker) console.log("Created collider:", entity.id, entity.collider.type);
            } else {
               // Update existing rigid body
              const body = colliders.get(entity.id);
              body.userData.reflected = entity.reflected;

              tempTransform.setIdentity();
              tempVec3.setValue(
                  entity.position.x,
                  entity.position.y,
                  entity.position.z
              );
              tempTransform.setOrigin(tempVec3);

              if (entity.reflected) {
                // Update velocity
                tempVec3.setValue(
                    entity.velocity.x,
                    entity.velocity.y,
                    entity.velocity.z
                );
                body.setLinearVelocity(tempVec3);

                  // Update position to match main thread's snapped position
                body.getMotionState().setWorldTransform(tempTransform);
                body.setGravity(new AmmoLib.btVector3(0, 0, 0));
                body.userData.gravityDisabled = true;
              } else {
                // Restore gravity if not reflected
                if (body.userData.gravityDisabled) {
                    body.setGravity(new AmmoLib.btVector3(0, entity.collider.gravity ? gravity : 0, 0));
                    body.userData.gravityDisabled = false;
                }
                body.getMotionState().setWorldTransform(tempTransform);
              }

              if (entity.quaternion) {
                  tempQuat.setValue(
                      entity.quaternion.x,
                      entity.quaternion.y,
                      entity.quaternion.z,
                      entity.quaternion.w
                  );
                  tempTransform.setRotation(tempQuat);
              }
            }
        });
    }

    // Remove colliders
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

    // Update physics
    if (data.deltaTime) {
        const deltaTime = Math.min(data.deltaTime, 1/30);
        physicsWorld.stepSimulation(deltaTime, 10);

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

        // Process ground collision
      //  checkGroundCollisions();
        
        update();
    }
};



function update() {
    const updatedEntities = [];
    const tempTransform = new AmmoLib.btTransform(); // Temp transform for getting world transforms

    colliders.forEach((body, id) => {
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
              position: { x: info[0], y: info[1], z: info[2] },
              quaternion: { x: info[3], y: info[4], z: info[5], w: info[6] },
              velocity: {
                  x: velocity.x(),
                  y: velocity.y(),
                  z: velocity.z()
              },
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