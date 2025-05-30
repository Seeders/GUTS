/**
 * PhysicsEngine: Handles all physics calculations and collision detection
 * for a 3D environment with entities, terrain, and static objects.
 * Enhanced with continuous collision detection to prevent tunneling.
 */
class PhysicsEngine {
      
    /**
     * Initialize the physics engine with configuration
     * @param {Object} config - Configuration object
     * @param {number} config.gravity - Gravity constant
     * @param {Object} config.biomeConfig - Terrain biome configuration
     * @param {number} config.chunkSize - Size of terrain chunks
     * @param {number} config.chunkResolution - Resolution of terrain chunks
     * @param {number} config.maxSubsteps - Maximum substeps for CCD (default: 5)
     * @param {number} config.speedThreshold - Speed threshold for CCD (default: 10)
     */
    init(config = {}) {
      this.gravity = config.gravity || -9.8;
      this.handleTerrainCollision = config.handleTerrainCollision;    
      this.getTerrainHeight = config.getTerrainHeight;
      
      // Anti-tunneling configuration
      this.maxSubsteps = config.maxSubsteps || 5;
      this.speedThreshold = config.speedThreshold || 10;
      this.minTimeStep = 1/120; // Minimum time step for high precision
    }
  
    /**
     * Update physics for all entities
     * @param {Array} entities - List of entities to update
     * @param {Array} collisionData - Static collision data
     * @param {number} deltaTime - Time step for physics calculation
     * @returns {Array} Updated entities
     */
    update(entities, collisionData, deltaTime) {
      // Reset collision flags
      entities.forEach(entity => {
        if (entity.collider) {
          entity.collidedWithEntity = false;
          entity.collidedWithStatic = false;
          entity.collidedWith = null;
          entity.grounded = false;
        }
      });
      
      // Use sub-steps for fast-moving objects to prevent tunneling
      this.updateWithSubsteps(entities, collisionData, deltaTime);
      
      return entities;
    }
    
    /**
     * Update physics using substeps for continuous collision detection
     * @param {Array} entities - List of entities to update
     * @param {Array} collisionData - Static collision data
     * @param {number} deltaTime - Time step for physics calculation
     */
    updateWithSubsteps(entities, collisionData, deltaTime) {
      // With threshold of 0, all entities use substeps, so no need to filter
      const numSubsteps = Math.min(
        this.maxSubsteps, 
        Math.max(1, Math.ceil(this.getMaxEntitySpeed(entities) / (this.speedThreshold || 0.001)))
      );
      
      // Use at least 3 substeps when maxSubsteps is very high
      const actualSubsteps = Math.max(3, Math.min(numSubsteps, 10));
      const subDeltaTime = deltaTime / actualSubsteps;
      
      // Process all entities together with substeps
      for (let i = 0; i < actualSubsteps; i++) {
        this.processPhysicsStep(entities, collisionData, subDeltaTime);
      }
    }
        
    /**
     * Process a single physics step
     * @private
     */
    processPhysicsStep(entities, collisionData, deltaTime) {
      // Apply gravity and update positions
      this.updateEntitiesPosition(entities, deltaTime);
      
      // Update AABBs after position update but before collision detection
      entities.forEach(entity => {
        if (entity.collider) {
          this.updateEntityAABB(entity);
        }
      });
      
      // Handle entity-entity collisions
      const collisionPairs = this.detectEntityCollisions(entities, deltaTime);
      this.resolveEntityCollisions(collisionPairs);
      
      // Handle terrain and static collisions
      this.resolveTerrainAndStaticCollisions(entities, collisionData, deltaTime);
      
      // Final AABB update after all collision resolution
      entities.forEach(entity => {
        if (entity.collider) {
          this.updateEntityAABB(entity);
        }
      });
    }
  
    /**
     * Update entity positions and AABBs
     * @private
     */
    updateEntitiesPosition(entities, deltaTime) {
      entities.forEach(entity => {
        if (!entity.collider) return;
        
        // Apply gravity
        entity.velocity.y += (entity.collider.gravity ? this.gravity : 0) * 10 * deltaTime;

        // Store previous position for swept collision detection
        entity.previousPosition = { 
          x: entity.position.x, 
          y: entity.position.y, 
          z: entity.position.z 
        };

        // Update position
        entity.position.x += entity.velocity.x * deltaTime;
        entity.position.y += entity.velocity.y * deltaTime;
        entity.position.z += entity.velocity.z * deltaTime;
  
        // Update AABB
        this.updateEntityAABB(entity);
      });
    }
  
    /**
     * Update entity's Axis-Aligned Bounding Box
     * @private
     */
    updateEntityAABB(entity) {
      if (!entity.collider) return;
      
      const pos = {
        x: entity.position.x + entity.collider.offset.x,
        y: entity.position.y + entity.collider.offset.y,
        z: entity.position.z + entity.collider.offset.z
      };
      
      if (entity.collider.type === 'sphere') {
        const r = entity.collider.size;
        entity.aabb = {
          min: { x: pos.x - r, y: pos.y - r, z: pos.z - r },
          max: { x: pos.x + r, y: pos.y + r, z: pos.z + r }
        };
      } else if (entity.collider.type === 'box') {
        const s = entity.collider.size;
        entity.aabb = {
          min: { x: pos.x - s.x / 2, y: pos.y - s.y / 2, z: pos.z - s.z / 2 },
          max: { x: pos.x + s.x / 2, y: pos.y + s.y / 2, z: pos.z + s.z / 2 }
        };
      }
      
      // Create a swept AABB if previous position exists
      if (entity.previousPosition) {
        entity.sweptAABB = this.createSweptAABB(entity);
      }
    }
    
    /**
     * Create a swept AABB that encompasses the entity's movement path
     * @private
     */
    createSweptAABB(entity) {
      if (!entity.collider || !entity.previousPosition) return null;
      
      // Expand the AABB slightly to avoid precision issues
      const EPSILON = 0.001;
      
      const prevPos = {
        x: entity.previousPosition.x + entity.collider.offset.x,
        y: entity.previousPosition.y + entity.collider.offset.y,
        z: entity.previousPosition.z + entity.collider.offset.z
      };
      
      const currPos = {
        x: entity.position.x + entity.collider.offset.x,
        y: entity.position.y + entity.collider.offset.y,
        z: entity.position.z + entity.collider.offset.z
      };
      
      let minX = Math.min(prevPos.x, currPos.x) - EPSILON;
      let minY = Math.min(prevPos.y, currPos.y) - EPSILON;
      let minZ = Math.min(prevPos.z, currPos.z) - EPSILON;
      let maxX = Math.max(prevPos.x, currPos.x) + EPSILON;
      let maxY = Math.max(prevPos.y, currPos.y) + EPSILON;
      let maxZ = Math.max(prevPos.z, currPos.z) + EPSILON;
      
      if (entity.collider.type === 'sphere') {
        const r = entity.collider.size;
        return {
          min: { x: minX - r, y: minY - r, z: minZ - r },
          max: { x: maxX + r, y: maxY + r, z: maxZ + r }
        };
      } else if (entity.collider.type === 'box') {
        const s = entity.collider.size;
        return {
          min: { x: minX - s.x / 2, y: minY - s.y / 2, z: minZ - s.z / 2 },
          max: { x: maxX + s.x / 2, y: maxY + s.y / 2, z: maxZ + s.z / 2 }
        };
      }
      
      return null;
    }
  
    /**
     * Detect collisions between entities using swept AABBs for fast moving objects
     * @private
     * @returns {Array} List of collision pairs
     */
    detectEntityCollisions(entities, deltaTime) {
      const collisionPairs = [];
      
      // Add collision debugging
      const DEBUG = false; // Set to true to see debug info
      
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const e1 = entities[i];
          const e2 = entities[j];
          
          if (!e1.collider || !e2.collider) continue;
          
          if (DEBUG) {
            console.log(`Checking collision: ${e1.id || i} vs ${e2.id || j}`);
          }

          let collision = null;
          
          // Always use swept collision detection since threshold is 0
          if (e1.sweptAABB && e2.sweptAABB) {
            // First do a broad phase check with swept AABBs
            if (this.aabbIntersects(e1.sweptAABB, e2.sweptAABB)) {
              // Now do precise CCD for potential collisions
              if (e1.collider.type === 'sphere' && e2.collider.type === 'sphere') {
                collision = this.continuousSphereSphereCollision(e1, e2, deltaTime);
              } else {
                collision = this.continuousBoxBoxCollision(e1, e2, deltaTime);
              }
              
              if (DEBUG && collision) {
                console.log(`  - CCD detected collision! TOI: ${collision.timeOfImpact}`);
              }
            } else if (DEBUG) {
              console.log(`  - Swept AABBs don't intersect`);
            }
          } else {
            // Fallback to standard collision detection
            if (e1.collider.type === 'sphere' && e2.collider.type === 'sphere') {
              collision = this.sphereSphereCollision(e1, e2, deltaTime);
            } else {
              collision = this.boxBoxCollision(e1, e2, deltaTime);
            }
            
            if (DEBUG && collision) {
              console.log(`  - Standard collision detected!`);
            }
          }

          if (collision) {
            collisionPairs.push({ e1, e2, ...collision });
          }
        }
      }
      
      if (DEBUG) {
        console.log(`Detected ${collisionPairs.length} collisions`);
      }
      
      return collisionPairs;
    }
    
    /**
     * Continuous collision detection between two entities
     * @private
     */
    continuousCollisionDetection(e1, e2, deltaTime) {
      // Determine collision type based on collider types
      if (e1.collider.type === 'sphere' && e2.collider.type === 'sphere') {
        return this.continuousSphereSphereCollision(e1, e2, deltaTime);
      } else {
        return this.continuousBoxBoxCollision(e1, e2, deltaTime);
      }
    }
    
    /**
     * Continuous collision detection for spheres
     * @private
     */
    continuousSphereSphereCollision(e1, e2, deltaTime) {
      const r1 = e1.collider.size;
      const r2 = e2.collider.size;
      const combinedRadius = r1 + r2;
      
      // Get positions with offset
      const p1Start = {
        x: e1.previousPosition.x + e1.collider.offset.x,
        y: e1.previousPosition.y + e1.collider.offset.y,
        z: e1.previousPosition.z + e1.collider.offset.z
      };
      
      const p2Start = {
        x: e2.previousPosition.x + e2.collider.offset.x,
        y: e2.previousPosition.y + e2.collider.offset.y,
        z: e2.previousPosition.z + e2.collider.offset.z
      };
      
      const p1End = {
        x: e1.position.x + e1.collider.offset.x,
        y: e1.position.y + e1.collider.offset.y,
        z: e1.position.z + e1.collider.offset.z
      };
      
      const p2End = {
        x: e2.position.x + e2.collider.offset.x,
        y: e2.position.y + e2.collider.offset.y,
        z: e2.position.z + e2.collider.offset.z
      };
      
      // Relative movement vectors
      const move1 = {
        x: p1End.x - p1Start.x,
        y: p1End.y - p1Start.y,
        z: p1End.z - p1Start.z
      };
      
      const move2 = {
        x: p2End.x - p2Start.x,
        y: p2End.y - p2Start.y,
        z: p2End.z - p2Start.z
      };
      
      // Relative velocity
      const relVelocity = {
        x: move1.x - move2.x,
        y: move1.y - move2.y,
        z: move1.z - move2.z
      };
      
      // Relative position
      const relPosition = {
        x: p1Start.x - p2Start.x,
        y: p1Start.y - p2Start.y,
        z: p1Start.z - p2Start.z
      };
      
      // Solving quadratic equation for time of impact
      // We're finding when distance^2 = combinedRadius^2
      const a = relVelocity.x * relVelocity.x + 
                relVelocity.y * relVelocity.y + 
                relVelocity.z * relVelocity.z;
                
      // If there's no relative movement, use regular collision check
      if (Math.abs(a) < 0.0001) {
        return this.sphereSphereCollision(e1, e2, deltaTime);
      }
      
      const b = 2 * (relPosition.x * relVelocity.x + 
                    relPosition.y * relVelocity.y + 
                    relPosition.z * relVelocity.z);
                    
      const c = relPosition.x * relPosition.x + 
                relPosition.y * relPosition.y + 
                relPosition.z * relPosition.z - 
                combinedRadius * combinedRadius;
      
      // Check if spheres are already intersecting
      if (c <= 0) {
        // Spheres already intersecting, use regular collision detection
        return this.sphereSphereCollision(e1, e2, deltaTime);
      }
      
      // Check if collision is possible
      const discriminant = b * b - 4 * a * c;
      
      if (discriminant < 0) {
        return null; // No collision possible
      }
      
      // Find time of impact (TOI)
      const toi = (-b - Math.sqrt(discriminant)) / (2 * a);
      
      // Check if collision happens within this time step
      if (toi < 0 || toi > 1) {
        return null; // Collision outside time step
      }
      
      // Interpolate positions at time of impact (FIXED - now interpolates both objects)
      const p1AtToi = {
        x: p1Start.x + toi * move1.x,
        y: p1Start.y + toi * move1.y,
        z: p1Start.z + toi * move1.z
      };
      
      const p2AtToi = {
        x: p2Start.x + toi * move2.x,
        y: p2Start.y + toi * move2.y,
        z: p2Start.z + toi * move2.z
      };
      
      // Calculate normal at impact
      const dx = p2AtToi.x - p1AtToi.x;
      const dy = p2AtToi.y - p1AtToi.y;
      const dz = p2AtToi.z - p1AtToi.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      if (distance < 0.0001) {
        // Objects are too close, use a default normal direction
        // This prevents division by zero
        return {
          normal: { x: 0, y: 1, z: 0 },
          penetration: combinedRadius,
          impulse: { x: 0, y: 0, z: 0 },
          timeOfImpact: toi
        };
      }
      
      const normal = { 
        x: dx / distance, 
        y: dy / distance, 
        z: dz / distance 
      };
      
      const penetration = combinedRadius - distance;
      
      // Calculate velocity along normal at time of impact
      const relVelAtImpact = {
        x: (e1.velocity.x - e2.velocity.x),
        y: (e1.velocity.y - e2.velocity.y),
        z: (e1.velocity.z - e2.velocity.z)
      };
      
      const velAlongNormal = 
        relVelAtImpact.x * normal.x + 
        relVelAtImpact.y * normal.y + 
        relVelAtImpact.z * normal.z;
        
      // Only respond to objects moving toward each other
      if (velAlongNormal > 0) return null;
      
      const restitution = Math.min(e1.collider.restitution || 0.2, e2.collider.restitution || 0.2);
      const impulseScalar = -(1 + restitution) * velAlongNormal / 
                            ((e1.collider.mass ? 1/e1.collider.mass : 0) + 
                            (e2.collider.mass ? 1/e2.collider.mass : 0));
      
      return {
        normal,
        penetration,
        impulse: {
          x: impulseScalar * normal.x,
          y: impulseScalar * normal.y,
          z: impulseScalar * normal.z
        },
        timeOfImpact: toi
      };
    }
    
    /**
     * Continuous collision detection for boxes
     * @private
     */
    continuousBoxBoxCollision(e1, e2, deltaTime) {
      // For box-box continuous collision, we'll use a simplified approach with swept AABBs
      // This is more complex to implement with full accuracy, so we'll use a conservative approach
      
      // First check if they're currently intersecting
      if (this.aabbIntersects(e1.aabb, e2.aabb)) {
        return this.boxBoxCollision(e1, e2, deltaTime);
      }
      
      // Calculate relative velocity
      const relVelocity = {
        x: e1.velocity.x - e2.velocity.x,
        y: e1.velocity.y - e2.velocity.y,
        z: e1.velocity.z - e2.velocity.z
      };
      
      // Entry and exit times for each axis
      let tEnter = -Infinity;
      let tExit = Infinity;
      
      // Check each axis (x, y, z)
      for (const axis of ['x', 'y', 'z']) {
        if (relVelocity[axis] === 0) {
          // Parallel movement, check if there's overlap
          if (e1.aabb.max[axis] < e2.aabb.min[axis] || e1.aabb.min[axis] > e2.aabb.max[axis]) {
            return null; // No collision possible on this axis
          }
        } else {
          // Calculate entry and exit times for this axis
          const v = relVelocity[axis];
          const invV = 1 / v;
          
          let t1, t2;
          if (v < 0) {
            t1 = (e2.aabb.max[axis] - e1.aabb.min[axis]) * invV;
            t2 = (e2.aabb.min[axis] - e1.aabb.max[axis]) * invV;
          } else {
            t1 = (e2.aabb.min[axis] - e1.aabb.max[axis]) * invV;
            t2 = (e2.aabb.max[axis] - e1.aabb.min[axis]) * invV;
          }
          
          // Update enter/exit times
          tEnter = Math.max(tEnter, t1);
          tExit = Math.min(tExit, t2);
          
          if (tEnter > tExit || tExit < 0 || tEnter > deltaTime) {
            return null; // No collision in this time step
          }
        }
      }
      
      // If we got here, there's a collision within the time step
      if (tEnter >= 0 && tEnter <= deltaTime) {
        // Calculate collision normal based on entry axis
        const normal = { x: 0, y: 0, z: 0 };
        let minTime = Infinity;
        let collisionAxis = 'x';
        
        for (const axis of ['x', 'y', 'z']) {
          if (relVelocity[axis] !== 0) {
            const t = relVelocity[axis] < 0 ? 
              (e2.aabb.max[axis] - e1.aabb.min[axis]) / relVelocity[axis] : 
              (e2.aabb.min[axis] - e1.aabb.max[axis]) / relVelocity[axis];
            
            if (t <= tEnter && t < minTime) {
              minTime = t;
              collisionAxis = axis;
            }
          }
        }
        
        normal[collisionAxis] = relVelocity[collisionAxis] < 0 ? -1 : 1;
        
        // Calculate penetration
        const penetration = tExit - tEnter;
        
        // Calculate impulse
        const velAlongNormal = 
          relVelocity.x * normal.x + 
          relVelocity.y * normal.y + 
          relVelocity.z * normal.z;
          
        const restitution = Math.min(e1.collider.restitution, e2.collider.restitution);
        const impulseScalar = -(1 + restitution) * velAlongNormal / (1 / e1.collider.mass + 1 / e2.collider.mass);
        
        return {
          normal,
          penetration,
          impulse: {
            x: impulseScalar * normal.x,
            y: impulseScalar * normal.y,
            z: impulseScalar * normal.z
          },
          timeOfImpact: tEnter
        };
      }
      
      return null;
    }
  
    /**
     * Apply collision responses to entity pairs
     * @private
     */
    resolveEntityCollisions(collisionPairs) {
      // Apply impulses for entity-entity collisions
      collisionPairs.forEach(({ e1, e2, impulse }) => {        
        // Set collision flags
        e1.collidedWithEntity = true;
        e2.collidedWithEntity = true;
        e1.collidedWith = e2.id;
        e2.collidedWith = e1.id;

        if (e1.collider.mass > 0) {
          e1.velocity.x += impulse.x / e1.collider.mass;
          e1.velocity.y += impulse.y / e1.collider.mass;
          e1.velocity.z += impulse.z / e1.collider.mass;
        }
        
        if (e2.collider.mass > 0) {
          e2.velocity.x -= impulse.x / e2.collider.mass;
          e2.velocity.y -= impulse.y / e2.collider.mass;
          e2.velocity.z -= impulse.z / e2.collider.mass;
        }
      });
  
      // Resolve penetrations (move entities apart)
      collisionPairs.forEach(({ e1, e2, normal, penetration }) => {
        const totalMass = e1.collider.mass + e2.collider.mass;
        if (totalMass === 0) return;
        
        const move1 = e1.collider.mass > 0 ? penetration * (e2.collider.mass / totalMass) : 0;
        const move2 = e2.collider.mass > 0 ? penetration * (e1.collider.mass / totalMass) : 0;
        
        if (e1.collider.mass > 0) {
          e1.position.x -= normal.x * move1;
          e1.position.y -= normal.y * move1;
          e1.position.z -= normal.z * move1;
        }
        
        if (e2.collider.mass > 0) {
          e2.position.x += normal.x * move2;
          e2.position.y += normal.y * move2;
          e2.position.z += normal.z * move2;
        }
      });
    }
  
    /**
     * Handle terrain and static collisions for all entities
     * @private
     */
    resolveTerrainAndStaticCollisions(entities, collisionData, deltaTime) {
      entities.forEach(entity => {
        if (!entity.collider) return;
        
        // Handle terrain collision using the terrain generator
       // if (this.getTerrainHeight && this.handleTerrainCollision) {
        //  this.handleTerrainCollision(entity, deltaTime);
       // }
  
        // Handle static object collisions
        const entityCollisions = collisionData.find(c => c.entityId === entity.id);
        if (entityCollisions) {
          entityCollisions.collisions.forEach(aabb => {
            // Use swept collision detection for fast moving entities
            if (this.getEntitySpeed(entity) > this.speedThreshold) {
              this.resolveSweptStaticCollision(entity, aabb, deltaTime);
            } else {
              this.resolveStaticCollision(entity, aabb, deltaTime);
            }
          });
        }
      });
    }
  
    /**
     * Check if two AABBs intersect
     * @private
     */
    aabbIntersects(aabb1, aabb2) {
      return (
        aabb1.min.x <= aabb2.max.x &&
        aabb1.max.x >= aabb2.min.x &&
        aabb1.min.y <= aabb2.max.y &&
        aabb1.max.y >= aabb2.min.y &&
        aabb1.min.z <= aabb2.max.z &&
        aabb1.max.z >= aabb2.min.z
      );
    }
  
    /**
     * Get entity speed (magnitude of velocity)
     * @private
     */
    getEntitySpeed(entity) {
      if (!entity.velocity) return 0;
      return this.vector3Length(entity.velocity);
    }
    
    /**
     * Get maximum entity speed from a list
     * @private
     */
    getMaxEntitySpeed(entities) {
      let maxSpeed = 0;
      entities.forEach(entity => {
        const speed = this.getEntitySpeed(entity);
        if (speed > maxSpeed) maxSpeed = speed;
      });
      return maxSpeed;
    }

    /**
     * Calculate vector3 length
     * @private
     */
    vector3Length(v){
      return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    }
    
    /**
     * Handle sphere-sphere collision detection
     * @private
     * @returns {Object|null} Collision data or null if no collision
     */
    sphereSphereCollision(e1, e2, deltaTime) {
      const r1 = e1.collider.size;
      const r2 = e2.collider.size;
      const p1 = { 
        x: e1.position.x + e1.collider.offset.x, 
        y: e1.position.y + e1.collider.offset.y, 
        z: e1.position.z + e1.collider.offset.z 
      };
      const p2 = { 
        x: e2.position.x + e2.collider.offset.x, 
        y: e2.position.y + e2.collider.offset.y, 
        z: e2.position.z + e2.collider.offset.z 
      };
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const minDistance = r1 + r2;
      
      if (distance < minDistance && distance > 0) {
        const normal = { 
          x: dx / distance, 
          y: dy / distance, 
          z: dz / distance 
        };
        const penetration = minDistance - distance;
        const relativeVelocity = {
          x: e1.velocity.x - e2.velocity.x,
          y: e1.velocity.y - e2.velocity.y,
          z: e1.velocity.z - e2.velocity.z
        };
        const velocityAlongNormal = 
          relativeVelocity.x * normal.x + 
          relativeVelocity.y * normal.y + 
          relativeVelocity.z * normal.z;
  
        if (velocityAlongNormal > 0) return null; // Moving apart
  
        const restitution = Math.min(e1.collider.restitution, e2.collider.restitution);
        const impulseScalar = -(1 + restitution) * velocityAlongNormal / (1 / e1.collider.mass + 1 / e2.collider.mass);
        
        return {
          normal,
          penetration,
          impulse: {
            x: impulseScalar * normal.x,
            y: impulseScalar * normal.y,
            z: impulseScalar * normal.z
          }
        };
      }
      
      return null;
    }
  
    /**
     * Handle box-box collision detection
     * @private
     * @returns {Object|null} Collision data or null if no collision
     */
    boxBoxCollision(e1, e2, deltaTime) {
      const aabb1 = e1.aabb;
      const aabb2 = e2.aabb;
      
      if (!this.aabbIntersects(aabb1, aabb2)) return null;
  
      const overlaps = [
        { axis: 'x', overlap: Math.min(aabb1.max.x - aabb2.min.x, aabb2.max.x - aabb1.min.x) },
        { axis: 'y', overlap: Math.min(aabb1.max.y - aabb2.min.y, aabb2.max.y - aabb1.min.y) },
        { axis: 'z', overlap: Math.min(aabb1.max.z - aabb2.min.z, aabb2.max.z - aabb1.min.z) }
      ];
      const minOverlap = overlaps.reduce((min, curr) => curr.overlap < min.overlap ? curr : min, overlaps[0]);
  
      const normal = { x: 0, y: 0, z: 0 };
      const sign = aabb1.min[minOverlap.axis] < aabb2.min[minOverlap.axis] ? -1 : 1;
      normal[minOverlap.axis] = sign;
  
      const relativeVelocity = {
        x: e1.velocity.x - e2.velocity.x,
        y: e1.velocity.y - e2.velocity.y,
        z: e1.velocity.z - e2.velocity.z
      };
      const velocityAlongNormal = 
        relativeVelocity.x * normal.x + 
        relativeVelocity.y * normal.y + 
        relativeVelocity.z * normal.z;
  
      if (velocityAlongNormal > 0) return null; // Moving apart
  
      const restitution = Math.min(e1.collider.restitution, e2.collider.restitution);
      const impulseScalar = -(1 + restitution) * velocityAlongNormal / (1 / e1.collider.mass + 1 / e2.collider.mass);
      
      return {
        normal,
        penetration: minOverlap.overlap,
        impulse: {
          x: impulseScalar * normal.x,
          y: impulseScalar * normal.y,
          z: impulseScalar * normal.z
        }
      };
    }
  }