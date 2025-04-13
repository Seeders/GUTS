class Projectile extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
init({ spawnType, owner, target, targetPosition, stats }) {
  this.type = spawnType;
  this.def = this.game.config.projectiles[this.type];
  this.owner = owner;
  this.target = target;
  this.targetPosition = targetPosition;
  this.stats = stats;
  this.piercedEnemies = [];
  this.ownerStats = this.owner.getComponent("stats").stats;
  this.distanceTraveled = 0;
  this.distanceToSpawnParticle = 24;

  // Add lifespan for projectile (e.g., 5 seconds)
  this.maxLifespan = this.stats.lifespan || 5; // Default to 5 seconds, adjust as needed
  this.currentLifespan = 0;  
  if(this.stats.attackSound){
      this.getComponent('audioPlayer').play(this.game.config.attackSounds[this.stats.attackSound].audio);
  }
}

update() {
  if(this.target) this.targetCurrentPosition = {...this.target.position };
  // Update lifespan and destroy if expired
  this.currentLifespan += this.game.deltaTime; // Assuming deltaTime is in seconds
  if (this.currentLifespan >= this.maxLifespan) {
    this.parent.destroy();
    return;
  }

  // Remove if target is gone (only if no targetPosition)
  if (!this.targetPosition && (!this.target || this.target.destroyed)) {
    if(this.targetCurrentPosition) {
    	this.targetPosition = this.targetCurrentPosition;
    } else {
     	this.parent.destroy(); 
    	return;
    }
  }

  // Determine movement target
  const targetPos = this.targetPosition ? this.targetPosition : this.target.position;
  const dx = targetPos.x - this.parent.position.x;
  const dy = targetPos.y - this.parent.position.y;
  const distSq = dx * dx + dy * dy;
  const dist = Math.sqrt(distSq);
  const speed = this.stats.speed;

  // Hit detection
  const hitRadiusSq = 15 * 15; // Same as your original hit detection radius
  let hitDetected = false;

  if (this.targetPosition) {
    // Check nearby enemies for hit detection when using targetPosition
    const nearbyEnemies = this.game.spatialGrid.getNearbyEntities(
      this.parent.gridPosition.x,
      this.parent.gridPosition.y,
      this.stats.splashRadius || 15, // Use splashRadius or default to 15,
      "enemy"
    );

    for (const enemy of nearbyEnemies) {
      if (enemy.isDead || this.piercedEnemies.includes(enemy)) continue;

      const dxEnemy = enemy.position.x - this.parent.position.x;
      const dyEnemy = enemy.position.y - this.parent.position.y;
      const enemyDistSq = dxEnemy * dxEnemy + dyEnemy * dyEnemy;

      if (enemyDistSq <= hitRadiusSq) {
        // Hit detected
        if(this.stats.hitSound && !hitDetected){
          enemy.getComponent('audioPlayer').play(this.game.config.hitSounds[this.stats.hitSound].audio);
        }
        hitDetected = true;
        let enemyHealth = enemy.getComponent("health");
        let enemyEnergyShield = enemy.getComponent("energyshield");
        let enemyStats = enemy.getComponent("stats");
        let enemyStatClone = { ...enemyStats.stats };
        enemyStatClone.energyShield = enemyEnergyShield.energyShield;

        // Apply damage
        let damageResult = engine.getFunction("calculateDamage")(this.stats, enemyStatClone);
        if (!damageResult.wasEvaded) {
          enemyHealth.hp -= damageResult.damageDealt;
          enemyEnergyShield.absorbDamage(damageResult.damageAbsorbed);
          this.game.spawn(enemy.position.x, enemy.position.y, "hitEffect", {
            damageType: this.stats.damageType,
            lifeSpan: 0.3
          });
          if (this.ownerStats.slowEffect) {
            enemyStats.addEffect(
              this.game.config.effects.slow,
              this.game.effects.slow,
              this.ownerStats.slowEffect
            );
          }
        }

        // Piercing logic
        if (this.stats.piercing > 0 && this.piercedEnemies.length < this.stats.piercing) {
          this.piercedEnemies.push(enemy);
          let newTarget = this.findNewTarget(nearbyEnemies);
          if (newTarget) {
            this.target = newTarget;
            this.targetPosition = null; // Switch to target-based tracking
            return;
          }
        }

        // Splash damage if applicable
        if (this.stats.splashRadius > 0) {
          this.applySplashDamage(nearbyEnemies);
          this.game.spawn(this.parent.position.x, this.parent.position.y, "explosion", {
            radius: this.stats.splashRadius
          });
        }

        // Destroy projectile if no piercing or piercing limit reached
        if (this.stats.piercing <= 0 || this.piercedEnemies.length >= this.stats.piercing) {
          this.parent.destroy();
          return;
        }
      }
    }
  } else if (distSq < hitRadiusSq) {
    // Original target-based hit detection
    let targetHealth = this.target.getComponent("health");
    let targetEnergyShield = this.target.getComponent("energyshield");
    let targetStats = this.target.getComponent("stats");
    let targetStatClone = { ...targetStats.stats };
    targetStatClone.energyShield = targetEnergyShield.energyShield;

    // Apply damage and effects (unchanged from your original code)
    let damageResult = engine.getFunction("calculateDamage")(this.stats, targetStatClone);
    if (!damageResult.wasEvaded) {
      if(this.stats.hitSound){
        this.target.getComponent('audioPlayer').play(this.game.config.hitSounds[this.stats.hitSound].audio);
      }
      targetHealth.hp -= damageResult.damageDealt;
      targetEnergyShield.absorbDamage(damageResult.damageAbsorbed);
      this.game.spawn(this.target.position.x, this.target.position.y, "hitEffect", {
        damageType: this.stats.damageType,
        lifeSpan: 0.3
      });
      if (this.ownerStats.slowEffect) {
        targetStats.addEffect(
          this.game.config.effects.slow,
          this.game.effects.slow,
          this.ownerStats.slowEffect
        );
      }
    }

    // Summon skeleton, leech, thief logic (unchanged)
    if (
      this.ownerStats.summonChance > 0 &&
      targetHealth.hp <= 0 &&
      Math.random() < this.ownerStats.summonChance - 1
    ) {
      this.game.spawn(this.target.position.x, this.target.position.y, "summonedTower", {
        objectType: "towers",
        spawnType: this.ownerStats.summonType,
        owner: this.owner
      });
    }
    if (this.ownerStats.leech > 0) {
      const healing = this.stats.damage * this.ownerStats.leech * this.game.state.stats.healingMultiplier;
      this.game.state.bloodCoreHP = Math.min(
        this.game.state.stats.maxBloodCoreHP,
        this.game.state.bloodCoreHP + healing
      );
    }
    if (this.ownerStats.thief && this.ownerStats.thief != 0) {
      const stealAmt = this.stats.damage * this.ownerStats.thief * this.game.state.stats.bloodShardMultiplier;
      this.game.state.bloodShards += stealAmt;
    }

    // Piercing logic
    if (this.stats.piercing > 0 && this.piercedEnemies.length < this.stats.piercing) {
      this.piercedEnemies.push(this.target);
      const newTarget = this.findNewTarget(
        this.game.spatialGrid.getNearbyEntities(
          this.parent.gridPosition.x,
          this.parent.gridPosition.y,
          this.ownerStats.range
        )
      );
      if (newTarget) {
        this.target = newTarget;
        return;
      }
    }

    this.parent.destroy();
    return;
  }

  // Move projectile
  this.parent.position.x += (dx / dist) * speed;
  this.parent.position.y += (dy / dist) * speed;

  // Continue moving past targetPosition by updating it if reached
  if (this.targetPosition && distSq < speed * speed) {
    // If close to targetPosition, extend it in the same direction
    const directionX = dx / dist;
    const directionY = dy / dist;
    this.targetPosition.x += directionX * speed * 10; // Extend further (adjust multiplier)
    this.targetPosition.y += directionY * speed * 10;
  }

  // Particle spawning logic (unchanged)
  const tDx = this.parent.lastPosition.x - this.parent.position.x;
  const tDy = this.parent.lastPosition.y - this.parent.position.y;
  const tDistSq = tDx * tDx + tDy * tDy;
  const tDist = Math.sqrt(tDistSq);

  this.distanceTraveled += tDist;
  if (this.def.particle && this.distanceTraveled > this.distanceToSpawnParticle) {
    this.game.spawn(this.parent.position.x, this.parent.position.y, "particle", { objectType: "particles", spawnType: this.def.particle});
    this.distanceTraveled = 0;
    this.distanceToSpawnParticle += Math.random() * 3;
  }
}

// Helper method to find a new target for piercing
findNewTarget(nearbyEnemies) {
  const gridSize = this.game.config.configs.game.gridSize;
  const rangeSq = this.ownerStats.range * this.ownerStats.range * gridSize * gridSize;
  for (let enemy of nearbyEnemies) {
    if (!enemy.destroyed && !this.piercedEnemies.includes(enemy)) {
      const dx = enemy.position.x - this.parent.position.x;
      const dy = enemy.position.y - this.parent.position.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < rangeSq) {
        return enemy;
      }
    }
  }
  return null;
}

// Helper method to apply splash damage
applySplashDamage(nearbyEnemies) {
  const gridSize = this.game.config.configs.game.gridSize;
  const splashRadiusSq = this.stats.splashRadius * this.stats.splashRadius * gridSize * gridSize;
  for (const enemy of nearbyEnemies) {
    if (enemy.isDead || this.piercedEnemies.includes(enemy)) continue;
    let enemyHealth = enemy.getComponent("health");
    let enemyEnergyShield = enemy.getComponent("energyshield");
    let enemyStats = enemy.getComponent("stats");
    let enemyStatClone = { ...enemyStats.stats };
    enemyStatClone.energyShield = enemyEnergyShield.energyShield;

    const dx = enemy.position.x - this.parent.position.x;
    const dy = enemy.position.y - this.parent.position.y;
    const distSq = dx * dx + dy * dy;

    if (distSq <= splashRadiusSq) {
      let damageResult = engine.getFunction("calculateDamage")(this.stats, enemyStatClone);
      if (!damageResult.wasEvaded) {
        enemyHealth.hp -= damageResult.damageDealt;
        enemyEnergyShield.absorbDamage(damageResult.damageAbsorbed);
        this.game.spawn(enemy.position.x, enemy.position.y, "hitEffect", {
          damageType: this.stats.damageType,
          lifeSpan: 0.3
        });
        if (this.ownerStats.slowEffect) {
          enemyStats.addEffect(
            this.game.config.effects.slow,
            this.game.effects.slow,
            this.ownerStats.slowEffect
          );
        }
      }
    }
  }
}
}