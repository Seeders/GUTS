class Attacker extends engine.Component {
    
 init() {        
        this.stats = this.getComponent('stats').stats;    
        this.level = 1;
        this.target = null;
        this.projectiles = [];  
        this.cooldown = 0;
    }

    update() {
        if (this.cooldown > 0) this.cooldown -= this.game.deltaTime;

        // Validate current target
        if (this.target) {
            const distance = Math.hypot(
                this.target.transform.position.x - this.parent.transform.position.x,
                this.target.transform.position.y - this.parent.transform.position.y
            );
            if (distance > this.stats.range || this.target.getComponent('health').hp <= 0) {
                this.target = null;
            }
        }

        // Find target if none
        if (!this.target) {
            this.findTarget();
        }

        // Attack if ready and has target
        if (this.cooldown <= 0 && this.target) {
            this.attack();
        }

        if (this.cooldown <= 0 && this.stats.mineAmt > 0) {
            this.gather();
        }
        return true;
    }
    
    findTarget() {
        this.target = null;
        let furthestEnemy = null;
        let furthestDistance = -1;
        const nearbyEntities = this.game.spatialGrid.getNearbyEntities(
            this.parent.transform.gridPosition.x, 
            this.parent.transform.gridPosition.y, 
            this.stats.range,
            "enemy"
        );
        for (let enemy of nearbyEntities) {
            let enemyHP = enemy.getComponent("health").hp;
            let followPath = enemy.getComponent('followPath');
            if (enemyHP <= 0) continue;          

            let distanceToEnd = this.game.state.paths[followPath.pathIndex].length - followPath.indexInPath;
            if (distanceToEnd > furthestDistance) {
                furthestDistance = followPath.indexInPath;
                furthestEnemy = enemy;
            }  
        }
        
        this.target = furthestEnemy;
    }

    gather() {
        this.game.state.bloodShards += this.stats.mineAmt;
        this.cooldown = this.stats.attackSpeed;
    }

    attack() {
        if (!this.target) return; 
        this.launchProjectile();
        this.cooldown = this.stats.attackSpeed;
    }
    
    launchProjectile() {
        this.stats = this.getComponent('stats').stats;    
        let projectileType = this.stats.projectile;
        let projectileDef = this.game.getCollections().projectilePrefabs[projectileType];
        

        let projStats = { ...projectileDef };
        delete projStats.render;
        projStats.baseDamage = this.stats.damage || 1; 
        projStats.speed = this.stats.speed || 5;     
        projStats.piercing = this.stats.piercing || 0;
        projStats.splashRadius = this.stats.splashRadius || 0;
        projStats.critChance = this.stats.critChance || 0.05;
        projStats.critMultiplier = this.stats.critMultiplier || 2;
    
       	if(projectileDef.customRenderer == "lightning") {
         	this.game.spawn('lightningProjectile', { objectType: "projectilePrefabs", spawnType: projectileType, target: this.target, owner: this.parent, stats: projStats , position:  this.parent.transform.position});
        } else if(projectileDef.isBallistic) {
         	this.game.spawn('ballisticProjectile', { objectType: "projectilePrefabs", spawnType: projectileType, target: this.target, owner: this.parent, stats: projStats, position:  this.parent.transform.position});
        } else if( this.stats.projectileCount > 0 ) {
          this.game.spawn('multiShotProjectile', { objectType: "projectilePrefabs", spawnType: projectileType, target: this.target, owner: this.parent, stats: projStats, position:  this.parent.transform.position});
        } else {
          this.game.spawn('projectile', { objectType: "projectilePrefabs", spawnType: projectileType, target: this.target, owner: this.parent, stats: projStats, position:  this.parent.transform.position});
        }
    }
}