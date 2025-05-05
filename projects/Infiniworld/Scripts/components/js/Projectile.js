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
      
      this.parent.transform.position.y += 10;
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
          const tDx = this.parent.transform.lastPosition.x - this.parent.transform.position.x;
          const tDy = this.parent.transform.lastPosition.y - this.parent.transform.position.y;
          const tDz = this.parent.transform.lastPosition.z - this.parent.transform.position.z;
          const tDistSq = tDx * tDx + tDy * tDy + tDz * tDz;
          const tDist = Math.sqrt(tDistSq);
          this.distanceTraveled += tDist;
          
          if (this.def.particle && this.distanceTraveled > this.distanceToSpawnParticle) {
              this.game.spawn("particle", { 
                  objectType: "particles", 
                  spawnType: this.def.particle
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
    if(this.stats.hitSound){
      this.game.audioManager.playSound('sounds', this.stats.hitSound);
    }
    this.parent.destroy();
  }
  OnStaticCollision(){
    if(this.stats.hitSound && this.parent.velocity.length() > 50){
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
          this.game.spawn("particle", {
              objectType: "particles", 
              spawnType: this.def.impactParticle
          }, this.parent.transform.position);
      }
  }
}