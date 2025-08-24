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
        
        const enemies = this.getEnemiesInRange(casterEntity);
        if (enemies.length === 0) return;
        
        // Cast effect
        this.createVisualEffect(casterPos, 'cast');
        
        // Fire multiple shards with slight delays
        for (let i = 0; i < this.shardCount; i++) {
            setTimeout(() => {
                const target = this.selectRandomTarget(enemies);
                if (target) {
                    this.fireIceShard(casterEntity, target);
                }
            }, i * 200);
        }
        
        this.logAbilityUsage(casterEntity, `Crystalline ice shards pierce the air!`);
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
        
        // Visual effect at target
        setTimeout(() => {
            this.createVisualEffect(targetPos, 'shard', { count: 3 });
        }, 300);
    }
    
    selectRandomTarget(enemies) {
        if (enemies.length === 0) return null;
        return enemies[Math.floor(Math.random() * enemies.length)];
    }
}