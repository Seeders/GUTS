class IceShardAbility extends GUTS.BaseAbility {
    constructor(game, abilityData = {}) {
        super(game, abilityData);

        this.damage       = abilityData.damage       ?? 40;
        this.shardCount   = abilityData.shardCount   ?? 3;
        this.slowDuration = abilityData.slowDuration ?? 3.0;
        this.element      = this.enums.element[abilityData.element || 'cold'] ?? this.enums.element.cold;
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
        this.playConfiguredEffects('cast', casterPos);
        this.logAbilityUsage(casterEntity, `Crystalline ice shards pierce the air!`);

        // Schedule all shards with staggered timing
        for (let i = 0; i < this.shardCount; i++) {
            // First shard at the release point (queue already waited), then stagger
            const shardDelay = i * 0.2;

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
        this.playConfiguredEffects('launch', casterPos);

        // Create frost trail effect using preset effects
        if (!this.game.isServer) {
            // Create trail particles along path
            const trailCount = 5;
            for (let i = 0; i < trailCount; i++) {
                const progress = (i + 1) / (trailCount + 1);
                const trailX = casterPos.x + (targetPos.x - casterPos.x) * progress;
                const trailY = casterPos.y + (targetPos.y - casterPos.y) * progress + 50;
                const trailZ = casterPos.z + (targetPos.z - casterPos.z) * progress;

                this.game.schedulingSystem.scheduleAction(() => {
                    this.playConfiguredEffects('trail', { x: trailX, y: trailY, z: trailZ });
                }, i * 0.05, null);
            }
        }

        // Deal damage
        this.dealDamageWithEffects(casterEntity, targetId, this.damage, this.element, {
            isIceShard: true
        });

        // Apply slow buff (BuffEffectsSystem reads slowed.movementSpeedMultiplier
        // and attackSpeedMultiplier and applies them each tick).
        const enums = this.game.getEnums();
        // applyBuff refreshes an existing slowed buff in place; the old
        // clobber-any-buff removal was a legacy single-slot workaround.
        this.applyBuff(targetId, {
            buffType: enums.buffTypes.slowed,
            endTime: this.game.state.now + this.slowDuration,
            appliedTime: this.game.state.now,
            stacks: 1,
            sourceEntity: casterEntity
        });

        // Impact effect at target
        this.game.schedulingSystem.scheduleAction(() => {
            const transform = this.game.getComponent(targetId, "transform");
            const currentTargetPos = transform?.position;
            if (currentTargetPos) {
                this.playConfiguredEffects('impact', currentTargetPos);
            }
        }, 0.25, casterEntity);
    }
}
