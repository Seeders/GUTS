class IceShardAbility extends GUTS.BaseAbility {
    constructor(game, params = {}) {
        super(game, {
            id: 'ice_shard',
            name: 'Ice Shard',
            description: 'Fires piercing ice shards that slow enemies',
            cooldown: 2.5,
            range: 280,
            manaCost: 25,
            targetType: 'auto',
            animation: 'cast',
            priority: 5,
            castTime: 0.8,
            autoTrigger: 'enemy_in_range',
            ...params
        });
        
        this.damage = 40;
        this.shardCount = 3;
        this.element = 'cold';
        this.slowDuration = 3.0;
    }
    
    defineEffects() {
        return {
            cast: {
                type: 'magic',
                options: {
                    count: 15,
                    color: 0x88ddff,
                    colorRange: { start: 0xffffff, end: 0x4488ff },
                    scaleMultiplier: 2.0,
                    speedMultiplier: 2.5
                }
            },
            shard: {
                type: 'magic',
                options: {
                    count: 10,
                    color: 0x88ffff,
                    colorRange: { start: 0xffffff, end: 0x44ddff },
                    scaleMultiplier: 1.5,
                    speedMultiplier: 3.5
                }
            },
            impact: {
                type: 'explosion',
                options: {
                    count: 12,
                    color: 0x88ddff,
                    colorRange: { start: 0xffffff, end: 0x4488ff },
                    scaleMultiplier: 1.8,
                    speedMultiplier: 2.5
                }
            },
            frost: {
                type: 'magic',
                options: {
                    count: 8,
                    color: 0xaaddff,
                    colorRange: { start: 0xffffff, end: 0x6699ff },
                    scaleMultiplier: 1.0,
                    speedMultiplier: 1.5
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
        
        // Immediate cast effect
        this.createVisualEffect(casterPos, 'cast');
        this.logAbilityUsage(casterEntity, `Crystalline ice shards pierce the air!`);
        
        // Schedule all shards with staggered timing
        for (let i = 0; i < this.shardCount; i++) {
            const shardDelay = this.castTime + (i * 0.2); // 0.2 second stagger between shards
            
            this.game.schedulingSystem.scheduleAction(() => {
                // Re-get enemies at firing time (some may have died)
                const currentEnemies = this.getEnemiesInRange(casterEntity);
                if (currentEnemies.length > 0) {
                    // DESYNC SAFE: Select target deterministically instead of randomly
                    const target = this.selectDeterministicTarget(currentEnemies, i);
                    if (target) {
                        this.fireIceShard(casterEntity, target);
                    }
                }
            }, shardDelay, casterEntity);
        }
    }
    
    // DESYNC SAFE: Deterministic target selection instead of random
    selectDeterministicTarget(enemies, shardIndex) {
        if (enemies.length === 0) return null;
        
        // Sort enemies deterministically
        const sortedEnemies = enemies.slice().sort((a, b) => String(a).localeCompare(String(b)));
        
        // Use shard index to cycle through targets deterministically
        const targetIndex = shardIndex % sortedEnemies.length;
        return sortedEnemies[targetIndex];
    }
    
    fireIceShard(casterEntity, targetId) {
        const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);

        if (!casterPos || !targetPos) return;

        // Visual effect at launch
        this.createVisualEffect(casterPos, 'shard');

        // Create frost trail effect
        if (this.game.gameManager) {
            // Launch burst
            const launchPos = new THREE.Vector3(casterPos.x, casterPos.y + 50, casterPos.z);

            this.game.gameManager.call('createParticles', {
                position: launchPos,
                count: 8,
                lifetime: 0.4,
                visual: {
                    color: 0x88ffff,
                    colorRange: { start: 0xffffff, end: 0x44ddff },
                    scale: 15,
                    scaleMultiplier: 1.2,
                    fadeOut: true,
                    blending: 'additive'
                },
                velocityRange: { x: [-30, 30], y: [20, 50], z: [-30, 30] },
                gravity: -20,
                drag: 0.9
            });

            // Create trail particles along path
            const trailCount = 5;
            for (let i = 0; i < trailCount; i++) {
                const progress = (i + 1) / (trailCount + 1);
                const trailX = casterPos.x + (targetPos.x - casterPos.x) * progress;
                const trailY = casterPos.y + (targetPos.y - casterPos.y) * progress + 50;
                const trailZ = casterPos.z + (targetPos.z - casterPos.z) * progress;

                this.game.schedulingSystem.scheduleAction(() => {
                    this.game.gameManager.call('createParticles', {
                        position: new THREE.Vector3(trailX, trailY, trailZ),
                        count: 4,
                        lifetime: 0.5,
                        visual: {
                            color: 0xaaddff,
                            colorRange: { start: 0xffffff, end: 0x6699ff },
                            scale: 10,
                            scaleMultiplier: 0.8,
                            fadeOut: true,
                            blending: 'additive'
                        },
                        velocityRange: { x: [-15, 15], y: [10, 30], z: [-15, 15] },
                        gravity: -10,
                        drag: 0.95
                    });
                }, i * 0.05, null);
            }
        }

        // Deal damage with slowing effect
        this.dealDamageWithEffects(casterEntity, targetId, this.damage, this.element, {
            isIceShard: true,
            slowDuration: this.slowDuration
        });

        // Impact effect at target
        this.game.schedulingSystem.scheduleAction(() => {
            const currentTargetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
            if (currentTargetPos) {
                this.createVisualEffect(currentTargetPos, 'impact');
                this.createVisualEffect(currentTargetPos, 'frost');

                // Enhanced ice shatter effect
                if (this.game.gameManager) {
                    const impactPos = new THREE.Vector3(currentTargetPos.x, currentTargetPos.y + 50, currentTargetPos.z);

                    this.game.gameManager.call('createLayeredEffect', {
                        position: impactPos,
                        layers: [
                            // Ice shatter burst
                            {
                                count: 15,
                                lifetime: 0.5,
                                color: 0x88ffff,
                                colorRange: { start: 0xffffff, end: 0x44ddff },
                                scale: 12,
                                scaleMultiplier: 1.0,
                                velocityRange: { x: [-60, 60], y: [20, 80], z: [-60, 60] },
                                gravity: 150,
                                drag: 0.95,
                                blending: 'additive'
                            },
                            // Frost mist
                            {
                                count: 10,
                                lifetime: 0.8,
                                color: 0xaaddff,
                                colorRange: { start: 0xcceeFF, end: 0x6699ff },
                                scale: 18,
                                scaleMultiplier: 1.5,
                                velocityRange: { x: [-30, 30], y: [10, 40], z: [-30, 30] },
                                gravity: -30,
                                drag: 0.92,
                                blending: 'additive'
                            }
                        ]
                    });
                }
            }
        }, 0.25, casterEntity);
    }
}