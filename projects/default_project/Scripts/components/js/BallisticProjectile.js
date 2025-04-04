class BallisticProjectile extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
init({ spawnType, owner, target, stats }) {
    this.type = spawnType;
    this.def = this.game.config.projectiles[this.type];
    this.owner = owner;
    this.target = target;
    this.stats = stats;
    this.piercedEnemies = [];
    this.ownerStats = this.owner.getComponent("stats").stats;
    this.distanceTraveled = 0;
    this.distanceToSpawnParticle = 24;
    
    // Ballistic trajectory variables
    this.startPosition = { ...this.parent.position, z: 10 }; // Start 10 units above ground
    this.targetPosition = { ...this.target.position, z: 0 };
    this.time = 0;
    
    this.totalDist = Math.sqrt(
        (this.targetPosition.x - this.startPosition.x) ** 2 + 
        (this.targetPosition.y - this.startPosition.y) ** 2
    );
    this.maxHeight = this.totalDist / Math.PI;
    
    // Initialize position with Z component
    this.parent.position.z = this.startPosition.z;
    this.positionZ = this.startPosition.z;
}

update() {
this.parent.position.z = this.positionZ;
    
    // Calculate progress (0 to 1)
    this.time += this.game.deltaTime;
       const dx = this.targetPosition.x - this.parent.position.x;
        const dy = this.targetPosition.y - this.parent.position.y;
        const distSq = dx * dx + dy * dy;
        let dist = Math.sqrt(distSq);
    const speed = this.stats.speed;
    this.parent.position.x += (dx / dist) * speed / (Math.PI);
    this.parent.position.y += (dy / dist) * speed / (Math.PI);


     const currentDist = Math.sqrt(
        (this.parent.position.x - this.startPosition.x) ** 2 + 
        (this.parent.position.y - this.startPosition.y) ** 2
    );
    const xyprogressToTarget = Math.min(1, currentDist / this.totalDist);

    // Parabolic trajectory calculation (2:1 isometric adjusted)
     this.parent.position.z = this.maxHeight * (1 - Math.pow(2 * xyprogressToTarget - 1, 2));
    
    this.positionZ = this.parent.position.z;
    // Check if we've hit the ground (Z <= 0)
    if (this.parent.position.z <= 0) {
        this.parent.position.z = 0; // Snap to ground
        
        // Hit detection - same as before but at current position
        const targetDistSq = (this.parent.position.x - this.target.position.x) ** 2 + 
                           (this.parent.position.y - this.target.position.y) ** 2;
        
        
     
            // We missed the target but hit the ground - maybe still do splash damage
       if (this.stats.splashRadius > 0) {
           this.processSplashDamage();
       }
       this.parent.destroy();
        
        
        return;
    }
    
    // Update distance traveled for particles
    const tDx = this.parent.lastPosition.x - this.parent.position.x;
    const tDy = this.parent.lastPosition.y - this.parent.position.y;
    const tDist = Math.sqrt(tDx * tDx + tDy * tDy);
    this.distanceTraveled += tDist;
    
    if (this.def.particle && this.distanceTraveled > this.distanceToSpawnParticle) {

        let particle = this.game.spawn(this.parent.lastPosition.x + Math.random() * 4 - 2, this.parent.lastPosition.y + Math.random() * 4 - 2, "particle", { objectType: "particles", spawnType: this.def.particle });
        particle.position.z = this.parent.position.z + Math.random() * 4 - 2;
        this.distanceTraveled = 0;
        this.distanceToSpawnParticle += Math.random() * 2;
    }
}


processSplashDamage() {
    const nearbyEnemies = this.game.spatialGrid.getNearbyEntities(
        this.parent.gridPosition.x, 
        this.parent.gridPosition.y, 
        this.stats.splashRadius,
        "enemy"
    );
    let explosion = this.game.spawn(this.parent.position.x, this.parent.position.y, "explosion", { radius: this.stats.splashRadius });
    for (const enemy of nearbyEnemies) {
        if (enemy.isDead) continue;
        
        const dx = enemy.position.x - this.parent.position.x;
        const dy = enemy.position.y - this.parent.position.y;
        const distSq = dx * dx + dy * dy;
        
        let gridSize = this.game.config.configs.game.gridSize;
        const splashRadiusSq = this.stats.splashRadius * this.stats.splashRadius * gridSize * gridSize;
        
        if (distSq <= splashRadiusSq) {
            let enemyHealth = enemy.getComponent("health");
            let enemyEnergyShield = enemy.getComponent("energyshield");
            let enemyStats = enemy.getComponent("stats");
            let enemyStatClone = { ...enemyStats.stats };
            enemyStatClone.energyShield = enemyEnergyShield.energyShield;
            
            let damageResult = engine.getFunction("calculateDamage")(this.stats, enemyStatClone);
            if (!damageResult.wasEvaded) {
                enemyHealth.hp -= damageResult.damageDealt;
                enemyEnergyShield.absorbDamage(damageResult.damageAbsorbed);
                this.game.spawn(enemy.position.x, enemy.position.y, "hitEffect", { damageType: this.stats.damageType , lifeSpan: .3});
                if (this.ownerStats.slowEffect) {
                    enemyStats.addEffect(this.game.config.effects.slow, this.game.effects.slow, this.ownerStats.slowEffect);
                }
            }
        }
    }
}
}