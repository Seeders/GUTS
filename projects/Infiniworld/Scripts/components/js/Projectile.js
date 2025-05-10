class Projectile extends engine.Component {
  constructor(game, parent, params) {
      super(game, parent, params);
  }
   
  init({ spawnType, owner, direction }) {
      this.projectilePrefabData = this.game.config.projectilePrefabs[spawnType];
      this.projectileData = this.game.config.projectiles[this.projectilePrefabData.projectile];
      this.owner = owner;
      this.piercedEnemies = [];
      if(this.owner){
        this.ownerStats = this.owner.getComponent("stats").stats;
      }
      this.distanceTraveled = 0;
      this.distanceToSpawnParticle = 24;
      this.direction = direction || new THREE.Vector3();
      
      // Add lifespan for projectile
      this.maxLifespan = this.projectileData.lifespan || 30;  
      this.currentLifespan = 0;
      
      if(this.projectileData.attackSound){
          this.game.audioManager.playSound('sounds', this.projectileData.attackSound);
      }      
      // Add physics properties
      this.parent.transform.velocity = new THREE.Vector3(
          this.direction.x * this.projectileData.speed,
          this.direction.y * this.projectileData.speed,
          this.direction.z * this.projectileData.speed
      );    
      if(this.owner){
        this.parent.transform.velocity = this.parent.transform.velocity.add(this.owner.transform.velocity.clone());
      }

  }
  
  update() {
      // Update lifespan and destroy if expired
      this.currentLifespan += this.game.deltaTime;
      if (this.currentLifespan >= this.maxLifespan) {
          this.parent.destroy();
          return;
      }
      // Don't directly modify position - let the physics system handle it
      // Instead, only update non-physical properties
      
      // Particle spawning logic
      if (this.parent.lastPosition) {
          const tDx = this.parent.transform.lastPosition.x - this.parent.transform.position.x;
          const tDy = this.parent.transform.lastPosition.y - this.parent.transform.position.y;
          const tDz = this.parent.transform.lastPosition.z - this.parent.transform.position.z;
          const tDistSq = tDx * tDx + tDy * tDy + tDz * tDz;
          const tDist = Math.sqrt(tDistSq);
          this.distanceTraveled += tDist;
          
          if (this.projectileData.particle && this.distanceTraveled > this.distanceToSpawnParticle) {
              this.game.spawn("particle", { 
                  objectType: "particlePrefabs", 
                  spawnType: this.projectileData.particlePrefab
              }, this.parent.transform.position);
              this.distanceTraveled = 0;
              this.distanceToSpawnParticle += Math.random() * 3;
          }
      }
      
      // Store current position for next frame
      this.parent.transform.lastPosition = {
          x: this.parent.transform.position.x,
          y: this.parent.transform.position.y,
          z: this.parent.transform.position.z
      };
      
      if(this.parent.grounded){
        //this.OnStaticCollision();
        //this.parent.destroy();
      }
      // Add impact check logic here if needed
      // Check for enemy collisions, etc.
  }
  
  OnCollision(collidedWith){
    if(this.projectileData.hitSound){
      this.game.audioManager.playSound('sounds', this.projectileData.hitSound);
    }
   // this.parent.destroy();
  }
  OnStaticCollision(){
    if(this.projectileData.hitSound && this.parent.transform.physicsVelocity.length() > 50){
      this.game.audioManager.playSound('sounds', this.projectileData.hitSound);
    }
  }
  destroy() {
      // Clean up physics registration
      if (this.physics) {
          this.physics.unregisterEntity(this.parent.id);
      }
      
      // Optional: Spawn impact effect
      if (this.projectileData.impactParticle) {
          this.game.spawn("particle", {
              objectType: "particlePrefabs", 
              spawnType: this.projectileData.impactParticlePrefab
          }, this.parent.transform.position);
      }
  }
}