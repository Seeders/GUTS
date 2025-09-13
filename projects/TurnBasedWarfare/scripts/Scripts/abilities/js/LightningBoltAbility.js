class LightningBoltAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'lightning_bolt',
            name: 'Lightning Bolt',
            description: 'Instantly strikes an enemy with pure lightning',
            cooldown: 2.0,
            range: 350,
            manaCost: 30,
            targetType: 'auto',
            animation: 'cast',
            priority: 7,
            castTime: 0.5,
            autoTrigger: 'enemy_in_range',
            ...params
        });
        
        this.damage = 55;
        this.criticalChance = 0.3; // 30% crit chance
        this.element = 'lightning';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 1,
                    color: 0xffff44,
                    colorRange: { start: 0xffff44, end: 0xffffff },
                    scaleMultiplier: 1.2,
                    speedMultiplier: 4.0
                }
            },
            lightning: {
                type: 'magic',
                options: {
                    count: 2,
                    color: 0xffffaa,
                    scaleMultiplier: 1.5,
                    speedMultiplier: 5.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const enemies = this.getEnemiesInRange(casterEntity);
        return enemies.length >= 1;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // DESYNC SAFE: Find target with highest health deterministically
        const target = this.findHighestHealthEnemy(enemies);
        if (!target) return;
        
        const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
        if (!targetPos) return;
        
        // Immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Lightning crackles with divine fury!`, true);
        
        // DESYNC SAFE: Use scheduling system instead of setTimeout
        this.game.schedulingSystem.scheduleAction(() => {
            this.strikeLightning(casterEntity, target, targetPos);
        }, this.castTime, casterEntity);
    }
    
    strikeLightning(casterEntity, targetId, targetPos) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // Create lightning bolt visual effect
        if (this.game.effectsSystem) {
            this.game.effectsSystem.createLightningBolt(
                new THREE.Vector3(casterPos.x, casterPos.y + 50, casterPos.z),
                new THREE.Vector3(targetPos.x, targetPos.y + 10, targetPos.z),
                {
                    style: { color: 0xffffaa, linewidth: 6 },
                    animation: { duration: 400, flickerCount: 3 }
                }
            );
        }
        
        // Lightning effect at target
        this.createVisualEffect(targetPos, 'lightning');
        
        // Screen flash
        if (this.game.effectsSystem) {
            this.game.effectsSystem.playScreenFlash('#ffffaa', 0.15);
        }
        
        // DESYNC SAFE: Determine critical hit deterministically instead of random
        const isCritical = this.isDeterministicCritical(casterEntity, targetId);
        const damage = isCritical ? this.damage * 2 : this.damage;
        
        // Apply lightning damage
        this.dealDamageWithEffects(casterEntity, targetId, damage, this.element, {
            isCritical: isCritical,
            isInstant: true
        });
    }
    
    // DESYNC SAFE: Deterministic critical hit calculation
    isDeterministicCritical(casterId, targetId) {
        // Create a deterministic "random" value based on entity IDs and game time
        const seed = parseInt(casterId) + parseInt(targetId) + Math.floor(this.game.state.now * 100);
        const pseudoRandom = (seed * 9301 + 49297) % 233280 / 233280; // Simple PRNG
        
        return pseudoRandom < this.criticalChance;
    }
    
    // DESYNC SAFE: Deterministic highest health enemy finding
    findHighestHealthEnemy(enemies) {
        // Sort enemies deterministically first
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        let strongest = null;
        let highestHealth = 0;
        
        sortedEnemies.forEach(enemyId => {
            const health = this.game.getComponent(enemyId, this.componentTypes.HEALTH);
            if (health && health.current >= highestHealth) { // Use >= for consistent tie-breaking
                highestHealth = health.current;
                strongest = enemyId;
            }
        });
        
        return strongest;
    }
}