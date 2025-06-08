class ChainProjectile extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
    init( { spawnType, owner, target, stats }) {        
        this.type = spawnType;
        this.owner = owner;
        this.target = target;
        this.stats = stats;
        this.piercedEnemies = [];
        this.ownerStats = this.owner.getComponent("stats").stats;
        this.chainTargets = []; // Store all targets hit in one frame
        this.hasStruck = false; // Flag to strike only once
    }

    update() {
        if (this.hasStruck) {
            this.parent.destroy(); // Destroy after one frame of striking
            return;
        }

        if (!this.target || this.target.destroyed) {
            this.parent.destroy();
            return;
        }

        // Strike the initial target
        let targetHealth = this.target.getComponent("health");
        let targetEnergyShield = this.target.getComponent("energyshield");
        let targetStats = {...this.target.getComponent("stats").stats};
        targetStats.energyShield = targetEnergyShield.energyShield;
        let damageResult = engine.getFunction("calculateDamage")(this.stats, targetStats);                    
        if( damageResult.wasEvaded ) { return; }         
        targetHealth.hp -= damageResult.damageDealt;
        targetEnergyShield.absorbDamage(damageResult.damageAbsorbed);
        this.piercedEnemies.push(this.target);
        this.chainTargets.push(this.target);
        this.game.spawn("hitEffect", { damageType: this.stats.damageType, lifeSpan: 1, position: this.target.transform.position});
        // Chain to nearby enemies
        if (this.stats.piercing > 0 && this.piercedEnemies.length <= this.stats.piercing) {
            const nearbyEnemies = this.game.spatialGrid.getNearbyEntities(
                this.target.transform.gridPosition.x, 
                this.target.transform.gridPosition.y, 
                this.ownerStats.range,
                "enemy"
            );

            for (let enemy of nearbyEnemies) {
                if (enemy.destroyed || this.piercedEnemies.includes(enemy)) continue;
                const dx = enemy.transform.position.x - this.target.transform.position.x;
                const dy = enemy.transform.position.y - this.target.transform.position.y;
                const distSq = dx * dx + dy * dy;
                let gridSize = this.game.getCollections().configs.game.gridSize;
                if (distSq <= this.ownerStats.range * this.ownerStats.range * gridSize * gridSize) {
                    let enemyHealth = enemy.getComponent("health");
                    let enemyEnergyShield = enemy.getComponent("energyshield");
                    let enemyStats = {...enemy.getComponent("stats").stats};
                    enemyStats.energyShield = targetEnergyShield.energyShield;
                    let damageResult = engine.getFunction("calculateDamage")(this.stats, enemyStats); 
                    if(!damageResult.wasEvaded) {
                        enemyHealth.hp -= damageResult.damageDealt;
                        enemyEnergyShield.absorbDamage(damageResult.damageAbsorbed);
                        this.piercedEnemies.push(enemy);
                        this.chainTargets.push(enemy);
                        this.game.spawn("hitEffect", { damageType: this.stats.damageType, lifeSpan: 1, position:  enemy.transform.position});
                        if (this.piercedEnemies.length > this.stats.piercing) break;
                    } else {
                        break;
                    }
                }
            }
        }

        // Apply additional effects (e.g., slow, leech) to all hit targets
        for (let enemy of this.chainTargets) {
            if (this.ownerStats.slowAmount) {
                enemy.getComponent("stats").addEffect(this.game.getCollections().effects.slow, this.game.effects.slow, this.ownerStats.slowAmount);
            }
            if (this.ownerStats.leech > 0) {
                const healing = this.stats.damage * this.ownerStats.leech * this.game.state.stats.healingMultiplier;
                this.game.state.bloodCoreHP = Math.min(this.game.state.stats.maxBloodCoreHP, this.game.state.bloodCoreHP + healing);
            }
            if (this.ownerStats.thief && this.ownerStats.thief != 0) {
                const stealAmt = this.stats.damage * this.ownerStats.thief * this.game.state.stats.bloodShardMultiplier;
                this.game.state.bloodShards += stealAmt;
            }
        }

        this.hasStruck = true; // Mark as struck, render lightning this frame
    }
}