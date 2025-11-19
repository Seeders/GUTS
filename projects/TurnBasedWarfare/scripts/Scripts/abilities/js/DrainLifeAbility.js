class DrainLifeAbility extends engine.app.appClasses['BaseAbility'] {
    constructor(game, params = {}) {
        super(game, {
            id: 'drain_life',
            name: 'Drain Life',
            description: 'Drains health from an enemy and heals the caster',
            cooldown: 4.5,
            range: 200,
            manaCost: 45,
            targetType: 'auto',
            animation: 'cast',
            priority: 7,
            castTime: 1.2,
            autoTrigger: 'low_health',
            ...params
        });
        
        this.drainAmount = 60;
        this.healRatio = 0.8; // Heal 80% of drained health
        this.element = 'physical';
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 15,
                    color: 0x9900cc,
                    colorRange: { start: 0xcc44ff, end: 0x4B0082 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 1.5
                }
            },
            drain: {
                type: 'damage',
                options: {
                    count: 18,
                    color: 0x8B008B,
                    colorRange: { start: 0xcc00ff, end: 0x440066 },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 2.5
                }
            },
            heal: {
                type: 'heal',
                options: {
                    count: 15,
                    color: 0xaa44ff,
                    colorRange: { start: 0xcc88ff, end: 0x9900cc },
                    scaleMultiplier: 1.8,
                    speedMultiplier: 0.8
                }
            },
            dark_energy: {
                type: 'magic',
                options: {
                    count: 10,
                    color: 0x660099,
                    colorRange: { start: 0x9900cc, end: 0x330066 },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 2.0
                }
            }
        };
    }
    
    canExecute(casterEntity) {
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        const enemies = this.getEnemiesInRange(casterEntity);
        
        // Use when injured and enemies are available
        return enemies.length >= 1 && 
               casterHealth && casterHealth.current < casterHealth.max * 0.6;
    }
    
    execute(casterEntity) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        if (!casterPos) return;
        
        // DESYNC SAFE: Get and sort enemies deterministically
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // DESYNC SAFE: Target selection
        const target = this.findHighestHealthEnemy(enemies);
        if (!target) return;
        
        const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
        if (!targetPos) return;
        
        // Immediate effects (visual, audio, logging)
        this.createVisualEffect(casterPos, 'cast');
        
        // Create drain beam effect immediately
        if (this.game.effectsSystem) {
            this.game.effectsSystem.createEnergyBeam(
                new THREE.Vector3(casterPos.x, casterPos.y + 15, casterPos.z),
                new THREE.Vector3(targetPos.x, targetPos.y + 10, targetPos.z),
                {
                    style: { color: 0x8B008B, linewidth: 4 },
                    animation: { duration: 1000, pulseEffect: true }
                }
            );
        }
        
        this.logAbilityUsage(casterEntity, `Dark energy siphons life force!`);
        
        // DESYNC SAFE: Use scheduling system for delayed effect
        this.game.schedulingSystem.scheduleAction(() => {
            const currentTargetPos = this.game.getComponent(target, this.componentTypes.POSITION);
            if (currentTargetPos) {
                this.performDrain(casterEntity, target, currentTargetPos);
            }
        }, this.castTime, casterEntity);
    }
    
    performDrain(casterEntity, targetId, targetPos) {
        const casterHealth = this.game.getComponent(casterEntity, this.componentTypes.HEALTH);
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);

        if (!casterHealth || !casterPos || !targetPos) return;

        // Apply damage to target
        const result = this.dealDamageWithEffects(casterEntity, targetId, this.drainAmount, this.element, {
            isDrain: true
        });

        if (result && result.damage > 0) {
            // Heal caster based on damage dealt
            const healAmount = Math.floor(result.damage * this.healRatio);
            const actualHeal = Math.min(healAmount, casterHealth.max - casterHealth.current);
            casterHealth.current += actualHeal;

            // Dark energy burst at target
            this.createVisualEffect(targetPos, 'drain');
            this.createVisualEffect(targetPos, 'dark_energy');

            // Create flowing dark energy particles from target to caster
            if (this.game.gameManager) {
                // Dark energy extraction at target
                const targetEffectPos = new THREE.Vector3(targetPos.x, targetPos.y + 50, targetPos.z);

                this.game.gameManager.call('createLayeredEffect', {
                    position: targetEffectPos,
                    layers: [
                        // Soul extraction burst
                        {
                            count: 20,
                            lifetime: 0.6,
                            color: 0xcc00ff,
                            colorRange: { start: 0xff44ff, end: 0x660099 },
                            scale: 20,
                            scaleMultiplier: 1.5,
                            velocityRange: { x: [-60, 60], y: [20, 80], z: [-60, 60] },
                            gravity: -50,
                            drag: 0.9,
                            blending: 'additive'
                        },
                        // Dark wisps
                        {
                            count: 15,
                            lifetime: 0.8,
                            color: 0x660099,
                            colorRange: { start: 0x9900cc, end: 0x330044 },
                            scale: 15,
                            scaleMultiplier: 1.2,
                            velocityRange: { x: [-40, 40], y: [30, 100], z: [-40, 40] },
                            gravity: -80,
                            drag: 0.95,
                            blending: 'additive'
                        }
                    ]
                });

                // Flowing energy stream from target to caster
                const streamCount = 8;
                for (let i = 0; i < streamCount; i++) {
                    this.game.schedulingSystem.scheduleAction(() => {
                        // Calculate position along path
                        const progress = i / streamCount;
                        const streamX = targetPos.x + (casterPos.x - targetPos.x) * progress;
                        const streamY = targetPos.y + (casterPos.y - targetPos.y) * progress + 50 + Math.sin(progress * Math.PI) * 30;
                        const streamZ = targetPos.z + (casterPos.z - targetPos.z) * progress;

                        this.game.gameManager.call('createParticles', {
                            position: new THREE.Vector3(streamX, streamY, streamZ),
                            count: 6,
                            lifetime: 0.4,
                            visual: {
                                color: 0xaa00ff,
                                colorRange: { start: 0xff66ff, end: 0x660099 },
                                scale: 12,
                                scaleMultiplier: 0.8,
                                fadeOut: true,
                                blending: 'additive'
                            },
                            velocityRange: { x: [-20, 20], y: [-10, 30], z: [-20, 20] },
                            gravity: -30,
                            drag: 0.95
                        });
                    }, i * 0.05, null);
                }
            }

            // Heal effect on caster
            if (actualHeal > 0) {
                this.createVisualEffect(casterPos, 'heal');

                // Enhanced heal absorption effect
                if (this.game.gameManager) {
                    const casterEffectPos = new THREE.Vector3(casterPos.x, casterPos.y + 50, casterPos.z);

                    this.game.gameManager.call('createLayeredEffect', {
                        position: casterEffectPos,
                        layers: [
                            // Absorbed energy
                            {
                                count: 15,
                                lifetime: 1.0,
                                color: 0xaa44ff,
                                colorRange: { start: 0xff88ff, end: 0x9900cc },
                                scale: 18,
                                scaleMultiplier: 1.5,
                                velocityRange: { x: [-30, 30], y: [30, 80], z: [-30, 30] },
                                gravity: -60,
                                drag: 0.92,
                                emitterShape: 'ring',
                                emitterRadius: 15,
                                blending: 'additive'
                            }
                        ]
                    });
                }

                if (this.game.gameManager && this.game.gameManager.has('showDamageNumber')) {
                    this.game.gameManager.call('showDamageNumber',
                        casterPos.x, casterPos.y + 50, casterPos.z,
                        actualHeal, 'heal'
                    );
                }
            }
        }
    }
    
    // DESYNC SAFE: Deterministic target selection
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