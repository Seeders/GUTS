/**
 * PhysicsEngine: Handles all physics calculations and collision detection
 * for a 3D environment with entities, terrain, and static objects.
 */
class PhysicsEngine {
      
    /**
     * Initialize the physics engine with configuration
     * @param {Object} config - Configuration object
     * @param {number} config.gravity - Gravity constant
     * @param {Object} config.biomeConfig - Terrain biome configuration
     * @param {number} config.chunkSize - Size of terrain chunks
     * @param {number} config.chunkResolution - Resolution of terrain chunks
     */
    init(config = {}) {
      this.gravity = config.gravity || -9.8;
      this.handleTerrainCollision = config.handleTerrainCollision;    
      this.getTerrainHeight = config.getTerrainHeight;    
    }
  
    /**
     * Update physics for all entities
     * @param {Array} entities - List of entities to update
     * @param {Array} collisionData - Static collision data
     * @param {number} deltaTime - Time step for physics calculation
     * @returns {Array} Updated entities
     */
    update(entities, collisionData, deltaTime) {
      // Apply gravity and update positions
      this.updateEntitiesPosition(entities, deltaTime);
      
      // Handle entity-entity collisions
      const collisionPairs = this.detectEntityCollisions(entities, deltaTime);
      this.resolveEntityCollisions(collisionPairs);
      
      // Handle terrain and static collisions
      this.resolveTerrainAndStaticCollisions(entities, collisionData, deltaTime);
      
      return entities;
    }
  
    /**
     * Update entity positions and AABBs
     * @private
     */
    updateEntitiesPosition(entities, deltaTime) {
      entities.forEach(entity => {
        // Apply gravity
        entity.velocity.y += (entity.collider.gravity ? this.gravity : 0) * 10 * deltaTime;

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
    }
  
    /**
     * Detect collisions between entities
     * @private
     * @returns {Array} List of collision pairs
     */
    detectEntityCollisions(entities, deltaTime) {
      const collisionPairs = [];
      
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const e1 = entities[i];
          const e2 = entities[j];
          
        //  if (!e1.collider || !e2.collider) continue;
  
          let collision = null;
          if (e1.collider.type === 'sphere' && e2.collider.type === 'sphere') {
            collision = this.sphereSphereCollision(e1, e2, deltaTime);
          } else {
            collision = this.boxBoxCollision(e1, e2, deltaTime);
          }
  
          if (collision) {
            collisionPairs.push({ e1, e2, ...collision });
          }
        }
      }
      
      return collisionPairs;
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
        // Handle terrain collision using the terrain generator

       // this.resolveTerrainCollision(entity, deltaTime);
        
  
        // Handle static object collisions
        const entityCollisions = collisionData.find(c => c.entityId === entity.id);
        if (entityCollisions) {
          entityCollisions.collisions.forEach(aabb => {
            this.resolveStaticCollision(entity, aabb, deltaTime);
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
  

    vector3Length(v){
      return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    }
    /**
     * Handle sphere-sphere collision detection
     * @private
     * @returns {Object|null} Collision data or null if no collision
     */
    sphereSphereCollision(e1, e2, deltaTime) {
      const r1 = e1.collider.size * (1 + deltaTime * this.vector3Length(e1.velocity));
      const r2 = e2.collider.size * (1 + deltaTime * this.vector3Length(e2.velocity));
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
  
    /**
     * Handle entity collision with terrain
     * @private
     */
    resolveTerrainCollision(entity, deltaTime) {
      // Check if entity is colliding with terrain
      const heightAtPoint = this.getTerrainHeight(entity.position);
      const sampleDistance = entity.collider.size || 1; // Distance to sample for normal calculation
      
      if (entity.position.y - sampleDistance <= heightAtPoint) {
        entity.velocity = this.handleTerrainCollision(deltaTime, entity.position, entity.velocity, entity.collider.restitution);
        // Move the entity to just above the terrain to prevent sinking
        // Calculate the offset along the normal vector to position the entity
        const offsetDistance = 0.01; // Small offset to prevent stuck in terrain
        entity.position.x += entity.velocity.x * offsetDistance;
        entity.position.y = heightAtPoint + offsetDistance + sampleDistance - entity.collider.offset.y;
        entity.position.z += entity.velocity.z * offsetDistance;
        
        entity.grounded = true;
      } else {
        entity.grounded = false;
      }
    }
  
    /**
     * Handle entity collision with static objects
     * @private
     */
    resolveStaticCollision(entity, aabb, deltaTime) {
      const playerAABB = entity.aabb;
      
      if (!this.aabbIntersects(playerAABB, aabb)) return;
  
      const overlaps = [
        { axis: 'x', overlap: Math.min(playerAABB.max.x - aabb.min.x, aabb.max.x - playerAABB.min.x) },
        { axis: 'y', overlap: Math.min(playerAABB.max.y - aabb.min.y, aabb.max.y - playerAABB.min.y) },
        { axis: 'z', overlap: Math.min(playerAABB.max.z - aabb.min.z, aabb.max.z - playerAABB.min.z) }
      ];
      const minOverlap = overlaps.reduce((min, curr) => curr.overlap < min.overlap ? curr : min, overlaps[0]);
  
      const sign = playerAABB.min[minOverlap.axis] < aabb.min[minOverlap.axis] ? -1 : 1;
      entity.position[minOverlap.axis] += sign * minOverlap.overlap;
      entity.velocity[minOverlap.axis] = 0;
      entity.collidedWithStatic = true;
    }
}
  
