class IceShardAbility extends engine.app.appClasses['BaseAbility'] {
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
                    count: 5,
                    color: 0x4488ff,
                    colorRange: { start: 0x4488ff, end: 0xaaffff },
                    scaleMultiplier: 1.0,
                    speedMultiplier: 2.0
                }
            },
            shard: {
                type: 'magic',
                options: {
                    count: 5,
                    color: 0x88bbff,
                    scaleMultiplier: 0.6,
                    speedMultiplier: 3.0
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
        
        // DESYNC SAFE: Use scheduling system instead of setTimeout
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
        
        // Deal damage with slowing effect
        this.dealDamageWithEffects(casterEntity, targetId, this.damage, this.element, {
            isIceShard: true,
            slowDuration: this.slowDuration
        });
        
        // DESYNC SAFE: Use scheduling system for visual effect delay
        this.game.schedulingSystem.scheduleAction(() => {
            const currentTargetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
            if (currentTargetPos) {
                this.createVisualEffect(currentTargetPos, 'shard', { count: 3 });
            }
        }, 0.3, casterEntity);
    }
}