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
      this._updateEntitiesPosition(entities, deltaTime);
      
      // Handle entity-entity collisions
      const collisionPairs = this._detectEntityCollisions(entities, deltaTime);
      this._resolveEntityCollisions(collisionPairs);
      
      // Handle terrain and static collisions
      this._resolveTerrainAndStaticCollisions(entities, collisionData, deltaTime);
      
      return entities;
    }
  
    /**
     * Update entity positions and AABBs
     * @private
     */
    _updateEntitiesPosition(entities, deltaTime) {
      entities.forEach(entity => {
        // Apply gravity
        entity.velocity.y += (entity.gravity ? this.gravity : 0) * 10 * deltaTime;
        
        // Update position
        entity.position.x += entity.velocity.x * deltaTime;
        entity.position.y += entity.velocity.y * deltaTime;
        entity.position.z += entity.velocity.z * deltaTime;
  
        // Update AABB
        this._updateEntityAABB(entity);
      });
    }
  
    /**
     * Update entity's Axis-Aligned Bounding Box
     * @private
     */
    _updateEntityAABB(entity) {
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
    _detectEntityCollisions(entities, deltaTime) {
      const collisionPairs = [];
      
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const e1 = entities[i];
          const e2 = entities[j];
          
          if (!e1.collider || !e2.collider) continue;
  
          let collision = null;
          if (e1.collider.type === 'sphere' && e2.collider.type === 'sphere') {
            collision = this._sphereSphereCollision(e1, e2, deltaTime);
          } else {
            collision = this._boxBoxCollision(e1, e2, deltaTime);
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
    _resolveEntityCollisions(collisionPairs) {
      // Apply impulses for entity-entity collisions
      collisionPairs.forEach(({ e1, e2, impulse }) => {
        if (e1.mass > 0) {
          e1.velocity.x += impulse.x / e1.mass;
          e1.velocity.y += impulse.y / e1.mass;
          e1.velocity.z += impulse.z / e1.mass;
        }
        
        if (e2.mass > 0) {
          e2.velocity.x -= impulse.x / e2.mass;
          e2.velocity.y -= impulse.y / e2.mass;
          e2.velocity.z -= impulse.z / e2.mass;
        }
        
        // Set collision flags
        e1.collidedWithEntity = true;
        e2.collidedWithEntity = true;
        e1.collidedWith = e2.id;
        e2.collidedWith = e1.id;
      });
  
      // Resolve penetrations (move entities apart)
      collisionPairs.forEach(({ e1, e2, normal, penetration }) => {
        const totalMass = e1.mass + e2.mass;
        if (totalMass === 0) return;
        
        const move1 = e1.mass > 0 ? penetration * (e2.mass / totalMass) : 0;
        const move2 = e2.mass > 0 ? penetration * (e1.mass / totalMass) : 0;
        
        if (e1.mass > 0) {
          e1.position.x -= normal.x * move1;
          e1.position.y -= normal.y * move1;
          e1.position.z -= normal.z * move1;
        }
        
        if (e2.mass > 0) {
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
    _resolveTerrainAndStaticCollisions(entities, collisionData, deltaTime) {
      entities.forEach(entity => {
        // Handle terrain collision using the terrain generator

        const x = entity.position.x;
        const z = entity.position.z;
        this._resolveTerrainCollision(
            entity, 
            deltaTime,             
            x, 
            z
        );
        
  
        // Handle static object collisions
        const entityCollisions = collisionData.find(c => c.entityId === entity.id);
        if (entityCollisions) {
          entityCollisions.collisions.forEach(aabb => {
            this._resolveStaticCollision(entity, aabb, deltaTime);
          });
        }
      });
    }
  
    /**
     * Check if two AABBs intersect
     * @private
     */
    _aabbIntersects(aabb1, aabb2) {
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
     * Handle sphere-sphere collision detection
     * @private
     * @returns {Object|null} Collision data or null if no collision
     */
    _sphereSphereCollision(e1, e2, deltaTime) {
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
  
        const restitution = Math.min(e1.restitution, e2.restitution);
        const impulseScalar = -(1 + restitution) * velocityAlongNormal / (1 / e1.mass + 1 / e2.mass);
        
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
    _boxBoxCollision(e1, e2, deltaTime) {
      const aabb1 = e1.aabb;
      const aabb2 = e2.aabb;
      
      if (!this._aabbIntersects(aabb1, aabb2)) return null;
  
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
  
      const restitution = Math.min(e1.restitution, e2.restitution);
      const impulseScalar = -(1 + restitution) * velocityAlongNormal / (1 / e1.mass + 1 / e2.mass);
      
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
    _resolveTerrainCollision(entity, deltaTime, x, z) {
      // Check if entity is colliding with terrain
      const heightAtPoint = this.getTerrainHeight(x, z);
      const sampleDistance = entity.collider.size || 1; // Distance to sample for normal calculation
      
      if (entity.position.y - sampleDistance <= heightAtPoint) {
        // Calculate terrain normal at collision point
        const heightAtPointPlusX = this.getTerrainHeight(x + sampleDistance, z);
        const heightAtPointPlusZ = this.getTerrainHeight(x, z + sampleDistance);
        
        // Calculate terrain normal using cross product of terrain tangent vectors
        const tangentX = { x: sampleDistance, y: heightAtPointPlusX - heightAtPoint, z: 0 };
        const tangentZ = { x: 0, y: heightAtPointPlusZ - heightAtPoint, z: sampleDistance };
        
        // Calculate normal (perpendicular to both tangents)
        const normal = {
          x: -tangentX.y * tangentZ.z + tangentX.z * tangentZ.y,
          y: tangentX.x * tangentZ.z - tangentX.z * tangentZ.x,
          z: -tangentX.x * tangentZ.y + tangentX.y * tangentZ.x
        };
        
        // Normalize the normal vector
        const normalLength = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
        normal.x /= normalLength;
        normal.y /= normalLength;
        normal.z /= normalLength;
        
        // Calculate reflection vector: r = v - 2(v·n)n
        const dotProduct = 
          entity.velocity.x * normal.x + 
          entity.velocity.y * normal.y + 
          entity.velocity.z * normal.z;
        
        // Apply restitution and reflection
        const restitution = entity.restitution || 0.3;
        
        // Calculate new velocity after reflection
        entity.velocity.x = entity.velocity.x - 2 * dotProduct * normal.x * restitution;
        entity.velocity.y = entity.velocity.y - 2 * dotProduct * normal.y * restitution;
        entity.velocity.z = entity.velocity.z - 2 * dotProduct * normal.z * restitution;
        
        // Apply friction based on slope
        const friction = 0.8; // Adjust as needed
        const slopeCoefficient = 1 - Math.abs(normal.y); // Higher when slope is steeper
        
        // Apply more friction on steeper slopes
        const frictionFactor = friction * (1 + slopeCoefficient);
        entity.velocity.x *= (1 - frictionFactor * deltaTime);
        entity.velocity.z *= (1 - frictionFactor * deltaTime);
        
        // Move the entity to just above the terrain to prevent sinking
        // Calculate the offset along the normal vector to position the entity
        const offsetDistance = 0.01; // Small offset to prevent stuck in terrain
        entity.position.x += normal.x * offsetDistance;
        entity.position.y = heightAtPoint + offsetDistance + sampleDistance - entity.collider.offset.y;
        entity.position.z += normal.z * offsetDistance;
        
        entity.grounded = true;
      } else {
        entity.grounded = false;
      }
    }
  
    /**
     * Handle entity collision with static objects
     * @private
     */
    _resolveStaticCollision(entity, aabb, deltaTime) {
      const playerAABB = entity.aabb;
      
      if (!this._aabbIntersects(playerAABB, aabb)) return;
  
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
  
