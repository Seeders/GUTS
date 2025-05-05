class PlanckProjectile extends engine.Component {
    
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

  // Add lifespan for projectile
  this.maxLifespan = this.stats.lifespan || 5; // Default to 5 seconds
  this.currentLifespan = 0;
  
  // Get the planck body from the component
  this.planckBody = this.parent.getComponent('planckBody');
  
  // Calculate direction and set velocity
  const currentPosition = {
    x: this.parent.transform.position.x,
    y: this.parent.transform.position.y
  };
  
  const targetPos = this.targetPosition ? this.targetPosition : this.target.transform.position;
  const dx = targetPos.x - currentPosition.x;
  const dy = targetPos.y - currentPosition.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  // Normalize direction and multiply by speed
  this.speed = this.stats.speed;
  const velocityX = (dx / dist) * this.speed;
  const velocityY = (dy / dist) * this.speed;
  
  // Set the linear velocity on the planck body
  this.planckBody.setVelocity({ x: velocityX, y: velocityY });
  
  // Store a reference to this projectile in the body's user data
  this.planckBody.body.setUserData(this);
  
  // Setup contact listener if not already done
  if (!this.game.contactListenerSetup) {
    this.setupContactListener();
    this.game.contactListenerSetup = true;
  }
}

setupContactListener() {
  const world = this.game.planckWorld;
  
  world.on('begin-contact', (contact) => {
    const fixtureA = contact.getFixtureA();
    const fixtureB = contact.getFixtureB();
    
    const bodyA = fixtureA.getBody();
    const bodyB = fixtureB.getBody();
    
    const entityA = bodyA.getUserData();
    const entityB = bodyB.getUserData();
    
    // Check if one is a projectile and one is an enemy
    if (entityA && entityB) {
      let projectile = null;
      let enemy = null;
      
      if (entityA.parent && entityA.parent.type === "projectile" && !entityB.parent) {
        projectile = entityA;
        enemy = entityB;

      } else if (entityB.parent && entityB.parent.type === "projectile" && !entityA.parent) {
        projectile = entityB;
        enemy = entityA;        
      }
      
      if (projectile && enemy) {
        // Handle collision in the next frame to avoid modifying physics during step
        this.game.queuePostPhysicsCallback(() => {
          projectile.handleEnemyCollision(enemy);
        });
      }
    }
  });
}

handleEnemyCollision(enemy) {
  // Skip if already hit this enemy or enemy is dead
  if (enemy.isDead || this.piercedEnemies.includes(enemy)) {
    return;
  }
  
  // Apply damage
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
    this.game.spawn(enemy.transform.position.x, enemy.transform.position.y, "hitEffect", {
      damageType: this.stats.damageType,
      lifeSpan: 0.3
    });
    if (this.ownerStats.slowAmount) {
      enemyStats.addEffect(
        this.game.config.effects.slow,
        this.game.effects.slow,
        this.ownerStats.slowAmount
      );
    }
  }

  // Special effects logic (summon, leech, thief)
  if (
    this.ownerStats.summonChance > 0 &&
    enemyHealth.hp <= 0 &&
    Math.random() < this.ownerStats.summonChance - 1
  ) {
    this.game.spawn(enemy.transform.position.x, enemy.transform.position.y, "summonedTower", {
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

  // Splash damage if applicable
  if (this.stats.splashRadius > 0) {
    this.applySplashDamage(enemy);
    this.game.spawn(this.parent.transform.position.x, this.parent.transform.position.y, "explosion", {
      radius: this.stats.splashRadius
    });
  }

  // Piercing logic
  if (this.stats.piercing > 0 && this.piercedEnemies.length < this.stats.piercing) {
    this.piercedEnemies.push(enemy);
    const nearbyEnemies = this.game.spatialGrid.getNearbyEntities(
      this.parent.transform.gridPosition.x,
      this.parent.transform.gridPosition.y,
      this.ownerStats.range,
      "enemy"
    );
    const newTarget = this.findNewTarget(nearbyEnemies);
    if (newTarget) {
      this.target = newTarget;
      this.targetPosition = null; // Switch to target-based tracking
      
      // Recalculate velocity toward the new target
      const currentPosition = {
        x: this.parent.transform.position.x,
        y: this.parent.transform.position.y
      };
      
      const dx = newTarget.position.x - currentPosition.x;
      const dy = newTarget.position.y - currentPosition.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > 0) {
        const velocityX = (dx / dist) * this.speed;
        const velocityY = (dy / dist) * this.speed;
        this.planckBody.setVelocity({ x: velocityX, y: velocityY });
      }
    } else {
      // No new target, keep going but don't destroy
      return;
    }
  } else {
    // No piercing or reached piercing limit, destroy projectile
    //this.parent.destroy();
  }
}

applySplashDamage(centerEnemy) {
  // Get nearby enemies within splash radius
  const nearbyEnemies = this.game.spatialGrid.getNearbyEntities(
    this.parent.transform.gridPosition.x,
    this.parent.transform.gridPosition.y,
    this.stats.splashRadius,
    "enemy"
  );
  
  const gridSize = this.game.config.configs.game.gridSize;
  const splashRadiusSq = this.stats.splashRadius * this.stats.splashRadius * gridSize * gridSize;
  
  for (const enemy of nearbyEnemies) {
    // Skip the center enemy (already damaged) and dead enemies
    if (enemy === centerEnemy || enemy.isDead || this.piercedEnemies.includes(enemy)) continue;
    
    let enemyHealth = enemy.getComponent("health");
    let enemyEnergyShield = enemy.getComponent("energyshield");
    let enemyStats = enemy.getComponent("stats");
    let enemyStatClone = { ...enemyStats.stats };
    enemyStatClone.energyShield = enemyEnergyShield.energyShield;

    const dx = enemy.transform.position.x - this.parent.transform.position.x;
    const dy = enemy.transform.position.y - this.parent.transform.position.y;
    const distSq = dx * dx + dy * dy;

    if (distSq <= splashRadiusSq) {
      let damageResult = engine.getFunction("calculateDamage")(this.stats, enemyStatClone);
      if (!damageResult.wasEvaded) {
        enemyHealth.hp -= damageResult.damageDealt;
        enemyEnergyShield.absorbDamage(damageResult.damageAbsorbed);
        this.game.spawn(enemy.transform.position.x, enemy.transform.position.y, "hitEffect", {
          damageType: this.stats.damageType,
          lifeSpan: 0.3
        });
        if (this.ownerStats.slowAmount) {
          enemyStats.addEffect(
            this.game.config.effects.slow,
            this.game.effects.slow,
            this.ownerStats.slowAmount
          );
        }
      }
    }
  }
}

update() {
  if(this.target) this.targetCurrentPosition = {...this.target.transform.position };
  
  // Update lifespan and destroy if expired
  this.currentLifespan += this.game.deltaTime;
  if (this.currentLifespan >= this.maxLifespan) {
    this.parent.destroy();
    return;
  }

  // Remove if target is gone (only if no targetPosition)
  if (!this.targetPosition && (!this.target || this.target.destroyed)) {
    if(this.targetCurrentPosition) {
      this.targetPosition = this.targetCurrentPosition;
      
      // Recalculate velocity toward the last known position
      const currentPosition = {
        x: this.parent.transform.position.x,
        y: this.parent.transform.position.y
      };
      
      const dx = this.targetPosition.x - currentPosition.x;
      const dy = this.targetPosition.y - currentPosition.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > 0) {        
        const velocityX = (dx / dist) * this.speed;
        const velocityY = (dy / dist) * this.speed;
        this.planckBody.setVelocity({ x: velocityX, y: velocityY });
      }
    } else {
      this.parent.destroy(); 
      return;
    }
  }
    


  // Particle spawning logic
  const currentPos = this.planckBody.body.getPosition();
  const currentVel = this.planckBody.body.getLinearVelocity();
  const speed = Math.sqrt(currentVel.x * currentVel.x + currentVel.y * currentVel.y);
  
  // Only spawn particles if the projectile is moving
  if (speed > 0 && this.def.particle) {
    this.distanceTraveled += speed * this.game.deltaTime;
    
    if (this.distanceTraveled > this.distanceToSpawnParticle) {
      this.game.spawn(currentPos.x, currentPos.y, "particle", { 
        objectType: "particles", 
        spawnType: this.def.particle
      });
      this.distanceTraveled = 0;
      this.distanceToSpawnParticle = 24 + Math.random() * 3;
    }
  }
}

// Helper method to find a new target for piercing
findNewTarget(nearbyEnemies) {
  const gridSize = this.game.config.configs.game.gridSize;
  const rangeSq = this.ownerStats.range * this.ownerStats.range * gridSize * gridSize;
  for (let enemy of nearbyEnemies) {
    if (!enemy.destroyed && !this.piercedEnemies.includes(enemy)) {
      const dx = enemy.transform.position.x - this.parent.transform.position.x;
      const dy = enemy.transform.position.y - this.parent.transform.position.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < rangeSq) {
        return enemy;
      }
    }
  }
  return null;
}
}