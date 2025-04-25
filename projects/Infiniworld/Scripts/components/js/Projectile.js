class Projectile extends engine.Component {
  constructor(game, parent, params) {
      super(game, parent, params);
  }
   
  init({ spawnType, owner, direction, stats }) {
      this.type = spawnType;
      this.def = this.game.config.projectiles[this.type];
      this.owner = owner;
      this.stats = stats;
      this.piercedEnemies = [];
      this.ownerStats = this.owner.getComponent("stats").stats;
      this.distanceTraveled = 0;
      this.distanceToSpawnParticle = 24;
      this.direction = direction;
      
      // Add lifespan for projectile
      this.maxLifespan = this.stats.lifespan || 30;  
      this.currentLifespan = 0;
      
      if(this.stats.attackSound){
          this.game.audioManager.playSound('sounds', this.stats.attackSound);
      }
      
      this.parent.position.y += 10;
      // Add physics properties
      this.parent.velocity = new THREE.Vector3(
          direction.x * this.stats.speed,
          direction.y * this.stats.speed,
          direction.z * this.stats.speed
      );    

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
          const tDx = this.parent.lastPosition.x - this.parent.position.x;
          const tDy = this.parent.lastPosition.y - this.parent.position.y;
          const tDz = this.parent.lastPosition.z - this.parent.position.z;
          const tDistSq = tDx * tDx + tDy * tDy + tDz * tDz;
          const tDist = Math.sqrt(tDistSq);
          this.distanceTraveled += tDist;
          
          if (this.def.particle && this.distanceTraveled > this.distanceToSpawnParticle) {
              this.game.spawn(this.parent.position.x, this.parent.position.y, this.parent.position.z, "particle", { 
                  objectType: "particles", 
                  spawnType: this.def.particle
              });
              this.distanceTraveled = 0;
              this.distanceToSpawnParticle += Math.random() * 3;
          }
      }
      
      // Store current position for next frame
      this.parent.lastPosition = {
          x: this.parent.position.x,
          y: this.parent.position.y,
          z: this.parent.position.z
      };
      
      if(this.parent.grounded){
        this.OnStaticCollision();
        this.parent.destroy();
      }
      // Add impact check logic here if needed
      // Check for enemy collisions, etc.
  }
  
  OnCollision(collidedWith){
    if(this.stats.hitSound){
      this.game.audioManager.playSound('sounds', this.stats.hitSound);
    }
    this.parent.destroy();
  }
  OnStaticCollision(){
    if(this.stats.hitSound){
      this.game.audioManager.playSound('sounds', this.stats.hitSound);
    }
  }
  destroy() {
      // Clean up physics registration
      if (this.physics) {
          this.physics.unregisterEntity(this.parent.id);
      }
      
      // Optional: Spawn impact effect
      if (this.def.impactParticle) {
          this.game.spawn(this.parent.position.x, this.parent.position.y, this.parent.position.z, "particle", {
              objectType: "particles", 
              spawnType: this.def.impactParticle
          });
      }
  }
}