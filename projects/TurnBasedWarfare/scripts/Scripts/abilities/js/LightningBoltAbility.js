class LightningBoltAbility extends GUTS.app.appClasses['BaseAbility'] {
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

        // Enhanced electric impact effect
        if (this.game.gameManager) {
            const impactPos = new THREE.Vector3(targetPos.x, targetPos.y + 30, targetPos.z);

            this.game.gameManager.call('createLayeredEffect', {
                position: impactPos,
                layers: [
                    // Bright flash core
                    {
                        count: 12,
                        lifetime: 0.15,
                        color: 0xffffff,
                        colorRange: { start: 0xffffff, end: 0xffffaa },
                        scale: 25,
                        scaleMultiplier: 2.0,
                        velocityRange: { x: [-80, 80], y: [20, 100], z: [-80, 80] },
                        gravity: 0,
                        drag: 0.8,
                        blending: 'additive'
                    },
                    // Electric sparks
                    {
                        count: 20,
                        lifetime: 0.4,
                        color: 0xffff44,
                        colorRange: { start: 0xffffff, end: 0x88aaff },
                        scale: 10,
                        scaleMultiplier: 0.8,
                        velocityRange: { x: [-120, 120], y: [30, 150], z: [-120, 120] },
                        gravity: 200,
                        drag: 0.95,
                        blending: 'additive'
                    },
                    // Blue electric arcs
                    {
                        count: 15,
                        lifetime: 0.3,
                        color: 0x44aaff,
                        colorRange: { start: 0x88ddff, end: 0x4488ff },
                        scale: 8,
                        scaleMultiplier: 1.2,
                        velocityRange: { x: [-100, 100], y: [50, 120], z: [-100, 100] },
                        gravity: -50,
                        drag: 0.9,
                        blending: 'additive'
                    }
                ]
            });

            // Ground scorch ring
            this.game.gameManager.call('createParticles', {
                position: new THREE.Vector3(targetPos.x, targetPos.y + 5, targetPos.z),
                count: 16,
                lifetime: 0.5,
                visual: {
                    color: 0xffaa44,
                    colorRange: { start: 0xffffaa, end: 0x886622 },
                    scale: 12,
                    scaleMultiplier: 1.5,
                    fadeOut: true,
                    blending: 'additive'
                },
                velocityRange: { x: [-60, 60], y: [5, 20], z: [-60, 60] },
                gravity: 10,
                drag: 0.92,
                emitterShape: 'ring',
                emitterRadius: 20
            });
        }

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