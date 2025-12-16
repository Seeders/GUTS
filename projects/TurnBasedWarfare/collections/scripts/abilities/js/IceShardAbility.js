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
        this.element = this.enums.element.cold;
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
        const transform = this.game.getComponent(casterEntity, "transform");
        const casterPos = transform?.position;
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
        const sortedEnemies = enemies.slice().sort((a, b) => a - b);
        
        // Use shard index to cycle through targets deterministically
        const targetIndex = shardIndex % sortedEnemies.length;
        return sortedEnemies[targetIndex];
    }
    
    fireIceShard(casterEntity, targetId) {
        const casterTransform = this.game.getComponent(casterEntity, "transform");
        const casterPos = casterTransform?.position;
        const targetTransform = this.game.getComponent(targetId, "transform");
        const targetPos = targetTransform?.position;

        if (!casterPos || !targetPos) return;

        // Visual effect at launch
        this.createVisualEffect(casterPos, 'shard');

        // Create frost trail effect using preset effects
        if (!this.game.isServer) {
            // Launch burst
            const launchPos = new THREE.Vector3(casterPos.x, casterPos.y + 50, casterPos.z);
            this.game.call('playEffect', 'ice_shards', launchPos);

            // Create trail particles along path
            const trailCount = 5;
            for (let i = 0; i < trailCount; i++) {
                const progress = (i + 1) / (trailCount + 1);
                const trailX = casterPos.x + (targetPos.x - casterPos.x) * progress;
                const trailY = casterPos.y + (targetPos.y - casterPos.y) * progress + 50;
                const trailZ = casterPos.z + (targetPos.z - casterPos.z) * progress;

                this.game.schedulingSystem.scheduleAction(() => {
                    this.game.call('playEffect', 'ice_trail',
                        new THREE.Vector3(trailX, trailY, trailZ));
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
            const transform = this.game.getComponent(targetId, "transform");
            const currentTargetPos = transform?.position;
            if (currentTargetPos) {
                this.createVisualEffect(currentTargetPos, 'impact');
                this.createVisualEffect(currentTargetPos, 'frost');

                // Use preset ice_impact effect system
                if (!this.game.isServer) {
                    this.game.call('playEffectSystem', 'ice_impact',
                        new THREE.Vector3(currentTargetPos.x, currentTargetPos.y + 50, currentTargetPos.z));
                }
            }
        }, 0.25, casterEntity);
    }
}
